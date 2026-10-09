import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { DatabaseSession } from '../db/database.ts';
import type { CatalogDraftState } from '../domain/catalog-draft-session.ts';
import { createCatalogDraftSession, selectCatalogProduct } from '../domain/catalog-draft-session.ts';
import {
  emptyCatalogChangeFields,
  extractCatalogTranscript,
  type CatalogChangeFields,
  type CatalogChangeKind,
} from '../domain/catalog-dictation.ts';
import {
  confirmCatalogChange,
  prepareCatalogChange,
} from '../actions/catalog-draft-actions.ts';
import { formatCentavos } from '../domain/money.ts';
import type { ProductWithStock } from '../types.ts';
import { SpeechTranscriptInput } from './SpeechTranscriptInput.tsx';
import { catalogDictationStyles as styles } from './catalog-dictation-styles.ts';

interface CatalogDictationModalProps {
  db: DatabaseSession;
  products: ProductWithStock[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const INTENTS: ReadonlyArray<{ kind: CatalogChangeKind; label: string }> = [
  { kind: 'new_product', label: 'Bagong produkto' },
  { kind: 'price_update', label: 'Bagong presyo' },
  { kind: 'set_count', label: 'Itakda ang bilang' },
  { kind: 'add_delivery', label: 'Magdagdag ng delivery' },
];

function productName(product: { name: string; variant: string; unit: string }): string {
  return `${product.name} (${product.variant}, ${product.unit})`;
}

function CatalogField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  editable?: boolean;
}): React.JSX.Element {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        keyboardType={keyboardType}
        editable={editable}
        accessibilityLabel={label.replace(/\s\*$/u, '')}
      />
    </View>
  );
}

