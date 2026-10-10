import { colors, radii } from './theme.ts';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { DatabaseSession } from '../db/database.ts';
import type { CustomerWithBalance } from '../types.ts';
import { getAgedUtang } from '../actions/utang-aging-actions.ts';
import { getCustomerById } from '../actions/utang-actions.ts';
import { millisecondsToManilaMidnight } from '../domain/utang-aging.ts';
import { formatCentavos } from '../domain/money.ts';
import { RepaymentModal } from './RepaymentModal.tsx';
import { SafeAreaView } from 'react-native-safe-area-context';

export function AgedUtangView({ db, onClose }: { db: DatabaseSession; onClose: () => void }): React.JSX.Element {
  const [result, setResult] = useState<Awaited<ReturnType<typeof getAgedUtang>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerWithBalance | null>(null);
  const [selecting, setSelecting] = useState(false);
  const sequence = useRef(0);
  const alive = useRef(true);
  const refresh = async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getAgedUtang(db);
      if (alive.current && request === sequence.current) setResult(data);
    } catch {
      if (alive.current && request === sequence.current) {
        setResult(null);
        setError('Hindi mabasa ang utang. Subukan muli.');
      }
    } finally {
      if (alive.current && request === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void refresh();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => { void refresh(); schedule(); }, millisecondsToManilaMidnight(Date.now()) + 50);
    };
    schedule();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { clearTimeout(timer); void refresh(); schedule(); }
    });
    return () => { alive.current = false; sequence.current++; clearTimeout(timer); subscription.remove(); };
  }, [db]);

  const openCustomer = async (id: string) => {
    setSelecting(true);
    try {
      const selected = await getCustomerById(db, id);
      if (alive.current) {
        if (!selected) throw new Error('Missing customer');
        setCustomer(selected);
      }
    } catch { if (alive.current) setError('Hindi mabasa ang suki. Subukan muli.'); }
    finally { if (alive.current) setSelecting(false); }
  };
  const icons = { Urgent: '‼', 'Needs attention': '!', 'Age unknown': '?', Current: '✓' };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>Utang — mga dapat unahin</Text>
        <Text style={styles.body}>Edad ayon sa araw sa Pilipinas (Asia/Manila).</Text>
        <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.button}><Text style={styles.buttonText}>Isara</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={() => void refresh()} style={styles.button}><Text style={styles.buttonText}>I-refresh</Text></TouchableOpacity>
        {loading && <ActivityIndicator accessibilityLabel="Binabasa ang utang" />}
        {error && <Text accessibilityRole="alert" style={styles.warning}>{error}</Text>}
        {!loading && result && <>
          <Text style={styles.title}>Kabuuang utang: {formatCentavos(result.totalCentavos)}</Text>
          {result.customers.length === 0 && <Text style={styles.body}>Walang natitirang utang.</Text>}
          {result.customers.map(c => <View key={c.customerId} style={styles.card}>
            <Text style={styles.name}>{c.name}</Text>
            <Text style={styles.name}>{icons[c.priority]} {c.priority}</Text>
            <Text style={styles.body}>Natitirang utang: {formatCentavos(c.totalCentavos)}</Text>
            {c.oldestDate && <>
              <Text style={styles.body}>Pinakamatandang may petsang utang: {c.oldestDate} · {c.ageDays} araw</Text>
              <Text style={styles.body}>Natitira sa talang ito: {formatCentavos(c.oldestRemainingCentavos!)}</Text>
              <Text style={styles.body}>Balanseng may petsa: {formatCentavos(c.knownCentavos)}</Text>
            </>}
            {c.unknownCount > 0 && <Text style={styles.body}>? Age unknown: {formatCentavos(c.unknownCentavos)} ({c.unknownCount} tala)</Text>}
            {c.dateWarning && <Text style={styles.warning}>May hindi wastong petsa o petsa sa hinaharap. Suriin ang tala.</Text>}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Suriin o bayaran ang utang ni ${c.name}`}
              disabled={selecting} onPress={() => void openCustomer(c.customerId)} style={[styles.button, selecting && styles.buttonDisabled]}>
              <Text style={styles.buttonText}>Suriin / Magbayad</Text>
            </TouchableOpacity>
          </View>)}
        </>}
      </ScrollView>
      </SafeAreaView>
      <RepaymentModal db={db} customer={customer} visible={customer !== null}
        onClose={() => { setCustomer(null); void refresh(); }} onSuccess={() => { void refresh(); }} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { padding: 16, paddingBottom: 40, gap: 12 },
  title: { fontSize: 20, fontWeight: '700', color: colors.primaryStrong },
  name: { fontSize: 18, fontWeight: '600', color: colors.primaryStrong },
  card: { backgroundColor: colors.surface, padding: 16, borderRadius: radii.card, gap: 8, borderWidth: 1, borderColor: colors.outline },
  body: { fontSize: 16, lineHeight: 24, color: colors.text },
  button: { minHeight: 48, padding: 14, backgroundColor: colors.divider, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '700', color: colors.text, textAlign: 'center' },
  buttonDisabled: { opacity: 0.55 },
  warning: { color: colors.error, fontSize: 14, lineHeight: 20 },
});
