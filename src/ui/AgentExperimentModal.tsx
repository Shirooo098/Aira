import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { DatabaseSession } from '../db/database.ts';
import { prepareAgentTool } from '../actions/agent-tools.ts';
import type { AgentToolResult, ReviewedAgentCartItem } from '../actions/agent-tools.ts';
import { createLlamaAgentAdapter } from '../agent/llama-adapter.ts';
import { createAgentSession, type AgentSessionState } from '../agent/agent-session.ts';
import { formatCentavos } from '../domain/money.ts';
import { agentExperimentStyles as styles } from './agent-experiment-styles.ts';

interface AgentExperimentModalProps {
  visible: boolean;
  db: DatabaseSession;
  onClose: () => void;
}

function productLabel(product: { name: string; variant: string; unit: string }): string {
  return `${product.name} (${product.variant}, ${product.unit})`;
}

function toolRequestSummary(result: AgentToolResult): Record<string, string | number> {
  return result.kind === 'catalog_lookup'
    ? { tool: 'catalog_lookup', query: result.query }
    : { tool: 'propose_cart_item', query: result.query, quantity: result.quantity };
}

function lookupSummary(result: Extract<AgentToolResult, { kind: 'catalog_lookup' }>): string {
  switch (result.lookup.kind) {
    case 'exact':
      return 'Eksaktong tugma mula sa catalog.';
    case 'ambiguous':
      return `May posibleng tugma (${result.lookup.products.length}). Tingnan ang buong pangalan at variant; hindi ito awtomatikong pinili.`;
    case 'unknown':
      return 'Walang tugma sa naka-save na catalog.';
    case 'empty':
      return 'Walang product query na naibalik.';
  }
}

function formatProductDetails(product: {
  name: string;
  variant: string;
  unit: string;
  priceCentavos: number;
  quantity?: number | null;
}): string {
  const stock = product.quantity === undefined
    ? ''
    : product.quantity === null
      ? ' • Hindi pa naitala ang stock'
      : ` • Stock: ${product.quantity} ${product.unit}`;
  return `${productLabel(product)} • ${formatCentavos(product.priceCentavos)}${stock}`;
}

