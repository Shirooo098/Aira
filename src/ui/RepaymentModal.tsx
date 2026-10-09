import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import type { DatabaseSession } from '../db/database.ts';
import type {
  CustomerWithBalance,
  RepaymentPreview,
  PaymentMethod,
  CreditEntry,
  CreditRepayment,
} from '../types.ts';
import {
  previewRepaymentAllocation,
  recordRepayment,
  getCustomerLedger,
  reverseRepayment,
} from '../actions/utang-actions.ts';
import { parseCentavos, formatCentavos } from '../domain/money.ts';
import {
  OverpaymentError,
  CreditValidationError,
  RepaymentAlreadyReversedError,
} from '../domain/utang.ts';
import { repaymentModalStyles as styles } from './repayment-modal-styles.ts';

interface RepaymentModalProps {
  db: DatabaseSession;
  customer: CustomerWithBalance | null;
  visible: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function RepaymentModal({
  db,
  customer,
  visible,
  onClose,
  onSuccess,
}: RepaymentModalProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<'repay' | 'history'>('repay');
  const [amountInput, setAmountInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [gcashRef, setGcashRef] = useState('');
  const [note, setNote] = useState('');

  const [preview, setPreview] = useState<RepaymentPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [ledgerEntries, setLedgerEntries] = useState<CreditEntry[]>([]);
  const [ledgerRepayments, setLedgerRepayments] = useState<CreditRepayment[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const submitInProgress = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reversal state
  const [reversingRepaymentId, setReversingRepaymentId] = useState<string | null>(null);
  const [reversalReasonInput, setReversalReasonInput] = useState('');
  const [reversing, setReversing] = useState(false);
  const [historyErrorMessage, setHistoryErrorMessage] = useState<string | null>(null);

  // Reset form when modal opens or customer changes
  useEffect(() => {
    if (!visible || !customer) {
      setAmountInput('');
      setPaymentMethod('cash');
      setGcashRef('');
      setNote('');
      setPreview(null);
      setPreviewError(null);
      setErrorMessage(null);
      setActiveTab('repay');
      setReversingRepaymentId(null);
      setReversalReasonInput('');
      setHistoryErrorMessage(null);
      return;
    }

    setAmountInput('');
    setPaymentMethod('cash');
    setGcashRef('');
    setNote('');
    setPreview(null);
    setPreviewError(null);
    setErrorMessage(null);
    setReversingRepaymentId(null);
    setReversalReasonInput('');
    setHistoryErrorMessage(null);

    // Fetch customer ledger for history tab
    let isCurrent = true;
    setLoadingLedger(true);
    getCustomerLedger(db, customer.id)
      .then((ledger) => {
        if (isCurrent) {
          setLedgerEntries(ledger.creditEntries);
          setLedgerRepayments(ledger.repayments);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent && typeof __DEV__ !== 'undefined' && __DEV__) {
          console.error('[RepaymentModal] Error fetching ledger:', err);
        }
      })
      .finally(() => {
        if (isCurrent) setLoadingLedger(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [visible, customer, db]);

  // Recalculate allocation preview when amount changes
  useEffect(() => {
    if (!customer || amountInput.trim().length === 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let parsed = 0;
    try {
      parsed = parseCentavos(amountInput);
    } catch (err) {
      setPreview(null);
      setPreviewError(err instanceof Error ? err.message : 'Maling halaga ng bayad');
      return;
    }

    if (parsed <= 0) {
      setPreview(null);
      setPreviewError('Dapat mas malaki sa ₱0.00 ang ibabayad sa utang');
      return;
    }

    let isCurrent = true;
    setLoadingPreview(true);
    setPreviewError(null);

    previewRepaymentAllocation(db, {
      customerId: customer.id,
      amountCentavos: parsed,
    })
      .then((res) => {
        if (isCurrent) {
          setPreview(res);
          setPreviewError(null);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : 'Hindi makuwenta ang bayad');
        }
      })
      .finally(() => {
        if (isCurrent) setLoadingPreview(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [amountInput, customer, db]);

  if (!visible || !customer) {
    return null;
  }

  const handlePayFull = () => {
    if (customer.totalDebtCentavos > 0) {
      const pesos = (customer.totalDebtCentavos / 100).toFixed(2);
      setAmountInput(pesos.endsWith('.00') ? (customer.totalDebtCentavos / 100).toString() : pesos);
    }
  };

  const handleConfirmRepayment = async () => {
    if (submitInProgress.current || submitting || !preview || !preview.canComplete) {
      return;
    }

    submitInProgress.current = true;
    setSubmitting(true);
    setErrorMessage(null);

    let parsedCentavos = 0;
    try {
      parsedCentavos = parseCentavos(amountInput);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Maling halaga ng bayad');
      submitInProgress.current = false;
      setSubmitting(false);
      return;
    }

    try {
      const repayment = await recordRepayment(db, {
        customerId: customer.id,
        amountCentavos: parsedCentavos,
        paymentMethod,
        referenceNumber: paymentMethod === 'gcash' && gcashRef.trim().length > 0 ? gcashRef.trim() : undefined,
        note: note.trim().length > 0 ? note.trim() : undefined,
      });

      const message = `Matagumpay na naitala ang bayad na ₱${formatCentavos(
        repayment.amountCentavos
      )} mula kay ${customer.name}. Natitirang utang: ₱${formatCentavos(preview.newTotalDebtCentavos)}.`;

      onSuccess(message);
      onClose();
    } catch (err) {
      if (err instanceof OverpaymentError || err instanceof CreditValidationError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Hindi naitala ang bayad dahil sa aberya.');
      }
    } finally {
      submitInProgress.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmReverse = async (repaymentId: string) => {
    if (reversing) return;
    setReversing(true);
    setHistoryErrorMessage(null);

    try {
      const res = await reverseRepayment(db, {
        repaymentId,
        reason: reversalReasonInput.trim().length > 0 ? reversalReasonInput.trim() : undefined,
      });

      setReversingRepaymentId(null);
      setReversalReasonInput('');

      // Reload ledger
      if (customer) {
        const ledger = await getCustomerLedger(db, customer.id);
        setLedgerEntries(ledger.creditEntries);
        setLedgerRepayments(ledger.repayments);
      }

      onSuccess(
        `Na-reverse ang bayad na ₱${formatCentavos(res.repayment.amountCentavos)}. Naibalik ang utang.`
      );
    } catch (err) {
      if (err instanceof RepaymentAlreadyReversedError || err instanceof CreditValidationError) {
        setHistoryErrorMessage(err.message);
      } else {
        setHistoryErrorMessage('Nagkaroon ng aberya sa pag-reverse ng bayad.');
      }
    } finally {
      setReversing(false);
    }
  };

  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTopRow}>
              <View>
                <Text style={styles.customerTitle}>{customer.name}</Text>
                {customer.note ? (
                  <Text style={styles.customerSubtitle}>{customer.note}</Text>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Isara ang modal"
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.balanceBanner}>
              <Text style={styles.balanceBannerLabel}>Kasalukuyang Utang:</Text>
              <Text style={styles.balanceBannerValue}>
                ₱{formatCentavos(customer.totalDebtCentavos)}
              </Text>
            </View>
          </View>

          {/* Tab Switcher */}
          <View style={styles.tabsRow}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'repay' && styles.tabBtnActive]}
              onPress={() => setActiveTab('repay')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'repay' }}
            >
              <Text
                style={[
                  styles.tabBtnText,
                  activeTab === 'repay' && styles.tabBtnTextActive,
                ]}
              >
                Magbayad ng Utang
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'history' && styles.tabBtnActive]}
              onPress={() => setActiveTab('history')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'history' }}
            >
              <Text
                style={[
                  styles.tabBtnText,
                  activeTab === 'history' && styles.tabBtnTextActive,
                ]}
              >
                Kasaysayan / Talaan
              </Text>
            </TouchableOpacity>
          </View>

          {/* Body */}
          <ScrollView style={styles.scrollBody} keyboardShouldPersistTaps="handled">
            {activeTab === 'repay' ? (
              <>
                {/* Amount Input */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Halaga ng Bayad sa Piso (₱):</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="hal. 50, 100, 250"
                    placeholderTextColor="#94a3b8"
                    value={amountInput}
                    onChangeText={(val) => {
                      setAmountInput(val);
                      setErrorMessage(null);
                    }}
                    keyboardType="decimal-pad"
                    editable={!submitting}
                    accessibilityLabel="Halaga ng ibabayad sa utang"
                  />
                  {customer.totalDebtCentavos > 0 && (
                    <View style={styles.quickPayRow}>
                      <TouchableOpacity
                        style={styles.quickPayBtn}
                        onPress={handlePayFull}
                        accessibilityRole="button"
                        accessibilityLabel="Bayaran ang buong utang"
                      >
                        <Text style={styles.quickPayBtnText}>
                          Bayaran Lahat (₱{formatCentavos(customer.totalDebtCentavos)})
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* Payment Method */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Paraan ng Bayad:</Text>
                  <View style={styles.paymentMethodRow}>
                    <TouchableOpacity
                      style={[
                        styles.methodBtn,
                        paymentMethod === 'cash' && styles.methodBtnActive,
                      ]}
                      onPress={() => setPaymentMethod('cash')}
                      accessibilityRole="button"
                    >
                      <Text
                        style={[
                          styles.methodBtnText,
                          paymentMethod === 'cash' && styles.methodBtnTextActive,
                        ]}
                      >
                        Cash
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.methodBtn,
                        paymentMethod === 'gcash' && styles.methodBtnActive,
                      ]}
                      onPress={() => setPaymentMethod('gcash')}
                      accessibilityRole="button"
                    >
                      <Text
                        style={[
                          styles.methodBtnText,
                          paymentMethod === 'gcash' && styles.methodBtnTextActive,
                        ]}
                      >
                        GCash (Kumpirmado)
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* GCash Reference (if GCash selected) */}
                {paymentMethod === 'gcash' && (
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>GCash Reference # (Opsyonal):</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="hal. 9021837482"
                      placeholderTextColor="#94a3b8"
                      value={gcashRef}
                      onChangeText={setGcashRef}
                      editable={!submitting}
                      accessibilityLabel="GCash Reference number"
                    />
                  </View>
                )}

                {/* Note */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Tala / Note (Opsyonal):</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="hal. Paunang bayad mula sa suweldo"
                    placeholderTextColor="#94a3b8"
                    value={note}
                    onChangeText={setNote}
                    editable={!submitting}
                    accessibilityLabel="Tala sa pagbabayad"
                  />
                </View>

                {/* Preview Error (e.g. Overpayment) */}
                {previewError && (
                  <View style={styles.errorBox} accessibilityRole="alert">
                    <Text style={styles.errorText}>{previewError}</Text>
                  </View>
                )}

                {/* Submission Error */}
                {errorMessage && (
                  <View style={styles.errorBox} accessibilityRole="alert">
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  </View>
                )}

                {/* Live FIFO Allocation Preview */}
                {preview && (
                  <View style={styles.previewCard}>
                    <Text style={styles.previewTitle}>Pagsusuri ng Alokasyon (Oldest-First):</Text>

                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>Ibinabayad:</Text>
                      <Text style={styles.previewValue}>
                        ₱{formatCentavos(preview.repaymentAmountCentavos)}
                      </Text>
                    </View>

                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>Bagong Natitirang Utang:</Text>
                      <Text style={[styles.previewValue, { color: '#b91c1c' }]}>
                        ₱{formatCentavos(preview.newTotalDebtCentavos)}
                      </Text>
                    </View>

                    {preview.allocations.length > 0 && (
                      <View style={styles.allocationsSection}>
                        <Text style={styles.allocationsHeader}>Mababawasang mga Utang:</Text>
                        {preview.allocations.map((alloc) => (
                          <View key={alloc.creditEntryId} style={styles.allocationItem}>
                            <View style={styles.allocTopRow}>
                              <Text style={styles.allocDesc} numberOfLines={1}>
                                {alloc.entryType === 'opening_balance'
                                  ? alloc.description || 'Dating Utang (Previous Balance)'
                                  : `Benta ${alloc.saleId || ''}`}
                              </Text>
                              <View
                                style={[
                                  styles.allocBadge,
                                  alloc.isFullySettled
                                    ? styles.allocBadgeSettled
                                    : styles.allocBadgePartial,
                                ]}
                              >
                                <Text
                                  style={
                                    alloc.isFullySettled
                                      ? styles.allocBadgeTextSettled
                                      : styles.allocBadgeTextPartial
                                  }
                                >
                                  {alloc.isFullySettled ? 'Bayad Na' : 'Bawas'}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.allocDetailText}>
                              Mababawas: ₱{formatCentavos(alloc.allocatedCentavos)} • Matitira: ₱
                              {formatCentavos(alloc.newRemainingCentavos)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* Action Buttons */}
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={onClose}
                    disabled={submitting}
                    accessibilityRole="button"
                  >
                    <Text style={styles.cancelBtnText}>Kanselahin</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.confirmBtn,
                      (!preview || !preview.canComplete || submitting) && styles.confirmBtnDisabled,
                    ]}
                    onPress={handleConfirmRepayment}
                    disabled={!preview || !preview.canComplete || submitting}
                    accessibilityRole="button"
                    accessibilityLabel="Kumpirmahin ang bayad sa utang"
                  >
                    {submitting ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.confirmBtnText}>Kumpirmahin ang Bayad</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              /* History Tab */
              <View>
                {loadingLedger ? (
                  <ActivityIndicator size="small" color="#0284c7" style={{ marginVertical: 20 }} />
                ) : (
                  <>
                    {/* Active & Past Credit Entries */}
                    <View style={styles.historySection}>
                      <Text style={styles.sectionHeading}>Mga Naitalang Utang ({ledgerEntries.length}):</Text>
                      {ledgerEntries.length === 0 ? (
                        <Text style={styles.emptyHistoryText}>Walang naitalang utang.</Text>
                      ) : (
                        ledgerEntries.map((ce) => (
                          <View key={ce.id} style={styles.historyCard}>
                            <View style={styles.historyRow}>
                              <Text style={styles.historyTitle}>
                                {ce.entryType === 'opening_balance'
                                  ? ce.description || 'Dating Utang'
                                  : `Benta ${ce.saleId || ''}`}
                              </Text>
                              <Text style={styles.historyAmount}>
                                ₱{formatCentavos(ce.originalAmountCentavos)}
                              </Text>
                            </View>
                            <Text style={styles.historyDate}>
                              Petsa: {ce.originalDate || new Date(ce.createdAt).toLocaleDateString()} •
                              Natira: ₱{formatCentavos(ce.remainingAmountCentavos)}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>

                    {/* Past Repayments */}
                    <View style={styles.historySection}>
                      <Text style={styles.sectionHeading}>Mga Naibayad ({ledgerRepayments.length}):</Text>

                      {historyErrorMessage && (
                        <View style={[styles.errorBox, { marginBottom: 10 }]} accessibilityRole="alert">
                          <Text style={styles.errorText}>{historyErrorMessage}</Text>
                        </View>
                      )}

                      {ledgerRepayments.length === 0 ? (
                        <Text style={styles.emptyHistoryText}>Wala pang naitalang bayad.</Text>
                      ) : (
                        ledgerRepayments.map((rep) => (
                          <View key={rep.id} style={styles.historyCard}>
                            <View style={styles.historyRow}>
                              <Text style={styles.historyTitle}>
                                Bayad ({rep.paymentMethod.toUpperCase()})
                              </Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                {rep.status === 'reversed' && (
                                  <View style={styles.reversedBadge}>
                                    <Text style={styles.reversedBadgeText}>Na-reverse</Text>
                                  </View>
                                )}
                                <Text
                                  style={[
                                    styles.historyAmount,
                                    {
                                      color: rep.status === 'reversed' ? '#94a3b8' : '#059669',
                                      textDecorationLine: rep.status === 'reversed' ? 'line-through' : 'none',
                                    },
                                  ]}
                                >
                                  +₱{formatCentavos(rep.amountCentavos)}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.historyDate}>
                              {new Date(rep.createdAt).toLocaleString()}
                              {rep.referenceNumber ? ` • Ref: ${rep.referenceNumber}` : ''}
                            </Text>
                            {rep.status === 'reversed' && (
                              <Text style={styles.reversalReasonText}>
                                Na-reverse{rep.reversedAt ? ` noong ${new Date(rep.reversedAt).toLocaleDateString()}` : ''}
                                {rep.reversalReason ? `: "${rep.reversalReason}"` : ''}
                              </Text>
                            )}

                            {/* Reversal action if still active */}
                            {rep.status !== 'reversed' && (
                              <>
                                {reversingRepaymentId === rep.id ? (
                                  <View style={styles.reversalConfirmBox}>
                                    <Text style={styles.reversalConfirmPrompt}>
                                      I-reverse ang bayad na ₱{formatCentavos(rep.amountCentavos)}? Ibabalik ito sa utang ng suki.
                                    </Text>
                                    <TextInput
                                      style={styles.reversalInput}
                                      placeholder="Dahilan ng pag-reverse (hal. maling encode)"
                                      placeholderTextColor="#9ca3af"
                                      value={reversalReasonInput}
                                      onChangeText={setReversalReasonInput}
                                      editable={!reversing}
                                    />
                                    <View style={styles.reversalActionsRow}>
                                      <TouchableOpacity
                                        style={styles.reversalCancelBtn}
                                        onPress={() => {
                                          setReversingRepaymentId(null);
                                          setReversalReasonInput('');
                                          setHistoryErrorMessage(null);
                                        }}
                                        disabled={reversing}
                                      >
                                        <Text style={styles.reversalCancelBtnText}>Kanselahin</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        style={styles.reversalConfirmBtn}
                                        onPress={() => handleConfirmReverse(rep.id)}
                                        disabled={reversing}
                                      >
                                        {reversing ? (
                                          <ActivityIndicator size="small" color="#ffffff" />
                                        ) : (
                                          <Text style={styles.reversalConfirmBtnText}>Kumpirmahin ang Reversal</Text>
                                        )}
                                      </TouchableOpacity>
                                    </View>
                                  </View>
                                ) : (
                                  <TouchableOpacity
                                    style={styles.reverseBtn}
                                    onPress={() => {
                                      setReversingRepaymentId(rep.id);
                                      setReversalReasonInput('');
                                      setHistoryErrorMessage(null);
                                    }}
                                    accessibilityRole="button"
                                  >
                                    <Text style={styles.reverseBtnText}>I-reverse ang Bayad</Text>
                                  </TouchableOpacity>
                                )}
                              </>
                            )}
                          </View>
                        ))
                      )}
                    </View>
                  </>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
