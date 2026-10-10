import { colors, radii } from './theme.ts';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import type { DatabaseSession } from '../db/database.ts';
import {
  getStoreReport,
} from '../actions/report-actions.ts';
import {
  getAvailablePriorMonths,
  type ReportPeriodKey,
  type StoreReport,
  type PriorMonthOption,
} from '../domain/reports.ts';
import { formatCentavos } from '../domain/money.ts';
import { ReportExplanationCard } from './ReportExplanationCard.tsx';
import { RestockChecklistModal } from './RestockChecklistModal.tsx';
import { StockActionModal } from './StockActionModal.tsx';
import type { ProductWithStock } from '../types.ts';

interface StoreReportsViewProps {
  db: DatabaseSession;
  onBack?: () => void;
}

export function StoreReportsView({ db, onBack }: StoreReportsViewProps): React.JSX.Element {
  const [selectedPeriod, setSelectedPeriod] = useState<ReportPeriodKey>('today');
  const [selectedPriorOffset, setSelectedPriorOffset] = useState<number>(1);
  const [showPriorMonthsPicker, setShowPriorMonthsPicker] = useState(false);
  const [restockModalOpen, setRestockModalOpen] = useState(false);
  const [stockModalProduct, setStockModalProduct] = useState<ProductWithStock | null>(null);

  const [report, setReport] = useState<StoreReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRevision = useRef(0);

  const priorMonths = getAvailablePriorMonths();

  const loadReport = useCallback(async () => {
    const revision = ++requestRevision.current;
    try {
      setLoading(true);
      setError(null);
      setReport(null);
      const data = await getStoreReport(db, {
        periodKey: selectedPeriod,
        selectedPriorMonthOffset: selectedPriorOffset,
      });
      if (revision === requestRevision.current) setReport(data);
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[StoreReportsView] Error loading report:', err);
      }
      if (revision === requestRevision.current) setError('Hindi ma-load ang ulat ng tindahan. Pakisubukan muli.');
    } finally {
      if (revision === requestRevision.current) setLoading(false);
    }
  }, [db, selectedPeriod, selectedPriorOffset]);

  useEffect(() => {
    void loadReport();
    return () => { requestRevision.current += 1; };
  }, [loadReport]);

  const handleSelectPeriod = (key: ReportPeriodKey) => {
    if (key !== selectedPeriod) {
      requestRevision.current += 1;
      setReport(null);
      setLoading(true);
    }
    setSelectedPeriod(key);
    setShowPriorMonthsPicker(false);
  };

  const handleSelectPriorMonth = (offset: number) => {
    if (selectedPeriod !== 'prior_month' || offset !== selectedPriorOffset) {
      requestRevision.current += 1;
      setReport(null);
      setLoading(true);
    }
    setSelectedPriorOffset(offset);
    setSelectedPeriod('prior_month');
    setShowPriorMonthsPicker(false);
  };

  return (
    <View style={styles.container}>
      {/* Top Header Bar */}
      <View style={styles.headerBar}>
        {onBack && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Bumalik"
          >
            <Text style={styles.backButtonText}>← Bumalik</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1, minWidth: 120 }}>
          <Text style={styles.title}>Ulat ng Tindahan</Text>
          <Text style={styles.subtitle}>
            {report?.period ? report.period.labelFilipino : 'Inihahanda ang ulat...'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.refreshButton, loading && styles.buttonDisabled]}
          onPress={() => void loadReport()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="I-refresh ang ulat"
        >
          <Text style={styles.refreshButtonText}>I-refresh</Text>
        </TouchableOpacity>
      </View>

      {/* Period Selector Tabs */}
      <View style={styles.periodTabsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.periodTabsScroll}
        >
          {(
            [
              { key: 'today', label: 'Ngayong Araw' },
              { key: 'week', label: 'Linggo' },
              { key: 'month', label: 'Buwan' },
              { key: 'six_months', label: '6 na Buwan' },
              { key: 'year', label: 'Taon' },
            ] as const
          ).map((tab) => {
            const active = selectedPeriod === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.periodTab, active && styles.periodTabActive]}
                onPress={() => handleSelectPeriod(tab.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={tab.label}
              >
                <Text
                  style={[
                    styles.periodTabText,
                    active && styles.periodTabTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}

          {/* Nakaraang Buwan Picker Button */}
          <TouchableOpacity
            style={[
              styles.periodTab,
              selectedPeriod === 'prior_month' && styles.periodTabActive,
            ]}
            onPress={() => setShowPriorMonthsPicker(!showPriorMonthsPicker)}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedPeriod === 'prior_month' }}
            accessibilityLabel="Pumili ng Nakaraang Buwan"
          >
            <Text
              style={[
                styles.periodTabText,
                selectedPeriod === 'prior_month' && styles.periodTabTextActive,
              ]}
            >
              Nakaraang Buwan ▾
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Prior Months Dropdown Chips */}
      {showPriorMonthsPicker && (
        <View style={styles.priorMonthsContainer}>
          <Text style={styles.priorMonthsTitle}>Pumili ng Nakaraang Buwan:</Text>
          <View style={styles.priorMonthsGrid}>
            {priorMonths.map((pm) => {
              const active =
                selectedPeriod === 'prior_month' && selectedPriorOffset === pm.offset;
              return (
                <TouchableOpacity
                  key={pm.offset}
                  style={[styles.priorMonthChip, active && styles.priorMonthChipActive]}
                  onPress={() => handleSelectPriorMonth(pm.offset)}
                  accessibilityRole="button"
                  accessibilityLabel={pm.label}
                >
                  <Text
                    style={[
                      styles.priorMonthChipText,
                      active && styles.priorMonthChipTextActive,
                    ]}
                  >
                    {pm.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Error Banner */}
      {error && (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void loadReport()}
            accessibilityRole="button"
          >
            <Text style={styles.retryButtonText}>Subukan Muli</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Content Area */}
      {loading && !report ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Kinakalkula ang datos ng tindahan...</Text>
        </View>
      ) : (
        <ScrollView style={styles.contentScroll} contentContainerStyle={{ paddingBottom: 40 }}>
          {report && (
            <>
              {/* Range Badge */}
              <View style={styles.dateRangeBox}>
                <Text style={styles.dateRangeText}>
                  Saklaw: {report.period.startManilaDate} hanggang {report.period.endManilaDate} (Manila Time)
                </Text>
              </View>

              {/* KPI Cards Grid */}
              <ReportExplanationCard report={report} />

              {/* Restock Suggestions Entry Point */}
              <TouchableOpacity
                style={{
                  backgroundColor: colors.lilac,
                  borderColor: colors.outline,
                  borderWidth: 1,
                  borderRadius: radii.field,
                  padding: 12,
                  marginBottom: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
                onPress={() => setRestockModalOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Buksan ang restock checklist para sa napiling panahon"
              >
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.primaryStrong }}>
                    📋 Restock Checklist
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.primaryMuted, marginTop: 2 }}>
                    Suriin ang mga panindang kailangang i-restock batay sa ulat na ito.
                  </Text>
                </View>
                <View
                  style={{
                    backgroundColor: colors.primary,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 10,
                  }}
                >
                  <Text style={{ color: colors.surface, fontSize: 12, fontWeight: '700' }}>
                    Buksan
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={styles.kpiGrid}>
                {/* 1. Net Sales Card */}
                <View style={[styles.kpiCard, styles.kpiCardHighlight]}>
                  <Text style={styles.kpiLabel}>Kabuuang Benta (Net Sales)</Text>
                  <Text style={styles.kpiValueLarge}>
                    {formatCentavos(report.netSalesCentavos)}
                  </Text>
                  <Text style={styles.kpiSubtext}>
                    {report.salesCount} naitalang benta
                  </Text>
                  {report.cancelledSalesCount > 0 && (
                    <Text style={styles.kpiWarningSubtext}>
                      {report.cancelledSalesCount} kinansela ({formatCentavos(report.cancelledSalesCentavos)})
                    </Text>
                  )}
                </View>

                {/* 2. Collections Card */}
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Pumasok na Pera (Collections)</Text>
                  <Text style={styles.kpiValueMedium}>
                    {formatCentavos(report.totalCollectionsCentavos)}
                  </Text>
                  <View style={styles.collectionBreakdown}>
                    <Text style={styles.collectionItem}>
                      Cash: {formatCentavos(report.cashCollectionsCentavos)}
                    </Text>
                    <Text style={styles.collectionItem}>
                      GCash: {formatCentavos(report.gcashCollectionsCentavos)}
                    </Text>
                  </View>
                </View>

                {/* 3. New Credit Card */}
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Bagong Pautang sa Panahon</Text>
                  <Text style={[styles.kpiValueMedium, { color: colors.error }]}>
                    {formatCentavos(report.newCreditCentavos)}
                  </Text>
                  <Text style={styles.kpiSubtext}>
                    Idinagdag na utang mula sa benta
                  </Text>
                </View>

                {/* 4. Current Outstanding Credit (Snapshot) */}
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Kasalukuyang Pautang (Current Credit)</Text>
                  <Text style={[styles.kpiValueMedium, { color: colors.warning }]}>
                    {formatCentavos(report.currentOutstandingCreditCentavos)}
                  </Text>
                  <Text style={styles.kpiSubtext}>
                    Lahat ng aktibong utang ngayon
                  </Text>
                </View>

                {/* 5. Current Inventory (Stock Now) */}
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Kasalukuyang Imbentaryo (Stock Now)</Text>
                  <Text style={[styles.kpiValueMedium, { color: colors.primary }]}>
                    {report.stockNowUnits} unit
                  </Text>
                  <Text style={styles.kpiSubtext}>
                    Lahat ng nabibilang na produkto
                  </Text>
                </View>
              </View>

              {/* Top Selling Products Card */}
              <View style={styles.topProductsCard}>
                <Text style={styles.topProductsHeader}>
                  Nangungunang Paninda (Top Selling Products)
                </Text>

                {report.topProducts.length === 0 ? (
                  <View style={styles.emptyProductsBox}>
                    <Text style={styles.emptyProductsTitle}>Walang Naitalang Benta</Text>
                    <Text style={styles.emptyProductsSubtext}>
                      Walang natapos na transaksyon sa saklaw ng napiling panahon.
                    </Text>
                  </View>
                ) : (
                  report.topProducts.map((p, index) => (
                    <View key={p.productId} style={styles.productRow}>
                      <View style={styles.rankBadge}>
                        <Text style={styles.rankText}>#{index + 1}</Text>
                      </View>
                      <View style={styles.productInfo}>
                        <Text style={styles.productName}>{p.productName}</Text>
                        <Text style={styles.productMeta}>
                          {p.variant} • {p.unit}
                        </Text>
                      </View>
                      <View style={styles.productStats}>
                        <Text style={styles.productQty}>
                          {p.unitsSold} {p.unit}
                        </Text>
                        <Text style={styles.productRev}>
                          {formatCentavos(p.revenueCentavos)}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}

      <RestockChecklistModal
        db={db}
        visible={restockModalOpen}
        onClose={() => setRestockModalOpen(false)}
        periodKey={selectedPeriod}
        onOpenDelivery={(product) => setStockModalProduct(product)}
      />

      {stockModalProduct && (
        <StockActionModal
          db={db}
          product={stockModalProduct}
          mode="add_delivery"
          onClose={() => setStockModalProduct(null)}
          onSuccess={() => {
            setStockModalProduct(null);
            void loadReport();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backButton: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radii.button,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.primaryStrong,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },
  refreshButton: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.selected,
    borderRadius: radii.button,
  },
  refreshButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  periodTabsContainer: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingVertical: 8,
  },
  periodTabsScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  periodTab: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  periodTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  periodTabText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primaryMuted,
  },
  periodTabTextActive: {
    color: colors.surface,
  },
  priorMonthsContainer: {
    backgroundColor: colors.successSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.successOutline,
    padding: 12,
    paddingHorizontal: 16,
  },
  priorMonthsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.success,
    marginBottom: 8,
  },
  priorMonthsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priorMonthChip: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.successOutline,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  priorMonthChipActive: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  priorMonthChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.success,
  },
  priorMonthChipTextActive: {
    color: colors.surface,
  },
  errorBanner: {
    backgroundColor: colors.errorSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.errorOutline,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: 13,
  },
  retryButton: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    backgroundColor: colors.error,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.button,
    marginLeft: 8,
  },
  retryButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.muted,
    fontWeight: '500',
  },
  contentScroll: {
    flex: 1,
  },
  dateRangeBox: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  dateRangeText: {
    fontSize: 11,
    color: colors.muted,
    textAlign: 'center',
    fontWeight: '500',
  },
  kpiGrid: {
    paddingHorizontal: 16,
    marginTop: 10,
    gap: 10,
  },
  kpiCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  kpiCardHighlight: {
    borderColor: colors.outline,
    backgroundColor: colors.lilac,
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryMuted,
    textTransform: 'uppercase',
  },
  kpiValueLarge: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.primaryStrong,
    marginTop: 4,
  },
  kpiValueMedium: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.primaryStrong,
    marginTop: 4,
  },
  kpiSubtext: {
    fontSize: 12,
    color: colors.primaryMuted,
    marginTop: 4,
  },
  kpiWarningSubtext: {
    fontSize: 12,
    color: colors.error,
    marginTop: 2,
    fontWeight: '600',
  },
  collectionBreakdown: {
    marginTop: 6,
    gap: 2,
  },
  collectionItem: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  topProductsCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: radii.card,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  topProductsHeader: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.primaryStrong,
    marginBottom: 12,
  },
  emptyProductsBox: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyProductsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
  },
  emptyProductsSubtext: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    textAlign: 'center',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSoft,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.selected,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rankText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  productMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  productStats: {
    alignItems: 'flex-end',
  },
  productQty: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.success,
  },
  productRev: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },
});