function ProductChoice({
  product,
  selected,
  onPress,
}: {
  product: { id: string; name: string; variant: string; unit: string; priceCentavos: number; quantity?: number | null };
  selected?: boolean;
  onPress?: () => void;
}): React.JSX.Element {
  const content = (
    <>
      <Text style={styles.productName}>{productLabel(product)}</Text>
      <Text style={styles.productMeta}>{formatProductDetails(product)}</Text>
    </>
  );

  if (!onPress) {
    return <View style={[styles.productCard, selected && styles.selectedProductCard]}>{content}</View>;
  }

  return (
    <TouchableOpacity
      style={[styles.productCard, selected && styles.selectedProductCard]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      accessibilityLabel={`Piliin ang ${productLabel(product)}`}
    >
      {content}
    </TouchableOpacity>
  );
}

function CatalogLookupResult({ result }: { result: Extract<AgentToolResult, { kind: 'catalog_lookup' }> }): React.JSX.Element {
  const { lookup } = result;
  return (
    <View>
      <Text style={styles.summary}>{lookupSummary(result)}</Text>
      {lookup.kind === 'exact' && (
        <ProductChoice product={lookup.product} />
      )}
      {lookup.kind === 'ambiguous' && lookup.products.map((product) => (
        <ProductChoice key={product.id} product={product} />
      ))}
    </View>
  );
}

function CartProposalResult({
  result,
  selectedCandidateId,
  onSelectCandidate,
}: {
  result: Extract<AgentToolResult, { kind: 'cart_item_proposal' }>;
  selectedCandidateId: string | null;
  onSelectCandidate: (id: string) => void;
}): React.JSX.Element {
  return (
    <View>
      <Text style={styles.summary}>Dami na iminungkahi ng model: {result.quantity}</Text>
      <Text style={[styles.summary, { marginTop: 6 }]}>{result.message}</Text>
      {result.resolution === 'exact' && result.product && (
        <ProductChoice product={result.product} />
      )}
      {result.resolution === 'ambiguous' && result.candidates.map((product) => (
        <ProductChoice
          key={product.id}
          product={product}
          selected={selectedCandidateId === product.id}
          onPress={() => onSelectCandidate(product.id)}
        />
      ))}
      {result.resolution === 'unknown' && (
        <Text style={styles.noticeText}>Hindi maaaring aprubahan ang produktong wala sa catalog.</Text>
      )}
    </View>
  );
}

function ReviewedCartItem({ item }: { item: ReviewedAgentCartItem }): React.JSX.Element {
  return (
    <View style={styles.notice}>
      <Text style={styles.sectionTitle}>Nasuring pansamantalang cart item</Text>
      <Text style={styles.productName}>{productLabel(item.product)}</Text>
      <Text style={styles.productMeta}>Dami: {item.quantity}</Text>
      <Text style={styles.productMeta}>Presyo sa catalog: {formatCentavos(item.product.priceCentavos)}</Text>
      <Text style={styles.noticeText}>
        Nasa screen lang ang draft. Walang nabagong cart, stock, catalog, o tala ng benta.
      </Text>
    </View>
  );
}

export function AgentExperimentModal({
  visible,
  db,
  onClose,
}: AgentExperimentModalProps): React.JSX.Element {
  const session = useMemo(() => createAgentSession({
    runtime: createLlamaAgentAdapter(),
    execute: (request) => prepareAgentTool(db, request),
  }), [db]);
  const [state, setState] = useState<AgentSessionState>(() => session.getState());
  const [requestText, setRequestText] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        setSelectedCandidateId(null);
        void session.background();
      }
    });

    return () => {
      appStateSubscription.remove();
      unsubscribe();
      void session.close();
    };
  }, [session]);

  const busy = state.status === 'initializing' || state.status === 'running';
  const result = state.result;
  const cartProposal = result?.kind === 'cart_item_proposal' ? result : null;
  const mayReviewCart = cartProposal !== null && cartProposal.resolution !== 'unknown' &&
    (cartProposal.resolution === 'exact' || selectedCandidateId !== null) &&
    state.status === 'proposal';
  const validatedRequest = result ? JSON.stringify(toolRequestSummary(result), null, 2) : null;

  const handleRequestChange = (value: string) => {
    setRequestText(value);
    setSelectedCandidateId(null);
    if (value !== requestText) session.edit();
  };

  const handleRun = () => {
    if (busy || state.status !== 'ready' || !requestText.trim()) return;
    setSelectedCandidateId(null);
    void session.run(requestText.trim());
  };

  const handleReviewCart = () => {
    if (!mayReviewCart || !cartProposal) return;
    const candidateId = cartProposal.resolution === 'exact'
      ? cartProposal.product?.id
      : selectedCandidateId ?? undefined;
    void session.reviewCart(candidateId);
  };

  const statusLabel = (() => {
    switch (state.status) {
      case 'idle': return 'Hindi pa nasisimulan ang lokal na model';
      case 'initializing': return 'Inihahanda ang bundled na lokal na model';
      case 'ready': return 'Handa na ang lokal na model';
      case 'running': return 'Bumubuo ng isang constrained tool request';
      case 'proposal': return 'May proposal na naghihintay ng pagsusuri';
      case 'reviewed': return 'Nasuri na ang pansamantalang cart proposal';
      case 'error': return 'Hindi natuloy ang lokal na agent';
      case 'disposed': return 'Sarado na ang lokal na agent';
    }
  })();

  const canInitialize = state.status === 'idle';
  const canRun = !busy && state.status === 'ready' && requestText.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <Text style={styles.heading}>Lokal na Agent Experiment</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Isara ang lokal na agent experiment"
              >
                <Text style={styles.closeText}>Isara</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.subtitle}>
              Subukan ang isang Filipino request gamit ang bundled na on-device model. May dalawang tool lang ito:
              maghanap sa catalog o magmungkahi ng isang cart item para sa owner review.
            </Text>
            <Text style={styles.status} accessibilityLiveRegion="polite">{statusLabel}</Text>

            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                Para ito sa Android development build na may naka-bundle na model. Hindi suportado ng Expo Go ang custom local-model module.
                Walang mock o template fallback. Ang pag-review ay nananatili sa screen at hindi nagsa-save ng cart item, sale, stock, o catalog.
              </Text>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.secondaryButton, !canInitialize && styles.disabledButton]}
                disabled={!canInitialize}
                onPress={() => { void session.initialize(); }}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canInitialize, busy: state.status === 'initializing' }}
              >
                {state.status === 'initializing'
                  ? <ActivityIndicator color="#0369a1" />
                  : <Text style={styles.secondaryButtonText}>Ihanda ang local model</Text>}
              </TouchableOpacity>
            </View>
            <Text style={styles.helpText}>
              Hindi ito Whisper o voice input. I-type muna ang request. Ang setup at generation time dito ay hindi Oppo performance benchmark.
            </Text>

            <Text style={styles.label}>Maikling Filipino request</Text>
            <TextInput
              style={styles.input}
              value={requestText}
              onChangeText={handleRequestChange}
              editable={state.status !== 'disposed'}
              placeholder="Hal. Magkano ang Coke maliit?"
              placeholderTextColor="#94a3b8"
              maxLength={1000}
              accessibilityLabel="Filipino request para sa lokal na agent"
              onSubmitEditing={handleRun}
              returnKeyType="go"
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.primaryButton, !canRun && styles.disabledButton]}
                disabled={!canRun}
                onPress={handleRun}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canRun, busy: state.status === 'running' }}
              >
                {state.status === 'running'
                  ? <ActivityIndicator color="#ffffff" />
                  : <Text style={styles.primaryButtonText}>Bumuo ng guarded tool request</Text>}
              </TouchableOpacity>
            </View>

            {state.error && (
              <>
                <View style={styles.errorBox} accessibilityRole="alert">
                  <Text style={styles.errorText}>{state.error}</Text>
                </View>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => {
                    setSelectedCandidateId(null);
                    session.edit();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="I-reset ang local agent error"
                >
                  <Text style={styles.secondaryButtonText}>I-reset ang request at error</Text>
                </TouchableOpacity>
              </>
            )}

            {(state.rawOutput.length > 0 || state.status === 'error') && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Raw output ng lokal na model</Text>
                <Text selectable style={styles.rawOutput}>{state.rawOutput || '(Walang output)'}</Text>
              </View>
            )}

            {result && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Napatunayang tool request</Text>
                <Text selectable style={styles.rawOutput}>{validatedRequest}</Text>
                <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Resultang galing sa host at catalog</Text>
                {result.kind === 'catalog_lookup'
                  ? <CatalogLookupResult result={result} />
                  : <CartProposalResult
                      result={result}
                      selectedCandidateId={selectedCandidateId}
                      onSelectCandidate={setSelectedCandidateId}
                    />}
                {result.kind === 'cart_item_proposal' && result.resolution !== 'unknown' && (
                  <TouchableOpacity
                    style={[styles.primaryButton, !mayReviewCart && styles.disabledButton, { marginTop: 12 }]}
                    disabled={!mayReviewCart}
                    onPress={handleReviewCart}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !mayReviewCart }}
                  >
                    <Text style={styles.primaryButtonText}>Suriin ang pansamantalang cart item</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {state.reviewedItem && <ReviewedCartItem item={state.reviewedItem} />}

            {state.inferenceMs !== null && (
              <Text style={styles.footer}>
                Local JavaScript model generation: {state.inferenceMs} ms. Hindi ito Oppo hardware benchmark; kailangang sukatin muli sa target phone.
              </Text>
            )}
            {state.elapsedMs !== null && (
              <Text style={styles.footer}>
                Kabuuang local request time: {state.elapsedMs} ms, kasama ang validation at host catalog read.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
