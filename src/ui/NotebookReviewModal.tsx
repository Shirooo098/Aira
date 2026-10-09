import React, { useState } from 'react';
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
  proposeNotebookCatalogUpdates,
  applyNotebookCatalogUpdates,
} from '../actions/notebook-actions.ts';
import type { NotebookProposalRow } from '../domain/notebook.ts';

interface NotebookReviewModalProps {
  visible: boolean;
  onClose: () => void;
  db: DatabaseSession;
  onApplied: (result: { updatedCount: number; createdCount: number }) => void;
}

const SAMPLE_NOTEBOOK_TEXT = `Coke 250ml 16.00
Lucky Me Pancit Canton (Kalamansi) 17.50
Bear Brand 33g sachet 13.00
Safeguard white bar 38.00`;

export function NotebookReviewModal({
  visible,
  onClose,
  db,
  onApplied,
}: NotebookReviewModalProps): React.JSX.Element {
  const [ocrInput, setOcrInput] = useState(SAMPLE_NOTEBOOK_TEXT);
  const [proposals, setProposals] = useState<NotebookProposalRow[]>([]);
  const [analyzed, setAnalyzed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!ocrInput.trim()) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      const rows = await proposeNotebookCatalogUpdates(db, ocrInput);
      setProposals(rows);
      setAnalyzed(true);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Nabigo sa pagsusuri ng notebook.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRow = (index: number, field: keyof NotebookProposalRow, value: string) => {
    setProposals((prev) => {
      const updated = [...prev];
      const row = { ...updated[index]! };

      if (field === 'name') row.name = value;
      if (field === 'variant') row.variant = value;
      if (field === 'unit') row.unit = value;
      if (field === 'priceInput') {
        row.priceInput = value;
        try {
          row.priceCentavos = parseCentavos(value);
        } catch {
          row.priceCentavos = null;
        }
      }

      // Re-evaluate readiness
      const reasons: string[] = [];
      if (!row.name.trim()) reasons.push('Kailangang tukuyin ang pangalan.');
      if (row.priceCentavos === null || row.priceCentavos <= 0) {
        reasons.push('Kailangang maglagay ng wastong presyo.');
      }
      row.clarificationReasons = reasons;
      row.status = reasons.length === 0 ? 'ready' : 'needs_clarification';

      updated[index] = row;
      return updated;
    });
  };

  const handleApply = async () => {
    setErrorMsg(null);
    setSaving(true);
    try {
      const result = await applyNotebookCatalogUpdates(db, proposals);
      onApplied(result);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Nabigo sa pag-apply ng notebook.');
    } finally {
      setSaving(false);
    }
  };

  const hasUnresolved = proposals.some((p) => p.status === 'needs_clarification');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>📓 Pagsusuri ng Notebook OCR</Text>
            <Text style={styles.subtitle}>
              Suriin ang mga nakasulat na paninda at presyo bago i-save sa tindahan.
            </Text>

            {errorMsg && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}

            {!analyzed ? (
              <View>
                <Text style={styles.label}>
                  Teksto mula sa Litrato ng Notebook (Bawat Linya):
                </Text>
                <TextInput
                  style={styles.multilineInput}
                  multiline
                  numberOfLines={6}
                  value={ocrInput}
                  onChangeText={setOcrInput}
                  placeholder="Ilagay o i-paste ang mga linya mula sa notebook..."
                />
                <TouchableOpacity
                  style={styles.analyzeBtn}
                  onPress={handleAnalyze}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.analyzeBtnText}>🔍 Suriin ang mga Paninda</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <View style={styles.summaryBar}>
                  <Text style={styles.summaryText}>
                    Natagpuan: {proposals.length} produkto • {proposals.filter((p) => p.action === 'update_price').length} bawas/dagdag-presyo • {proposals.filter((p) => p.action === 'create_product').length} bagong paninda
                  </Text>
                  <TouchableOpacity onPress={() => setAnalyzed(false)}>
                    <Text style={styles.reEditLink}>I-edit ang Teksto</Text>
                  </TouchableOpacity>
                </View>

                {proposals.map((row, idx) => (
                  <View key={row.id} style={styles.rowCard}>
                    <View style={styles.rowHeader}>
                      <Text style={styles.rawLineText}>"{row.rawLine}"</Text>
                      <View
                        style={[
                          styles.actionBadge,
                          row.action === 'update_price' ? styles.updateBadge : styles.newBadge,
                        ]}
                      >
                        <Text
                          style={[
                            styles.actionBadgeText,
                            row.action === 'update_price' ? styles.updateBadgeText : styles.newBadgeText,
                          ]}
                        >
                          {row.action === 'update_price' ? 'Presyo Lang' : 'Bagong Produkto'}
                        </Text>
                      </View>
                    </View>

                    {row.action === 'update_price' && row.existingPriceCentavos !== undefined && (
                      <View style={styles.priceDiffBanner}>
                        <Text style={styles.priceDiffText}>
                          Dating Presyo: {formatCentavos(row.existingPriceCentavos)} ➔ Bagong Presyo:{' '}
                          {row.priceCentavos ? formatCentavos(row.priceCentavos) : '—'}
                        </Text>
                        {row.existingStock !== null && row.existingStock !== undefined && (
                          <Text style={styles.stockPreservedText}>
                            Stock ngayon: {row.existingStock} {row.unit} (mananatili, hindi magagalaw)
                          </Text>
                        )}
                      </View>
                    )}

                    {row.clarificationReasons.length > 0 && (
                      <View style={styles.clarificationBanner}>
                        {row.clarificationReasons.map((r, rIdx) => (
                          <Text key={rIdx} style={styles.clarificationText}>
                            ⚠️ {r}
                          </Text>
                        ))}
                      </View>
                    )}

                    {/* Editable fields */}
                    <View style={styles.fieldsGrid}>
                      <View style={styles.fieldCol}>
                        <Text style={styles.miniLabel}>Pangalan:</Text>
                        <TextInput
                          style={styles.miniInput}
                          value={row.name}
                          onChangeText={(v) => handleUpdateRow(idx, 'name', v)}
                        />
                      </View>
                      <View style={styles.fieldCol}>
                        <Text style={styles.miniLabel}>Baryant:</Text>
                        <TextInput
                          style={styles.miniInput}
                          value={row.variant}
                          onChangeText={(v) => handleUpdateRow(idx, 'variant', v)}
                        />
                      </View>
                    </View>

                    <View style={styles.fieldsGrid}>
                      <View style={styles.fieldCol}>
                        <Text style={styles.miniLabel}>Yunit:</Text>
                        <TextInput
                          style={styles.miniInput}
                          value={row.unit}
                          onChangeText={(v) => handleUpdateRow(idx, 'unit', v)}
                        />
                      </View>
                      <View style={styles.fieldCol}>
                        <Text style={styles.miniLabel}>Presyo (₱):</Text>
                        <TextInput
                          style={styles.miniInput}
                          value={row.priceInput}
                          onChangeText={(v) => handleUpdateRow(idx, 'priceInput', v)}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    </View>
                  </View>
                ))}

                <View style={styles.buttonRow}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                    <Text style={styles.cancelBtnText}>Isara</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.applyBtn, (hasUnresolved || saving) && styles.applyBtnDisabled]}
                    onPress={handleApply}
                    disabled={hasUnresolved || saving}
                  >
                    {saving ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.applyBtnText}>
                        💾 I-apply ang mga Pagbabago sa Tindahan
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    maxHeight: '92%',
    width: '100%',
    padding: 18,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  multilineInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#1e293b',
    textAlignVertical: 'top',
    minHeight: 120,
    backgroundColor: '#f8fafc',
    marginBottom: 14,
  },
  analyzeBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  analyzeBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  summaryText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
    flex: 1,
  },
  reEditLink: {
    fontSize: 12,
    color: '#0284c7',
    fontWeight: '700',
    marginLeft: 8,
  },
  rowCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  rawLineText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#64748b',
    flex: 1,
    marginRight: 8,
  },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  actionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  updateBadge: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
    borderWidth: 1,
  },
  updateBadgeText: {
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: '700',
  },
  newBadge: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
  },
  newBadgeText: {
    color: '#065f46',
    fontSize: 11,
    fontWeight: '700',
  },
  priceDiffBanner: {
    backgroundColor: '#f8fafc',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  priceDiffText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e40af',
  },
  stockPreservedText: {
    fontSize: 11,
    color: '#059669',
    marginTop: 2,
    fontWeight: '600',
  },
  clarificationBanner: {
    backgroundColor: '#fffbeb',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
  },
  clarificationText: {
    fontSize: 12,
    color: '#92400e',
  },
  fieldsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  fieldCol: {
    flex: 1,
  },
  miniLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 2,
  },
  miniInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 13,
    color: '#1e293b',
    backgroundColor: '#ffffff',
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
  },
  errorText: {
    fontSize: 13,
    color: '#b91c1c',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  cancelBtnText: {
    color: '#475569',
    fontWeight: '600',
    fontSize: 14,
  },
  applyBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#059669',
  },
  applyBtnDisabled: {
    backgroundColor: '#9ca3af',
  },
  applyBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
