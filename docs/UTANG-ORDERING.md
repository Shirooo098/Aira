# Utang (Credit) Repayment Ordering and Allocation Specification

Documenting the ordering rules and design decisions for utang repayment allocations in Ticket #12.

## 1. FIFO (Oldest-First) Debt Settlement

When a customer repays debt in a sari-sari store, payments must be applied against their oldest unpaid debt obligations first:
- Debts are settled sequentially: an older debt must be reduced to ₱0 (`remaining_amount_centavos = 0`) before subsequent payments allocate to newer debts.
- Overpayment is strictly rejected: a customer cannot repay more than their current total outstanding balance (`amount_centavos <= total_debt_centavos`). Overpayment attempts throw an `OverpaymentError` with clear Filipino messaging indicating the exact maximum allowable payment.

## 2. Ordering of Unknown-Date Opening Debts

### Problem
When store owners migrate from paper notebooks to Aira, they frequently enter legacy "opening debts" (*"Dating utang bago nag-Aira"*). These records often do not have a specific calendar date (`original_date IS NULL`). 

Fabricating or inventing arbitrary dates (e.g., using `1970-01-01` or `now()`) would violate truthful recordkeeping and distort future financial aging reports.

### Solution & Ordering Rules
To maintain truthful data without inventing dates:
1. **Prior Balance Precedence**: An `opening_balance` entry represents debt incurred prior to the store's adoption of Aira. Any `sale_credit` created within Aira represents debt incurred *after* opening balances were imported. Therefore, all active `opening_balance` entries take precedence over any `sale_credit`.
2. **Within Opening Balances**:
   - An undated legacy debt (`original_date IS NULL`) signifies the oldest untracked historic notebook balance carried forward. It is allocated first among opening debts.
   - If multiple undated opening debts exist, they are ordered by when they were entered into Aira (`created_at ASC`), followed by unique ID (`id ASC`).
   - If an opening debt has a known historical date (`original_date IS NOT NULL`), it is ordered chronologically by its `original_date ASC`.
3. **Within Sales Credits**:
   - Sales credits are ordered strictly by the chronological timestamp of the sale (`created_at ASC`, tie-broken by `id ASC`).
4. **Preservation of Debt Age**:
   - Partial repayment reduces `remaining_amount_centavos` but never mutates `original_date` or `created_at`. The remaining debt preserves its exact original age and creation timestamp.

### SQL Ordering Clause
```sql
ORDER BY 
  CASE WHEN entry_type = 'opening_balance' THEN 0 ELSE 1 END ASC,
  CASE WHEN original_date IS NULL THEN 0 ELSE 1 END ASC,
  COALESCE(original_date, created_at) ASC,
  created_at ASC,
  id ASC
```

## 3. Collections vs. Sales Integrity

- Repayments are pure financial collections, **never sales**.
- Repayments insert records into `credit_repayments` and `repayment_allocations`.
- Repayments **never** insert into `sales` or `sale_items`.
- Repayments **never** deduct or alter inventory (`stock_levels`, `inventory_movements`).
- All repayment writes and credit entry updates commit within an atomic SQLite transaction (`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`).
