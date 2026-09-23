# finance Schema: Policies

RLS is **always on** for `finance`. Since **2026-09-23** the schema is **exposed to PostgREST**
(Decision #68(a) lifted, with the product owner's approval — the move off fixtures). The posture is
**read-scoped, write-through-definer**: a client role may READ the money that is its own — its
wallets and their ledger, its orders, the invoices it is party to — but every write that moves money
flows through a `SECURITY DEFINER` function (see [Functions.md](Functions.md)), and no client role
holds a write privilege on a balance, a ledger line, an order, an invoice or a payout.

Exposure is three layers, and each is necessary:

1. **Schema usage** — `anon`, `authenticated`, `service_role` (`00002500`). Grants nothing by itself.
2. **Table privileges** — named per table with the narrowest privilege it needs (`00002520`); a table
   with no grant is unreachable whatever its policies say.
3. **Row policies** — every granted table has RLS on (`00002001`) and the policies below (`00002013`).

And a fourth that is easy to miss: **function privileges** (see [§ Function privileges](#-function-privileges-2026-09-23)).
Postgres grants `EXECUTE` to `PUBLIC` by default, so schema usage alone would have made every finance
function — including the ledger primitives — callable over the API.

## 🛡️ Shared authorization helpers

- **`finance.fn_owner_visible(owner_type, owner_id)`** — `SECURITY DEFINER`; true when the caller
  may see that owner's finances (self for `user`/`freelancer`; `org.is_active_business_member` for
  `business`; `org.is_active_team_member` for `team`; `org.is_organisation_member` for
  `organisation`; or `security.is_admin()`).
- **`finance.fn_can_view_wallet(wallet_id)`** — resolves a wallet's owner then defers to
  `fn_owner_visible`. Both are `SECURITY DEFINER` so they read the un-policied `finance.wallets`
  without recursion. Reused by every wallet-scoped policy below.
- **`finance.fn_has_vault_capability(wallet_id, user_id, cap)`** — the in-DB capability gate for
  future money-movement RPCs (a `manage_members` grant implies every capability).
- **`finance.fn_can_manage_basket(owner_type, owner_id)`** — may the caller **write** this owner's
  basket? Composes the two helpers above rather than restating membership: personal owners are
  self-only; a shared owner additionally needs the `spend` vault capability on one of its wallets.
  ⚠️ **Fails closed** — an entity with no wallet or no `vault_permissions` rows has nobody who may
  write its basket (correct for a spend surface, but vault provisioning must come first).
- **`finance.fn_can_move_wallet_funds(wallet_id)`** — strictly narrower than `fn_can_view_wallet`:
  _seeing_ a balance is ordinary membership, _moving_ it is not. Personal wallet → self only; shared
  wallet → the `spend` capability. Gates `finance.simulate_wallet_transaction`, recurring deposits and
  pots.
- **`finance.fn_owner_capability(owner_type, owner_id, cap)`** _(2026-09-23)_ — the owner-keyed twin
  of the above, for the settings an entity keeps once rather than per wallet: its payout schedule
  (`withdraw`) and its payment instruments (`manage_billing`). Personal owners are self-only; a shared
  owner qualifies when the caller holds the capability on **any** of its wallets. Fails closed like
  `fn_can_manage_basket`.

## 🔒 Definer-only tables (RLS enabled, no policy)

Reachable only through `SECURITY DEFINER` functions and the service role; no client grant.

`finance.promo_codes` (a list of codes **is** the leak — a checkout resolves one code at a time,
server-side), `finance.ratings` (nothing reads it), `finance.idempotency_keys` (system table), and the
`finance.v_wallet_reconciliation` view (service role only).

> **Changed 2026-09-23.** `wallets`, `transactions`, `payouts`, `payout_accounts`, `orders`,
> `order_lines`, `invoices`, `invoice_line_items`, `disputes`, `dispute_messages`,
> `contribution_agreements`, `payout_splits` and `spending_limits` are **no longer definer-only**:
> each gained a READ policy (see [§ The ledger and commerce tables](#-the-ledger-and-commerce-tables-2026-09-23)).
> Twelve of them had shipped with RLS **off** — unreachable only because the schema granted no usage.

> **Changed 2026-07-24 (`20260724112000`):** `finance.subscriptions` is **no longer definer-only**.
> It gained a subject-scoped `SELECT` policy (`View own subscriptions`) so a subject can read its
> own plan — a user must be able to see what they are paying for. **Writes remain
> definer/service-only** (a Stripe webhook owns the lifecycle); no `INSERT`/`UPDATE`/`DELETE` grant
> or policy exists for `authenticated`.

## 👁 Escrow visibility (`0205_security.sql`)

```sql
-- The payee (freelancer/team) and the payer business's active members can view an escrow.
CREATE POLICY "View escrows" ON finance.escrows FOR SELECT TO authenticated USING (
    (payee_type = 'freelancer'::assignment_type AND payee_id = auth.uid ())
    OR (payee_type = 'team'::assignment_type AND org.is_active_team_member (payee_id))
    OR org.is_active_business_member (payer_business_id)
);
```

Writes to `finance.escrows` remain definer-only (`fn_hold_ticket_escrow` /
`fn_release_ticket_escrow` / `fn_refund_ticket_escrow` / `fn_fair_exit_release`).

## 🆕 Additive-table policies (2026-07-23 Wallet & Finance foundation)

| Table                        | SELECT                                                           | Write                                                                                          |
| :--------------------------- | :--------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `finance.fx_rates`           | `USING (true)` for `anon` **and** `authenticated` — public reference data SSR converts a guest's prices with (Decision #69). | Service-role / definer only (ingestion job). |
| `finance.verification_cases` | Subject or its members (`fn_owner_visible`-style) + admin.       | Definer / service only (verification webhook).                                                 |
| `finance.payment_methods`    | `fn_owner_visible(owner_type, owner_id)`.                        | **UPDATE only**, `fn_owner_capability(…, 'manage_billing')` — relabel / change the default. No INSERT: the processor handshake creates a method. Identity columns immutable (`trg_payment_methods_immutable`). |
| `finance.deposit_rules`      | `fn_can_view_wallet(wallet_id)`.                                 | `FOR ALL`, `fn_can_move_wallet_funds(wallet_id)` — a recurring deposit moves money. `failure_count` / `last_error` guarded (`trg_deposit_rules_derived`). |
| `finance.payout_schedules`   | `fn_owner_visible(owner_type, owner_id)`.                        | `FOR ALL`, `fn_owner_capability(…, 'withdraw')` — decides when money leaves the vault. |
| `finance.income_smoothing`   | `user_id = auth.uid()` (or admin).                               | **None.** Enrolment is an eligibility decision (earning history, fee), made server-side; a client write let a user set `eligibility_met` and `fee_bp`. |
| `finance.wallet_pots`        | `fn_can_view_wallet(wallet_id)`.                                 | `FOR ALL`, `fn_can_move_wallet_funds(wallet_id)`. `balance_cents` guarded (`trg_wallet_pots_derived`) — a client could otherwise mint funds into a pot; `wallet_id` / `currency` immutable. |
| `finance.vault_permissions`  | `fn_can_view_wallet(wallet_id)`.                                 | Grants flow through a `manage_members`-gated definer RPC (deferred) — no INSERT/UPDATE policy. |
| `finance.split_rules`        | `org.is_active_team_member(team_id)` (or admin).                 | Edits via a `manage_finances`-gated RPC (deferred).                                            |
| `finance.spend_approvals`    | `fn_can_view_wallet(wallet_id)`.                                 | INSERT (`requested_by = auth.uid()` + can-view-wallet, and born **undecided**: `status = 'pending'`, no approver, no `decided_at` — otherwise a member could insert a request already approved); approve/reject via definer RPC. |
| `finance.ledger_audit`       | `fn_can_view_wallet(wallet_id)`.                                 | Definer / service only (append-only, unforgeable).                                             |
| `finance.pending_releases`   | `fn_can_view_wallet(wallet_id)`.                                 | Definer / service only (window sweep).                                                         |
| `finance.statements`         | `fn_owner_visible(owner_type, owner_id)`.                        | Definer / service only (statement generator).                                                  |
| `finance.chargebacks`        | admin or `fn_can_view_wallet(wallet_id)` (NULL wallet = admin).  | Definer / service only (Stripe webhook).                                                       |

> **Rationale:** read policies are scoped to the money's owner; every mutation that moves or
> reclassifies capital is a `SECURITY DEFINER` RPC so financial invariants (fee application, splits,
> caps, idempotency) are enforced in one auditable place, never by a raw client write.

## 🆕 Additive-table policies (2026-07-24 Subscriptions, Standing & Entitlements)

Migrations `20260724112000` / `20260724113000`. The posture matches the rest of the schema: reads
are scoped to the money's owner (or public where the value _is_ the public contract), and every
mutation flows through a `SECURITY DEFINER` function.

| Table                               | SELECT                                                                             | Write                                                               |
| :---------------------------------- | :--------------------------------------------------------------------------------- | :------------------------------------------------------------------ |
| `finance.plans`                     | `USING (is_public OR security.is_admin())` — the catalogue is a public price list. | Service-role only.                                                  |
| `finance.plan_entitlements`         | `USING (true)` — what a plan grants must be inspectable before buying.             | Service-role only.                                                  |
| `finance.subscriptions`             | `fn_owner_visible(subject_type, subject_id)`.                                      | Definer / service only (Stripe webhook owns the lifecycle).         |
| `finance.subscription_events`       | `fn_owner_visible(subject_type, subject_id)`.                                      | Definer / service only.                                             |
| `finance.entitlement_grants`        | `fn_owner_visible(subject_type, subject_id)`.                                      | Service-role only (a grant is an admin act).                        |
| `finance.standing_commission_tiers` | `USING (true)` — the earned taper is a public promise.                             | Service-role only.                                                  |
| `finance.negotiated_rates`          | `fn_owner_visible(subject_type, subject_id)`.                                      | Service-role only; every row is admin-approved and time-boxed.      |
| `finance.allowance_periods`         | `fn_owner_visible(subject_type, subject_id)`.                                      | Definer only — via `fn_current_allowance` / `fn_consume_allowance`. |
| `finance.allowance_ledger`          | `fn_owner_visible(subject_type, subject_id)`.                                      | Definer only (append-only).                                         |

> **Why the catalogue and the taper are world-readable.** They are the platform's published terms. A
> freelancer deciding whether a rung is worth chasing, or whether Pro is worth £12.99, has to be
> able to read the exact numbers — hiding them would undercut the "earn it or accelerate it" promise
> the whole system rests on.

**Allowance write path.** `authenticated` may `EXECUTE` `fn_current_allowance` (read/roll its own
period) but **not** `fn_consume_allowance` / `fn_refund_allowance`, which are `REVOKE`d from
`public` and granted to `service_role`. Consumption therefore only ever happens through the metering
trigger on `projects.project_applications` or a backend service — a client cannot spend, refund, or
inflate its own allowance.

## 🆕 Basket, wishlist & saved cards

These three tables are **user-facing**, unlike most of the hidden ledger, so they ship with real
policies. (RLS enabled with zero policies is default-deny and is a _bug_, not a lock — root
`CLAUDE.md`, Decision #57.)

| Table                  | SELECT                                                            | Write                                                                   |
| :--------------------- | :---------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `finance.baskets`      | `fn_owner_visible(owner_type, owner_id)` — any member may see it. | `FOR ALL`, `fn_can_manage_basket(owner_type, owner_id)` — needs `spend` if shared. |
| `finance.basket_items` | `EXISTS` over the parent basket with `fn_owner_visible`.          | `FOR ALL`, `EXISTS` over the parent basket with `fn_can_manage_basket`. `purchased_at` guarded (`trg_basket_items_derived`) — only checkout marks a line purchased. |
| `finance.saved_cards`  | `fn_owner_visible(owner_type, owner_id)`.                         | UPDATE + DELETE, `fn_owner_capability(…, 'manage_billing')` — mirrors `payment_methods`. No INSERT (the processor saves a card); display columns immutable (`trg_saved_cards_immutable`). |

> **A basket line's PRICE is not guarded, deliberately.** The basket service writes it as the
> signed-in user, so a column guard would refuse the legitimate write too. The price that matters is
> the one checkout computes: it re-prices every line from the catalogue and never charges a stored
> figure, so a tampered line fools only its own display.

> **Why read and write differ on a basket.** Any member of an entity may _see_ what the entity is
> about to buy; only a member who could actually **pay** for it may change it. A basket line is a
> proposed spend, so writing one is a spend-adjacent act, not a read. Items inherit their basket's
> reach through an `EXISTS` over `finance.baskets` — which is itself filtered by the two policies
> above — so an item is exactly as reachable as the basket holding it, with **no second copy of the
> ownership rule** to drift.

> **Saved cards and payment methods share one posture.** A saved card _is_ the display projection of
> a `finance.payment_methods` row, so the two answer "who may manage this entity's instruments" the
> same way. Until 2026-09-23 that answer was bare membership — any active member could manage an
> entity's cards — which is now `manage_billing`. The three-table instrument overlap
> (`payment_methods` / `payout_accounts` / `saved_cards`) remains flagged in root `CLAUDE.md` §8.

**`DELETE` is granted** on these three (baskets and items: `SELECT, INSERT, UPDATE, DELETE`; saved
cards: `SELECT, UPDATE, DELETE`), unlike every other `finance` table. Root `CLAUDE.md` §5 ("nothing
is hard-deleted") governs lifecycle entities and financial records; a basket line is neither — it is
an intent that has never moved money, and removing an item from a cart is genuinely a delete. The
soft path still exists where it means something (`saved_for_later`). Nothing downstream of checkout
became deletable.

## 📒 The ledger and commerce tables (2026-09-23)

READ policies only. Money moves through definer functions, so none of these carries a client write
policy — except `buyer_details`, the buyer's own form.

| Table                             | SELECT                                                                                    | Write |
| :-------------------------------- | :---------------------------------------------------------------------------------------- | :---- |
| `finance.wallets`                 | `fn_owner_visible(owner_type, owner_id)`                                                  | — |
| `finance.transactions`            | `fn_can_view_wallet(wallet_id)`                                                           | — |
| `finance.payouts`                 | `fn_can_view_wallet(wallet_id)`                                                           | — |
| `finance.payout_accounts`         | `fn_owner_visible(owner_type, owner_id)`                                                  | — |
| `finance.orders`                  | `fn_owner_visible(owner_type, owner_id)` — the buyer, or the members of the buying entity | — |
| `finance.order_lines`             | `EXISTS` over its order (runs under the order's policy)                                   | — |
| `finance.invoices`                | admin, the issuer (`issue_from_profile` is a user **or** team id — both tested), or a member of `issue_to_business_id` | — |
| `finance.invoice_line_items`      | `EXISTS` over its invoice                                                                  | — |
| `finance.buyer_details`           | `fn_owner_visible(owner_type, owner_id)`                                                  | INSERT / UPDATE, `fn_can_manage_basket(owner_type, owner_id)` — the same read/write split as the basket these details check out under |
| `finance.disputes`                | admin, the opener, or a reader of the escrow (`EXISTS` under "View escrows")              | — |
| `finance.dispute_messages`        | `EXISTS` over its dispute                                                                  | — |
| `finance.contribution_agreements` | admin or an active member of the team — each member sees the whole split                   | — |
| `finance.payout_splits`           | the member paid, or a reader of the escrow                                                 | — |
| `finance.spending_limits`         | `fn_can_view_wallet(wallet_id)` — includes the member it binds                             | — |

> **Child tables inherit through the parent's policy.** An `EXISTS` inside a policy runs under the
> referenced table's own RLS, so an order line is exactly as visible as its order, with no second
> copy of the rule to drift.

## 🧱 Column guards (2026-09-23)

A policy decides **who** may touch a row; it cannot say **which columns** — a `WITH CHECK` sees only
the post-image. The finance tables a client may write therefore carry column guards (the
`security.fn_guard_*` triggers, `00001001`, attached in `00001830`):

| Trigger                          | Table             | Guards                                                                 |
| :------------------------------- | :---------------- | :--------------------------------------------------------------------- |
| `trg_wallet_pots_derived`        | `wallet_pots`     | `balance_cents` — must start at zero, never written by a client        |
| `trg_wallet_pots_immutable`      | `wallet_pots`     | `wallet_id`, `currency`                                                |
| `trg_deposit_rules_derived`      | `deposit_rules`   | `failure_count`, `last_error` — the scheduler's record                 |
| `trg_payment_methods_immutable`  | `payment_methods` | owner, role, provider, external ref, brand, last4, status              |
| `trg_saved_cards_immutable`      | `saved_cards`     | owner, instrument refs, brand, last4, expiry, cardholder, BIN, creator |
| `trg_basket_items_derived`       | `basket_items`    | `purchased_at` — only checkout marks a line purchased                  |

All refuse with `42501` for `anon` / `authenticated`; definer functions and the service role pass.

## 🔑 Function privileges (2026-09-23)

With schema usage granted, Postgres's default `EXECUTE` to `PUBLIC` would have made every finance
function an API endpoint — and the ledger primitives check nothing about who is asking, because the
guarded doors that call them (`projects.fund_stage`, `complete_ticket`, `approve_stage`, the claim
path…) do the checking and run them as their owner. `rpc/fn_wallet_credit` would have credited any
wallet with any amount. So (`00002510`):

- **`EXECUTE` is revoked from `PUBLIC` and `anon` on every finance function**, and from future ones
  (`ALTER DEFAULT PRIVILEGES`). The service role keeps them all.
- **The primitives are stated per function as well** — `fn_wallet_credit`, `fn_wallet_debit`, the
  three escrow hold/release/refund functions, `fn_fair_exit_release`, `fn_split_team_payout`,
  `fn_generate_consolidated_invoice`, `fn_check_spending_limit`, `fn_seed_business_wallet` — so no
  client role can be found holding one even if a broad grant lands later. Every SQL caller of them is
  `SECURITY DEFINER`, so revoking them changed nothing that worked.
- **The subject-taking resolvers moved to the service role** — `fn_freelancer_payout_ready`,
  `fn_business_kyb_verified`, `fn_active_plan`, `fn_effective_limit`, `fn_has_entitlement`,
  `fn_effective_commission_bp`, `fn_effective_platform_fee_bp`, `fn_current_allowance`,
  `fn_footprint_usage`, `fn_footprint_remaining`. Each takes ANY subject, so a client grant would hand
  any signed-in account another person's KYC readiness, plan, usage and negotiated rates. A surface
  that needs the viewer's own figures should get a self-scoped wrapper.
- **`authenticated` keeps exactly** the predicates the policies call (`fn_owner_visible`,
  `fn_can_view_wallet`, `fn_has_vault_capability`, `fn_can_manage_basket`, `fn_can_move_wallet_funds`,
  `fn_owner_capability` — a policy expression runs as the invoking role, so these must stay
  executable), the two public resolvers (`fn_audience_for`, `fn_subject_standing_level`), and the
  param-gated `simulate_wallet_transaction`.

## 🧪 `finance.simulate_wallet_transaction` — the param-gated simulator

Not a policy but a permission decision that belongs beside them. The function **moves real money**
(see [Functions.md](Functions.md)); four gates stand in front of it and every one must hold:

1. `security.platform_params.finance_simulation_enabled` is true — **seeded `false`, fails closed**.
2. `auth.uid()` is present (a service-role or cron context is refused outright).
3. `finance.fn_can_move_wallet_funds` holds on **every** wallet touched — source _and_ destination.
4. `EXECUTE` is granted to `authenticated` **only** — never `anon`, and deliberately not
   `service_role` (it has no `auth.uid()`, so gate 2 would refuse it anyway; granting it would
   advertise a bolted door).

> Gate 3 is wider than "own the source wallet". A credit-only type (`top_up`, `escrow_release`,
> `refund`) with no destination check would let any signed-in caller **mint balance into a
> stranger's wallet** — so the destination is checked with the same predicate.
