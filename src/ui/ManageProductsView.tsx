import React, { useState, useEffect, useRef } from 'react';
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
import { saveProduct, getAllProducts } from '../actions/catalog-actions.ts';
import { parseCentavos, formatCentavos } from '../domain/money.ts';
import { CatalogValidationError } from '../domain/catalog.ts';
import { manageProductsStyles as styles } from './manage-products-styles.ts';

interface ManageProductsViewProps {
  db: DatabaseSession;
}

export function ManageProductsView({ db }: ManageProductsViewProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [variant, setVariant] = useState('');
  const [unit, setUnit] = useState('piraso');
  const [priceInput, setPriceInput] = useState('');

  const [saving, setSaving] = useState(false);
  const saveInProgress = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const refreshProducts = async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const items = await getAllProducts(db);
      setProducts(items);
    } catch (err) {
      setListError('Hindi mabasa ang talaan ng paninda. Subukan muli.');
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[ManageProductsView] Error fetching products:', err);
      }
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    refreshProducts();
  }, [db]);

  let parsedCentavos: number | null = null;
  let priceParseError: string | null = null;
  if (priceInput.trim().length > 0) {
    try {
      parsedCentavos = parseCentavos(priceInput);
    } catch (err) {
      priceParseError = err instanceof Error ? err.message : 'Maling format ng presyo';
    }
  }

  const isDraftReviewable =
    name.trim().length > 0 &&
    variant.trim().length > 0 &&
    unit.trim().length > 0 &&
    parsedCentavos !== null &&
    priceParseError === null;

  const handleResetDraft = () => {
    setName('');
    setVariant('');
    setUnit('piraso');
    setPriceInput('');
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleSave = async () => {
    if (saveInProgress.current) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!isDraftReviewable || parsedCentavos === null) {
      setErrorMessage(priceParseError ?? 'Punan ang lahat ng kinakailangang field.');
      return;
    }

    saveInProgress.current = true;
    setSaving(true);
    try {
      const saved = await saveProduct(db, {
        name: name.trim(),
        variant: variant.trim(),
        unit: unit.trim(),
        priceCentavos: parsedCentavos,
      });

      setSuccessMessage(`Matagumpay na naitala ang "${saved.name}" (${formatCentavos(saved.priceCentavos)})!`);
      setName('');
      setVariant('');
      setPriceInput('');
      await refreshProducts();
    } catch (err) {
      let displayError = 'Nagkaroon ng hindi inaasahang aberya sa pag-save ng produkto.';
      if (err instanceof CatalogValidationError) {
        displayError = err.message;
      } else if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[ManageProductsView] Unexpected database error:', err);
      }
      setErrorMessage(displayError);
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Pamahalaan ang mga Produkto</Text>
        <Text style={styles.subtitle}>Magrehistro ng paninda at suriin bago i-save</Text>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.sectionHeader}>Magdagdag ng Bagong Produkto</Text>

        <Text style={styles.fieldLabel}>Pangalan ng Produkto *</Text>
        <TextInput
          style={styles.input}
          placeholder="hal. Coca-Cola, Safeguard, Bear Brand"
          placeholderTextColor="#9ca3af"
          value={name}
          editable={!saving}
          onChangeText={(v) => {
            setName(v);
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          accessibilityLabel="Pangalan ng produkto"
        />

        <Text style={styles.fieldLabel}>Variant o Laki *</Text>
        <TextInput
          style={styles.input}
          placeholder="hal. 1.5L, Maliit, 60g, Regular"
          placeholderTextColor="#9ca3af"
          value={variant}
          editable={!saving}
          onChangeText={(v) => {
            setVariant(v);
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          accessibilityLabel="Variant o laki ng produkto"
        />

        <Text style={styles.fieldLabel}>Pirasong Ibinebenta (Unit) *</Text>
        <TextInput
          style={styles.input}
          placeholder="hal. piraso, bote, pack, sachet, lata"
          placeholderTextColor="#9ca3af"
          value={unit}
          editable={!saving}
          onChangeText={(v) => {
            setUnit(v);
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          accessibilityLabel="Unit ng pagbebenta"
        />

        <Text style={styles.fieldLabel}>Presyo sa Piso (₱) *</Text>
        <TextInput
          style={styles.input}
          placeholder="hal. 15.50, 75, 100.00"
          placeholderTextColor="#9ca3af"
          value={priceInput}
          editable={!saving}
          onChangeText={(v) => {
            setPriceInput(v);
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          keyboardType="decimal-pad"
          accessibilityLabel="Presyo sa piso"
        />

        {priceParseError && (
          <Text style={styles.fieldError}>{priceParseError}</Text>
        )}

        <View style={styles.reviewBox}>
          <Text style={styles.reviewTitle}>Suriin ang Detalye Bago I-save:</Text>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Produkto:</Text>
            <Text style={styles.reviewValue}>{name.trim() || '(Wala pa)'}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Variant:</Text>
            <Text style={styles.reviewValue}>{variant.trim() || '(Kailangan)'}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Unit:</Text>
            <Text style={styles.reviewValue}>{unit.trim() || '(Kailangan)'}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Presyo:</Text>
            <Text style={[styles.reviewValue, styles.reviewPrice]}>
              {parsedCentavos !== null ? formatCentavos(parsedCentavos) : '(Kailangan)'}
            </Text>
          </View>
        </View>

        {errorMessage && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {successMessage && (
          <View style={styles.successBox} accessibilityRole="alert">
            <Text style={styles.successText}>{successMessage}</Text>
          </View>
        )}

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleResetDraft}
            disabled={saving}
            accessibilityState={{ disabled: saving }}
            accessibilityRole="button"
            accessibilityLabel="Kanselahin at i-reset ang draft"
          >
            <Text style={styles.cancelButtonText}>I-reset</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveButton, (!isDraftReviewable || saving) && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={!isDraftReviewable || saving}
            accessibilityState={{ disabled: !isDraftReviewable || saving, busy: saving }}
            accessibilityRole="button"
            accessibilityLabel="I-save ang produkto"
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>Kumpirmahin at I-save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.listCard}>
        <Text style={styles.sectionHeader}>
          Talaan ng Paninda{!loadingList && !listError ? ` (${products.length})` : ''}
        </Text>

        {loadingList ? (
          <ActivityIndicator size="small" color="#0284c7" style={{ marginTop: 12 }} />
        ) : listError ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{listError}</Text>
            <TouchableOpacity style={styles.cancelButton} accessibilityRole="button" onPress={refreshProducts}>
              <Text>Subukan muli</Text>
            </TouchableOpacity>
          </View>
        ) : products.length === 0 ? (
          <Text style={styles.emptyListText}>
            Wala pang nakatalang produkto. Maglagay sa itaas upang magsimula.
          </Text>
        ) : (
          products.map((item) => (
            <View key={item.id} style={styles.productRow}>
              <View style={styles.productInfo}>
                <Text style={styles.itemTitle}>{item.name}</Text>
                <Text style={styles.itemMeta}>
                  {item.variant} • {item.unit}
                </Text>
              </View>
              <Text style={styles.itemPrice}>
                {formatCentavos(item.priceCentavos)}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}
