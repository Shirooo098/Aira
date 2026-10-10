import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { DatabaseSession } from '../db/database.ts';
import type { Product } from '../types.ts';
import { createLookupSession, type LookupState } from '../actions/lookup-session.ts';
import { formatCentavos } from '../domain/money.ts';
import { parsePriceCommand } from '../domain/price-command.ts';
import { AppIcon } from './AppIcon.tsx';
import { colors } from './theme.ts';
import { askPriceStyles as styles } from './ask-price-styles.ts';
import { SpeechTranscriptInput } from './SpeechTranscriptInput.tsx';

interface AskPriceViewProps {
  db: DatabaseSession;
}

type QuerySource = 'typed' | 'voice' | null;

export function AskPriceView({ db }: AskPriceViewProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [reviewedQuestion, setReviewedQuestion] = useState<string | null>(null);
  const [extractedPhrase, setExtractedPhrase] = useState<string | null>(null);
  const [voiceCommandError, setVoiceCommandError] = useState<string | null>(null);
  const [{ loading, result, error }, setLookup] = useState<LookupState>({
    result: { kind: 'empty' }, loading: false, error: null,
  });
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const querySource = useRef<QuerySource>(null);
  const searchInputRef = useRef<TextInput>(null);

  const lookup = useMemo(() => createLookupSession(db, setLookup), [db]);
  useEffect(() => () => lookup.cancel(), [lookup]);

  const handleSearch = (text: string) => {
    setQuery(text);
    querySource.current = text.trim() ? 'typed' : null;
    setSelectedProduct(null);
    setReviewedQuestion(null);
    setExtractedPhrase(null);
    setVoiceCommandError(null);
    void lookup.search(text);
  };

  const handleVoiceInvalidated = () => {
    // Editing or discarding speech should not erase a separate query the owner typed.
    if (querySource.current !== 'voice') return;
    querySource.current = null;
    setQuery('');
    setSelectedProduct(null);
    setReviewedQuestion(null);
    setExtractedPhrase(null);
    setVoiceCommandError(null);
    void lookup.search('');
  };

  const handleReviewedTranscript = (text: string) => {
    const phrase = parsePriceCommand(text);
    querySource.current = 'voice';
    setReviewedQuestion(text);
    setExtractedPhrase(phrase);
    setSelectedProduct(null);
    setVoiceCommandError(null);

    if (!phrase) {
      setQuery('');
      setVoiceCommandError('Hindi matukoy ang pangalan ng produkto sa tanong. I-edit ang transcript o mag-type ng pangalan sa ibaba.');
      void lookup.search('');
      return;
    }

    setQuery(phrase);
    void lookup.search(phrase);
  };

  const handleClear = () => handleSearch('');
  const handleRetrySearch = () => {
    setSelectedProduct(null);
    void lookup.search(query);
  };

  const displayProduct = selectedProduct ?? (result.kind === 'exact' ? result.product : null);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Magkano ito?</Text>
        <Text style={styles.subtitle}>Hanapin ang presyo ng paninda sa tindahan mo.</Text>
      </View>

      {/* Rounded search with search/clear icons BEFORE speech */}
      <View style={styles.searchRow}>
        <AppIcon name="search" size={20} color={colors.primaryMuted} />
        <TextInput
          ref={searchInputRef}
          style={styles.searchInput}
          placeholder="hal. Coke, Bear Brand, Lucky Me"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={handleSearch}
          accessibilityLabel="Pangalan ng paninda na hahanapin"
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
            <View style={styles.clearButtonIcon}>
              <AppIcon name="close" size={14} color={colors.muted} />
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Apricot primary speech control */}
      <SpeechTranscriptInput
        compact={true}
        onReviewedTranscript={handleReviewedTranscript}
        onTranscriptInvalidated={handleVoiceInvalidated}
      />

      {/* Purple correction link that focuses search input */}
      <TouchableOpacity
        style={styles.correctionLink}
        onPress={() => searchInputRef.current?.focus()}
        accessibilityRole="button"
        accessibilityLabel="I-edit ang hinahanap"
        activeOpacity={0.7}
      >
        <AppIcon name="edit" size={18} color={colors.primary} />
        <Text style={styles.correctionText}>I-edit ang hinahanap</Text>
      </TouchableOpacity>

      {reviewedQuestion !== null && (
        <View style={styles.voiceReviewContainer}>
          <Text style={styles.voiceReviewLabel}>Nasuring tanong</Text>
          <Text style={styles.voiceReviewText}>{reviewedQuestion}</Text>
          {extractedPhrase !== null && (
            <>
              <Text style={styles.voiceReviewLabel}>Produktong hahanapin</Text>
              <Text style={styles.voiceReviewText}>{extractedPhrase}</Text>
            </>
          )}
          {voiceCommandError !== null && (
            <Text style={styles.voiceCommandError} accessibilityRole="alert">
              {voiceCommandError}
            </Text>
          )}
        </View>
      )}

      {error && (
        <View style={styles.errorCard} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} accessibilityRole="button" onPress={handleRetrySearch}>
            <Text style={styles.retryButtonText}>Subukan muli</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && (
        <View style={styles.centered} accessibilityLabel="Naghahanap">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.helperText}>Naghahanap sa catalog...</Text>
        </View>
      )}

      {!loading && displayProduct && (
        <View style={styles.cardSuccess} accessibilityLabel="Resulta ng presyo">
          <View style={styles.resultHandle} />
          <Text style={styles.productName}>{displayProduct.name}</Text>
          <Text style={styles.productMeta}>
            {displayProduct.variant ? `${displayProduct.variant} • ` : ''}bawat {displayProduct.unit}
          </Text>
          <Text style={styles.priceValue}>
            {formatCentavos(displayProduct.priceCentavos)}
          </Text>
          <View style={styles.foundBadge}>
            <AppIcon name="tag" size={16} color={colors.primary} />
            <Text style={styles.foundBadgeText}>Nahanap sa paninda</Text>
          </View>
          <View style={styles.resultDivider} />
          <View style={styles.reminderRow}>
            <AppIcon name="info" size={20} color={colors.primary} />
            <Text style={styles.reminderText}>Suriin ang variant at laki.</Text>
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
              accessibilityLabel={`${item.name}, ${item.variant}, bawat ${item.unit}`}
            >
              <View style={styles.choiceInfo}>
                <Text style={styles.choiceName}>{item.name}</Text>
                <Text style={styles.choiceMeta}>
                  {item.variant} • bawat {item.unit}
                </Text>
              </View>
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
            Hindi kami nanghuhula ng presyo. Maaari mong idagdag ang produktong ito sa tab na &quot;Tindahan&quot;.
          </Text>
        </View>
      )}

      {!loading && !error && voiceCommandError === null && result.kind === 'empty' && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            I-type ang pangalan ng paninda sa itaas o gamitin ang boses upang alamin ang opisyal na presyo.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
