import { colors } from './theme.ts';
import React, { useState, useEffect } from 'react';
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
import type { ProductWithStock, InventoryMovement } from '../types.ts';
import {
  setStockCount,
  recordDelivery,
  getInventoryHistory,
} from '../actions/inventory-actions.ts';
import { updateProductPrice } from '../actions/catalog-actions.ts';
import {
  validateStockQuantity,
  validateDeliveryQuantity,
  StockValidationError,
} from '../domain/inventory.ts';
import { parseCentavos, formatCentavos } from '../domain/money.ts';
import { stockActionStyles as styles } from './stock-action-styles.ts';

export type StockActionModalMode =
  | 'set_count'
  | 'add_delivery'
  | 'edit_price'
  | 'history'
  | null;

interface StockActionModalProps {
  db: DatabaseSession;
  product: ProductWithStock | null;
  mode: StockActionModalMode;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function StockActionModal({
  db,
  product,
  mode,
  onClose,
  onSuccess,
}: StockActionModalProps): React.JSX.Element | null {
  const [quantityInput, setQuantityInput] = useState('');
  const [deliveryInput, setDeliveryInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [priceInput, setPriceInput] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [historyList, setHistoryList] = useState<InventoryMovement[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!product || !mode) {
      setQuantityInput('');
      setDeliveryInput('');
      setNoteInput('');
      setPriceInput('');
      setErrorMessage(null);
      setHistoryList([]);
      return;
    }

    setQuantityInput('');
    setDeliveryInput('');
    setNoteInput('');
    setPriceInput('');
    setErrorMessage(null);

    if (mode === 'history') {
      let isCurrent = true;
      setLoadingHistory(true);
      getInventoryHistory(db, product.id)
        .then((items) => {
          if (isCurrent) setHistoryList(items);
        })
        .catch((err: unknown) => {
          if (isCurrent) {
            setErrorMessage('Hindi mabasa ang kasaysayan ng stock.');
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              console.error('[StockActionModal] History fetch failed:', err);
            }
          }
        })
        .finally(() => {
          if (isCurrent) setLoadingHistory(false);
        });
      return () => {
        isCurrent = false;
      };
    }
  }, [product, mode, db]);

  if (!product || !mode) {
    return null;
  }

  // Live validation calculations for preview
  let parsedQuantity: number | null = null;
  let quantityValidationError: string | null = null;
  if (mode === 'set_count' && quantityInput.trim().length > 0) {
    try {
      parsedQuantity = validateStockQuantity(quantityInput);
    } catch (err) {
      quantityValidationError =
        err instanceof Error ? err.message : 'Maling bilang ng stock';
    }
  }

  let parsedDelivery: number | null = null;
  let deliveryValidationError: string | null = null;
  if (mode === 'add_delivery' && deliveryInput.trim().length > 0) {
    try {
      parsedDelivery = validateDeliveryQuantity(deliveryInput);
    } catch (err) {
      deliveryValidationError =
        err instanceof Error ? err.message : 'Maling dami ng delivery';
    }
  }

  let parsedPriceCentavos: number | null = null;
  let priceValidationError: string | null = null;
  if (mode === 'edit_price' && priceInput.trim().length > 0) {
    try {
      parsedPriceCentavos = parseCentavos(priceInput);
    } catch (err) {
      priceValidationError =
        err instanceof Error ? err.message : 'Maling format ng presyo';
    }
  }

  const handleConfirmSetStock = async () => {
    if (submitting) return;
    setErrorMessage(null);

    let validQty: number;
    try {
      validQty = validateStockQuantity(quantityInput);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Maling bilang ng stock'
      );
      return;
    }

    setSubmitting(true);
    try {
      const movement = await setStockCount(db, {
        productId: product.id,
        newQuantity: validQty,
        note: noteInput.trim().length > 0 ? noteInput.trim() : null,
      });

      const beforeText =
        movement.previousQuantity !== null
          ? `${movement.previousQuantity} ${product.unit}`
          : 'Walang naitala';
      onSuccess(
        `Naitakda ang stock ng "${product.name}": ${beforeText} ➔ ${movement.newQuantity} ${product.unit}`
      );
      onClose();
    } catch (err) {
      const msg =
        err instanceof StockValidationError
          ? err.message
          : 'Nagkaroon ng aberya sa pag-save ng bilang ng stock.';
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmAddDelivery = async () => {
    if (submitting) return;
    setErrorMessage(null);

    let validQty: number;
    try {
      validQty = validateDeliveryQuantity(deliveryInput);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Maling dami ng delivery'
      );
      return;
    }

    setSubmitting(true);
    try {
      const movement = await recordDelivery(db, {
        productId: product.id,
        deliveryQuantity: validQty,
        note: noteInput.trim().length > 0 ? noteInput.trim() : null,
      });

      onSuccess(
        `Naitala ang delivery ng "${product.name}": +${movement.quantityDelta} ${product.unit} (Kabuuan: ${movement.newQuantity} ${product.unit})`
      );
      onClose();
    } catch (err) {
      const msg =
        err instanceof StockValidationError
          ? err.message
          : 'Nagkaroon ng aberya sa pag-save ng delivery.';
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmEditPrice = async () => {
    if (submitting) return;
    setErrorMessage(null);

    let validCentavos: number;
    try {
      validCentavos = parseCentavos(priceInput);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Maling format ng presyo'
      );
      return;
    }

    setSubmitting(true);
    try {
      const updated = await updateProductPrice(
        db,
        product.id,
        validCentavos
      );

      onSuccess(
        `Nai-update ang presyo ng "${updated.name}" sa ${formatCentavos(updated.priceCentavos)} (Hindi nabago ang stock).`
      );
      onClose();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Nagkaroon ng aberya sa pag-update ng presyo.';
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={true}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {mode === 'set_count' && 'Itakda ang Bilang ng Stock'}
              {mode === 'add_delivery' && 'Magtala ng Natanggap na Delivery'}
              {mode === 'edit_price' && 'Baguhin ang Presyo'}
              {mode === 'history' && 'Kasaysayan ng Paggalaw ng Stock'}
            </Text>
            <View style={styles.productBadge}>
              <Text style={styles.productBadgeTitle}>{product.name}</Text>
              <Text style={styles.productBadgeMeta}>
                {product.variant} • {product.unit} • Presyo:{' '}
                {formatCentavos(product.priceCentavos)}
              </Text>
            </View>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            {/* Mode: SET STOCK */}
            {mode === 'set_count' && (
              <View>
                <Text style={styles.fieldLabel}>
                  Bagong Bilang ng Stock ({product.unit}) *
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder={`hal. 10, 25, 0 (buong ${product.unit})`}
                  placeholderTextColor={colors.muted}
                  value={quantityInput}
                  onChangeText={(v) => {
                    setQuantityInput(v);
                    setErrorMessage(null);
                  }}
                  keyboardType="number-pad"
                  editable={!submitting}
                  accessibilityLabel="Bagong bilang ng stock"
                />
                {quantityValidationError && (
                  <Text style={styles.fieldError}>
                    {quantityValidationError}
                  </Text>
                )}

                <Text style={styles.fieldLabel}>Tala o Dahilan (Opsyonal)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="hal. Lingguhang bilang, audit, nasira"
                  placeholderTextColor={colors.muted}
                  value={noteInput}
                  onChangeText={setNoteInput}
                  editable={!submitting}
                  accessibilityLabel="Tala sa pagbabago ng stock"
                />

                {/* Before / After Preview */}
                <View style={styles.previewCard}>
                  <Text style={styles.previewTitle}>
                    Pagsusuri Bago Kumpirmahin:
                  </Text>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>Dating bilang:</Text>
                    <Text style={styles.previewValue}>
                      {product.quantity !== null
                        ? `${product.quantity} ${product.unit}`
                        : 'Walang naitalang bilang'}
                    </Text>
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>Bagong bilang:</Text>
                    <Text
                      style={[
                        styles.previewValue,
                        parsedQuantity !== null && styles.previewValueHighlight,
                      ]}
                    >
                      {parsedQuantity !== null
                        ? `${parsedQuantity} ${product.unit}`
                        : '(Kailangan ilagay)'}
                    </Text>
                  </View>
                  {parsedQuantity !== null && (
                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>Pagbabago:</Text>
                      <Text style={styles.previewValue}>
                        {product.quantity !== null
                          ? `${parsedQuantity - product.quantity >= 0 ? '+' : ''}${parsedQuantity - product.quantity} ${product.unit}`
                          : `Bagong simula (${parsedQuantity} ${product.unit})`}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Mode: ADD DELIVERY */}
            {mode === 'add_delivery' && (
              <View>
                <Text style={styles.fieldLabel}>
                  Dami ng Idinagdag na Delivery ({product.unit}) *
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder={`hal. 12, 24, 50 (dapat higit sa 0)`}
                  placeholderTextColor={colors.muted}
                  value={deliveryInput}
                  onChangeText={(v) => {
                    setDeliveryInput(v);
                    setErrorMessage(null);
                  }}
                  keyboardType="number-pad"
                  editable={!submitting}
                  accessibilityLabel="Dami ng delivery"
                />
                {deliveryValidationError && (
                  <Text style={styles.fieldError}>
                    {deliveryValidationError}
                  </Text>
                )}

                <Text style={styles.fieldLabel}>Tala o Resibo (Opsyonal)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="hal. Invoice #5021, Delivery mula sa Puregold"
                  placeholderTextColor={colors.muted}
                  value={noteInput}
                  onChangeText={setNoteInput}
                  editable={!submitting}
                  accessibilityLabel="Tala sa delivery"
                />

                {/* Before / After Preview */}
                <View style={styles.previewCard}>
                  <Text style={styles.previewTitle}>
                    Pagsusuri Bago Kumpirmahin:
                  </Text>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>Dating bilang:</Text>
                    <Text style={styles.previewValue}>
                      {product.quantity !== null
                        ? `${product.quantity} ${product.unit}`
                        : 'Walang naitalang bilang'}
                    </Text>
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>Idadagdag na stock:</Text>
                    <Text
                      style={[
                        styles.previewValue,
                        parsedDelivery !== null && styles.previewValueHighlight,
                      ]}
                    >
                      {parsedDelivery !== null
                        ? `+${parsedDelivery} ${product.unit}`
                        : '(Kailangan ilagay)'}
                    </Text>
                  </View>
                  {parsedDelivery !== null && (
                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>Magiging kabuuan:</Text>
                      <Text
                        style={[
                          styles.previewValue,
                          styles.previewValueHighlight,
                        ]}
                      >
                        {`${(product.quantity ?? 0) + parsedDelivery} ${product.unit}`}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Mode: EDIT PRICE */}
            {mode === 'edit_price' && (
              <View>
                <Text style={styles.fieldLabel}>Bagong Presyo sa Piso (₱) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="hal. 18.50, 75, 100.00"
                  placeholderTextColor={colors.muted}
                  value={priceInput}
                  onChangeText={(v) => {
                    setPriceInput(v);
                    setErrorMessage(null);
                  }}
                  keyboardType="decimal-pad"
                  editable={!submitting}
                  accessibilityLabel="Bagong presyo sa piso"
                />
                {priceValidationError && (
                  <Text style={styles.fieldError}>
                    {priceValidationError}
                  </Text>
                )}

                {/* Before / After Preview */}
                <View style={styles.previewCard}>
                  <Text style={styles.previewTitle}>
                    Pagsusuri ng Bagong Presyo:
                  </Text>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>Kasalukuyang presyo:</Text>
                    <Text style={styles.previewValue}>
                      {formatCentavos(product.priceCentavos)}
                    </Text>
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>Bagong presyo:</Text>
                    <Text
                      style={[
                        styles.previewValue,
                        parsedPriceCentavos !== null &&
                          styles.previewValueHighlight,
                      ]}
                    >
                      {parsedPriceCentavos !== null
                        ? formatCentavos(parsedPriceCentavos)
                        : '(Kailangan ilagay)'}
                    </Text>
                  </View>
                  <Text style={styles.previewNote}>
                    Paalala: Ang bilang ng stock (
                    {product.quantity !== null
                      ? `${product.quantity} ${product.unit}`
                      : 'walang naitalang bilang'}
                    ) ay mananatiling hindi magbabago.
                  </Text>
                </View>
              </View>
            )}

            {/* Mode: HISTORY */}
            {mode === 'history' && (
              <View>
                {loadingHistory ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primary}
                    style={{ marginVertical: 20 }}
                  />
                ) : historyList.length === 0 ? (
                  <Text style={styles.emptyHistoryText}>
                    Wala pang naitalang paggalaw ng stock para sa produktong ito.
                  </Text>
                ) : (
                  <View style={styles.historyList}>
                    {historyList.map((m) => (
                      <View key={m.id} style={styles.historyItem}>
                        <View style={styles.historyHeader}>
                          <Text style={styles.historyTypeBadge}>
                            {m.movementType === 'set_count' && 'Pagwawasto ng Bilang'}
                            {m.movementType === 'add_delivery' && 'Natanggap na Delivery'}
                            {m.movementType === 'sale_deduction' && 'Bawas sa Benta'}
                            {m.movementType === 'sale_cancellation' && 'Kanseladong Benta'}
                          </Text>
                          <Text style={styles.historyDate}>
                            {new Date(m.createdAt).toLocaleDateString('fil-PH', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Text>
                        </View>
                        <Text style={styles.historyFlow}>
                          {m.previousQuantity !== null
                            ? `${m.previousQuantity} ${product.unit} ➔ `
                            : 'Wala ➔ '}
                          {`${m.newQuantity} ${product.unit}`}
                          {m.quantityDelta !== 0 && (
                            <Text style={{ color: m.quantityDelta > 0 ? colors.success : colors.error }}>
                              {` (${m.quantityDelta > 0 ? '+' : ''}${m.quantityDelta})`}
                            </Text>
                          )}
                        </Text>
                        {m.note ? (
                          <Text style={styles.historyNote}>Tala: {m.note}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Error Message */}
            {errorMessage && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={mode === 'history' ? 'Isara' : 'Kanselahin'}
            >
              <Text style={styles.cancelButtonText}>
                {mode === 'history' ? 'Isara' : 'Kanselahin'}
              </Text>
            </TouchableOpacity>

            {mode === 'set_count' && (
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  (parsedQuantity === null || submitting) &&
                    styles.confirmButtonDisabled,
                ]}
                onPress={handleConfirmSetStock}
                disabled={parsedQuantity === null || submitting}
                accessibilityRole="button"
                accessibilityLabel="Kumpirmahin ang bagong bilang"
              >
                {submitting ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.confirmButtonText}>
                    Kumpirmahin ang Bilang
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {mode === 'add_delivery' && (
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  (parsedDelivery === null || submitting) &&
                    styles.confirmButtonDisabled,
                ]}
                onPress={handleConfirmAddDelivery}
                disabled={parsedDelivery === null || submitting}
                accessibilityRole="button"
                accessibilityLabel="Kumpirmahin ang delivery"
              >
                {submitting ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.confirmButtonText}>
                    Kumpirmahin ang Delivery
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {mode === 'edit_price' && (
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  (parsedPriceCentavos === null || submitting) &&
                    styles.confirmButtonDisabled,
                ]}
                onPress={handleConfirmEditPrice}
                disabled={parsedPriceCentavos === null || submitting}
                accessibilityRole="button"
                accessibilityLabel="Kumpirmahin ang bagong presyo"
              >
                {submitting ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.confirmButtonText}>
                    Kumpirmahin ang Presyo
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
