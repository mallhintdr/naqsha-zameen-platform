# Online payments for Naqsha Zameen renewals: design review

Status: proposal (read-only review, nothing in the repo was changed). Date: 2026-10-23.

**About the sources.** Web searches did not return official 2026 fee sheets for any Pakistani gateway. Every fee and SLA figure below is **to be confirmed during merchant onboarding**. The facts I could confirm come from the sources listed in §8. Integration details for JazzCash (HMAC-SHA256 with the "Integrity Salt", hosted redirect, separate IPN) come from third-party plugin documentation and must be checked against the merchant integration guide JazzCash issues at onboarding.

---

## 0. What exists today (from code)

- **User side.** `frontend/src/features/chrome/modals/SubscriptionWarningModal.tsx` opens when the account is Pending or Expired, or has ≤5 days left. Admins never see it. It shows the provider's Easypaisa and JazzCash account cards (`provider.easypaisa/jazzcash`, else `DEFAULT_ACCOUNT`) and a "Renew Now / Activate Now" WhatsApp button. That button calls `sendRenewalRequest` (`features/chrome/renewal.tsx`), which calls `POST /api/users/:userId/renewal-token`.
- **`renewalController.createRenewalToken`** creates a 7-day `RenewalToken` (Activation or Renewal), deletes older unused tokens, and notifies the provider with an action `/admin/activate/:token`. The provider is the sub-admin when `user.managedBy` is set, otherwise the admins. It returns `payFirst` for trial users.
- **Activation by the provider:**
  - Admin, direct customer: through `/admin/activate/:token` → `UserEditForm`, which calls `userController.updateUser`. `recordUpdateEvents` writes a `RENEWED` AccountEvent with `paymentAmount` (`ctx.billing.price` or the typed amount) and `requestKey = renewalKey(userId, date, plan)`. This is what drives revenue stats.
  - Sub-admin customer: `subAdminController.renew`. The fee is entered by hand ("manual pricing for now", `pricingVersion: undefined`). It continues from the current `endDate` if the customer is still paid. It sets `paidPeriod`, writes a `RENEWED` event with `billable:true, billDay, requestKey: renew:<sa>:<key>` (unique index, so it is idempotent), then calls `billing.announceLine` and `checkCredit`, and sends the notification and email.
  - The admin-only `subscriptionController.activate*` endpoints are a legacy path that uses `recordPlanChange`.
- **Mouza change.** `AssignmentRequest` moves from `pending` to `invoiced` (`invoice.dueAt`, expires automatically) to `approved`. `POST /api/assignment-requests/:id/confirm-payment` writes `ASSIGNMENT_TOPUP` / `TIER_UPGRADED`. Sub-admin cases are billable. The fee comes from `pricing.upgradeCharge`.
- **Sub-admin billing.**
  - Each day becomes a `SubAdminBill` (PKT day, due window).
  - The admin records each `SubAdminPayment` by hand (`method: jazzcash|easypaisa|bank|cash|reversal`, `reference` sparse-indexed).
  - `computePosition` allocates payments FIFO across bills. `checkCredit` runs the state machine `active → final_warning → suspended_unpaid`; recording a payment restores the account.
- **Evidence.** `PaymentProof` (`kind: renewal|subadmin_payment`) stores a screenshot or SMS text.
- **Pricing.** `PricingVersion` is append-only. `pricing.quote({mouzaCount, plan, subAdmin, customer})` returns the price and `pricingVersion`, honouring `customPlatformPrice` and sub-admin `priceOverride`.
- **Audit.** `AccountEvent` is append-only (mutations are blocked by hooks).

---

## 1. Gateway recommendation

