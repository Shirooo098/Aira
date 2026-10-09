import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { DatabaseSession } from '../db/database.ts';
import type { ProductWithStock } from '../types.ts';
import type { SpokenCartLine } from '../domain/spoken-order.ts';
import { createSpokenCartSession, type SpokenCartState } from '../domain/spoken-cart-session.ts';
import {
  applySpokenOrderProposal,
  prepareSpokenOrder,
  type SpokenOrderProposal,
  type SpokenOrderSelection,
} from '../actions/spoken-order-actions.ts';
import { formatCentavos } from '../domain/money.ts';
import { SpeechTranscriptInput } from './SpeechTranscriptInput.tsx';
import { spokenOrderStyles as styles } from './spoken-order-styles.ts';

interface SpokenOrderModalProps {
  visible: boolean;
  db: DatabaseSession;
  initialCart: SpokenCartLine[];
  onClose: () => void;
  onApply: (cart: SpokenCartLine[]) => void;
}

interface AddItemEdit {
  productId: string | null;
  quantityText: string;
}

function productIdentity(product: ProductWithStock): string {
  return `${product.name}${product.variant ? ` · ${product.variant}` : ''} · ${product.unit}`;
}

function formatProductPrice(priceCentavos: number): string {
  return Number.isSafeInteger(priceCentavos) && priceCentavos >= 0
    ? formatCentavos(priceCentavos)
    : '—';
}

function parsePositiveQuantity(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const quantity = Number(value.trim());
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

function cartTotal(cart: SpokenCartLine[]): number | null {
  let total = 0;
  for (const line of cart) {
    const price = line.product.priceCentavos;
    if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      return null;
    }
    const subtotal = price * line.quantity;
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total + subtotal)) return null;
    total += subtotal;
  }
  return total;
}

function projectCart(
  cart: SpokenCartLine[],
  proposal: SpokenOrderProposal,
  targetProductId: string | null,
): { cart: SpokenCartLine[]; selection: SpokenOrderSelection } | null {
  if (proposal.kind === 'add') return null;

  const target = targetProductId ?? proposal.targetProductId;
  if (!target) return null;
  if (proposal.kind === 'remove') {
    if (!cart.some((line) => line.product.id === target)) return null;
    return {
      cart: cart.filter((line) => line.product.id !== target).map((line) => ({ ...line, product: { ...line.product } })),
      selection: { targetProductId: target },
    };
  }

  const quantity = proposal.quantity;
  if (quantity === null || !Number.isSafeInteger(quantity) || quantity < 1) return null;
  if (!cart.some((line) => line.product.id === target)) return null;
  return {
    cart: cart.map((line) => ({
      ...line,
      product: { ...line.product },
      ...(line.product.id === target ? { quantity } : {}),
    })),
    selection: { targetProductId: target },
  };
}

