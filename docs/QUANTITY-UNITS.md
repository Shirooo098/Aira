# Quantity and Selling Unit Conventions

Documenting the quantity-unit conventions established in Ticket #1 for coordination across workstreams (especially D3 stock work in Ticket #4 and sales drafting in Ticket #7).

## 1. Product Identity and Unit Separation

- **Identity Definition**: A sellable product in Aira is uniquely identified by the combination of `(name_normalized, variant_normalized, unit_normalized)`.
- **Distinct Products**: Two items with the same brand name but different variants or selling units are stored as completely separate records with independent prices:
  - Example: `Coca-Cola (250 ml, bote)` vs. `Coca-Cola (1.5 L, bote)` vs. `Coca-Cola (1.5 L, case/kahon)`.
- **No Automatic Unit Conversion**: The system does not assume or calculate automatic conversions between units (e.g., 1 case = 12 bottles). In sari-sari store reality, bulk packages may be sold at a discount, re-packaged, or sold individually. Each sellable unit is managed as its own distinct product.

## 2. Quantity Representation and Precision

- **Whole Selling Units**: For Ticket #1 foundation and early inventory operations, quantities represent whole selling units (`INTEGER >= 0`).
  - Unit values: `piraso`, `bote`, `pack`, `sachet`, `lata`, `kahon`, `rolyo`, etc.
  - Fractional quantities (e.g., fractional kilograms `0.5 kilo` of rice or sugar) are not automatically converted or approximated; if fractional quantities are introduced in later tickets, they must be represented with explicit integer fixed-point scales (e.g., grams instead of floating-point kg) to preserve strict numeric integrity.
- **Stock Movement Integrity**:
  - `add-delivery`: Positively increments the on-hand quantity with owner confirmation.
  - `set-count`: Directly corrects the on-hand quantity after physical count/audit with before/after log.
  - Missing or unknown stock count must NEVER be silently defaulted to zero (`0`). The owner must explicitly enter or verify count corrections.

## 3. Monetary Association

- Each product row associates a single unit price in **nonnegative integer centavos** (`price_centavos INTEGER`).
- The price represents the cost for exactly **one (1) whole unit** of that product.
- Fractional currency math is prohibited: all line items calculate `quantity * price_centavos` using safe integer operations.

## 4. Coordination with D3 (Ticket #4)

- When D3 introduces the `inventory_movements` or `stock_levels` tables in Ticket #4, foreign keys should reference the stable `products.id` primary key defined in Ticket #1.
- Existing product records, IDs, and normalized fields must remain backward-compatible without destructive database migrations.