| Option | Coverage | Integration | Notes |
|---|---|---|---|
| **PayFast (APPS)**, recommended primary | Cards (Visa/MC/UnionPay/PayPak), bank accounts, **JazzCash and Easypaisa wallets**, Raast P2M (first gateway live with Raast P2M, 2024) | One hosted checkout with a token API, IPN/callback, and a hash check | SBP-licensed PSP. MDR varies by payment method and is negotiated. One contract covers both wallets, so there is only one integration and one settlement report to reconcile. |
| **JazzCash Online Payment Gateway**, alternative or second | JazzCash wallet (MWALLET), cards, OTC voucher | Hosted page (Page Redirection v1.1) or REST MWALLET API. Request and response are signed with HMAC-SHA256 using the Integrity Salt. Has an IPN listener. | The direct wallet route usually has the lowest MDR. It covers only JazzCash wallet users, so Easypaisa users would need a separate integration. |
| **Easypaisa (Telenor Microfinance Bank, Easypaisa Digital Bank)** | Easypaisa wallet, OTC, cards via hosted checkout | Hosted checkout with a merchant hash, or the mobile-account API with a push USSD/in-app prompt | Merchant onboarding has its own KYC. Only worth it if PayFast's wallet MDR is poor. |
| **Safepay** | Cards, Raast (Shopify app lists bank and wallet Raast) | Modern REST API and webhooks, good developer experience, sandbox | A good card and Raast alternative. Check wallet coverage. |
| **Bank gateways (Alfa Pay, HBL, MCB/MPGS)** | Cards, plus the bank's own account | MPGS-style | Slow onboarding. Card holders are few among the target users (patwaris, property agents). |
| **Raast P2M QR** | Any bank or wallet app | Through a PSP (PayFast or Safepay). Dynamic QR with request-to-pay. | Lowest fee. Next-business-day settlement in PayFast's Rah-e-Raast. Good for larger yearly or sub-admin bill amounts. |

**Recommendation**
- **Primary: PayFast hosted checkout.** It offers JazzCash wallet, Easypaisa wallet, Raast and cards in one integration with one settlement report.
- **Phase 2: direct JazzCash MWALLET API**, only if the volume and MDR difference justify it.
- **Keep the manual flow as a permanent fallback.** The account cards, WhatsApp receipt and provider activation all stay, under an "Other ways to pay" section. Gateway downtime or KYC limits on wallets must never block a renewal.
- Behind a `SystemConfig` flag `payments.online.enabled` plus a per-audience switch (admin-only, direct users, sub-admins), the manual flow stays the default until the flag is on.
- **Recurring / auto-debit.** None of the local wallets offers a merchant-initiated recurring mandate that a small merchant can use generally. Card tokenisation exists at some PSPs (PayFast and Safepay advertise saved cards and tokens) but card share is low. **Design for one-off payments plus reminders.** Leave room for a `paymentMethodToken` later.
- **Refunds.** Use the PSP portal or API where supported. Wallet refunds are often handled manually through the portal, so model them as an admin action.
- **Sandbox.** PayFast, JazzCash and Safepay all provide sandbox merchant credentials once onboarding starts.

---

## 2. Target end-to-end flows

### (a) Direct customer renewal (`managedBy == null`)

1. The customer opens the SubscriptionWarningModal (or the banner, or Profile) and clicks **Pay online**. A small form asks for the plan (Monthly or Yearly) and shows the server quote.
2. `POST /api/payments/orders {purpose:'renewal', plan, idempotencyKey}`.
   - The server re-computes the price with `pricing.quote({mouzaCount: inScope count of user.tehsilAccess, plan, customer})` and freezes `amount` and `pricingVersion` on the order.
   - It refuses trial-only plans (`payFirst` logic stays).
   - It returns `{orderId, redirect: {url, fields}}`.
