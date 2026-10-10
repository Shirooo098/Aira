import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { StoreReport } from '../domain/reports.ts';
import { formatCentavos } from '../domain/money.ts';
import { createLlamaReportAdapter } from '../agent/llama-adapter.ts';
import { createReportExplanationSession } from '../agent/report-explanation-session.ts';

export function ReportExplanationCard({ report }: { report: StoreReport }): React.JSX.Element {
  const session = useMemo(() => createReportExplanationSession({
    report, runtime: createLlamaReportAdapter(),
  }), [report]);
  const [state, setState] = useState(() => session.getState());
  const [showEvidence, setShowEvidence] = useState(false);

  useEffect(() => {
    setState(session.getState());
    const unsubscribe = session.subscribe(setState);
    const background = AppState.addEventListener('change', (next) => {
      if (next !== 'active') void session.cancel();
    });
    return () => {
      unsubscribe();
      background.remove();
      void session.dispose().catch(() => undefined);
    };
  }, [session]);

  const busy = state.status === 'initializing' || state.status === 'generating';
  const breakdown = report.collectionBreakdown;
  const values: [string, string][] = [
    ['Kabuuang benta bago ibawas ang kinansela', formatCentavos(report.grossSalesCentavos)],
    ['Kinanselang benta na naitala sa saklaw', formatCentavos(report.cancelledSalesCentavos)],
    ['Benta matapos ibawas ang kinansela', formatCentavos(report.netSalesCentavos)],
    ['Cash mula sa benta', formatCentavos(breakdown.cashSalesCentavos)],
    ['Cash na bayad sa utang', formatCentavos(breakdown.cashRepaymentsCentavos)],
    ['GCash mula sa benta', formatCentavos(breakdown.gcashSalesCentavos)],
    ['GCash na bayad sa utang', formatCentavos(breakdown.gcashRepaymentsCentavos)],
    ['Kabuuang koleksiyon', formatCentavos(report.totalCollectionsCentavos)],
    ['Bagong utang sa panahon', formatCentavos(report.newCreditCentavos)],
    ['Aktibong benta / kinanselang benta', `${report.salesCount} / ${report.cancelledSalesCount}`],
    ['Kasalukuyang utang, hindi dating balanse', formatCentavos(report.currentOutstandingCreditCentavos)],
    ['Kasalukuyang nabibilang na stock', `${report.stockNowUnits} unit`],
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Ipaliwanag ang ulat sa Filipino</Text>
      <Text style={styles.note}>
        {report.period.startManilaDate} hanggang {report.period.endManilaDate} (Manila).
        {' '}Batay lamang sa naka-save na tala; hindi ito pagtataya ng tubo o dahilan ng pagbabago.
      </Text>
      <Text style={styles.note}>
        Lokal at offline ang paliwanag. Maaaring umabot nang isang minuto; hiwalay ito sa target na bilis ng paghahanap ng presyo.
      </Text>
      <TouchableOpacity style={styles.button} disabled={busy} accessibilityRole="button"
        accessibilityState={{ disabled: busy }} onPress={() => void session.run()}>
        <Text style={styles.buttonText}>{busy ? 'Inihahanda ang paliwanag…' : 'Ipaliwanag ang napiling ulat'}</Text>
      </TouchableOpacity>
      {busy && (
        <View style={styles.progress} accessibilityRole="progressbar">
          <ActivityIndicator color="#0284c7" />
          <Text style={styles.note}>{state.status === 'initializing' ? 'Inihahanda ang naka-bundle na modelo…' : 'Sinusuri ng lokal na modelo ang datos…'}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => void session.cancel()}>
            <Text style={styles.link}>Kanselahin</Text>
          </TouchableOpacity>
        </View>
      )}
      {state.error && <Text style={styles.error} accessibilityRole="alert">{state.error} Maaari mong subukan muli. Walang binagong tala.</Text>}
      {state.status === 'complete' && (
        <View>
          {!state.evidence.hasPeriodActivity && <Text style={styles.note}>Walang naitalang aktibidad sa saklaw. Ipinapakita ang datos nang hindi gumagamit ng modelo.</Text>}
          {state.points.map((point) => <Text key={point.id} style={styles.point}>{point.text}</Text>)}
          {state.initializationMs !== null && <Text style={styles.note}>Paghahanda ng modelo: {state.initializationMs} ms</Text>}
          {state.inferenceMs !== null && <Text style={styles.note}>Aktuwal na generation sa device: {state.inferenceMs} ms. Hindi ito benchmark ng price lookup.</Text>}
        </View>
      )}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showEvidence }} onPress={() => setShowEvidence(!showEvidence)}>
        <Text style={styles.link}>{showEvidence ? 'Itago ang pinagbatayang breakdown' : 'Tingnan ang pinagbatayang breakdown'}</Text>
      </TouchableOpacity>
      {showEvidence && (
        <View>
          <Text selectable style={styles.note}>Simula (UTC): {report.period.startUtcIso}{'\n'}Hangganan (UTC): {report.period.endUtcIso}{'\n'}Snapshot: {report.asOfUtcIso}</Text>
          {values.map(([label, value]) => (
            <View key={label} style={styles.row}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text></View>
          ))}
          <Text style={styles.note}>Hindi kabilang ang kinanselang benta at reversed na bayad sa koleksiyon. Ang cancellations ay iniuugnay sa petsa ng orihinal na benta, hindi sa araw ng pagkansela. Hindi patunay ng kumpletong kasaysayan ang kawalan ng tala.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 14, padding: 16, borderRadius: 12, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', gap: 10 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  note: { fontSize: 12, color: '#475569' },
  button: { padding: 12, borderRadius: 8, backgroundColor: '#0284c7' },
  buttonText: { color: '#ffffff', fontWeight: '700', textAlign: 'center' },
  progress: { gap: 8 },
  point: { marginVertical: 6, color: '#1e293b', fontSize: 14 },
  link: { color: '#0369a1', fontWeight: '700', paddingVertical: 8 },
  error: { color: '#991b1b', backgroundColor: '#fef2f2', padding: 10 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 6 },
  label: { flex: 1, color: '#334155', fontSize: 12 },
  value: { color: '#0f172a', fontWeight: '700', fontSize: 12 },
});
