# finance Schema: Policies

RLS is **always on** for `finance`. The schema follows a **hidden-ledger** posture: the core money
tables are locked to `SECURITY DEFINER` RPCs, and only deliberately user-facing tables carry a
`SELECT`/manage policy in the caller's JWT context. Writes to money-moving tables are never opened
to `authenticated` directly — they flow through definer functions (see
[Functions.md](Functions.md)).

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
  wallet → the `spend` capability. Gates `finance.simulate_wallet_transaction`.

## 🔒 Definer-only tables (RLS enabled, no policy)

Locked to definer/service access — reachable only via the finance RPCs (`org.get_business_finance`,
the `projects.*` stage wrappers). No `authenticated` grant.

`finance.wallets`, `finance.transactions`, `finance.invoices`, `finance.invoice_line_items`
(migration 0201 enables RLS; no policy), `finance.disputes`, `finance.dispute_messages`,
`finance.contribution_agreements` (0201), `finance.payout_splits` (0201), `finance.spending_limits`
(0201), `finance.ratings`, `finance.payout_accounts`, and `finance.idempotency_keys` (additive —
system table, service-role only).

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
| `finance.fx_rates`           | `USING (true)` — public reference data (like `platform_params`). | Service-role / definer only (ingestion job).                                                   |
| `finance.verification_cases` | Subject or its members (`fn_owner_visible`-style) + admin.       | Definer / service only (verification webhook).                                                 |
| `finance.payment_methods`    | `fn_owner_visible(owner_type, owner_id)`.                        | `FOR ALL` with the same predicate (owner manages own methods).                                 |
| `finance.deposit_rules`      | `fn_can_view_wallet(wallet_id)`.                                 | `FOR ALL` same predicate.                                                                      |
| `finance.payout_schedules`   | `fn_owner_visible(owner_type, owner_id)`.                        | `FOR ALL` same predicate.                                                                      |
| `finance.income_smoothing`   | `user_id = auth.uid()` (or admin).                               | `FOR ALL`, `WITH CHECK (user_id = auth.uid())`.                                                |
| `finance.wallet_pots`        | `fn_can_view_wallet(wallet_id)`.                                 | `FOR ALL` same predicate.                                                                      |
| `finance.vault_permissions`  | `fn_can_view_wallet(wallet_id)`.                                 | Grants flow through a `manage_members`-gated definer RPC (deferred) — no INSERT/UPDATE policy. |
| `finance.split_rules`        | `org.is_active_team_member(team_id)` (or admin).                 | Edits via a `manage_finances`-gated RPC (deferred).                                            |
| `finance.spend_approvals`    | `fn_can_view_wallet(wallet_id)`.                                 | INSERT (`requested_by = auth.uid()` + can-view-wallet); approve/reject via definer RPC.        |
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

| Table                  | SELECT                                                            | Write (`FOR ALL`)                                                       |
| :--------------------- | :---------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `finance.baskets`      | `fn_owner_visible(owner_type, owner_id)` — any member may see it. | `fn_can_manage_basket(owner_type, owner_id)` — needs `spend` if shared. |
| `finance.basket_items` | `EXISTS` over the parent basket with `fn_owner_visible`.          | `EXISTS` over the parent basket with `fn_can_manage_basket`.            |
| `finance.saved_cards`  | `fn_owner_visible(owner_type, owner_id)`.                         | `fn_owner_visible(owner_type, owner_id)` — mirrors `payment_methods`.   |

> **Why read and write differ on a basket.** Any member of an entity may _see_ what the entity is
> about to buy; only a member who could actually **pay** for it may change it. A basket line is a
> proposed spend, so writing one is a spend-adjacent act, not a read. Items inherit their basket's
> reach through an `EXISTS` over `finance.baskets` — which is itself filtered by the two policies
> above — so an item is exactly as reachable as the basket holding it, with **no second copy of the
> ownership rule** to drift.

> **Why saved cards do not use the tighter gate.** A saved card _is_ the display projection of a
> `finance.payment_methods` row, so it mirrors that table's policy exactly rather than inventing a
> third posture for one concept. The looseness that implies for a shared owner (any active member
> may manage the entity's cards) is **inherited from the sibling, not introduced here**, and is
> flagged for reconciliation alongside the three-table instrument overlap (root `CLAUDE.md` §8).

**`DELETE` is granted** on all three (`SELECT, INSERT, UPDATE, DELETE TO authenticated`), unlike
every other `finance` table. Root `CLAUDE.md` §5 ("nothing is hard-deleted") governs lifecycle
entities and financial records; a basket line is neither — it is an intent that has never moved
money, and removing an item from a cart is genuinely a delete. The soft path still exists where it
means something (`saved_for_later`). Nothing downstream of checkout became deletable.

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