3. The browser does a full-page POST redirect to the hosted checkout. The customer pays by wallet OTP/PIN or by card.
4. The gateway sends the **IPN/webhook** to the server. The server verifies the signature, checks amount and currency against the order, and calls `GET status` on the gateway (inquiry API) for a double check. It then moves the order to `paid` **atomically** and calls **`renewalService.applyPaidRenewal(order)`** (§3.4).
5. The return URL `/payments/return?order=…` only *displays* the result: it polls `GET /api/payments/orders/:id` until the order is final. It never activates anything.
6. On activation:
   - a `RENEWED` AccountEvent (`paymentAmount`, `requestKey: pay:<orderId>`, `paymentId`);
   - an in-app notification and an email receipt;
   - any open renewal Notification for the provider gets `actionDone = true`;
   - unused `RenewalToken`s for the user are marked `used`.

### (b) Plan upgrade or mouza-change invoice

When the provider invoices an `AssignmentRequest` (status `invoiced`, `invoice.amount`, `invoice.dueAt`), the customer gets a **Pay invoice** button. The order then follows the same path as (a):

- `purpose:'assignment_invoice', refId: requestId`.
- The amount is taken from `request.invoice.amount`, which the server computed with `pricing.upgradeCharge`. The client never sends it.
- The order expires at `min(invoice.dueAt, 60 min)`.
- On `paid`, run the *same code* as `confirm-payment` in `assignmentRequestController`. Extract it into `assignmentService.confirmPaid(request, {amount, paymentId, actor:'system'})`. This writes `ASSIGNMENT_TOPUP` / `TIER_UPGRADED` and applies the tehsil change.
- If the request expired between payment and IPN, apply it anyway: the money was received. Log `late_payment` and alert the admin.

### (c) Sub-admin pays platform bills

- On `/subadmin` (My Business) → Bills, a **Pay now** button pays the `closedBalance` / `overdue` amount or a chosen bill.
- `purpose:'subadmin_bill', amount: server-computed from computePosition` (the option to pay an arbitrary amount ≥ Rs 100 counts as an advance).
- On `paid`, create a `SubAdminPayment {method:'gateway', reference: gatewayTxnId, recordedBy:'system', paymentId}`. Add `'gateway'` to the enum. Then `billing.checkCredit(subAdmin)`, which lifts `final_warning` / `suspended_unpaid` automatically, the same as an admin-recorded payment does today.
- **Raast QR / bank transfer** suits large amounts (lower MDR).

### (d) Sub-admin's customers: who gets paid?

