import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import type { DatabaseSession } from '../db/database.ts';
import type { ProductWithStock } from '../types.ts';
import type { ReportPeriodKey } from '../domain/reports.ts';
import {
  createDraftRestockChecklist,
  getLatestRestockChecklist,
  updateChecklistItem,
  approveRestockChecklist,
  discardRestockChecklist,
} from '../actions/restock-actions.ts';
import {
  createRestockSession,
  type RestockSessionState,
} from '../agent/restock-session.ts';
import { createLlamaRestockAdapter } from '../agent/llama-adapter.ts';
import type { RestockChecklist, RestockChecklistItem } from '../domain/restock.ts';
import { restockChecklistStyles as styles } from './restock-checklist-styles.ts';
import { colors } from './theme.ts';

interface RestockChecklistModalProps {
  db: DatabaseSession;
  visible: boolean;
  onClose: () => void;
  periodKey?: ReportPeriodKey;
  onOpenDelivery?: (product: ProductWithStock) => void;
}

export function RestockChecklistModal({
  db,
  visible,
  onClose,
  periodKey = 'today',
  onOpenDelivery,
}: RestockChecklistModalProps): React.JSX.Element | null {
  const [checklist, setChecklist] = useState<RestockChecklist | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiState, setAiState] = useState<RestockSessionState | null>(null);
  const [saving, setSaving] = useState(false);
  const sessionRef = useRef<ReturnType<typeof createRestockSession> | null>(null);

  const loadChecklist = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Check if there is an existing draft, or create a new grounded draft
      const latest = await getLatestRestockChecklist(db);
      if (latest && latest.status === 'draft') {
        setChecklist(latest);
      } else {
        const fresh = await createDraftRestockChecklist(db, { periodKey });
        setChecklist(fresh);
      }
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[RestockChecklistModal] Error loading checklist:', err);
      }
      setError('Hindi maihanda ang restock checklist. Pakisubukan muli.');
    } finally {
      setLoading(false);
    }
  }, [db, periodKey]);

  useEffect(() => {
    if (visible) {
      void loadChecklist();
    } else {
      setChecklist(null);
      setError(null);
      setAiState(null);
      void sessionRef.current?.dispose();
      sessionRef.current = null;
    }
    return () => {
      void sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [visible, loadChecklist]);

  const handleRunAi = async () => {
    if (!checklist || checklist.status !== 'draft') return;
    setError(null);
    try {
      let adapter;
      try {
        adapter = createLlamaRestockAdapter();
      } catch {
        // If native adapter is unavailable (e.g. running in web or dev client without llama), handle gracefully
        adapter = undefined;
      }

      const session = createRestockSession({
        db,
        runtime: adapter,
        periodKey: checklist.periodKey as ReportPeriodKey,
      });
      sessionRef.current = session;
      session.subscribe((s) => {
        setAiState(s);
        if (s.checklist) {
          setChecklist(s.checklist);
        }
      });
      await session.run();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nagka-aberya sa pagsusuri ng AI.');
    }
  };

  const handleToggleInclude = async (item: RestockChecklistItem) => {
    if (saving || checklist?.status !== 'draft') return;
    try {
      const updated = await updateChecklistItem(db, {
        itemId: item.id,
        isIncluded: !item.isIncluded,
      });
      setChecklist((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) => (i.id === item.id ? updated : i)),
            }
          : null
      );
    } catch (err) {
      Alert.alert('Aberya', 'Hindi ma-update ang item.');
    }
  };

  const handleUpdateQuantity = async (item: RestockChecklistItem, delta: number) => {
    if (saving || checklist?.status !== 'draft') return;
    const next = Math.max(1, item.requestedQuantity + delta);
    try {
      const updated = await updateChecklistItem(db, {
        itemId: item.id,
        requestedQuantity: next,
      });
      setChecklist((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) => (i.id === item.id ? updated : i)),
            }
          : null
      );
    } catch (err) {
      Alert.alert('Aberya', 'Hindi mabago ang dami.');
    }
  };

  const handleQuantityTextChange = async (item: RestockChecklistItem, text: string) => {
    if (saving || checklist?.status !== 'draft') return;
    const num = parseInt(text, 10);
    if (Number.isNaN(num) || num <= 0) return;
    try {
      const updated = await updateChecklistItem(db, {
        itemId: item.id,
        requestedQuantity: num,
      });
      setChecklist((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) => (i.id === item.id ? updated : i)),
            }
          : null
      );
    } catch {
      // Ignore intermediate parse errors
    }
  };

  const handleApprove = async () => {
    if (!checklist || checklist.status !== 'draft' || saving) return;
    setSaving(true);
    setError(null);
    try {
      const approved = await approveRestockChecklist(db, {
        checklistId: checklist.id,
        notes: 'Inaprubahan ng may-ari ng tindahan.',
      });
      setChecklist(approved);
      Alert.alert(
        '✓ Naaprubahan ang Checklist',
        'Paalala: Ang pag-apruba ay gabay lamang; HINDI ito nagbawas o nagdagdag ng stock sa database. Magtala ng delivery kapag natanggap na ang paninda.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hindi maaprubahan ang checklist.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = async () => {
    if (!checklist || saving) return;
    setSaving(true);
    try {
      const discarded = await discardRestockChecklist(db, { checklistId: checklist.id });
      setChecklist(discarded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hindi ma-discard ang checklist.');
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.titleCol}>
              <Text style={styles.modalTitle}>📋 Restock Checklist</Text>
              <Text style={styles.modalSubtitle}>
                {checklist ? `Batay sa Ulat: ${checklist.periodLabel}` : 'Inihahanda...'}
              </Text>
              {checklist && (
                <View
                  style={[
                    styles.statusBadge,
                    checklist.status === 'draft' && styles.statusBadgeDraft,
                    checklist.status === 'approved' && styles.statusBadgeApproved,
                    checklist.status === 'discarded' && styles.statusBadgeDiscarded,
                  ]}
                >
                  <Text style={styles.statusBadgeText}>
                    {checklist.status === 'draft' && 'Draft (Maaaring I-edit)'}
                    {checklist.status === 'approved' && '✓ Naaprubahan (Gabay)'}
                    {checklist.status === 'discarded' && 'Kinansela'}
                  </Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Isara ang restock checklist"
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* AI Prioritization Bar (Draft only) */}
          {checklist?.status === 'draft' && (
            <View style={styles.aiBar}>
              <Text style={styles.aiBarText}>
                {aiState?.status === 'initializing' && 'Inihahanda ang lokal na AI...'}
                {aiState?.status === 'generating' && 'Sinusuri ng AI ang mga produkto...'}
                {aiState?.status === 'complete' &&
                  (aiState.prioritizedCount > 0
                    ? `✓ Na-prioritize ang ${aiState.prioritizedCount} pinaka-urgent na produkto.`
                    : 'Natapos ang pagsusuri ng AI.')}
                {(!aiState || aiState.status === 'idle') && 'Gusto mo bang suriin ng lokal na AI?'}
                {aiState?.status === 'error' && 'Hindi natapos ang AI; maaari pa ring gamitin ang listahan.'}
              </Text>
              {(!aiState || aiState.status === 'idle' || aiState.status === 'error') && (
                <TouchableOpacity
                  style={styles.aiButton}
                  onPress={handleRunAi}
                  accessibilityRole="button"
                  accessibilityLabel="Suriin ang restock gamit ang AI"
                >
                  <Text style={styles.aiButtonText}>⚡ AI Suriin</Text>
                </TouchableOpacity>
              )}
              {(aiState?.status === 'initializing' || aiState?.status === 'generating') && (
                <ActivityIndicator size="small" color={colors.primary} />
              )}
            </View>
          )}

          {/* Grounding and Invariant Banner */}
          <View
            style={[
              styles.banner,
              checklist?.status === 'approved' ? styles.bannerApproved : styles.bannerDraft,
            ]}
          >
            <Text style={styles.bannerText}>
              {checklist?.status === 'approved' ? (
                <>
                  <Text style={styles.bannerBold}>✓ Naaprubahan ang checklist!</Text>
                  {'\n'}Ang pag-apruba ay gabay sa pamimili. Hindi ito nagbabago ng stock o gumagawa ng pagbili. Gamitin ang "Itala ang Delivery" kapag aktwal nang dumating ang paninda.
                </>
              ) : (
                <>
                  <Text style={styles.bannerBold}>Grounded sa Real Data:</Text> Ang mga mungkahi ay batay sa kasalukuyang stock at totoong benta. Kulang na kasaysayan ay hindi hinuhulaan. Ikaw ang magpapasya sa dami.
                </>
              )}
            </Text>
          </View>

          {/* Error Message */}
          {error && (
            <View style={[styles.banner, { backgroundColor: colors.errorSoft, borderColor: colors.errorOutline }]}>
              <Text style={[styles.bannerText, { color: colors.error }]}>{error}</Text>
            </View>
          )}

          {/* Loading Indicator */}
          {loading && (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.emptyText, { marginTop: 10 }]}>Inihahanda ang restock checklist...</Text>
            </View>
          )}

          {/* Items List */}
          {!loading && checklist && (
            <ScrollView style={styles.itemsList} showsVerticalScrollIndicator={false}>
              {checklist.items.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    Walang produktong kailangang i-restock sa kasalukuyan. Sapat ang lahat ng may bilang na stock!
                  </Text>
                </View>
              ) : (
                checklist.items.map((item) => {
                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.itemCard,
                        item.isPriority && styles.itemCardPriority,
                        !item.isIncluded && styles.itemCardExcluded,
                      ]}
                    >
                      {/* Priority Tag */}
                      {item.isPriority && (
                        <View style={styles.priorityBadge}>
                          <Text style={styles.priorityBadgeText}>⭐ AI Priority Restock</Text>
                        </View>
                      )}

                      {/* Header Row */}
                      <View style={styles.itemHeaderRow}>
                        <View style={styles.itemTitleContainer}>
                          <Text style={styles.itemTitle}>{item.productName}</Text>
                          <Text style={styles.itemMeta}>
                            Variant: {item.variant} • Unit: {item.unit}
                          </Text>
                        </View>

                        {/* Checkbox for Draft */}
                        {checklist.status === 'draft' && (
                          <TouchableOpacity
                            style={styles.checkboxButton}
                            onPress={() => handleToggleInclude(item)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: item.isIncluded }}
                            accessibilityLabel={`Isama ang ${item.productName} sa checklist`}
                          >
                            <View
                              style={[
                                styles.checkboxBox,
                                item.isIncluded && styles.checkboxBoxChecked,
                              ]}
                            >
                              {item.isIncluded && (
                                <Text style={styles.checkboxCheckText}>✓</Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Status and History Tags */}
                      <View style={styles.tagsRow}>
                        <View
                          style={[
                            styles.tagBadge,
                            item.reason === 'out_of_stock' && styles.tagOutOfStock,
                            item.reason === 'low_stock' && styles.tagLowStock,
                            item.reason === 'uncounted' && styles.tagUncounted,
                            item.reason === 'popular_demand' && styles.tagPopular,
                          ]}
                        >
                          <Text style={styles.tagText}>{item.reasonExplanation}</Text>
                        </View>
                      </View>

                      {/* History Explanation */}
                      <Text style={styles.historyText}>{item.historyExplanation}</Text>

                      {/* Quantity Controls or Delivery Button */}
                      {checklist.status === 'draft' ? (
                        <View style={styles.quantityControlsRow}>
                          <Text style={styles.quantityLabel}>Dami na Bibilhin:</Text>
                          <View style={styles.counterContainer}>
                            <TouchableOpacity
                              style={styles.counterButton}
                              onPress={() => handleUpdateQuantity(item, -1)}
                              disabled={!item.isIncluded}
                              accessibilityRole="button"
                              accessibilityLabel="Bawasan ang dami"
                            >
                              <Text style={styles.counterButtonText}>−</Text>
                            </TouchableOpacity>

                            <TextInput
                              style={styles.counterInput}
                              value={String(item.requestedQuantity)}
                              onChangeText={(text) => handleQuantityTextChange(item, text)}
                              keyboardType="number-pad"
                              editable={item.isIncluded}
                              accessibilityLabel={`Dami ng ${item.productName}`}
                            />

                            <TouchableOpacity
                              style={styles.counterButton}
                              onPress={() => handleUpdateQuantity(item, 1)}
                              disabled={!item.isIncluded}
                              accessibilityRole="button"
                              accessibilityLabel="Dagdagan ang dami"
                            >
                              <Text style={styles.counterButtonText}>+</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : checklist.status === 'approved' && item.isIncluded ? (
                        <View style={styles.quantityControlsRow}>
                          <Text style={styles.quantityLabel}>
                            Aprubadong Dami: <Text style={{ fontWeight: '800' }}>{item.requestedQuantity} {item.unit}</Text>
                          </Text>
                          {onOpenDelivery && (
                            <TouchableOpacity
                              style={styles.deliveryButton}
                              onPress={() => {
                                onClose();
                                onOpenDelivery({
                                  id: item.productId,
                                  name: item.productName,
                                  variant: item.variant,
                                  unit: item.unit,
                                  priceCentavos: 0,
                                  createdAt: '',
                                  updatedAt: '',
                                  quantity: item.currentStock,
                                  stockUpdatedAt: null,
                                });
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={`Itala ang delivery para sa ${item.productName}`}
                            >
                              <Text style={styles.deliveryButtonText}>📦 Itala ang Delivery</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}

          {/* Footer Actions */}
          <View style={styles.modalFooter}>
            {checklist?.status === 'draft' ? (
              <>
                <TouchableOpacity
                  style={styles.discardButton}
                  onPress={handleDiscard}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="I-discard ang checklist"
                >
                  <Text style={styles.discardButtonText}>I-discard</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={handleApprove}
                  disabled={saving || checklist.items.length === 0}
                  accessibilityRole="button"
                  accessibilityLabel="Aprubahan ang checklist"
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={colors.surface} />
                  ) : (
                    <Text style={styles.approveButtonText}>Aprubahan ang Checklist</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={styles.closeFooterButton}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Isara ang modal"
              >
                <Text style={styles.closeFooterButtonText}>Isara</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
