# Tindig — implementation tickets

Published: 2026-10-09. Destination: https://github.com/Shirooo098/Tindig/issues (Issues #1 to #20 published with label `ready-for-agent`).

D1 speech/device; D2 catalog/understanding; D3 transactions/data; D4 app integration/OCR/UI. Leads deliver vertical slices, not isolated layers. D3 coordinates migrations. Developer usernames are unknown.

1. **Create an offline catalog and typed price lookup** — D4; blocked by none. Install Tindig, enter a product, restart the app, and retrieve its saved price by typing. [Acceptance criteria](issues/01.md)

2. **Transcribe Filipino speech with a bundled model** — D1; blocked by 1. Use push-to-talk and review an editable Filipino transcript on the phone without internet. [Acceptance criteria](issues/02.md)

3. **Teach and reuse owner-confirmed product aliases** — D2; blocked by 1. Approve a store nickname for a product and use it in subsequent price searches. [Acceptance criteria](issues/03.md)

4. **Set stock counts and record deliveries** — D3; blocked by 1. Maintain the quantity on hand through clearly distinct count corrections and deliveries. [Acceptance criteria](issues/04.md)

5. **Ask prices by voice using confirmed aliases** — D1; blocked by 2, 3. Speak a Filipino price question, resolve any ambiguity, and see the exact catalog price. [Acceptance criteria](issues/05.md)

6. **Dictate and review catalog changes** — D2; blocked by 2, 4. Speak a product name, selling price and quantity, review the extracted fields, and save intentionally. [Acceptance criteria](issues/06.md)

7. **Complete a cash sale with consistent inventory** — D3; blocked by 4. Create a typed/tapped purchase draft, confirm cash received, and save a sale with correct stock. [Acceptance criteria](issues/07.md)

8. **Speak and correct an order before checkout** — D2; blocked by 5, 7. Prepare a sale by voice and correct quantities in its visible draft before confirmation. [Acceptance criteria](issues/08.md)

9. **Record owner-confirmed GCash purchases** — D3; blocked by 7. Prepare a GCash sale, keep it pending while the owner checks receipt of funds, then confirm it. [Acceptance criteria](issues/09.md)

10. **Attach, extract and find GCash receipts** — D4; blocked by 9. Capture/import a receipt for a sale, review OCR fields, and retrieve the attached evidence later. [Acceptance criteria](issues/10.md)

11. **Record customer credit and partial-payment purchases** — D3; blocked by 9. Select the correct customer and record a fully unpaid or partially paid sale. [Acceptance criteria](issues/11.md)

12. **Repay utang against the oldest unpaid entries** — D3; blocked by 11. Record cash/owner-confirmed GCash repayments and show exactly how they reduce customer debt. [Acceptance criteria](issues/12.md)

13. **Correct payments and cancel sales without corrupting balances** — D3; blocked by 12. Review and reverse incorrect records while preserving an understandable correction history. [Acceptance criteria](issues/13.md)

14. **Show aged utang with attention priorities** — D4; blocked by 12. See customers needing attention, their oldest unpaid debt, remaining balance and age. [Acceptance criteria](issues/14.md)

15. **View accurate store reports across calendar periods** — D4; blocked by 13. View sales, collections, credit and product performance with the agreed date filters. [Acceptance criteria](issues/15.md)

16. **Prove a bundled local agent with a guarded tool request** — D2; blocked by 1. Ask a narrow Filipino request and inspect a validated local tool proposal without autonomous writes. [Acceptance criteria](issues/16.md)

17. **Explain the selected report in Filipino** — D2; blocked by 15, 16. Request a local explanation of the selected dashboard period grounded in returned records. [Acceptance criteria](issues/17.md)

18. **Prepare an owner-approved restock checklist** — D2; blocked by 17. Ask for restock suggestions, review supporting stock information and approve an editable checklist. [Acceptance criteria](issues/18.md)

19. **Review notebook OCR proposals before catalog import** — D4; blocked by 4. Photograph actual notebook rows and review proposed product/price updates before saving. [Acceptance criteria](issues/19.md)

20. **Verify the offline demo and prepare submission evidence** — D4; blocked by 6, 8, 10, 14, 18. Deliver a reproducible Android demonstration and truthful hackathon evidence for implemented scope. [Acceptance criteria](issues/20.md)

After ticket 1, tickets 2, 3, 4 and 16 are technically unblocked; D2 should prioritize aliases (3) over the agent experiment (16). D4 can take the bounded notebook experiment after 4 while supporting integration. Technical readiness does not imply enough people for every ready ticket simultaneously.

Proposed checks for review: granularity; genuine blocking edges; merges/splits; application-action SQLite plus actual-phone acceptance test seams. No additional product interview is needed.

Upon approval: publish one issue per slice, create/use ready-for-agent, retain human-readable dependency references and native GitHub blocking relationships, and verify each link. Draft numbers are not GitHub issue numbers. No parent issue exists, and no parent issue should be closed or modified.

