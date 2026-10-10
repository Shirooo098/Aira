import { colors, radii } from './theme.ts';
import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import type { DatabaseSession } from '../db/database.ts';
import { formatCentavos, parseCentavos } from '../domain/money.ts';
import {
  attachReceipt,
  reviewReceiptForSale,
  type ReceiptAttachment,
  type ReceiptTarget,
} from '../actions/receipt-actions.ts';
import { proposeReceiptFields } from '../domain/receipt.ts';

interface ReceiptReviewModalProps {
  visible: boolean;
  onClose: () => void;
  targetKind: 'sale' | 'pending_draft';
  targetId: string;
  expectedAmountCentavos: number;
  db: DatabaseSession;
  onSaved: (attachment: ReceiptAttachment) => void;
  existingAttachment?: ReceiptAttachment | null;
  initialImagePath?: string;
  initialRawText?: string;
}

export function ReceiptReviewModal({
  visible,
  onClose,
  targetKind,
  targetId,
  expectedAmountCentavos,
  db,
  onSaved,
  existingAttachment,
  initialImagePath,
  initialRawText,
}: ReceiptReviewModalProps): React.JSX.Element {
  const [imagePath, setImagePath] = useState(
    existingAttachment?.imagePath ?? initialImagePath ?? 'file:///receipts/sample-receipt.jpg'
  );
  const [amountStr, setAmountStr] = useState(
    existingAttachment?.amountCentavos !== null && existingAttachment?.amountCentavos !== undefined
      ? (existingAttachment.amountCentavos / 100).toFixed(2)
      : ''
  );
  const [reference, setReference] = useState(existingAttachment?.referenceNumber ?? '');
  const [senderName, setSenderName] = useState(existingAttachment?.senderName ?? '');
  const [senderMobile, setSenderMobile] = useState(existingAttachment?.senderMobile ?? '');
  const [rawText, setRawText] = useState(existingAttachment?.rawText ?? initialRawText ?? '');

  const [warnings, setWarnings] = useState<string[]>([]);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      if (existingAttachment) {
        setImagePath(existingAttachment.imagePath);
        setAmountStr(
          existingAttachment.amountCentavos !== null
            ? (existingAttachment.amountCentavos / 100).toFixed(2)
            : ''
        );
        setReference(existingAttachment.referenceNumber ?? '');
        setSenderName(existingAttachment.senderName ?? '');
        setSenderMobile(existingAttachment.senderMobile ?? '');
        setRawText(existingAttachment.rawText ?? '');
      } else if (initialRawText) {
        const proposal = proposeReceiptFields(initialRawText);
        setAmountStr(proposal.amountInput || '');
        setReference(proposal.referenceNumber || '');
        setSenderName(proposal.senderName || '');
        setSenderMobile(proposal.senderMobile || '');
        setWarnings(proposal.warnings);
      }
      setSaveError(null);
    }
  }, [visible, existingAttachment, initialRawText]);

  // Check duplicate references and amount match
  useEffect(() => {
    if (!visible || !reference.trim()) {
      setDuplicateWarning(null);
      return;
    }

    let isMounted = true;
    const target: ReceiptTarget = {
      kind: targetKind === 'pending_draft' ? 'pending' : 'sale',
      id: targetId,
    };

    reviewReceiptForSale(db, target, {
      rawText,
      amountInput: amountStr,
      amountCentavos: null,
      referenceNumber: reference,
      senderName,
      senderMobile,
      warnings: [],
    })
      .then((review) => {
        if (!isMounted) return;
        if (review.referenceUses.length > 0) {
          setDuplicateWarning(
            `Babala: Ang reference number (${reference.trim()}) ay nagamit na sa ${review.referenceUses.length} transaksyon sa tindahan.`
          );
        } else {
          setDuplicateWarning(null);
        }
      })
      .catch(() => {
        // Ignore background check failure
      });

    return () => {
      isMounted = false;
    };
  }, [visible, reference, targetKind, targetId, db, rawText, amountStr, senderName, senderMobile]);

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      let parsedCentavos: number | null = null;
      if (amountStr.trim()) {
        parsedCentavos = parseCentavos(amountStr.trim());
      }

      const attachment = await attachReceipt(db, {
        targetKind,
        targetId,
        imagePath: imagePath.trim(),
        amountCentavos: parsedCentavos,
        referenceNumber: reference.trim() || null,
        senderName: senderName.trim() || null,
        senderMobile: senderMobile.trim() || null,
        rawText: rawText.trim() || null,
      });

      onSaved(attachment);
      onClose();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Nabigo sa pag-save ng resibo.');
    } finally {
      setSaving(false);
    }
  };

  const parsedCurrentCentavos = (() => {
    try {
      return amountStr.trim() ? parseCentavos(amountStr.trim()) : null;
    } catch {
      return null;
    }
  })();

  const isAmountMismatch =
    parsedCurrentCentavos !== null && parsedCurrentCentavos !== expectedAmountCentavos;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Text style={styles.title}>Pagsusuri ng Resibo ng GCash</Text>
            <Text style={styles.subtitle}>
              Suriin at iwasto ang impormasyon mula sa resibo bago i-save.
            </Text>

            {/* Target Expected Info */}
            <View style={styles.infoBanner}>
              <Text style={styles.infoBannerText}>
                Inaasahang Halaga: {formatCentavos(expectedAmountCentavos)}
              </Text>
            </View>

            {/* Warning Banners */}
            {isAmountMismatch && (
              <View style={styles.warningBanner}>
                <Text style={styles.warningTitle}>⚠️ Magkaiba ang Halaga!</Text>
                <Text style={styles.warningText}>
                  Ang nakasulat sa resibo ({formatCentavos(parsedCurrentCentavos!)}) ay hindi tugma
                  sa kailangang bayaran ({formatCentavos(expectedAmountCentavos)}).
                </Text>
              </View>
            )}

            {duplicateWarning && (
              <View style={styles.warningBanner}>
                <Text style={styles.warningTitle}>⚠️ Posibleng Dobleng Resibo!</Text>
                <Text style={styles.warningText}>{duplicateWarning}</Text>
              </View>
            )}

            {warnings.map((w, index) => (
              <View key={index} style={styles.noteBanner}>
                <Text style={styles.noteText}>ℹ️ {w}</Text>
              </View>
            ))}

            {saveError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{saveError}</Text>
              </View>
            )}

            {/* Fields */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Halaga (Pesos):</Text>
              <TextInput
                style={styles.input}
                value={amountStr}
                onChangeText={setAmountStr}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Reference Number:</Text>
              <TextInput
                style={styles.input}
                value={reference}
                onChangeText={setReference}
                placeholder="Hal. 1002 9847 1234"
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Pangalan ng Nagpadala:</Text>
              <TextInput
                style={styles.input}
                value={senderName}
                onChangeText={setSenderName}
                placeholder="Hal. JUAN DELA CRUZ"
                autoCapitalize="words"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Numero ng Nagpadala:</Text>
              <TextInput
                style={styles.input}
                value={senderMobile}
                onChangeText={setSenderMobile}
                placeholder="Hal. 0917 *** 4567"
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Lokasyon ng Larawan (App-Private File):</Text>
              <TextInput
                style={[styles.input, styles.readOnlyInput]}
                value={imagePath}
                onChangeText={setImagePath}
                placeholder="file:///path/to/receipt.jpg"
              />
            </View>

            {/* Action Buttons */}
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.cancelBtnText}>Isara</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.saveBtnText}>I-save ang Resibo</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    maxHeight: '90%',
    width: '100%',
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primaryStrong,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 14,
  },
  infoBanner: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  infoBannerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  warningBanner: {
    backgroundColor: colors.warningSoft,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: colors.warningOutline,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.warning,
    marginBottom: 2,
  },
  warningText: {
    fontSize: 12,
    color: colors.warning,
  },
  noteBanner: {
    backgroundColor: colors.background,
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  noteText: {
    fontSize: 12,
    color: colors.primaryMuted,
  },
  errorBanner: {
    backgroundColor: colors.errorSoft,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
  },
  formGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radii.field,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  readOnlyInput: {
    backgroundColor: colors.background,
    color: colors.muted,
    fontSize: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    maxWidth: '100%',
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceSoft,
  },
  cancelBtnText: {
    textAlign: 'center',
    color: colors.primaryMuted,
    fontWeight: '600',
    fontSize: 14,
  },
  saveBtn: {
    maxWidth: '100%',
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: radii.button,
    backgroundColor: colors.primary,
  },
  saveBtnText: {
    textAlign: 'center',
    color: colors.surface,
    fontWeight: '700',
    fontSize: 14,
  },
});