export function CatalogDictationModal({
  db,
  products,
  onClose,
  onSuccess,
}: CatalogDictationModalProps): React.JSX.Element {
  const session = useMemo(() => createCatalogDraftSession({
    prepare: (fields) => prepareCatalogChange(db, fields),
    save: (proposal) => confirmCatalogChange(db, proposal),
  }), [db]);
  const [state, setState] = useState<CatalogDraftState>(() => session.getState());
  const [fields, setFields] = useState<CatalogChangeFields>(() => emptyCatalogChangeFields());
  const [typedTranscript, setTypedTranscript] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [clarification, setClarification] = useState<string | null>(null);
  const [spokenNotice, setSpokenNotice] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const reviewGeneration = useRef(0);
  const saveInProgress = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = session.subscribe(setState);
    return () => {
      mountedRef.current = false;
      reviewGeneration.current++;
      unsubscribe();
      session.close();
    };
  }, [session]);

  const invalidateDraft = useCallback(() => {
    const status = session.getState().status;
    if (status === 'saving' || status === 'saved' || status === 'closed') return;
    reviewGeneration.current++;
    session.edit();
    setClarification(null);
    setSpokenNotice(null);
  }, [session]);

  const changeField = <K extends keyof CatalogChangeFields>(key: K, value: CatalogChangeFields[K]) => {
    invalidateDraft();
    setWarnings([]);
    setFields((current) => ({ ...current, [key]: value }));
  };

  const applyTranscript = useCallback((text: string) => {
    if (session.getState().status === 'saving' || session.getState().status === 'saved' || session.getState().status === 'closed') return;
    invalidateDraft();
    setTypedTranscript(text);
    const extracted = extractCatalogTranscript(text, fields.kind);
    setFields(extracted.fields);
    setWarnings(extracted.warnings);
  }, [fields.kind, invalidateDraft, session]);

  const changeIntent = (kind: CatalogChangeKind) => {
    if (kind === fields.kind || state.status === 'saving') return;
    invalidateDraft();
    setFields(emptyCatalogChangeFields(kind));
    setWarnings([]);
    setTypedTranscript('');
    setShowAllProducts(false);
  };

  const handleProductQuery = (value: string) => {
    invalidateDraft();
    setFields((current) => ({
      ...current,
      productQuery: value,
      productId: null,
      name: '',
      variant: '',
      unit: '',
    }));
    setWarnings([]);
  };

  const selectProduct = (product: ProductWithStock) => {
    invalidateDraft();
    setFields((current) => selectCatalogProduct(current, product));
    setWarnings([]);
    setShowAllProducts(false);
  };

  const matchingProducts = fields.productQuery.trim()
    ? products.filter((product) => {
        const identity = `${product.name} ${product.variant} ${product.unit}`.toLocaleLowerCase();
        return identity.includes(fields.productQuery.trim().toLocaleLowerCase());
      })
    : [];
  const visibleProducts = showAllProducts ? products : matchingProducts;
  const selectedProduct = fields.productId
    ? products.find((product) => product.id === fields.productId) ?? null
    : null;

  const handleReview = async () => {
    if (state.status === 'saving' || state.status === 'reviewing') return;
    const token = ++reviewGeneration.current;
    setClarification(null);
    setSpokenNotice(null);
    await session.review(fields);
    if (!mountedRef.current || token !== reviewGeneration.current) return;
    const current = session.getState();
    if (current.status === 'editing' && current.error) setClarification(current.error);
  };

  const finishSave = async (source: 'button' | 'spoken', transcript = '') => {
    if (saveInProgress.current || state.status !== 'reviewed') return;
    saveInProgress.current = true;
    setSpokenNotice(null);
    try {
      const product = await session.confirm(source, transcript);
      if (!mountedRef.current) return;
      if (product) {
        const proposal = session.getState().proposal;
        let message: string;
        if (proposal?.kind === 'new_product') {
          message = `Naitala ang ${productName(product)} sa halagang ${formatCentavos(product.priceCentavos)}.`;
        } else if (proposal?.kind === 'price_update') {
          message = `Na-update ang presyo ng ${productName(product)} sa ${formatCentavos(product.priceCentavos)}.`;
        } else if (proposal?.kind === 'add_delivery') {
          message = `Naitala ang delivery para sa ${productName(product)}.`;
        } else {
          message = `Na-update ang bilang ng stock para sa ${productName(product)}.`;
        }
        onSuccess(message);
        onClose();
      } else if (session.getState().status === 'reviewed' && source === 'spoken') {
        setSpokenNotice('Walang na-save. Sabihin lamang ang “kumpirmahin” para tanggapin ang nasuring pagbabago.');
      }
    } finally {
      saveInProgress.current = false;
    }
  };

  const handleClose = () => {
    if (session.getState().status === 'saving' || saveInProgress.current) return;
    reviewGeneration.current++;
    onClose();
  };

  const proposal = state.proposal;
  const busy = state.status === 'saving';
  const selectedKind = fields.kind;
  const editable = !busy;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalCard}>
          <View style={styles.header}>
            <Text style={styles.title}>Idikta ang pagbabago sa paninda</Text>
            <Text style={styles.subtitle}>Suriin ang mga field at kumpirmahin bago maitala.</Text>
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            keyboardShouldPersistTaps="handled"
          >
            {state.status !== 'reviewed' && state.status !== 'saving' && state.status !== 'saved' && (
              <SpeechTranscriptInput
                title="Magsalita ng detalye"
                description="Magsalita sa Filipino o Taglish. Lalabas muna ang transcript para masuri mo bago kunin ang mga field."
                reviewLabel="Gamitin ang transcript"
                onDraftChanged={invalidateDraft}
                onReviewed={applyTranscript}
              />
            )}

            <View style={styles.typedTranscriptCard}>
              <Text style={styles.sectionTitle}>
                {state.status === 'reviewed' ? 'Transcript na sinuri' : 'O mag-type ng transcript'}
              </Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={typedTranscript}
                onChangeText={(text) => {
                  if (session.getState().status === 'saving') return;
                  invalidateDraft();
                  setTypedTranscript(text);
                  setWarnings([]);
                }}
                editable={editable}
                multiline
                textAlignVertical="top"
                placeholder="hal. Lucky Me chicken, 15 pesos, 10 pieces"
                placeholderTextColor="#94a3b8"
                accessibilityLabel="Transcript ng detalye ng produkto"
              />
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => applyTranscript(typedTranscript)}
                disabled={!typedTranscript.trim() || !editable}
                accessibilityRole="button"
                accessibilityLabel="Kunin ang mga field mula sa transcript"
              >
                <Text style={styles.secondaryButtonText}>Kunin ang mga detalye</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Ano ang babaguhin?</Text>
            <View style={styles.intentGrid}>
              {INTENTS.map(({ kind, label }) => (
                <TouchableOpacity
                  key={kind}
                  style={[styles.intentButton, selectedKind === kind && styles.intentButtonSelected]}
                  onPress={() => changeIntent(kind)}
                  disabled={!editable}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedKind === kind, disabled: !editable }}
                >
                  <Text style={[styles.intentButtonText, selectedKind === kind && styles.intentButtonTextSelected]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {warnings.length > 0 && (
              <View style={styles.warningBox} accessibilityRole="alert">
                <Text style={styles.warningTitle}>Kailangan pang linawin</Text>
                {warnings.map((warning, index) => (
                  <Text key={`${index}-${warning}`} style={styles.warningText}>• {warning}</Text>
                ))}
              </View>
            )}

            {selectedKind === 'new_product' ? (
              <View style={styles.fieldsCard}>
                <Text style={styles.sectionTitle}>Detalye ng bagong produkto</Text>
                <CatalogField
                  label="Pangalan ng produkto *"
                  value={fields.name}
                  onChangeText={(value) => changeField('name', value)}
                  placeholder="hal. Lucky Me chicken"
                  editable={editable}
                />
                <CatalogField
                  label="Variant o laki *"
                  value={fields.variant}
                  onChangeText={(value) => changeField('variant', value)}
                  placeholder="hal. Chicken, 60g"
                  editable={editable}
                />
                <CatalogField
                  label="Unit na ibinebenta *"
                  value={fields.unit}
                  onChangeText={(value) => changeField('unit', value)}
                  placeholder="hal. piraso, pack, bote"
                  editable={editable}
                />
                <CatalogField
                  label="Presyo sa piso *"
                  value={fields.priceInput}
                  onChangeText={(value) => changeField('priceInput', value)}
                  placeholder="hal. 15, 15.50"
                  keyboardType="decimal-pad"
                  editable={editable}
                />
                <CatalogField
                  label="Panimulang bilang *"
                  value={fields.quantityInput}
                  onChangeText={(value) => changeField('quantityInput', value)}
                  placeholder="hal. 10"
                  keyboardType="number-pad"
                  editable={editable}
                />
              </View>
            ) : (
              <View style={styles.fieldsCard}>
                <Text style={styles.sectionTitle}>Piliin ang eksaktong produkto</Text>
                <CatalogField
                  label="Hanapin sa talaan ng paninda *"
                  value={fields.productQuery}
                  onChangeText={handleProductQuery}
                  placeholder="Pangalan, variant, o unit"
                  editable={editable}
                />
                {selectedProduct ? (
                  <View style={styles.selectedProduct}>
                    <Text style={styles.selectedProductTitle}>Napiling produkto</Text>
                    <Text style={styles.selectedProductIdentity}>{productName(selectedProduct)}</Text>
                    <Text style={styles.selectedProductPrice}>
                      Kasalukuyang presyo: {formatCentavos(selectedProduct.priceCentavos)}
                    </Text>
                    <TouchableOpacity
                      style={styles.clearSelectionButton}
                      onPress={() => handleProductQuery(fields.productQuery)}
                      disabled={!editable}
                      accessibilityRole="button"
                    >
                      <Text style={styles.clearSelectionText}>Pumili muli</Text>
                    </TouchableOpacity>
                  </View>
                ) : visibleProducts.length > 0 ? (
                  <View style={styles.productChoices}>
                    <Text style={styles.choiceHint}>
                      {showAllProducts ? 'Pumili gamit ang buong pangalan, variant, at unit:' : 'Pindutin ang buong pangalan, variant, at unit:'}
                    </Text>
                    {visibleProducts.map((product) => (
                      <TouchableOpacity
                        key={product.id}
                        style={styles.productChoice}
                        onPress={() => selectProduct(product)}
                        disabled={!editable}
                        accessibilityRole="button"
                        accessibilityLabel={`Piliin ang ${productName(product)}`}
                      >
                        <Text style={styles.productChoiceTitle}>{product.name}</Text>
                        <Text style={styles.productChoiceMeta}>{product.variant} • {product.unit}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : fields.productQuery.trim() ? (
                  <View>
                    <Text style={styles.emptyChoices}>Walang direktang tugma. Piliin mula sa buong talaan kung ang sinabi ay bansag.</Text>
                    {!showAllProducts && products.length > 0 && (
                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => setShowAllProducts(true)}
                        disabled={!editable}
                        accessibilityRole="button"
                        accessibilityLabel="Ipakita ang lahat ng produkto"
                      >
                        <Text style={styles.secondaryButtonText}>Ipakita ang lahat ng produkto</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <Text style={styles.emptyChoices}>Mag-type ng pangalan upang makita ang mga pagpipilian.</Text>
                )}

                {selectedKind === 'price_update' && (
                  <CatalogField
                    label="Bagong presyo sa piso *"
                    value={fields.priceInput}
                    onChangeText={(value) => changeField('priceInput', value)}
                    placeholder="hal. 18.50"
                    keyboardType="decimal-pad"
                    editable={editable}
                  />
                )}
                {(selectedKind === 'set_count' || selectedKind === 'add_delivery') && (
                  <CatalogField
                    label={selectedKind === 'set_count' ? 'Bagong bilang ng stock *' : 'Dami ng delivery *'}
                    value={fields.quantityInput}
                    onChangeText={(value) => changeField('quantityInput', value)}
                    placeholder={selectedKind === 'set_count' ? 'hal. 10' : 'hal. 12'}
                    keyboardType="number-pad"
                    editable={editable}
                  />
                )}
              </View>
            )}

            {clarification && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>{clarification}</Text>
              </View>
            )}
            {state.error && state.error !== clarification && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>{state.error}</Text>
              </View>
            )}
            {spokenNotice && (
              <View style={styles.noticeBox} accessibilityRole="alert">
                <Text style={styles.noticeText}>{spokenNotice}</Text>
              </View>
            )}

            {proposal && (
              <View style={styles.proposalCard}>
                <Text style={styles.proposalTitle}>Suriin bago kumpirmahin</Text>
                <Text style={styles.proposalIdentity}>{productName(proposal.product)}</Text>
                {proposal.kind === 'new_product' && (
                  <>
                    <View style={styles.proposalRow}>
                      <Text style={styles.proposalLabel}>Presyo</Text>
                      <Text style={styles.proposalValue}>{proposal.priceCentavos !== null ? formatCentavos(proposal.priceCentavos) : 'Kailangan pang linawin'}</Text>
                    </View>
                    <View style={styles.proposalRow}>
                      <Text style={styles.proposalLabel}>Panimulang bilang</Text>
                      <Text style={styles.proposalValue}>
                        {proposal.quantity !== null ? `${proposal.quantity} ${proposal.product.unit}` : 'Kailangan pang linawin'}
                      </Text>
                    </View>
                  </>
                )}
                {proposal.kind === 'price_update' && (
                  <>
                    <View style={styles.proposalRow}>
                      <Text style={styles.proposalLabel}>Dating presyo</Text>
                      <Text style={styles.proposalValue}>{formatCentavos(proposal.product.priceCentavos)}</Text>
                    </View>
                    <View style={styles.proposalRow}>
                      <Text style={styles.proposalLabel}>Bagong presyo</Text>
                      <Text style={styles.proposalValueHighlight}>
                        {proposal.priceCentavos !== null ? formatCentavos(proposal.priceCentavos) : 'Kailangan pang linawin'}
                      </Text>
                    </View>
                  </>
                )}
                {proposal.kind === 'set_count' && (
                  <>
                    <View style={styles.proposalRow}>
                      <Text style={styles.proposalLabel}>Dating bilang</Text>
                      <Text style={styles.proposalValue}>
                        {proposal.previousQuantity !== null ? `${proposal.previousQuantity} ${proposal.product.unit}` : 'Walang naitalang bilang'}
                      </Text>
                    </View>
                    <View style={styles.proposalRow}>
                      <Text style={styles.proposalLabel}>Itatakdang bilang</Text>
                      <Text style={styles.proposalValueHighlight}>
                        {proposal.quantity !== null ? `${proposal.quantity} ${proposal.product.unit}` : 'Kailangan pang linawin'}
                      </Text>
                    </View>
                  </>
                )}
                {proposal.kind === 'add_delivery' && (
                  <>
                    <View style={styles.proposalRow}>
                      <Text style={styles.proposalLabel}>Dating bilang</Text>
                      <Text style={styles.proposalValue}>
                        {proposal.previousQuantity !== null ? `${proposal.previousQuantity} ${proposal.product.unit}` : 'Walang naitalang bilang'}
                      </Text>
                    </View>
                    <View style={styles.proposalRow}>
                      <Text style={styles.proposalLabel}>Idadagdag na delivery</Text>
                      <Text style={styles.proposalValueHighlight}>
                        {proposal.quantity !== null ? `+${proposal.quantity} ${proposal.product.unit}` : 'Kailangan pang linawin'}
                      </Text>
                    </View>
                    {proposal.quantity !== null && (
                      <View style={styles.proposalRow}>
                        <Text style={styles.proposalLabel}>Magiging bilang</Text>
                        <Text style={styles.proposalValue}>
                          {(proposal.previousQuantity ?? 0) + proposal.quantity} {proposal.product.unit}
                        </Text>
                      </View>
                    )}
                  </>
                )}
                {proposal.kind === 'add_delivery' && proposal.previousQuantity === null && (
                  <Text style={styles.proposalNote}>Walang naitalang dating bilang; ipapakita ang bagong bilang pagkatapos matanggap ang delivery.</Text>
                )}
              </View>
            )}

            {state.status === 'reviewed' && (
              <View style={styles.confirmSpeechCard}>
                <Text style={styles.sectionTitle}>O kumpirmahin sa boses</Text>
                <Text style={styles.confirmSpeechHint}>
                  Pagkatapos suriin ang detalye sa itaas, sabihin lamang ang “kumpirmahin”.
                </Text>
                <SpeechTranscriptInput
                  title="Kumpirmahin ang nasuring pagbabago"
                  description="Ang eksaktong kumpirmasyon lamang ang tatanggapin. Ang ibang sinabi ay hindi magse-save."
                  reviewLabel="Ipadala ang kumpirmasyon"
                  onReviewed={(text) => { void finishSave('spoken', text); }}
                />
              </View>
            )}
          </ScrollView>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.cancelButton, busy && styles.buttonDisabled]}
              onPress={handleClose}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Kanselahin ang pagbabago"
            >
              <Text style={styles.cancelButtonText}>{busy ? 'Nagse-save...' : 'Kanselahin'}</Text>
            </TouchableOpacity>
            {state.status === 'reviewed' ? (
              <TouchableOpacity
                style={[styles.confirmButton, (busy || saveInProgress.current) && styles.buttonDisabled]}
                onPress={() => { void finishSave('button'); }}
                disabled={busy || saveInProgress.current}
                accessibilityRole="button"
                accessibilityLabel="Kumpirmahin at i-save ang pagbabago"
              >
                {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.confirmButtonText}>Kumpirmahin at i-save</Text>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.confirmButton, state.status === 'reviewing' && styles.buttonDisabled]}
                onPress={() => { void handleReview(); }}
                disabled={state.status === 'reviewing' || busy}
                accessibilityRole="button"
                accessibilityLabel="Suriin ang pagbabago"
              >
                {state.status === 'reviewing' ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.confirmButtonText}>Suriin ang pagbabago</Text>}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
