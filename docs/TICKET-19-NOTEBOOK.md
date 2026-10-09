# Ticket #19 — Notebook OCR Feasibility Spike & Reviewed Catalog Import

## Overview

Store owners frequently record their wholesale inventory costs and retail selling prices in spiral or composition notebooks. Ticket #19 evaluates offline handwritten notebook extraction feasibility and provides an explicit owner review flow to safely import or update product prices into Aira without corrupting inventory stock or duplicating catalog items.

## Feasibility Spike Findings: Photographed Handwriting vs. Digital Ink

1. **Digital Ink vs. Camera Photo OCR**:
   - Google ML Kit Digital Ink Recognition processes live vector strokes (coordinates, timestamps, pen pressure) drawn on screen. It does *not* accept raster images or photographed paper notebooks.
   - For camera photographs, raster text recognition (Latin ML Kit OCR) is required.
2. **Error Rates on Handwritten Notes**:
   - Printed retail receipts have standardized fonts, structured line items, and predictable key-value labels ("Amount", "Ref No"), yielding high extraction reliability (>90%).
   - Handwritten store notebooks exhibit high cursive variance, irregular baseline tilts, compressed margins, mixed Taglish abbreviations (`"pk"`, `"bt"`, `"k"`, `"chili"`), and smudged ballpoint ink. Raw character accuracy on actual notebook photos is roughly 60–75%.
3. **Core Conclusion**:
   - **Autonomous catalog commits from handwriting OCR are unsafe**.
   - A guarded draft proposal with human-in-the-loop review is mandatory.
   - The UI must display the original line text, clearly distinguish **Price Updates** from **New Products**, flag missing units or unparseable numbers for manual clarification, and allow line-by-line editing prior to committing.

## Business Invariants & Guarantees

1. **Stock Preservation on Price Updates**:
   - When a notebook scan updates a product's price (`action = 'update_price'`), only `products.price_centavos` and `updated_at` are modified.
   - Physical inventory levels in `stock_levels` remain untouched.
2. **Deduplication & Rescan Safety**:
   - Rescanning the same notebook rows matches existing products by normalized name and variant.
   - It will *never* create duplicate product rows in `products` or duplicate stock records.
3. **Integer Centavos**:
   - All monetary figures are parsed using integer centavo arithmetic (`₱16.50` = `1650`).
4. **Offline Only**:
   - All parsing and database operations run on-device with zero cloud fallbacks.

## Verification Seam

- Domain unit tests in `tests/notebook-ocr.test.ts` exercising line parsing, unit extraction, existing product matching, price updates preserving stock, missing-value warnings, and database restart persistence on real SQLite files.
- UI reviewed in `NotebookReviewModal.tsx` launched from `ManageProductsView.tsx`.