| Option | Money flow | Pros | Cons |
|---|---|---|---|
| **D1. Customer pays the sub-admin (today's model), off-platform** | Customer → sub-admin's own wallet. Sub-admin renews in the app, which bills the platform daily. | No change in legal or tax position. Sub-admins keep their margin and the customer relationship. | No online pay button for these customers. |
| D2. Customer pays the platform; platform credits the sub-admin | Customer → platform gateway. The renewal is automatic and the sub-admin's bill is netted (`customerFee − platformPrice` as a credit line). | Fully automatic. | The platform collects the reseller's money and must pay out the margin, which means marketplace/payout obligations and tax on gross. It also requires the sub-admin's retail price to be fixed in the system (today it is entered manually). |
| D3. Split payment / sub-merchant (PSP aggregator) | The PSP splits at settlement. | Clean. | Few Pakistani PSPs offer it to small merchants. Each sub-admin needs KYC as a sub-merchant. |

**Recommendation: D1 now.**
- For managed customers, keep showing the sub-admin's account cards and the WhatsApp button. Hide "Pay online", or let it work only once the sub-admin opts in under D2 later.
- Sub-admins pay their platform bills online (c).
- Revisit D2 or D3 once sub-admin retail prices are system-priced (`subAdminController.renew` already notes "manual pricing for now").

---

## 3. Backend design

### 3.1 New collection `Payment` (`backend/models/Payment.js`)

```js
{
  orderId: String, unique             // our merchant txn ref, e.g. NZ-20261023-<base32>, ≤ 20 chars for JazzCash
  purpose: enum ['renewal','activation','assignment_invoice','subadmin_bill'],
  userId: String,                     // payer's userId (customer or sub-admin)
  subAdminId: String|null,            // purpose subadmin_bill
  managedBy: String|null,             // owner at creation (null = direct)
  refId: String|null,                 // AssignmentRequest _id / SubAdminBill _id
  plan: 'Monthly'|'Yearly'|null, mouzaCount: Number, tierKey: String, pricingVersion: Number,
  amount: Number (integer Rs), currency: 'PKR',
  gateway: enum ['payfast','jazzcash','easypaisa','safepay','raast'], method: String,   // wallet/card/raast as reported
  status: enum ['created','pending','paid','failed','expired','cancelled','refunded','part_refunded','review'],
  idempotencyKey: String,             // client-generated UUID per checkout attempt
  gatewayTxnId: String, gatewayRef: String, rrn: String,
  expiresAt: Date,                    // created + 30–60 min
  paidAt: Date, failedReason: String,
  applied: { at: Date, eventId: ObjectId, subAdminPaymentId: ObjectId, error: String },  // fulfilment result
  refunds: [{ amount, at, by, reason, gatewayRefundId, status }],
  history: [{ at, from, to, source: 'create'|'ipn'|'inquiry'|'return'|'recon'|'admin', raw: Mixed (redacted) }],
  settlement: { day: String, batchId: String, fee: Number, net: Number, matchedAt: Date },
  createdAt, updatedAt
}
```

Indexes:

- `{orderId:1}` unique
- `{userId:1, idempotencyKey:1}` unique
- `{gateway:1, gatewayTxnId:1}` unique, sparse
- `{status:1, expiresAt:1}` (expiry sweep)
- `{userId:1, createdAt:-1}`
- `{purpose:1, refId:1, status:1}`
- `{'settlement.day':1}`

**State machine.** Every transition is a guarded `findOneAndUpdate({_id, status: {$in: allowedFrom}})`.

```
created ──redirect──▶ pending ──IPN/inquiry ok──▶ paid ──admin──▶ refunded | part_refunded
   │                    ├──IPN fail──▶ failed
   └──────timeout───────┴──sweep + inquiry says unpaid──▶ expired
paid but amount mismatch / user deleted ──▶ review (admin decides)
```

`expired`/`failed` → `paid` is **allowed only through IPN, inquiry or recon** (late money is still money).

**Links to existing collections:**
- Add the optional fields `paymentId: ObjectId` and `method: 'gateway'|'manual'` to `AccountEvent`. The schema is append-only, but new fields only affect new documents.
- The AccountEvent `requestKey = pay:<orderId>` makes fulfilment idempotent through the existing unique index.
- `PaymentProof` is not needed for gateway payments. The `Payment` record is the proof. Show it in the same proof viewer.
- Add `'gateway'` to `SubAdminPayment.method` and add `paymentId`.

### 3.2 API endpoints (`routes/paymentRoutes.js`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/payments/quote` | user | Returns `{amount, plan, pricingVersion, breakdown}` for the modal. |
| POST | `/api/payments/orders` | user / sub-admin, apiLimiter | Body `{purpose, plan?, refId?, idempotencyKey}`. Computes the amount on the server. Returns the existing order for the same key. Returns `{orderId, amount, checkout:{url, method:'POST', fields}}`. |
| GET | `/api/payments/orders/:orderId` | owner or admin | Status for polling. If the order is `pending` and older than 2 min, the server calls gateway inquiry once, rate-limited. |
| POST | `/api/payments/orders/:orderId/cancel` | owner | Moves `created`/`pending` to `cancelled`. Late money still wins. |
| POST/GET | `/api/payments/return/:gateway` | public | The gateway's browser return. Verify the hash only to choose the message, then `302 → FRONTEND/payments/result?order=…`. **No fulfilment here** (at most it kicks off an inquiry). |
| POST | `/api/payments/ipn/:gateway` | public, IP allow-list where the PSP publishes ranges, raw body | Verify the signature (HMAC with constant-time compare). Upsert the history entry, transition the order, fulfil. Always reply 200 with the gateway's expected ack after a durable write. Reply 5xx only if Mongo is down, so the gateway retries. |
| GET | `/api/admin/payments` | admin | List and filter. |
| POST | `/api/admin/payments/:id/refund` | admin | Refund. |
| POST | `/api/admin/payments/:id/resolve` | admin | Handle `review` cases: apply, or refund. |
| GET | `/api/admin/payments/recon/:day` | admin | Reconciliation report. |
| GET | `/api/payments/orders/:orderId/receipt.pdf` | owner/admin | Uses `pdfReportService`. |

Put the gateway adapters in `services/payments/{payfast,jazzcash,...}.js` with one interface: `buildCheckout(order)`, `verifyCallback(req) → {orderId, txnId, amount, status, raw}`, `inquire(order)`, `refund(order, amt)`, `parseSettlement(file)`.

### 3.3 Fulfilment: where activation hooks in

Create **`services/paymentFulfilment.js` → `fulfil(order)`**. Call it from the IPN handler, the inquiry, recon and the admin resolve action. It is idempotent: it first checks `order.applied.at`, then relies on `requestKey: pay:<orderId>`.

- **`renewal` / `activation`** (direct customer). Extract the renewal core that `userController.updateUser` and `recordUpdateEvents` run when an admin renews (start date, endDate and status via the User save hook, `paidPeriod`) into `services/renewalService.applyRenewal(user, {plan, amount, pricingVersion, tierKey, actor:'system', requestKey, paymentId})`. Use the same "early renewal continues from the current paid end" rule as `subAdminController.renew`.
  - Write the `RENEWED` event (`paymentAmount = order.amount`, `ownerAtEvent: null`, `actorRole:'system'`, `pricingVersion`).
  - Guard with `findSameDaySubscription` so a manual renewal by the admin on the same day doesn't double-extend. If one is found, mark the order `review` and alert the admin to refund it or extend the next period.
  - Pending → Active activation follows the same path. `requestType` is taken from the user's status, as in `createRenewalToken`.
  - Afterwards:
    - `RenewalToken.updateMany({userId, used:false, requestType:{$ne:'AssignmentChange'}}, {used:true, usedAt})`;
    - mark open renewal Notifications `actionDone`;
    - `sendNotification(user, 'Subscription renewed')`;
    - email receipt;
    - `notifyAdmins('Online payment received')`.
- **`assignment_invoice`** → `assignmentService.confirmPaid` (extracted from `assignmentRequestController.confirmPayment`).
- **`subadmin_bill`** → `SubAdminPayment.create(...)` then `billing.checkCredit(subAdmin)` and the `subAdminEmails` receipt.
- Wrap the transition and fulfilment in a Mongo transaction where the deployment is a replica set. Otherwise use **two steps**: mark `paid`, then `applied`. A sweeper job retries orders with `status:'paid', applied.at:null`, which covers partial failures.

Refactor the existing manual endpoints to call the same `renewalService`, so manual and online renewals cannot drift apart.

### 3.4 Jobs (add to `subAdminJobs` / queueService)

- **Every 5 min:** for orders `pending` older than 10 min and not yet past `expiresAt + 15 min`, run gateway inquiry. Paid orders get fulfilled. The rest move to `expired`.
- **Every 5 min:** retry orders that are `paid` but not `applied`, with alerting after 3 attempts.
- **Daily at 10:00 PKT, reconciliation.** Download or parse yesterday's settlement report (SFTP/portal CSV/API) and match on `orderId`/`gatewayTxnId`, filling `settlement.{fee, net, batchId}`. Report:
  - (i) paid at the gateway but not paid in the DB, which triggers fulfilment;
  - (ii) paid in the DB but missing from settlement after T+2;
  - (iii) amount mismatches;
  - (iv) refunds.

  Email the admin and include the result in the existing daily report (`dailyReportService`).

---

## 4. Security and correctness

- **Never trust the return URL or the client.** Only IPN plus signature check, or a server-side inquiry, can mark an order paid. The amount and `pricingVersion` are frozen on the order at creation, from `PricingVersion` / `upgradeCharge` / `computePosition`. Reject a callback whose amount ≠ `order.amount` (state `review`).
- **Signature.** Use HMAC-SHA256 with the merchant salt or secret (JazzCash: sorted `pp_*` fields joined with `&` and the Integrity Salt prepended; PayFast: their documented hash/token). Compare in constant time. Keep secrets in env or a secret store, never in `SystemConfig`, and rotate them.
- **Replay and idempotency.**
  - The unique `orderId` and `gatewayTxnId` and the guarded transitions stop a replayed IPN from doing anything twice.
  - The `requestKey` unique index on AccountEvent prevents double renewal.
  - The client `idempotencyKey` prevents duplicate orders from double clicks.
  - Order expiry stops stale pay links.
- **Webhook retries.** Write the inbound callback first (history), then process. Reply 200 once it is stored. Processing has to tolerate retries arriving in any order.
- **Partial failure.** Paid but not applied is handled by the sweeper and alerts. Paid after expiry still gets fulfilled. A user deleted or transferred mid-flow goes to `review`.
- **PCI scope.** Hosted checkout / redirect means card data never touches our servers, so SAQ-A-level scope. Do not embed card fields. Use a strict CSP on our pages. Wallet MSISDN and OTP are entered on the PSP page.
- **Audit.**
  - `Payment.history` holds raw callbacks with secrets and PII redacted.
  - The `AccountEvent` carries `paymentId`.
  - Admin refunds and resolves go to `AuditLog`.
  - Never delete `Payment` documents.
- **Refunds.** Admin only, ≤ amount paid. Choose whether to reverse the subscription (shorten `endDate` and write a `CORRECTION` event) or keep it. For sub-admin bills, write a `SubAdminPayment` reversal (negative), which the existing reversal path supports.
- **Other controls.**
  - Rate-limit order creation.
  - Allow at most 1 open order per (user, purpose).
  - The `/ipn` route must bypass the CSRF and auth middleware but keep its own body-size limit.
  - CORS does not apply to server-to-server calls.
  - Log the PSP's IPs.

---

## 5. Frontend UX

- **SubscriptionWarningModal.** Add a primary **"Pay Rs X online"** button: green, above the account cards, Monthly/Yearly toggle, shown when `online.enabled && !user.managedBy`. Underneath, list the wallet, card and Raast logos. Collapse the existing JazzCash/Easypaisa cards and the WhatsApp button into an **"Other ways to pay (manual)"** section. Trial users can choose a paid plan only.
- **Expiry banner / Profile.** Add the same "Renew online" call to action.
- **ChangeMouzas modal.** When the request is `invoiced`, show "Pay invoice Rs X (due …)".
- **Sub-admin `/subadmin` Bills.** Add a "Pay balance" button and a per-bill "Pay" button. Show `final_warning` with a pay button in the banner.
- **Admin `/admin/payments`.** A list with status chips, a recon tab, and refund/resolve actions. In UserDetail history, gateway payments show a "paid online" badge and the txn id.
- **Checkout style.** Use a **full-page redirect**, not a popup. Popups get blocked on mobile and wallet apps deep-link back. Save `orderId` in sessionStorage before the redirect.
- **Wallet OTP / PIN.** This happens on the PSP page. Show "Keep this page open; approve the request in your JazzCash/Easypaisa app within 60 s" if the PSP uses push approval.
- **`/payments/result?order=`.** A spinner while it polls every 2 s for up to 60 s. Then it shows one of:
  - **Success:** new expiry date, receipt download, Continue to map. Refresh the profile so the modal closes.
  - **Failed:** reason, Try again, Pay manually.
  - **Still pending:** "We'll notify you when your payment is confirmed", backed by a socket push from `socketService` when the order is fulfilled.
- **Receipts.** PDF from `pdfReportService` with orderId, txn id, plan, period, amount, and NTN once registered. Sent by email, also available as an in-app notification and a push notification.

---

## 6. Phased rollout

| Phase | Scope | Estimate |
|---|---|---|
| 0. Prerequisites (owner) | See the list below. | 2–6 weeks, mostly waiting on the PSP |
| 1. Foundations | Extract `renewalService` / `assignmentService.confirmPaid`. `Payment` model, adapter interface, PayFast sandbox adapter, IPN/return/status endpoints, unit tests with signed fixtures. | 5–7 dev days |
| 2. Sandbox E2E | Result page, modal button, expiry and inquiry jobs, receipts, admin payments list. Test cases: duplicate IPN, IPN before return, IPN only, amount tamper, expiry then late pay. | 4–5 days |
| 3. Pilot (live, admin-only flag) | Admin plus 5–10 friendly direct customers. Real Rs 10–100 payments. Refund test. First recon runs. | 1–2 weeks elapsed |
| 4. All direct users | Default on, manual flow kept as fallback. Watch conversion and failures. | 1 day of work, then 2 weeks of monitoring |
| 5. Sub-admin bill payments | Pay buttons, `SubAdminPayment` 'gateway', `checkCredit`. | 3 days |
| 6. Optional | Direct JazzCash MWALLET adapter, Raast QR for big bills, card tokens, D2/D3 reseller collection. | 1–2 weeks each |

**Owner prerequisites:**

1. A registered business (sole proprietor or SMC-Pvt/AOP) with an **NTN** and, if needed, sales-tax registration (provincial sales tax on IT services, e.g. PRA, SRB).
2. A **business bank account** in the business name for settlement.
3. A PSP merchant agreement and KYC: CNIC of the directors, NTN certificate, bank letter or cancelled cheque, SECP incorporation documents if a company, and the website showing terms, refund policy, privacy policy, contact details and pricing (PSPs check this).
4. Published **Terms, Refund/Cancellation and Privacy** pages on naqsha-zameen.pk.
5. Agreed MDR, settlement period (typically T+1 to T+2) and the format for settlement reports.
6. A decision on the tax invoice format (NTN on receipts).
7. The decision on reseller money flow (D1 recommended).
8. Production secrets and IPN URL registration with the PSP. The PSP needs a public HTTPS backend URL.

---

## 7. Open questions

- Should a paid order for a user who is already renewed manually that same day be refunded automatically or credited to the next period? Default: `review`.
- Should an Expired user who pays be renewed from now, or from the old `endDate`? The current rule restarts from now when expired and continues when still paid. Keep it.
- Weekly/Quarterly legacy plan types are excluded from online sale.

## 8. Sources

- JazzCash integration details (hosted redirect, MWALLET/card/OTC, HMAC-SHA256 with the Integrity Salt, separate server-to-server IPN), third-party plugin docs: https://docs.ecosire.com/odoo-modules/jazzcash-gateway , https://ecosire.com/de/apps/woocommerce/woo-jazzcash-gateway
- PayFast as the first gateway with Raast P2M: https://profit.pakistantoday.com.pk/2024/05/17/payfast-becomes-the-first-payment-gateway-to-enable-raast-p2m-payments-in-pakistan
- PayFast Rah-e-Raast QR, next-day settlement: https://propakistani.pk/2025/10/29/payfast-unity-retail-and-slgtrax-launch-rah-e-raast-pakistans-first-merchant-friendly-raast-qr-payment-solution/amp/
- PayFast gateway app (MDR varies by merchant): https://apps.shopify.com/payfast-gateway-app
- Safepay Raast checkout: https://apps.shopify.com/safepay-alternate-payments
- APPS/PayFast SBP licence and card schemes: https://www.brecorder.com/news/amp/40303957 , https://payatlas.com/company/payfast-1756
- Not verified, confirm with the PSPs: exact 2026 MDRs, Easypaisa API specifics, card tokenisation terms, and refund APIs for wallets.
