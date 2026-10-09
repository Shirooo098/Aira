import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import type { DatabaseSession } from '../db/database.ts';
import type { Product } from '../types.ts';
import { createLookupSession, type LookupState } from '../actions/lookup-session.ts';
import { formatCentavos } from '../domain/money.ts';
import { askPriceStyles as styles } from './ask-price-styles.ts';
import { SpeechTranscriptInput } from './SpeechTranscriptInput.tsx';

interface AskPriceViewProps {
  db: DatabaseSession;
}

export function AskPriceView({ db }: AskPriceViewProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [{ loading, result, error }, setLookup] = useState<LookupState>({
    result: { kind: 'empty' }, loading: false, error: null,
  });
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const lookup = useMemo(() => createLookupSession(db, setLookup), [db]);
  useEffect(() => () => lookup.cancel(), [lookup]);
  const handleSearch = (text: string) => {
    setQuery(text);
    setSelectedProduct(null);
    void lookup.search(text);
  };

  const handleClear = () => handleSearch('');

  const displayProduct = selectedProduct ?? (result.kind === 'exact' ? result.product : null);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Alamin ang Presyo</Text>
        <Text style={styles.subtitle}>I-type ang pangalan o variant ng produkto</Text>
      </View>

      <SpeechTranscriptInput />

      {error && (
        <View accessibilityRole="alert">
          <Text>{error}</Text>
          <TouchableOpacity style={styles.clearButton} accessibilityRole="button" onPress={() => handleSearch(query)}>
            <Text>Subukan muli</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="hal. Coke, Bear Brand, Lucky Me"
          placeholderTextColor="#9ca3af"
          value={query}
          onChangeText={handleSearch}
          accessibilityLabel="Pangalan ng produkto na hahanapin"
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={handleClear}
            accessibilityLabel="Burahin ang nilalaman"
            accessibilityRole="button"
          >
            <Text style={styles.clearButtonText}>Burahin</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && (
        <View style={styles.centered} accessibilityLabel="Naghahanap">
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.helperText}>Naghahanap sa catalog...</Text>
        </View>
      )}

      {!loading && displayProduct && (
        <View style={styles.cardSuccess} accessibilityLabel="Resulta ng presyo">
          <Text style={styles.productBadge}>Nahanap na Produkto</Text>
          <Text style={styles.productName}>{displayProduct.name}</Text>
          <Text style={styles.productMeta}>
            {displayProduct.variant} • bawat {displayProduct.unit}
          </Text>
          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>Presyo:</Text>
            <Text style={styles.priceValue}>
              {formatCentavos(displayProduct.priceCentavos)}
            </Text>
          </View>
        </View>
      )}

      {!loading && !selectedProduct && result.kind === 'ambiguous' && (
        <View style={styles.ambiguousContainer}>
          <Text style={styles.ambiguousTitle}>
            May {result.products.length} tumutugmang produkto. Pumili:
          </Text>
          {result.products.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.choiceCard}
              onPress={() => setSelectedProduct(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.variant}, bawat ${item.unit}, presyo ${formatCentavos(item.priceCentavos)}`}
            >
              <View style={styles.choiceInfo}>
                <Text style={styles.choiceName}>{item.name}</Text>
                <Text style={styles.choiceMeta}>
                  {item.variant} • bawat {item.unit}
                </Text>
              </View>
              <Text style={styles.choicePrice}>
                {formatCentavos(item.priceCentavos)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!loading && result.kind === 'unknown' && (
        <View style={styles.cardUnknown} accessibilityLabel="Hindi nahanap ang produkto">
          <Text style={styles.unknownTitle}>Hindi nahanap ang produkto</Text>
          <Text style={styles.unknownText}>
            Walang naitalang presyo para sa &quot;{result.query}&quot;.
          </Text>
          <Text style={styles.unknownHint}>
            Hindi kami nanghuhula ng presyo. Maaari mong idagdag ang produktong ito sa tab na &quot;Pamahalaan&quot;.
          </Text>
        </View>
      )}

      {!loading && !error && result.kind === 'empty' && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            I-type ang pangalan ng paninda sa itaas upang masilip ang opisyal na presyo.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
