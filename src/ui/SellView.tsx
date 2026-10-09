import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

export function SellView(): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Benta / Checkout</Text>
        </View>

        <Text style={styles.title}>Mode ng Pagbebenta</Text>

        <View style={styles.noticeBox}>
          <Text style={styles.noticeHeader}>Hindi pa magagamit ang checkout</Text>
          <Text style={styles.noticeBody}>
            Ang pagtatala ng benta, paggawa ng cart, at pagkalkula ng sukli ay darating sa susunod na bersyon.
          </Text>
        </View>

        <Text style={styles.description}>
          Gamitin ang &quot;Alamin ang Presyo&quot; upang makita ang presyo ng paninda, at ang &quot;Pamahalaan&quot; upang magdagdag ng produkto sa iyong talaan.
        </Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoDot}>•</Text>
          <Text style={styles.infoText}>
            Ligtas ang iyong talaan: Ang paglipat sa mode na ito ay walang binabagong rekord sa tindahan.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400e',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  noticeBox: {
    backgroundColor: '#eff6ff',
    borderLeftWidth: 4,
    borderLeftColor: '#3b82f6',
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  noticeHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1d4ed8',
    marginBottom: 4,
  },
  noticeBody: {
    fontSize: 14,
    color: '#1e40af',
    lineHeight: 20,
  },
  description: {
    fontSize: 15,
    color: '#475569',
    lineHeight: 22,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  infoDot: {
    fontSize: 16,
    color: '#64748b',
    marginRight: 8,
    lineHeight: 20,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
  },
});
