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
import type { ProductWithStock, SalePreview, PendingGcashDraft } from '../types.ts';
import { getAllProductsWithStock } from '../actions/inventory-actions.ts';
import {
  buildSalePreview,
  completeCashSale,
  createPendingGcashDraft,
  getPendingGcashDrafts,
  confirmGcashSale,
  cancelPendingGcashDraft,
} from '../actions/sales-actions.ts';
import { parseCentavos, formatCentavos } from '../domain/money.ts';
import { SaleValidationError, InsufficientStockError } from '../domain/sales.ts';
import { sellStyles as styles } from './sell-styles.ts';

interface SellViewProps {
  db: DatabaseSession;
}

interface CartItem {
  product: ProductWithStock;
  quantity: number;
}

export function SellView({ db }: SellViewProps): React.JSX.Element {
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'gcash'>('cash');
  const [tenderInput, setTenderInput] = useState('');
  const [gcashRefInput, setGcashRefInput] = useState('');
  const [preview, setPreview] = useState<SalePreview | null>(null);

  const [pendingDrafts, setPendingDrafts] = useState<PendingGcashDraft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const submitInProgress = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    method: 'cash' | 'gcash';
    totalCentavos: number;
    tenderCentavos?: number;
    changeCentavos?: number;
    referenceNumber?: string | null;
    itemCount: number;
  } | null>(null);

  const loadProducts = async () => {
    try {
      setLoadingProducts(true);
      const items = await getAllProductsWithStock(db);
      setProducts(items);
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[SellView] Error fetching products:', err);
      }
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadPendingDrafts = async () => {
    try {
      setLoadingDrafts(true);
      const drafts = await getPendingGcashDrafts(db);
      setPendingDrafts(drafts);
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[SellView] Error fetching pending drafts:', err);
      }
    } finally {
      setLoadingDrafts(false);
    }
  };

  useEffect(() => {
    loadProducts();
    loadPendingDrafts();
  }, [db]);

  // Recompute preview whenever cart or tender input changes
  useEffect(() => {
    if (cart.length === 0) {
      setPreview(null);
      return;
    }

    let isCurrent = true;
    let tenderCentavos = 0;
    if (paymentMethod === 'cash' && tenderInput.trim().length > 0) {
      try {
        tenderCentavos = parseCentavos(tenderInput);
      } catch {
        tenderCentavos = 0;
      }
    }

    buildSalePreview(db, {
      items: cart.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
      tenderCentavos,
    })
      .then((res) => {
        if (isCurrent) setPreview(res);
      })
      .catch((err) => {
        if (isCurrent) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.error('[SellView] Error building sale preview:', err);
          }
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [cart, tenderInput, paymentMethod, db]);

  const addToCart = (product: ProductWithStock) => {
    setSuccessInfo(null);
    setErrorMessage(null);
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setSuccessInfo(null);
    setErrorMessage(null);
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter((item): item is CartItem => item !== null)
    );
  };

  const removeFromCart = (productId: string) => {
    setSuccessInfo(null);
    setErrorMessage(null);
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const handleCompleteCashSale = async () => {
    if (submitInProgress.current || !preview || !preview.canComplete) return;

    submitInProgress.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    setSuccessInfo(null);

    let parsedTender = 0;
    try {
      parsedTender = parseCentavos(tenderInput);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Maling halaga ng bayad');
      submitInProgress.current = false;
      setSubmitting(false);
      return;
    }

    try {
      const completed = await completeCashSale(db, {
        items: cart.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
        tenderCentavos: parsedTender,
      });

      setSuccessInfo({
        method: 'cash',
        totalCentavos: completed.totalCentavos,
        tenderCentavos: completed.tenderCentavos,
        changeCentavos: completed.changeCentavos,
        itemCount: completed.items.length,
      });

      setCart([]);
      setTenderInput('');
      setPreview(null);
      await loadProducts();
    } catch (err) {
      if (err instanceof InsufficientStockError || err instanceof SaleValidationError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Nagkaroon ng aberya sa pagtatala ng benta.');
      }
    } finally {
      submitInProgress.current = false;
      setSubmitting(false);
    }
  };

  const handleCreatePendingGcash = async () => {
    if (submitInProgress.current || !preview || preview.insufficientStockItems.length > 0) return;

    submitInProgress.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    setSuccessInfo(null);

    try {
      await createPendingGcashDraft(db, {
        items: cart.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
        referenceNumber: gcashRefInput.trim().length > 0 ? gcashRefInput.trim() : undefined,
      });

      setCart([]);
      setGcashRefInput('');
      setPreview(null);
      await loadPendingDrafts();
    } catch (err) {
      if (err instanceof InsufficientStockError || err instanceof SaleValidationError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Nagkaroon ng aberya sa paggawa ng pending GCash draft.');
      }
    } finally {
      submitInProgress.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmPendingDraft = async (draft: PendingGcashDraft) => {
    if (submitInProgress.current) return;

    submitInProgress.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    setSuccessInfo(null);

    try {
      const confirmed = await confirmGcashSale(db, {
        draftId: draft.id,
        items: draft.items,
        referenceNumber: draft.referenceNumber ?? undefined,
        idempotencyKey: `gcash_confirm_${draft.id}`,
      });

      setSuccessInfo({
        method: 'gcash',
        totalCentavos: confirmed.totalCentavos,
        referenceNumber: confirmed.referenceNumber,
        itemCount: confirmed.items.length,
      });

      await loadProducts();
      await loadPendingDrafts();
    } catch (err) {
      if (err instanceof InsufficientStockError || err instanceof SaleValidationError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Hindi nakumpirma ang GCash benta. Suriin ang stock.');
      }
    } finally {
      submitInProgress.current = false;
      setSubmitting(false);
    }
  };

  const handleCancelPendingDraft = async (draftId: string) => {
    if (submitInProgress.current) return;

    submitInProgress.current = true;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      await cancelPendingGcashDraft(db, draftId);
      await loadPendingDrafts();
    } catch (err) {
      setErrorMessage('Hindi nakansela ang pending draft.');
    } finally {
      submitInProgress.current = false;
      setSubmitting(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (q.length === 0) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.variant.toLowerCase().includes(q) ||
      p.unit.toLowerCase().includes(q)
    );
  });

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>Pagbebenta & Checkout</Text>
        <Text style={styles.subtitle}>Pumili ng produkto, suriin ang presyo at stock, at kumpletuhin ang benta</Text>
      </View>

      {/* Pending GCash Drafts Card (Owner Review Seam) */}
      {pendingDrafts.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>
            Naghihintay ng Kumpirmasyon sa GCash ({pendingDrafts.length})
          </Text>
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingBannerTitle}>Babala sa Pagtanggap ng GCash</Text>
            <Text style={styles.pendingBannerText}>
              Huwag magtiwala sa screenshot ng mamimili. Buksan muna ang iyong sariling GCash app at kumpirmahing pumasok ang pera bago pindutin ang Kumpirmahin.
            </Text>
          </View>

          {pendingDrafts.map((draft) => (
            <View key={draft.id} style={styles.draftCard}>
              <View style={styles.draftHeader}>
                <Text style={styles.draftRef}>
                  {draft.referenceNumber ? `Ref: ${draft.referenceNumber}` : 'Walang Ref #'}
                </Text>
                <Text style={styles.draftTotal}>{formatCentavos(draft.totalCentavos)}</Text>
              </View>
              <Text style={{ fontSize: 12, color: '#64748b' }}>
                {draft.items.length} aytem • {new Date(draft.createdAt).toLocaleTimeString('fil-PH', { hour: '2-digit', minute: '2-digit' })}
              </Text>

              <View style={styles.draftActions}>
                <TouchableOpacity
                  style={styles.draftCancelBtn}
                  onPress={() => handleCancelPendingDraft(draft.id)}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Kanselahin ang draft"
                >
                  <Text style={styles.draftCancelText}>Kanselahin</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.draftConfirmBtn}
                  onPress={() => handleConfirmPendingDraft(draft)}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Kumpirmahing natanggap ang GCash"
                >
                  <Text style={styles.draftConfirmText}>Kumpirmahin (Pumasok na)</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Catalog Selector Card */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Pumili ng Paninda</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Maghanap ng paninda..."
            placeholderTextColor="#9ca3af"
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel="Maghanap ng paninda"
          />
        </View>

        {loadingProducts ? (
          <ActivityIndicator size="small" color="#0284c7" />
        ) : filteredProducts.length === 0 ? (
          <Text style={styles.emptyText}>Walang nahanap na paninda.</Text>
        ) : (
          <ScrollView style={styles.catalogScroll} nestedScrollEnabled={true}>
            {filteredProducts.map((p) => (
              <View key={p.id} style={styles.catalogItem}>
                <View style={styles.catalogItemInfo}>
                  <Text style={styles.catalogItemName}>{p.name}</Text>
                  <Text style={styles.catalogItemMeta}>
                    {p.variant} • {p.unit}
                  </Text>
                  <Text
                    style={[
                      styles.catalogItemStock,
                      p.quantity !== null && p.quantity > 0 ? styles.stockOk : styles.stockNone,
                    ]}
                  >
                    {p.quantity !== null
                      ? `Stock: ${p.quantity} ${p.unit}`
                      : 'Walang naitalang stock'}
                  </Text>
                </View>
                <Text style={styles.catalogItemPrice}>
                  {formatCentavos(p.priceCentavos)}
                </Text>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => addToCart(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`Idagdag ang ${p.name} sa cart`}
                >
                  <Text style={styles.addButtonText}>+ Idagdag</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Cart & Checkout Card */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>
          Listahan ng Bibilhin {cart.length > 0 ? `(${cart.length})` : ''}
        </Text>

        {cart.length === 0 ? (
          <Text style={styles.emptyText}>Walang aytem sa listahan. Pumili sa itaas.</Text>
        ) : (
          <View style={styles.cartTable}>
            {cart.map((item) => {
              const previewItem = preview?.items.find((pi) => pi.productId === item.product.id);
              const hasInsufficient = previewItem && !previewItem.hasSufficientStock;

              return (
                <View key={item.product.id} style={styles.cartItemRow}>
                  <View style={styles.cartItemDetails}>
                    <Text style={styles.cartItemTitle}>{item.product.name}</Text>
                    <Text style={styles.cartItemUnitPrice}>
                      {formatCentavos(item.product.priceCentavos)} bawat {item.product.unit}
                    </Text>
                    {hasInsufficient && (
                      <Text style={styles.cartItemStockWarning}>
                        {previewItem.availableStock === null
                          ? 'Kailangan itakda ang stock bago maibenta'
                          : `Kulang ang stock! Mayroon lang ${previewItem.availableStock} ${item.product.unit}`}
                      </Text>
                    )}
                  </View>

                  <View style={styles.cartQuantityControls}>
                    <TouchableOpacity
                      style={styles.qtyButton}
                      onPress={() => updateQuantity(item.product.id, -1)}
                      accessibilityRole="button"
                      accessibilityLabel="Bawasan ng isa"
                    >
                      <Text style={styles.qtyButtonText}>-</Text>
                    </TouchableOpacity>

                    <Text style={styles.qtyText}>{item.quantity}</Text>

                    <TouchableOpacity
                      style={styles.qtyButton}
                      onPress={() => updateQuantity(item.product.id, 1)}
                      accessibilityRole="button"
                      accessibilityLabel="Dagdagan ng isa"
                    >
                      <Text style={styles.qtyButtonText}>+</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.cartSubtotal}>
                    {previewItem
                      ? formatCentavos(previewItem.subtotalCentavos)
                      : formatCentavos(item.product.priceCentavos * item.quantity)}
                  </Text>

                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => removeFromCart(item.product.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Alisin sa listahan"
                  >
                    <Text style={styles.deleteButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}

            {/* Payment Method Selector */}
            <View style={styles.paymentMethodRow}>
              <TouchableOpacity
                style={[styles.paymentTab, paymentMethod === 'cash' && styles.paymentTabActive]}
                onPress={() => setPaymentMethod('cash')}
                accessibilityRole="button"
                accessibilityLabel="Pumili ng Cash na bayad"
              >
                <Text
                  style={[
                    styles.paymentTabText,
                    paymentMethod === 'cash' && styles.paymentTabTextActive,
                  ]}
                >
                  Bayad sa Cash
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.paymentTab, paymentMethod === 'gcash' && styles.paymentTabActive]}
                onPress={() => setPaymentMethod('gcash')}
                accessibilityRole="button"
                accessibilityLabel="Pumili ng GCash na bayad"
              >
                <Text
                  style={[
                    styles.paymentTabText,
                    paymentMethod === 'gcash' && styles.paymentTabTextActive,
                  ]}
                >
                  Bayad sa GCash
                </Text>
              </TouchableOpacity>
            </View>

            {/* Price Snapshot, Tender & Change Review */}
            {preview && (
              <View style={styles.checkoutSummary}>
                <View style={[styles.summaryRow, styles.totalRow]}>
                  <Text style={styles.totalLabel}>Kabuuan:</Text>
                  <Text style={styles.totalValue}>{formatCentavos(preview.totalCentavos)}</Text>
                </View>

                {paymentMethod === 'cash' ? (
                  <>
                    <View style={styles.tenderSection}>
                      <Text style={styles.fieldLabel}>Natanggap na Bayad (₱):</Text>
                      <TextInput
                        style={styles.tenderInput}
                        placeholder="hal. 50, 100, 500"
                        placeholderTextColor="#9ca3af"
                        value={tenderInput}
                        onChangeText={(v) => {
                          setTenderInput(v);
                          setErrorMessage(null);
                        }}
                        keyboardType="decimal-pad"
                        editable={!submitting}
                        accessibilityLabel="Natanggap na bayad"
                      />
                    </View>

                    {preview.tenderCentavos > 0 && preview.tenderCentavos >= preview.totalCentavos && (
                      <View style={styles.changeRow}>
                        <Text style={styles.changeLabel}>Sukli:</Text>
                        <Text style={styles.changeValue}>{formatCentavos(preview.changeCentavos)}</Text>
                      </View>
                    )}
                  </>
                ) : (
                  <View style={styles.tenderSection}>
                    <Text style={styles.fieldLabel}>GCash Reference # (Opsyonal):</Text>
                    <TextInput
                      style={styles.tenderInput}
                      placeholder="hal. 9021837482"
                      placeholderTextColor="#9ca3af"
                      value={gcashRefInput}
                      onChangeText={(v) => {
                        setGcashRefInput(v);
                        setErrorMessage(null);
                      }}
                      editable={!submitting}
                      accessibilityLabel="GCash Reference number"
                    />
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

            {/* Insufficient Stock Warning */}
            {preview && preview.insufficientStockItems.length > 0 && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>
                  Hindi makukumpleto ang benta: Kulang ang naitalang stock para sa{' '}
                  {preview.insufficientStockItems.join(', ')}. Kailangan muna itong ayusin sa Pamahalaan.
                </Text>
              </View>
            )}

            {/* Confirm or Draft Buttons */}
            {paymentMethod === 'cash' ? (
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  (!preview || !preview.canComplete || submitting) && styles.confirmButtonDisabled,
                ]}
                onPress={handleCompleteCashSale}
                disabled={!preview || !preview.canComplete || submitting}
                accessibilityRole="button"
                accessibilityLabel="Kumpirmahin at I-save ang Benta"
              >
                {submitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.confirmButtonText}>Kumpirmahin ang Cash Sale</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  (!preview || preview.insufficientStockItems.length > 0 || submitting) &&
                    styles.confirmButtonDisabled,
                ]}
                onPress={handleCreatePendingGcash}
                disabled={!preview || preview.insufficientStockItems.length > 0 || submitting}
                accessibilityRole="button"
                accessibilityLabel="Ihanda ang GCash Draft"
              >
                {submitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.confirmButtonText}>Ihanda ang GCash Draft (Pending)</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Success Banner */}
        {successInfo && (
          <View style={styles.successBox} accessibilityRole="alert">
            <Text style={styles.successTitle}>
              Matagumpay na naitala ang {successInfo.method === 'cash' ? 'Cash' : 'GCash'} benta!
            </Text>
            <Text style={styles.successDetail}>
              Kabuuan: {formatCentavos(successInfo.totalCentavos)}
              {successInfo.method === 'cash'
                ? ` • Bayad: ${formatCentavos(successInfo.tenderCentavos ?? 0)} • Sukli: ${formatCentavos(successInfo.changeCentavos ?? 0)}`
                : successInfo.referenceNumber
                ? ` • Ref #: ${successInfo.referenceNumber}`
                : ' • GCash Kumpirmado'}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
