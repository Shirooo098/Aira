import { colors } from './theme.ts';
import React, { useEffect, useRef, useState } from 'react';
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
import type { ProductWithStock } from '../types.ts';
import { confirmAlias, prepareAlias } from '../actions/alias-actions.ts';
import { AliasValidationError, type AliasProposal } from '../domain/aliases.ts';
import { formatCentavos } from '../domain/money.ts';
import { aliasReviewStyles as styles } from './alias-review-styles.ts';

interface AliasReviewModalProps {
  db: DatabaseSession;
  product: ProductWithStock;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function AliasReviewModal({
  db,
  product,
  onClose,
  onSuccess,
}: AliasReviewModalProps): React.JSX.Element {
  const [aliasText, setAliasText] = useState('');
  const [proposal, setProposal] = useState<AliasProposal | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const reviewTokenRef = useRef<number | null>(null);
  const saveTokenRef = useRef<number | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      reviewTokenRef.current = null;
      saveTokenRef.current = null;
    };
  }, []);

  const isCurrentReview = (token: number) =>
    mountedRef.current &&
    generationRef.current === token &&
    reviewTokenRef.current === token;

  const isCurrentSave = (token: number) =>
    mountedRef.current &&
    generationRef.current === token &&
    saveTokenRef.current === token;

  const proposalMatchesInput =
    proposal !== null &&
    proposal.aliasText === aliasText.normalize('NFC').trim().replace(/\s+/gu, ' ');

  const handleAliasChange = (value: string) => {
    if (savingRef.current) return;

    // Editing means the previous exact proposal is no longer what the owner reviewed.
    generationRef.current += 1;
    reviewTokenRef.current = null;
    setAliasText(value);
    setProposal(null);
    setReviewing(false);
    setErrorMessage(null);
  };

  const handleReview = async () => {
    const alias = aliasText.trim();
    if (!alias || reviewTokenRef.current !== null || savingRef.current) return;

    const token = ++generationRef.current;
    reviewTokenRef.current = token;
    setProposal(null);
    setErrorMessage(null);
    setReviewing(true);

    try {
      const prepared = await prepareAlias(db, product.id, alias);
      if (isCurrentReview(token)) setProposal(prepared);
    } catch (err) {
      if (!isCurrentReview(token)) return;
      setErrorMessage(
        err instanceof AliasValidationError
          ? err.message
          : 'Hindi masuri ang bansag. Subukan muli.'
      );
      if (!(err instanceof AliasValidationError) && typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[AliasReviewModal] Alias review failed:', err);
      }
    } finally {
      if (reviewTokenRef.current === token) {
        reviewTokenRef.current = null;
        if (mountedRef.current && generationRef.current === token) {
          setReviewing(false);
        }
      }
    }
  };

  const handleConfirm = async () => {
    if (!proposalMatchesInput || !proposal || savingRef.current) return;

    const token = ++generationRef.current;
    saveTokenRef.current = token;
    savingRef.current = true;
    setErrorMessage(null);
    setSaving(true);

    try {
      await confirmAlias(db, proposal);
      if (!isCurrentSave(token)) return;
      onSuccess(`Naitala ang bansag na “${proposal.aliasText}” para sa ${product.name} (${product.variant}, ${product.unit}).`);
    } catch (err) {
      if (!isCurrentSave(token)) return;
      setErrorMessage(
        err instanceof AliasValidationError
          ? err.message
          : 'Hindi na-save ang bansag. Maaari mong subukan muli.'
      );
      if (!(err instanceof AliasValidationError) && typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[AliasReviewModal] Alias save failed:', err);
      }
    } finally {
      if (saveTokenRef.current === token) {
        saveTokenRef.current = null;
        savingRef.current = false;
        if (mountedRef.current && generationRef.current === token) setSaving(false);
      }
    }
  };

  const handleClose = () => {
    // Review is read-only and can be safely discarded. A confirmed save cannot be cancelled.
    if (savingRef.current) return;
    generationRef.current += 1;
    reviewTokenRef.current = null;
    onClose();
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalCard}>
          <Text style={styles.title}>Magdagdag ng Bansag</Text>
          <View style={styles.productCard}>
            <Text style={styles.productName}>{product.name}</Text>
            <Text style={styles.productDetails}>
              {product.variant} • {product.unit} • Presyo: {formatCentavos(product.priceCentavos)}
            </Text>
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.fieldLabel}>Bansag na ginagamit sa tindahan *</Text>
            <TextInput
              style={styles.input}
              value={aliasText}
              onChangeText={handleAliasChange}
              placeholder="hal. softdrinks, sabon ni ate"
              placeholderTextColor={colors.muted}
              editable={!saving}
              returnKeyType="done"
              onSubmitEditing={handleReview}
              accessibilityLabel="Bansag para sa produkto"
            />

            <Text style={styles.helpText}>
              Suriin muna ang bansag. Hindi ito itatala hangga’t hindi mo kinukumpirma.
            </Text>

            {reviewing && (
              <View style={styles.statusRow} accessibilityRole="progressbar" accessibilityLabel="Sinusuri ang bansag">
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.statusText}>Sinusuri ang bansag…</Text>
              </View>
            )}

            {proposalMatchesInput && proposal && (
              <View style={styles.proposalCard} accessibilityLiveRegion="polite">
                <Text style={styles.proposalTitle}>Suriin bago kumpirmahin</Text>
                <View style={styles.proposalRow}>
                  <Text style={styles.proposalLabel}>Bansag:</Text>
                  <Text style={styles.proposalValue}>{proposal.aliasText}</Text>
                </View>
                <View style={styles.proposalRow}>
                  <Text style={styles.proposalLabel}>Ituturo sa:</Text>
                  <Text style={styles.proposalValue}>
                    {proposal.product.name} ({proposal.product.variant}, {proposal.product.unit})
                  </Text>
                </View>
                {proposal.conflicts.length > 0 && (
                  <View style={styles.conflictWarning} accessibilityRole="alert">
                    <Text style={styles.conflictTitle}>May ibang produktong tumutugma rito</Text>
                    <Text style={styles.conflictText}>
                      Maaaring magpakita ang paghahanap ng mga pagpipilian sa ibaba. Suriin ang buong pangalan bago magpresyo.
                    </Text>
                    <Text style={styles.conflictProduct}>
                      • Piniling produkto: {proposal.product.name} ({proposal.product.variant}, {proposal.product.unit})
                    </Text>
                    {proposal.conflicts.map((conflict) => (
                      <Text key={conflict.id} style={styles.conflictProduct}>
                        • Iba pang produkto: {conflict.name} ({conflict.variant}, {conflict.unit})
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}

            {errorMessage && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton, saving && styles.buttonDisabled]}
              onPress={handleClose}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={saving ? 'Nagaganap ang pagsasave ng bansag' : 'Kanselahin ang pagdagdag ng bansag'}
              accessibilityState={{ disabled: saving }}
            >
              <Text style={styles.cancelButtonText}>Kanselahin</Text>
            </TouchableOpacity>

            {proposalMatchesInput && proposal && (
              <TouchableOpacity
                style={[styles.button, styles.confirmButton, saving && styles.buttonDisabled]}
                onPress={handleConfirm}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Kumpirmahin at itala ang bansag"
                accessibilityState={{ disabled: saving, busy: saving }}
              >
                {saving ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryButtonText}>Kumpirmahin</Text>}
              </TouchableOpacity>
            )}

            {!proposalMatchesInput && (
              <TouchableOpacity
                style={[styles.button, styles.reviewButton, (!aliasText.trim() || reviewing || saving) && styles.buttonDisabled]}
                onPress={handleReview}
                disabled={!aliasText.trim() || reviewing || saving}
                accessibilityRole="button"
                accessibilityLabel="Suriin ang bansag bago itala"
                accessibilityState={{ disabled: !aliasText.trim() || reviewing || saving, busy: reviewing }}
              >
                {reviewing ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryButtonText}>Suriin</Text>}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