function CartLines({ cart }: { cart: SpokenCartLine[] }): React.JSX.Element {
  if (cart.length === 0) {
    return <Text style={styles.emptyText}>Walang laman ang cart.</Text>;
  }
  return (
    <View>
      {cart.map((line) => {
        const subtotal = line.product.priceCentavos * line.quantity;
        const validPrice = Number.isSafeInteger(line.product.priceCentavos) && line.product.priceCentavos >= 0;
        return (
          <View key={line.product.id} style={styles.cartLine}>
            <Text style={styles.cartName}>{productIdentity(line.product)}</Text>
            <Text style={styles.cartMeta}>
              {line.quantity} × {formatProductPrice(line.product.priceCentavos)} ={' '}
              {validPrice && Number.isSafeInteger(subtotal) && subtotal >= 0 ? formatCentavos(subtotal) : '—'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function SpokenOrderModal({
  visible,
  db,
  initialCart,
  onClose,
  onApply,
}: SpokenOrderModalProps): React.JSX.Element {
  const [session] = useState(() => createSpokenCartSession({
    prepare: (text, cart) => prepareSpokenOrder(db, text, cart),
    apply: (cart, proposal, selection) => applySpokenOrderProposal(cart, proposal, selection),
  }, initialCart));
  const [state, setState] = useState<SpokenCartState>(() => session.getState());
  const [commandText, setCommandText] = useState('');
  const [itemEditsState, setItemEditsState] = useState<{
    proposal: SpokenOrderProposal;
    edits: AddItemEdit[];
  } | null>(null);
  const [targetChoiceState, setTargetChoiceState] = useState<{
    proposal: SpokenOrderProposal;
    productId: string | null;
  } | null>(null);
  const activeRef = useRef(true);
  const closingRef = useRef(false);
  const applyingRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    const unsubscribe = session.subscribe(setState);
    return () => {
      activeRef.current = false;
      session.close();
      unsubscribe();
    };
  }, [session]);

  const itemEdits = state.proposal?.kind === 'add'
    ? itemEditsState?.proposal === state.proposal
      ? itemEditsState.edits
      : state.proposal.items.map((item) => ({
        productId: item.product?.id ?? null,
        quantityText: item.quantity === null ? '' : String(item.quantity),
      }))
    : [];
  const selectedTargetProductId = state.proposal && targetChoiceState?.proposal === state.proposal
    ? targetChoiceState.productId
    : state.proposal && state.proposal.kind !== 'add'
      ? state.proposal.targetProductId
      : null;

  const projected = useMemo(() => {
    if (!state.proposal) return null;
    if (state.proposal.kind === 'add') {
      // Product choices are only editable for unresolved phrases. Keep the selected catalog
      // identity with the projection so the preview uses the same saved product record.
      const cart = state.cart.map((line) => ({ ...line, product: { ...line.product } }));
      const selectionItems: Array<{ productId: string; quantity: number }> = [];
      for (const [index, item] of state.proposal.items.entries()) {
        const edit = itemEdits[index];
        const productId = item.product?.id ?? edit?.productId;
        const quantity = parsePositiveQuantity(edit?.quantityText ?? '');
        if (!productId || quantity === null) return null;
        const product = item.product ??
          item.candidates.find((candidate) => candidate.id === productId) ??
          null;
        if (!product) return null;
        selectionItems.push({ productId, quantity });
        const existing = cart.find((line) => line.product.id === productId);
        if (existing) {
          const nextQuantity = existing.quantity + quantity;
          if (!Number.isSafeInteger(nextQuantity)) return null;
          existing.quantity = nextQuantity;
        } else {
          cart.push({ product, quantity });
        }
      }
      return { cart, selection: { items: selectionItems } as SpokenOrderSelection };
    }
    return projectCart(state.cart, state.proposal, selectedTargetProductId);
  }, [state.cart, state.proposal, itemEdits, selectedTargetProductId]);

  const beforeTotal = cartTotal(state.cart);
  const afterTotal = projected ? cartTotal(projected.cart) : null;
  const isPreparing = state.status === 'preparing';
  const applyEnabled = visible && state.status === 'review' && projected !== null && afterTotal !== null && !closingRef.current;

  const handleClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    session.close();
    onClose();
  };

  const handleTranscriptInvalidated = () => {
    if (!activeRef.current || closingRef.current) return;
    setCommandText('');
    session.invalidate();
  };

  const handlePrepare = () => {
    if (!activeRef.current || closingRef.current || isPreparing || state.status === 'applied') return;
    const text = commandText.trim();
    if (!text) return;
    void session.prepare(text);
  };

  const handleApply = () => {
    if (!applyEnabled || applyingRef.current || !projected) return;
    applyingRef.current = true;
    const cart = session.apply(projected.selection);
    if (!cart) {
      applyingRef.current = false;
      return;
    }
    onApply(cart);
    handleClose();
  };

  const updateAddItem = (index: number, update: Partial<AddItemEdit>) => {
    const proposal = state.proposal;
    if (!proposal || proposal.kind !== 'add') return;
    const current = itemEditsState?.proposal === proposal
      ? itemEditsState.edits
      : proposal.items.map((item) => ({
        productId: item.product?.id ?? null,
        quantityText: item.quantity === null ? '' : String(item.quantity),
      }));
    setItemEditsState({
      proposal,
      edits: current.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item),
    });
  };

  const updateCorrectionTarget = (productId: string) => {
    const proposal = state.proposal;
    if (!proposal || proposal.kind === 'add') return;
    setTargetChoiceState({ proposal, productId });
  };

  const renderProductChoice = (
    product: ProductWithStock,
    selected: boolean,
    onPress: () => void,
  ) => (
    <TouchableOpacity
      key={product.id}
      style={[styles.choice, selected && styles.choiceSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Piliin ang ${productIdentity(product)}, ${formatProductPrice(product.priceCentavos)}`}
      accessibilityState={{ selected }}
    >
      <Text style={styles.choiceTitle}>{productIdentity(product)}</Text>
      <Text style={styles.choiceMeta}>
        Presyo: {formatProductPrice(product.priceCentavos)} • Stock:{' '}
        {product.quantity === null ? 'walang tala' : `${product.quantity} ${product.unit}`}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <Text style={styles.title}>Idikta ang order / itama ang dami</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Isara at itapon ang hindi pa nailalapat na utos"
              >
                <Text style={styles.closeButtonText}>Isara</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.subtitle}>
              Ihahanda lang nito ang pansamantalang cart. Suriin ang lahat bago ilapat sa draft ng checkout.
            </Text>

            <SpeechTranscriptInput
              title="Magsalita o maghanda ng transcript"
              description="Ihanda ang offline na boses, saka suriin at itama ang transcript. Maaari ring mag-type kung Expo Go ang gamit."
              reviewLabel="Gamitin ang transcript"
              onReviewedTranscript={(text) => {
                if (!activeRef.current || closingRef.current) return;
                session.invalidate();
                setCommandText(text);
              }}
              onTranscriptInvalidated={handleTranscriptInvalidated}
            />

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Utos sa cart</Text>
              <TextInput
                style={[styles.input, styles.commandInput]}
                value={commandText}
                onChangeText={(text) => {
                  setCommandText(text);
                  session.invalidate();
                }}
                placeholder="Hal. dalawang Coke at isang Lucky Me; isa lang pala ang Coke"
                placeholderTextColor="#94a3b8"
                multiline
                textAlignVertical="top"
                editable={!closingRef.current && state.status !== 'applied'}
                accessibilityLabel="I-type o itama ang utos para sa cart"
              />
              <TouchableOpacity
                style={[styles.primaryButton, (!commandText.trim() || isPreparing || state.status === 'applied') && styles.primaryButtonDisabled]}
                onPress={handlePrepare}
                disabled={!commandText.trim() || isPreparing || state.status === 'applied'}
                accessibilityRole="button"
                accessibilityLabel="Suriin ang utos sa cart"
              >
                {isPreparing ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Suriin ang utos</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.note}>
                Walang benta o bayad na itatala rito. Ang paglipat ng app sa ibang mode ay magtatapon ng hindi nailapat na utos.
              </Text>
            </View>

            {state.error && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>{state.error}</Text>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Bago — cart ngayon</Text>
              <CartLines cart={state.cart} />
              {beforeTotal !== null && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Kabuuan:</Text>
                  <Text style={styles.totalValue}>{formatCentavos(beforeTotal)}</Text>
                </View>
              )}
            </View>

            {state.proposal && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {state.proposal.kind === 'add' ? 'Suriin ang mga paninda' : 'Suriin ang pagbabago'}
                </Text>

                {state.proposal.kind === 'add' && state.proposal.items.map((item, index) => {
                  const edit = itemEdits[index] ?? { productId: null, quantityText: '' };
                  const choices = item.product ? [] : item.candidates;
                  const resolvedProduct = item.product ?? choices.find((product) => product.id === edit.productId) ?? null;
                  return (
                    <View key={`${item.query}-${index}`} style={styles.itemCard}>
                      <Text style={styles.query}>Narinig: “{item.query}”</Text>
                      {item.message && <Text style={styles.message}>{item.message}</Text>}
                      {item.product ? (
                        <Text style={styles.choiceMeta}>
                          Nahanap na paninda: {productIdentity(item.product)} • Presyo:{' '}
                          {formatProductPrice(item.product.priceCentavos)}
                        </Text>
                      ) : (
                        <>
                          <Text style={styles.fieldLabel}>
                            {item.candidates.length > 0
                              ? 'Pumili ng tamang pangalan, baryante, at yunit:'
                              : 'Hindi ito natagpuan. Piliin ang paninda mula sa buong catalog:'}
                          </Text>
                          {choices.length === 0 ? (
                            <Text style={styles.message}>Walang produktong nasa catalog. Idagdag muna ito sa Pamahalaan.</Text>
                          ) : choices.map((product) => renderProductChoice(
                            product,
                            edit.productId === product.id,
                            () => updateAddItem(index, { productId: product.id }),
                          ))}
                          {resolvedProduct && (
                            <Text style={styles.choiceMeta}>
                              Napiling paninda: {productIdentity(resolvedProduct)} • Presyo:{' '}
                              {formatProductPrice(resolvedProduct.priceCentavos)}
                            </Text>
                          )}
                        </>
                      )}
                      <Text style={styles.fieldLabel}>Dami (buong bilang):</Text>
                      <TextInput
                        style={styles.input}
                        value={edit.quantityText}
                        onChangeText={(quantityText) => updateAddItem(index, { quantityText })}
                        keyboardType="number-pad"
                        placeholder="Ilagay ang dami"
                        placeholderTextColor="#94a3b8"
                        accessibilityLabel={`Dami para sa ${item.query}`}
                      />
                      {parsePositiveQuantity(edit.quantityText) === null && (
                        <Text style={styles.message}>Ilagay ang wastong dami. Hindi magdaragdag ng isa bilang palagay.</Text>
                      )}
                    </View>
                  );
                })}

                {state.proposal.kind !== 'add' && (() => {
                  const proposal = state.proposal;
                  const target = proposal.targetProductId ?? selectedTargetProductId;
                  const targetLine = state.cart.find((line) => line.product.id === target);
                  return (
                    <View style={styles.itemCard}>
                      <Text style={styles.query}>
                        {proposal.kind === 'remove' ? 'Alisin sa cart' : `Itakda ang dami sa ${proposal.quantity ?? '—'}`}
                      </Text>
                      {proposal.message && <Text style={styles.message}>{proposal.message}</Text>}
                      {proposal.targetProductId ? (
                        <Text style={styles.choiceMeta}>
                          Paninda: {targetLine ? productIdentity(targetLine.product) : 'Hindi na makita sa kasalukuyang cart'}
                        </Text>
                      ) : (
                        <>
                          <Text style={styles.fieldLabel}>Piliin kung aling buong paninda ang ibig mong sabihin:</Text>
                          {proposal.candidates.map((line) => renderProductChoice(
                            line.product,
                            selectedTargetProductId === line.product.id,
                            () => updateCorrectionTarget(line.product.id),
                          ))}
                        </>
                      )}
                      {proposal.kind === 'set_quantity' && proposal.quantity === null && (
                        <Text style={styles.message}>Walang tinukoy na bagong dami. Sabihin o i-type muli ang utos kasama ang dami.</Text>
                      )}
                    </View>
                  );
                })()}
              </View>
            )}

            {state.proposal && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Pagkatapos — cart na ilalapat</Text>
                {projected ? <CartLines cart={projected.cart} /> : (
                  <Text style={styles.emptyText}>Kumpletuhin muna ang mga pagpili at wastong dami sa itaas.</Text>
                )}
                {projected && afterTotal !== null && (
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Kabuuan:</Text>
                    <Text style={styles.totalValue}>{formatCentavos(afterTotal)}</Text>
                  </View>
                )}
                {projected && afterTotal === null && (
                  <Text style={styles.message}>Hindi ligtas kalkulahin ang kabuuan. Suriin ang presyo at dami sa catalog.</Text>
                )}
              </View>
            )}

            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleClose}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryButtonText}>Itapon at isara</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, !applyEnabled && styles.primaryButtonDisabled]}
                onPress={handleApply}
                disabled={!applyEnabled}
                accessibilityRole="button"
                accessibilityLabel="Ilapat ang nasuring utos sa draft ng cart"
              >
                <Text style={styles.primaryButtonText}>Ilapat sa draft</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
