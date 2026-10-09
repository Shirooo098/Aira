import React, { useState, useEffect, useCallback } from 'react';
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

interface StoreReportsViewProps {
  db: DatabaseSession;
  onBack?: () => void;
}

export function StoreReportsView({ db, onBack }: StoreReportsViewProps): React.JSX.Element {
  const [selectedPeriod, setSelectedPeriod] = useState<ReportPeriodKey>('today');
  const [selectedPriorOffset, setSelectedPriorOffset] = useState<number>(1);
  const [showPriorMonthsPicker, setShowPriorMonthsPicker] = useState(false);

  const [report, setReport] = useState<StoreReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const priorMonths = getAvailablePriorMonths();

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getStoreReport(db, {
        periodKey: selectedPeriod,
        selectedPriorMonthOffset: selectedPriorOffset,
      });
      setReport(data);
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[StoreReportsView] Error loading report:', err);
      }
      setError('Hindi ma-load ang ulat ng tindahan. Pakisubukan muli.');
    } finally {
      setLoading(false);
    }
  }, [db, selectedPeriod, selectedPriorOffset]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleSelectPeriod = (key: ReportPeriodKey) => {
    setSelectedPeriod(key);
    setShowPriorMonthsPicker(false);
  };

  const handleSelectPriorMonth = (offset: number) => {
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
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Ulat ng Tindahan</Text>
          <Text style={styles.subtitle}>
            {report?.period ? report.period.labelFilipino : 'Inihahanda ang ulat...'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => void loadReport()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="I-refresh ang ulat"
        >
          <Text style={styles.refreshButtonText}>🔄 I-refresh</Text>
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
              📅 Nakaraang Buwan ▾
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
          <ActivityIndicator size="large" color="#0284c7" />
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
                      💵 Cash: {formatCentavos(report.cashCollectionsCentavos)}
                    </Text>
                    <Text style={styles.collectionItem}>
                      📱 GCash: {formatCentavos(report.gcashCollectionsCentavos)}
                    </Text>
                  </View>
                </View>

                {/* 3. New Credit Card */}
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Bagong Pautang sa Panahon</Text>
                  <Text style={[styles.kpiValueMedium, { color: '#b91c1c' }]}>
                    {formatCentavos(report.newCreditCentavos)}
                  </Text>
                  <Text style={styles.kpiSubtext}>
                    Idinagdag na utang mula sa benta
                  </Text>
                </View>

                {/* 4. Current Outstanding Credit (Snapshot) */}
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Kasalukuyang Pautang (Current Credit)</Text>
                  <Text style={[styles.kpiValueMedium, { color: '#ea580c' }]}>
                    {formatCentavos(report.currentOutstandingCreditCentavos)}
                  </Text>
                  <Text style={styles.kpiSubtext}>
                    Lahat ng aktibong utang ngayon
                  </Text>
                </View>

                {/* 5. Current Inventory (Stock Now) */}
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Kasalukuyang Imbentaryo (Stock Now)</Text>
                  <Text style={[styles.kpiValueMedium, { color: '#0284c7' }]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backButton: {
    marginRight: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  refreshButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#e0f2fe',
    borderRadius: 6,
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284c7',
  },
  periodTabsContainer: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 8,
  },
  periodTabsScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  periodTab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  periodTabActive: {
    backgroundColor: '#0284c7',
    borderColor: '#0284c7',
  },
  periodTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  periodTabTextActive: {
    color: '#ffffff',
  },
  priorMonthsContainer: {
    backgroundColor: '#f0fdf4',
    borderBottomWidth: 1,
    borderBottomColor: '#bbf7d0',
    padding: 12,
    paddingHorizontal: 16,
  },
  priorMonthsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 8,
  },
  priorMonthsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priorMonthChip: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  priorMonthChipActive: {
    backgroundColor: '#15803d',
    borderColor: '#15803d',
  },
  priorMonthChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
  },
  priorMonthChipTextActive: {
    color: '#ffffff',
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderBottomWidth: 1,
    borderBottomColor: '#fecaca',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    flex: 1,
    color: '#991b1b',
    fontSize: 13,
  },
  retryButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 12,
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
    color: '#64748b',
    fontWeight: '500',
  },
  contentScroll: {
    flex: 1,
  },
  dateRangeBox: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  dateRangeText: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    fontWeight: '500',
  },
  kpiGrid: {
    paddingHorizontal: 16,
    marginTop: 10,
    gap: 10,
  },
  kpiCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  kpiCardHighlight: {
    borderColor: '#bae6fd',
    backgroundColor: '#f0f9ff',
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  kpiValueLarge: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0f172a',
    marginTop: 4,
  },
  kpiValueMedium: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
  },
  kpiSubtext: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  kpiWarningSubtext: {
    fontSize: 12,
    color: '#b91c1c',
    marginTop: 2,
    fontWeight: '600',
  },
  collectionBreakdown: {
    marginTop: 6,
    gap: 2,
  },
  collectionItem: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  topProductsCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  topProductsHeader: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  emptyProductsBox: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyProductsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  emptyProductsSubtext: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    textAlign: 'center',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rankText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0284c7',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  productMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  productStats: {
    alignItems: 'flex-end',
  },
  productQty: {
    fontSize: 13,
    fontWeight: '800',
    color: '#059669',
  },
  productRev: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
});
