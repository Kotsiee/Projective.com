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

## 🔒 Definer-only tables (RLS enabled, no policy)

Locked to definer/service access — reachable only via the finance RPCs (`org.get_business_finance`,
the `projects.*` stage wrappers). No `authenticated` grant.

`finance.wallets`, `finance.transactions`, `finance.invoices`, `finance.invoice_line_items`
(migration 0201 enables RLS; no policy), `finance.disputes`, `finance.dispute_messages`,
`finance.contribution_agreements` (0201), `finance.payout_splits` (0201), `finance.spending_limits`
(0201), `finance.subscriptions`, `finance.ratings`, `finance.payout_accounts`, and
`finance.idempotency_keys` (additive — system table, service-role only).

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
