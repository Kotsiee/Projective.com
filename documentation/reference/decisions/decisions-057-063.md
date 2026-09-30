> Full rows of Resolved Decisions #57–#63 (former root CLAUDE.md §8), verbatim.

| #  | Decision (2026-07-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Applied in                                                                                                                                                                                                                                                                                    |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 57 | **Notification Engine — documentation + database FOUNDATION (2026-07-24).** A **docs + DB +
Zod-only** pass (NO UI / islands / routes / features / backend services), mirroring the Decision #54
/ #56 shape. Adds **5 additive, timestamped migrations** (`20260724090000`–`094000`) — (1) the
**`comms.notification_types` catalog** (routing policy as data: category · urgency · default channel
fan-out · mute-ability · quiet-hours override · dedupe window · audit flag; **81 event keys
seeded**) plus the additive event-envelope columns on `comms.notifications` (`category`, `urgency`,
`actor_user_id`, `context_type`/`context_id`, `action_url`, `payload`, `group_key`/`group_count`,
`channels`, `seen_at`, `archived_at`, `expires_at`) and 9 partial indexes; (2) **preference
granularity** — recurring, timezone-aware quiet hours + digest cadence + global snooze +
`escalate_after` on `comms.notification_prefs`, the new sparse `notification_category_prefs` and
`notification_type_mutes`, and a real `device_tokens` shape (platform · Web Push endpoint/keys ·
soft-revoke · failure count) with a seed-on-signup trigger; (3) **delivery & scheduling** —
`notification_deliveries` (one row per notification × channel × device), `notification_queue`
(durable, cancellable, dedupe-keyed promises), `notification_digests`, `delivery_events` (the
webhook idempotency ledger) and `channel_suppressions`; (4) the **router + writer** — `fn_notify`
(compatible superset of the 0305 six-arg signature), `fn_resolve_channels`, `fn_is_quiet_hours`,
`fn_is_suppressed`, the inbox RPCs, and three `security_invoker` read views; (5) **RLS, grants,
realtime, `pg_cron` jobs** and a feature-flagged outbound dispatch trigger. **THE HEADLINE FIX:**
`comms.notifications`/`notification_prefs`/`device_tokens` have had RLS **enabled since 0201 with
ZERO policies** — default-deny — so `authenticated` could never read a notification and Realtime
(publishing the table since 0206) could never emit one; the in-app channel has never worked. Lands
with the **Zod SSOT** `@projective/types/comms` (`common`/`catalog`/`notifications`/`preferences` +
the `./comms` export) and the de-stubbed
`documentation/database/comms/{Tables,Policies,Functions}.md` (Policies + Functions were
`_Not yet documented._`), plus `Schemas.md`, `database/README.md`, `PRODUCT_MANAGEMENT.md` §3.5 (two
new domain lifecycles: notification delivery + scheduled notification) and `SYSTEM_ARCHITECTURE.md`
§The Notification Engine. **Verified against a real Postgres 16** (throwaway container,
Supabase-shaped scaffold): all 5 migrations apply clean; legacy alias resolution, collapse,
quiet-hours push-drop, critical-pierces-quiet-hours, mandatory-survives-snooze, per-type mute, audit
write, queue dedupe + processing, per-device push fan-out, feed exclusion of muted rows, expiry
sweep, escalation idempotency and suppression semantics all behave; RLS verified as an
`authenticated` role (own-rows-only, forging blocked, reassignment blocked). **Authored, NOT applied
to any live database** (a human step, Decisions #47/#54/#56 precedent). **Design invariants:** the
catalog is **policy, not a gate** (deliberately NO FK from `notifications.type`, and `fn_notify`
auto-registers an unknown key); **the engine never raises** (it is called from inside escrow/stage
RPCs); a notification **row is always written** while `channels` records what the router decided
(empty = recorded, delivered nowhere); there is **no client INSERT policy**, so _"Payout sent"_
cannot be spoofed; nothing is hard-deleted (dismiss = `archived_at`). **Flagged conflicts (surface,
do not silently resolve):** (a) **key-convention split** — `comms/Tables.md` has always documented
dotted keys (`message.new`) but the live escrow callers (0305/0311) emit underscored ones
(`stage_funded`, `stage_approved`, `stage_cancelled`, `project_handover`); resolved
non-destructively (dotted canonical + the four legacy keys in `aliases[]` + `fn_resolve_type_key`)
so those call sites are untouched — **rewriting the money-movement RPCs needs human sign-off**. (b)
**`quiet_hours tstzrange` superseded** — it is an ABSOLUTE range and cannot express a recurring
nightly window; kept under the Additive Rule and still honoured, with the new
`quiet_hours_*`+`timezone` columns authoritative. (c) **`digest boolean` superseded** by
`digest_frequency` (backfilled `true`→`daily`). (d) **`org.user_preferences`
`notification_email`/`notification_push` are a second, coarser copy** of the same toggles (seeded by
Decision #47's trigger) — `comms.notification_prefs` is the engine's SSOT and the two are **not
reconciled** (a data decision). (e) `fn_notify` is replaced via **DROP + CREATE**, not
`CREATE OR REPLACE` — adding defaulted params changes the signature and keeping both would make a
six-arg call ambiguous; every existing call site still resolves to the new function unchanged. (f)
**Push/email/SMS have no transport yet** — the `dispatch-push`/`send-email` Edge Functions, the
VAPID keypair, FCM/APNs credentials and an SMTP/email-provider block in `config.toml` are the
deferred live path; the outbound trigger ships **feature-flagged off** with an `XXXX-XXXX`
placeholder URL. (g) `pg_cron`/`pg_net` are **optional** — registration is guarded and only raises a
`NOTICE`, so the jobs may need scheduling by hand. | root CLAUDE.md §1/§5/§6 ·
`supabase/migrations/20260724090000..094000_*` · `packages/types/comms/*` ·
`documentation/database/comms/{Tables,Policies,Functions}.md` ·
`documentation/database/{Schemas,README}.md` · `SYSTEM_ARCHITECTURE.md` §The Notification Engine ·
`PRODUCT_MANAGEMENT.md` §3.5 · Decisions #47 / #54 / #56 |

| 58 | **Subscriptions, Entitlements & the earned Standing ladder — documentation + database
FOUNDATION (2026-07-24).** A **docs + DB + Zod-only** pass (NO UI / islands / routes / features /
backend services). Adds **4 additive, timestamped migrations** (`20260724110000`–`113000`) — (1) the
**`analytics` event substrate** (that schema's first tables: `event_catalogue` · append-only
`events` · `daily_rollups` · `fn_emit` · `v_unregistered_events`), (2) the **earned Standing
ladder** in `org` (`standing_levels` · `entity_standing` · `standing_events` · `create_mastery` ·
`achievements` + `entity_achievements` · `quality_streaks` +
`fn_recompute_standing`/`fn_award_achievement`/ `fn_touch_streak`/`fn_record_mastery`), (3) the
**paid ladder** in `finance` (`plans` · `plan_entitlements` · `subscriptions` **extended
additively** · `subscription_events` · `entitlement_grants` · `standing_commission_tiers` ·
`negotiated_rates`), (4) **resolution, metering & enforcement** (`allowance_periods` ·
`allowance_ledger` · `fn_effective_limit`/`fn_has_entitlement`
/`fn_effective_commission_bp`/`fn_effective_platform_fee_bp`/`fn_current_allowance`/
`fn_consume_allowance`/`fn_footprint_usage` + three param-gated triggers) — each **RLS-on with
policies**, **additive-only** (no table/column/FK/function/trigger dropped; the pre-existing
`finance.subscriptions` skeleton is EXTENDED and its legacy `plan`/`status`/`profile_id` columns
mirrored by a BEFORE trigger rather than relaxed), **authored, NOT applied to any live DB** (a human
step, Decisions #47/#54 precedent). Lands with the **Zod SSOT** (`@projective/types/analytics` — a
NEW sub-path — + `org/standing.ts` + `finance/{plans,entitlements}.ts`) and the de-stubbed
`documentation/database/analytics/{Tables,Policies,Functions}.md` plus `org`/`finance`/`Schemas.md`/
`README.md` updates. Business: `finance-model.md` §1.1–1.5 rewritten + new §16 (concrete numbers),
`PRODUCT_SPEC.md` §Escrow…#7 "Subscriptions, Allowances & Entitlements" + §Reputation…#5 "Standing,
Mastery & Progression" (abstract rules), `PRODUCT_MANAGEMENT.md` §3.5 (+3 domain lifecycles).
**Architecture — the three axes:** execution capacity is **never** monetised ($W_i$ caps stay the
sole authority); only **distribution** (proposals) and **marketplace footprint** are tiered; and a
plan **accelerates capacity but can never buy reputation** (nothing in `finance` writes to
`org.entity_standing`; every Standing mutator is `REVOKE`d from `public`). **Reused, NOT forked:**
Standing is the discretised rung of the EXISTING Reliability Index ($R_i$, `PRODUCT_SPEC.md`
§Reputation & Discovery), not a competing score; `security.penalties` remains the penalty SSOT;
`finance.subscriptions` was extended rather than replaced; the "Architect" designation is seeded
into `org.achievements` rather than reinvented. **Owner decisions applied (2026-07-24):** Individual
Pro = **£12.99/mo**; free published listings **10 scaling with rank** (Pro = 2×); active public
projects **3 free / 15 Pro**; **no cap on joining** teams/businesses; the 5% **may** flex for
Organisation volume deals; governing constraint = _"never feel suffocated; upgrading should just
make sense."_ **Flagged conflicts / open items (surface, do NOT silently resolve):** (a)
**`finance-model.md` §1.1 reworded** — "no paywall on freelancer **project** volume" → "no paywall
on **execution** volume"; this is a real semantic change to a previously absolute guardrail, made on
the owner's explicit instruction, and is logged here rather than applied silently. (b)
**`business_pro` price is unset** — entitlements seeded, `finance.plans.price_cents` deliberately
`NULL`. (c) **Enforcement ships fail-open** — `proposal_allowance_enforced` +
`footprint_caps_enforced` default `false`, so the caps **meter** but never refuse; flipping them
changes live user-visible behaviour and needs a human. (d) **`published_listings` usage count
returns 0** until the `catalogue.*` tables land (Decision #53 keeps `/catalogue` on fixtures) — the
cap already resolves, only its live count is pending. (e) **Standing is never recomputed by a
trigger** — it is a sweep (`standing_recompute_interval_hours`), because recomputing reputation
inside a stage-approval transaction would couple money movement to reputation math; the sweep job
itself is not yet written. (f) `standing_demotion_grace_days` is seeded but **not yet consumed** by
`fn_recompute_standing` (anti-flapping guard reserved). (g) `finance.plan_entitlements`
`organisation_businesses` counts 0 because businesses are **not yet FK-linked** to an organisation
(Phase 2). (h) The Standing metric inputs (`completion_rate`, `on_time_rate`, dual-track ratings,
`dispute_rate`, `workload_reliability`) have **no writer yet** — the backfill from
`projects.*`/`finance.ratings` is a follow-up. (i) **Timestamp collision avoided:** these migrations
were renumbered from `2026072409xxxx` to `2026072411xxxx` because the concurrent Notification Engine
(#57) had already claimed the `090000`–`094000` slots. (j) **Denial telemetry goes dark once
enforcement is ON** — the `RAISE` that blocks also rolls back the `entitlement.denied` row written
moments earlier (Postgres has no autonomous transactions); after either param is flipped, the app
layer must catch the `check_violation` and emit the denial itself, or the conversion funnel stops
being measurable exactly when it starts mattering. **Validated by execution, not inspection:** all
four migrations were applied to a throwaway Postgres 16 container against a stub of their
dependencies, and the resolver / metering / enforcement paths exercised (free→Pro resolution, rung
scaling 10→20→40 listings, 50→70→170 proposals, the L5 volume floor holding a 95.9-score subject at
L4, legacy-column mirroring, buffer exhaustion, draft-vs-live footprint, and both triggers refusing
once switched on). | root CLAUDE.md §1/§5/§6 · `supabase/migrations/20260724110000..113000_*` ·
`packages/types/{analytics,org/standing,
finance/{plans,entitlements}}` ·
`documentation/database/{analytics,org,finance}/*` · `documentation/database/{Schemas,README}.md` ·
`finance-model.md` §1/§16 · `PRODUCT_SPEC.md` §Escrow/Wallets/Finance #7 + §Reputation & Discovery
#5 · `PRODUCT_MANAGEMENT.md` §3.5 · Decisions #2 / #47 / #53 / #54 / #57 |

| 59 | **Integration & Plugin Platform — `integrations` schema redesigned from scratch (2026-07-25).
Docs + DB + Zod-only** pass (NO UI / islands / routes / features / backend services). The
calendar-only connection store (Decision #56) is generalised into the platform's **connector +
plugin substrate**, architected on the rule that "integration" is **four systems with irreconcilable
trust models — Auth (GoTrue), Infra (Stripe/Maps, server keys), Connectors, Plugins** — and the unit
of architecture is the `(provider, capability)` pair, NOT the vendor. **(A) Connector substrate**
(generic provider/consent/sync framework so a 50th connector is a seed row + adapter code, never a
schema change): `integrations.providers` enriched (category vs. multi-valued capability axes,
`auth_scheme`, `broker` recording the integration STRATEGY — calendar→Nylas unified API,
storage/dev→direct, CRM tail→Merge, always wrapped behind our own adapter), `user_connections` now a
`(user, provider, external_account_id)` **state machine**
(`pending→active→degraded→expired/revoked/
disconnected`, multi-account per vendor), the token vault
**split into `connection_secrets`** (its own table, **no policy/no view/service-role only**, KMS
**envelope encryption** via `key_id`, never a symmetric env secret), `connection_sync_state` (delta
cursors), `webhook_subscriptions` (first-class `expires_at` a cron renews) + `webhook_deliveries`
(idempotency ledger, dedupe on `(provider_slug, external_delivery_id)`), `connection_audit`. **(B)
Plugin ecosystem** ("Projective OS", post-MVP, schema+seams laid now so the later build is not a
rewrite): `extension_points` (the slot registry — first-party counterpart of the app's
`channelHeaderFor`/`laneFor`/`middleNavFooterFor` resolvers), `plugin_scopes` (capability-permission
vocabulary AS DATA), `plugins` + `plugin_versions` (GitHub-hosted, SRI-pinned `bundle_url` on a
SEPARATE origin, manifest jsonb), `plugin_installations` (scoped consent, `granted_scopes` the
mediator enforces), `plugin_grants` (hashed client secrets, headless/automation) + `plugin_audit`.
**Trust model is adversarial (Figma/Shopify, NOT Obsidian):** third-party code never runs in the
host origin (sandboxed cross-origin iframe / declarative Block-Kit tier the host renders with
`@projective/ui`; **Shadow DOM is a styling boundary, not a security one**); every data touch is
capability-scoped through a server Plugin-API mediator (`fn_plugin_has_scope`) — a plugin is a
first-party OAuth client with extra UI rights. **The three retrofit-killing seams already hold
today:** thin-routes/fat-services (a plugin `/api/*` call == an island `/api/*` call — anything a
plugin could call already goes through HTTP, never a service import), the slot-resolver pattern, and
the token-only design-system contract. Enums greatly expanded (`provider_kind` 2→12,
`provider_category`, `auth_scheme`, `sync_direction`, `webhook_status`, `connection_action` + 8
plugin enums). Preserves `providers.slug` + `user_connections.id` PKs (scheduling FKs untouched).
Full functions/triggers/RLS/grants/views/indexes/seed wired; a `v_plugin_catalog` LATERAL view
replaces a circular `latest_version_id` FK. Zod SSOT split into
`providers.ts`/`connections.ts`/`plugins.ts` (+ `common.ts`), NO token/secret shape anywhere.
Consolidated edit-in-place (root CLAUDE.md §1) — **NOT applied to any live DB** (a human step,
Decisions #47/#54 precedent). **Deferred (code, not migrations):** the consent handshake, the
**proactive token-refresh scheduler** (refresh before expiry, not lazily on 401), webhook ingestion

- channel renewal, canonical-model sync adapters, per-user + global rate limiting, and the entire
  plugin SDK/CLI/review-pipeline/marketplace (post-PMF). **AI workflows/automation agents ride the
  same capability-scoped Plugin API — an agent is a `headless` plugin.** **Flagged (surface, do not
  silently resolve):** (a) connections stay **per-user** (the freelancer-workspace scope), NOT
  per-vault — a team/business shared connection would need an owner axis; deferred. (b) `outlook` +
  `microsoft_teams` remain **separate vendor rows** (both Microsoft) to preserve the scheduling FKs
  rather than consolidate to one `microsoft` slug + capability array; reconcile if a unified
  Microsoft provider is wanted. (c) `notion` keeps its `calendar` capability (Decision #37's
  `INTEGRATION_SOURCES` lists it) AND gains `docs`; confirm Notion-as-calendar is still intended. |
  `SYSTEM_ARCHITECTURE.md` §Integration Blueprints #3 (§3.1–3.4) ·
  `documentation/database/integrations/{Tables,Policies,Functions}.md` ·
  `documentation/database/{Schemas,README}.md` · `packages/types/integrations/*` ·
  `supabase/migrations/{00000004,00000020,00001500,00001870,00002001,00002015,00002510,00002520,00003004,00003005,00004008,00005050}*`
  · Decisions #37 / #47 / #54 / #56 |

| 60 | **Wallet & Finance surface — complete redesign to a band architecture (2026-07-28).
SUPERSEDES the presentation of Decision #55.** The `/wallet` frontend is rebuilt from a boxed card
grid into a **vertical stack of FULL-BLEED bands**. The single biggest change:
`max-inline-size: 1100px;
margin-inline: auto` is **deleted** from both `.wallet-overview` and
`.wallet-page` — on this surface a money figure, a chart and a table always get the whole content
region, and `max-inline-size` now survives in exactly two places (`.wlt-prose` running text,
`.wlt-formfield` form fields) with a rule forbidding any figure/chart/table from being their
descendant. The whole `.wallet-*` BEM tree is replaced by `.wlt-*`; `wallet.css` becomes an
`@import` barrel over 13 sheets. **Region contract (strict):** the LANE owns the account switcher +
section nav + an ambient verification chip; a **NEW middle-nav HEADER band** (`walletHeaderFor`,
composed into `middleNavHeaderFor` — the wallet had none before) owns identity + the 30/60/90
range + search/filter entry + the display-currency toggle; the FOOTER band (`walletFooterFor`,
widened from `/wallet/transactions` only to **every** `/wallet*` route) owns every money action +
density/sort + Export; the BODY owns viewing and selecting data ONLY — no tabs, no filter dropdowns,
no primary CTAs. **The signature element** is the four-state capital meter: one shared rail split by
`flex-grow` into Available/Locked/Pending/On-hold with **no minimum width ever** (a sliver gets an
achromatic overhanging pip instead of a dishonest floor), the track `aria-hidden` and decorative
while the legend carries every fact in five redundant static channels (shape mark · label · figure ·
printed % · tone). Locked is `color-mix(--primary 34%,
--surface-2)` — the same hue as spendable
cash at a lower temperature, so escrowed capital reads as stored, never blocked; **`--danger` is
banned above the fold** and appears only on a ledger reason chip, the Standing penalty bar, and a
band-scoped error. **Two gates behave differently on purpose:** capability → **absence** (a member
never sees Access or Distribute), verification → **rendered but locked** with the one permitted lock
glyph and a nudge carrying `verification.prompt` (removing it hides the path to getting paid;
locking it teaches it) — `quickActionsFor` was changed to stop folding `canWithdraw` into the OFFER
so the client can draw the lock. **Additive SSOT** (no DB migration — still a read+write projection
over fixtures): `WalletOverviewSchema.capital` (server-summed, so the client never totals money),
`lockedStageCount`, `heldCaseCount`, `IncomingItemSchema.clearingFraction` (server clock — an
unsynced client would draw a dishonest 7-day ring), and **`WalletStandingSchema`**

- `StandingRung`/`StandingComponent`/`StandingGate`, carrying the earned ladder verbatim from
  `finance-model.md` §16.3 and the commission taper priced as MONEY against the wallet's own
  trailing volume. The **Standing gauge** renders the rung as what it PAYS: an arc for the
  continuous index, a **hatched ceiling veil** for everything past the stage-gated rung, and a
  separate LINEAR stage meter — because a rung has TWO conditions and an arc can only encode one, so
  the score may sweep past a notch while the rung honestly does not advance. It carries no button,
  plan badge or upgrade affordance: Standing is earned and can never be bought (§16.5). A **7th Dev
  axis** (`walletStanding`, incl. the `stage_floor` edge case) mirrors it per §5. **Three defects
  found and fixed in verification, all the same class — a fact depending on an animation or a scope
  that may not resolve:** (a) the hero count-up painted a starting `0` before its first `rAF`, so a
  backgrounded tab showed £0.00 for a funded wallet — it no longer lowers a figure it cannot raise,
  and a watchdog snaps to the server string; (b) the meter's segments animated `flex-grow` with a
  `backwards` fill, so a frozen animation clock left every share at zero width — motion now only
  ever decorates `transform`/`opacity`, never the property that encodes data; (c) the local token
  layer was scoped to `.wlt`, but the lane, header band, footer rig and every `BodyPortal` overlay
  render OUTSIDE it, so all `--wlt-*` silently fell back — tokens are now on `:root` (all names are
  `--wlt-`-prefixed). Also: `opacity` replaces `color-mix(… currentColor …)` for the pence
  de-emphasis (engines drop a `currentColor` mix that is itself defining `color`), and the fade
  token is unitless (a `%` through `var()` is rejected by older `<alpha-value>` grammar). **No new
  `@projective/ui` primitive** (reuses Drawer · Dialog · Popover · Tooltip · Avatar · Select ·
  SelectButton · InputNumber · InputText · Checkbox · ZoomSlider · Grid · Message · Alert ·
  LaneChrome) → **no `DESIGN_SYSTEM.md` §C.1 change**; no lifecycle change → no
  `PRODUCT_MANAGEMENT.md` change. Verified in-browser: all four variants (personal/team/business +
  read-only aggregate), all 7 deep pages, the Transfer flow end-to-end (footer → drawer → modal
  reading `Transfer £250.00` → success → the movement appears in the ledger), light + dark,
  `dir="rtl"` (lane 64→1241, deck 1165→51, segments reverse, **zero horizontal overflow both
  directions**), mobile 390px, the verification lock, the member capability gate, and the
  converted-currency 2×2 reflow. **Flagged (surface, do not silently resolve):** (a) the fixtures
  now generate Standing for a `team` subject too, but per the brief the gauge renders only in the
  PERSONAL intelligence band — decide whether a team vault should surface its own rung; (b)
  `/wallet/access` capability toggles and the `/wallet/methods` detail drawer remain optimistic
  stubs pending `FINANCE_BACKEND_LIVE`; (c) the FX spread and the Instant-Payout fee magnitude stay
  undecided platform economics and the surface deliberately renders neither — three facts inline
  (origin · converted · rate) and the literal phrase "a small fee applies". |
  `packages/types/finance/wallet.ts` · `packages/backend/services/finance/wallet-fixtures.ts` ·
  `apps/web/features/wallet/**` · `apps/web/routes/(dashboard)/wallet/*` ·
  `apps/web/routes/(dashboard)/_layout.tsx` · `apps/web/utils/dev-seam.ts` ·
  `apps/web/features/devtools/` · Decisions #1 / #10 / #54 / #55 / #58 |

| 61 | **Teams & Businesses — the multi-member entity console (`/teams`, `/businesses`)
(2026-07-30).** The 16th thin-frontend/fat-backend read and a write surface, built on one mental
model: **a Team is a Freelancer with multiple members (seller side); a Business is a Client with
multiple members (buyer side).** An entity is not a new persona but an existing one made multi-seat,
so the surface is ONE architecture parameterised by `WorkspaceKind` and the diff between the kinds
is a **capability table** (`capabilitiesForKind` · `presetCapabilities` · `kindCopy`), never a
duplicated folder: both kinds share the same routes-shape, lane, bands, roster, console, module
dispatcher and screens, and `consoleOutcome(kind, …)` differs by one argument. New Zod SSOT
**`@projective/types/workspace`** (`common` vocabulary + capability table · `members` incl. the
three-layer permission engine · `policy` money governance · `workspace` read/write projections +
`WorkspaceSim`), fat **`WorkspaceBackendService`** (`@server/services/workspace/`) behind the NEW
**`WORKSPACE_BACKEND_LIVE`** (default off), thin `/api/workspace/*` (13 routes) +
`/api/context/switch`. **No DB migration** — the live path reads the EXISTING `org.teams` /
`org.business_profiles` / `org.*_members` / `org.*_roles`, which is why the projections live under
their own `workspace` sub-path rather than the DB-row-mirroring `org` one. **(A) The module registry
(`core/module-registry.tsx`) is the extensibility core:** one array drives the lane's grouped nav,
the collapsed rail, the `[module]` route validator and the permission gate. Adding a module is one
entry + one component. `permission` is a **function of kind** and may return **`null`** = every
active member may view — load-bearing, not lazy: Overview is permissionless, so a capability-less
member always has a landing module and the **"never 404 a user out of their own workspace"**
invariant is satisfiable. Three route outcomes are deliberately distinct: an unregistered segment is
a miss, a REAL module the viewer may not open **redirects** to `firstModuleFor(...)`, otherwise it
renders. **(B) Three-layer permissions:** preset roles (read-only bundles;
`Duplicate to custom role` is the escape hatch) → entity-scoped custom roles → per-member overrides,
with the effective set `role ∪ granted − revoked` computed by ONE pure SSOT function
(`effectivePermissions` / `permissionFacets`) so the matrix, the member drawer, the roster row and
the server guard cannot disagree. Overrides render their PROVENANCE (`+ granted` / `− revoked`)
rather than only the outcome. `mayGrant` blocks privilege escalation; the last owner routes to a
real **ownership transfer** instead of a refusal. **(C) Money diverges by kind, honestly:** a team's
money comes IN then SPLITS (multi-handle split bar whose dividers ARE the total — `rebalanceSplit`
holds the 100% invariant in integer basis points, held stakes are immovable and never redistributed,
full keyboard parity via `role="slider"` with money-bearing `aria-valuetext`); a business's comes in
FROM members then out as PURCHASES (attributable contribution ledger, per-member envelopes reusing
`finance.spending_limits` semantics, and `evaluateSpend` returning **`needs_approval` as a
first-class outcome** so a blocked purchase always offers the request path). All money is
server-computed `MoneyView`; the client never totals, splits or converts. **(D) Two switchers stay
distinct** (closes Decision #55's flag (a)): the global `useContextSwitch` re-stamps the JWT
(`security.switch_session_context` → `/api/auth/refresh` → hard nav) and carries the "Acting as"
language; `/wallet`'s `?w=` is a page-local VIEW scope that never claims to change who you are.
**(E) `/businesses` (plural) is canonical** — the singular `/business` routes were deleted and
`nav-model` / `nav-fixtures` / `actions-model` / `UserActions` repointed (creation now
`/teams/create` · `/businesses/create`, not `/new`). **(F) Dev parity (§5 merge gate):** six axes —
entity kind · entity role (incl. `non_member`) · membership state · verification · acting context ·
roster shape — wired end-to-end through `dev-seam` + `dev-context` (`DevOverrides` · `DEV_DEFAULTS`
· `DevOption` lists · `reflect()` set AND delete) + a "Workspaces" panel group, and because the
switcher is a CLIENT seam the server cannot see, they travel as validated `sim*` QUERY PARAMS
(`WorkspaceSim`, the `/wallet` precedent) which **survive the gate's own redirect** (`preserveSim`)
and are ignored on the live path. **Bugs found and fixed in verification:** (1) a `Response`
returned from a Fresh `define.page` component is dead code, so the redirect never fired and every
gated module rendered a BLANK body — the resolution moved into `define.handlers` + `page()`; (2)
both policy screens measured "unsaved changes" against the immutable SSR prop, leaving the footer
permanently dirty after a successful save — the baseline is now a signal adopted from the server's
own response. **Flagged (surface, do not silently resolve):** (a) the **Businesses nav gate**
remains `businessAccountEnabled` while migration `20260709` gates on `org.users_public.is_operator`
— settling the buyer-side question rules out `isFreelancer` but the remaining two still need one
human decision (inherits Decisions #17/#18); (b) **Organisations** now overlap Businesses
considerably (both buyers with members and a pooled wallet) — own console, scale tier of
`/businesses`, or profile-only is undecided; (c) entity-owned **catalogue scope** still depends on
Decision #53's flag (d) fixtures-own-the-whole-corpus issue; (d) whose payment method funds a
business purchase when the pool is short (fail / prompt to contribute / charge personal) has refund
and attribution consequences and is undecided; (e) member and counterparty links follow the
canonical `/@handle` (Decision #3), not `/profiles/[id]`; (f) `isWorkspaceBackendLive()` lives
beside its service rather than in `core/supabase.ts` with its eight siblings — reconcile if the
gates become one registry. | root CLAUDE.md §2/§3/§5 · `packages/types/workspace/*` ·
`packages/backend/services/workspace/*` ·
`packages/backend/services/context/ContextBackendService.ts` · `packages/backend/core/env.ts` ·
`apps/web/features/workspaces/**` · `apps/web/routes/(dashboard)/{teams,businesses}/**` ·
`apps/web/routes/api/{workspace/*,context/switch}` · `apps/web/routes/(dashboard)/_layout.tsx` ·
`apps/web/features/shell/core/{nav-model,nav-fixtures,actions-model}.ts` ·
`apps/web/features/shell/islands/UserActions.island.tsx` · `apps/web/utils/dev-seam.ts` ·
`apps/web/features/devtools/*` · Decisions #3 / #10 / #16 / #17 / #18 / #53 / #55 |

| 62 | **Iconography unified — the `@projective/ui/icons` contract (2026-07-31).** An icon audit
found the product had **no** icon system: 134 hand-authored `<svg>` roots across 75 files, ~376
named glyphs in 23 independent per-feature modules, **10** declared `stroke-width` values, **7**
viewBoxes, **3** sizing models, **47** rendered sizes (9 of them landing on fractional pixels), and
a **second complete icon family made of Unicode characters** (`▾ ▸ ▲ ▼ ‹ › × ✓ ☰ ⠿ ★ 👤 🗗`, ~85
sites) living inside `packages/ui` itself. Measured end to end the same set rendered its lightest
glyph at **0.93px** and its heaviest at **1.80px** — a 1.93× spread. **NEW 14th sub-path
`@projective/ui/icons`**: a canonical `ICON_PATHS` registry (95 glyphs, values are **thunks** not
VNode constants — closing the Preact VNode-reuse hazard at the source rather than at call sites),
the `Icon` primitive, and **`IconShell`**, the base every feature-owned glyph module now renders
through. **The mechanism is CSS, deliberately:** `icon.css` sets `stroke-width` from `--icon-stroke`
against `.ui-icon` and pairs it with `vector-effect: non-scaling-stroke`, and because a CSS
declaration outranks an SVG presentation attribute, ONE stylesheet normalises all ~376 glyphs
without editing a single path — and a per-glyph override becomes impossible by construction.
`non-scaling-stroke` also **decouples stroke weight from grid**, which is what demotes the 11
off-grid (20/16/14/12-unit) glyphs from blocking to cosmetic. New tokens `--icon-2xs…--icon-xl`
(12·14·16·20·24·32, every step an integer pixel) + `--icon-stroke: 1.5`. **Weight is 1.5, not the
1.8 authoring precedent** — 1.8 was a _declared_ number whose rendered result was that whole spread,
so it never named a weight; 1.5px is the shipped median, the value `packages/ui/feedback` already
rendered at native scale, and it lands on a whole device pixel at 1× and a clean 3 at 2×. **Semantic
collisions resolved:** `/projects` had TWO glyphs split by form factor (desktop rail = briefcase,
mobile bottom nav = an architectural arch labelled "Workspace") — the briefcase is now canonical;
`PinIcon` meant a map pin in auth AND a push-pin in projects → `pin-location`/`pin-fixed`; `XIcon`
meant the X brand mark AND a close cross → `close` (brand marks stay quarantined in
`footer-icons.tsx`); `Archive` meant a compressed-file KIND and an archive ACTION → `archive-box`
for the action. Also fixed: `packages/ui/feedback/core/icons.tsx` was the only glyph module shipping
**without `aria-hidden`**, so every Alert announced its decorative mark before its own text; and a
pre-existing `TS2322` in `fields/components/field-marks.tsx` (an `as const` base object widening
`aria-hidden` to `string`) that the migration resolved. **Flagged (surface, do not silently
resolve):** (a) **`@tabler/icons-preact` is declared in the root import map and imported nowhere** —
a dead dependency and a fourth icon family waiting to happen; remove it or justify it. (b) The
wallet's four 12×12 **fund-state marks are data shape channels, not icons** (Decision #60's CVD
requirement) and deliberately stay off `.ui-icon`. (c) Integer-but-off-ramp sizes (18px, 22px) and
the fractional `font-size` driving `.ui-lane-iconbtn` remain; a control's hit-target is governed by
touch-target rules, not the icon ramp. (d) `nav-icons`/`profile-glyphs`/`view-glyphs` still export
**VNode constants** from their `PATHS` maps — the same reuse hazard the registry now avoids; migrate
them to thunks when next touched. | `DESIGN_SYSTEM.md` **§B.7** (new, merge-gated) + §C.1 roster ·
`packages/ui/icons/` · `packages/ui/styles/index.css` · `packages/ui/deno.json` ·
`packages/ui/feedback/core/icons.tsx` · `packages/ui/fields/components/field-marks.tsx` · 23 feature
`*-glyphs.tsx` modules · Decisions #22 / #25 / #60 |

| 62 | **Fields — one state language, one geometry (`--fld-*`) (2026-07-31).** An audit of all 27
controls in `@projective/ui/fields` (measured in-browser, not read) found a good spine reaching only
the text-input family: the 10 controls composing `.ui-field` were already pixel-identical, while 15
re-declared their own geometry and state vocabulary in parallel. Resolved by promoting a single
**`--fld-*` token layer to `:root`** in `styles/index.css` — geometry ramp, label/hint register,
panel + option-row contract, and a state model where every state declares the same four channels
(**border · surface · ink · ring**) plus a **mark**. On `:root` rather than `.ui-field`
deliberately: a field's label, hint, footer rig and — since the panels now leave the subtree — its
PORTALLED dropdown all render outside the control, so a scoped token would silently fall back for
four of five surfaces (the `--wlt-*` lesson, Decision #60). **Fixed, each verified by measurement:**
the **Knob was unreachable by keyboard** (JSX serialises `tabIndex` onto an `<svg>` as a camelCase
attribute; SVG attribute names are case-sensitive, so `svg.tabIndex === -1` — now lowercase
`tabindex`); **SortControl's menu had no focus ring** (`:hover` and `:focus-visible` shared one rule
with `outline: none`); `aria-valuetext` added to Slider/ZoomSlider via a `formatValue` hook and made
unconditional on Knob (it was gated on the VISUAL `showValue`, and now omits itself when it would
merely repeat `aria-valuenow`); a **24px hit-target floor** (`.ui-hit`, WCAG 2.2 AA 2.5.8) for the
6px slider track, 18px handle, 12px zoom handle, 20px checkbox/radio and 15px stepper; **MultiSelect
was 20px taller than every sibling** when EMPTY (`flex-wrap: wrap` on the root let the clear button
and chevron drop to a second line — wrapping belongs to the chip area alone); **Button +
ToggleButton radius never ramped** (fixed `--radius-base` at all three sizes); **four sibling
dropdowns had four option-row heights** (43.6/38.5/37.0/30.5px, three paddings, two type sizes) plus
divergent panel surface/elevation/max-height and NO `min-inline-size`, so a 71px trigger produced a
71px menu with every label ellipsised away; **five disabled opacities** (0.40–0.55, measuring
2.30–5.04:1) collapsed to one that measures **5.04:1** everywhere, applied to ink and border rather
than the box and no longer paired with `pointer-events: none` (which cancels the `not-allowed`
cursor it sits beside); the **status icon channel** (§A.5) went from documented-but-absent to a real
`.ui-field__mark` slot; `loading` became a field state at all (`AutoComplete` fetches suggestions
and had no way to say so). **App forms:** `auth.css` had replaced the canonical two-tone focus ring
with a single `0 0 0 2px var(--primary)` and, worse, its invalid rule wrote the SAME `box-shadow`
property later in the cascade, so **a focused invalid auth field showed no focus indicator at all**
— invalid now paints the border and the two compose; the dead `.auth .ui-field__label` selector (a
class that never existed) and the `0.85rem` label override are gone. `CatalogueCreateModal` bound
each visible label to its control by id (an `aria-label` on each one had been overriding the visible
text, WCAG 2.5.3; two of three were not associated at all) and stopped painting `required` +
`aria-invalid` the instant the modal opened. **`OwnershipTransfer`'s irreversible "Transfer
ownership" was styled identically to a safe primary** — now `severity="danger"`, a vocabulary the
codebase already had and had simply not reached for. Five label typographies collapsed to
`--fld-label-fs`. **Deliberate positions (not drift):** `--fld-fs-md`/`-lg` stay a half-step above
their neighbours on the type scale because a value the user TYPED is read under different conditions
than a table cell they scan; a 16px floor applies on coarse-pointer viewports because iOS Safari
zooms a sub-16px field on focus and does not zoom back. **Gotchas worth keeping:** this engine drops
`min()`/nested-`calc()` in `min-inline-size` (use a plain `var()`), and drops a `color-mix` whose
percentage comes from `calc(var(…) * 100%)` — hence the paired `--fld-disabled-mix` (literal `%`,
for mixes) and `--fld-disabled-alpha` (unitless, for `opacity`). **Concurrency note:** the
BodyPortal/z-scale migration for the eight field overlays landed in a CONCURRENT session working the
same tree during this pass; this row records the audit that specified it alongside the rest of the
work. | `DESIGN_SYSTEM.md` §C.1 + the field-contract and labelling-model notes ·
`packages/ui/styles/index.css` (`--fld-*`, `.ui-hit`) · `packages/ui/fields/**` ·
`apps/web/features/auth/styles/auth.css` · `apps/web/features/catalogue/**` ·
`apps/web/features/workspaces/**` · Decisions #19 / #50 / #60 |

| 63 | **Wallet — reachability, and the other half of the region contract (2026-07-31). REFINES
Decision #60.** A composed-page layout review of `/wallet` found the BODY half of #60's region
contract honoured better than anywhere else in the codebase (17 controls on the Overview, every one
a data selection or a navigation — no tabs, no filter dropdown, no CTA) and the CHROME half
unfinished in ways that made the surface unusable below a 1080px window. **(A) The footer band was
setting the surface's minimum width.** `.ui-middle-nav` is `grid-template-columns: auto 1fr`, and a
`1fr` track's automatic minimum is `auto`, so the content column could not shrink below its own
min-content — which one `nowrap` rig of six text-labelled buttons raised to **739px** (measured:
252px with the footer hidden, 95px with header and footer hidden). The lane, being the `auto` track,
absorbed every pixel: **280px → 2px at an 820px viewport with all six nav links clipped**, and at
768px the content column overflowed the frame's `clip` by 50px and cut the lifetime-earned figure.
Two fixes, either of which alone leaves the other's failure reachable: `minmax(0, 1fr)` on the
content track, and `container-type: inline-size` on the rig, whose inline-size containment stops it
contributing its width at all. **(B) The rig now adapts by WIDTH, not by page identity, and no
action is ever lost to it.** `TABLE_VIEWS` gated everything and was wrong three ways: a row-density
slider on Payouts and Invoices, which render `<dl>`/`<ul>` fact lists and where `walletZoom` is read
by nothing (only `LedgerTable` reads it); a `nth-child(n + 3) { display: none }` mobile rule that
deleted **Transfer, Fund escrow and New recurring** on exactly the four pages with no menu to
recover them; and the width floor above. Three container-query tiers (label → glyph-only, which is
§B.6.3's icon-only sticky footer, with the name relocated to the Tooltip every action now carries →
one menu), and **the menu holds every action at every tier**. **(C) Five actions existed in code and
nowhere in the interface.** `add_method` / `set_payout` / `enrol_smoother` had labels, capability
requirements, glyphs and `WalletService` methods, and `quickActionsFor` never emitted them;
`MoneyMoveDrawer` returned `null` for those plus `new_recurring` and `request_spend`, and was the
only consumer of `activeAction`. So Methods could not add a method, Payouts could not change the
schedule its own docstring called changeable, an eligible Income Smoother could not be enrolled in,
and three empty states pointed at "the action bar" for controls it was never given. New
`ConfigureDrawer` (reversible settings commit directly — the confirmation modal is for the
irreversible); `quickActionsFor` emits the three; a `VIEW_ACTION` map gives each page its own
leading primary. **Add method collects no card data by construction** — no PAN, expiry or CVV field,
because Stripe holds it and an input implying otherwise is a custody claim the surface spends its
whole design refusing to make. **(D) The action layer was mounted in `WalletOverviewScreen`** — one
route, while the rig that opens it renders on eight — so every footer action on the seven deep pages
opened nothing. It moved to the rig. **(E) Section navigation below 767px.** The lane is
`display: none` there and was the only route between the eight sections, so Activity / Funding /
Methods / Invoices / Access were unreachable on every phone; the header band now carries a
capability-filtered switcher at exactly the width the lane leaves — **the duty transfers, it does
not duplicate**. The `@media (max-width: 900px)` rule that dropped the reporting window now drops
the account NAME instead: the avatar still answers "whose money is this", which is the last fact
allowed to leave a band whose controls move money. **(F) Two header controls were inert** — Search
wrote to a local signal nothing read, and Filter opened a panel whose entire content was a sentence
telling you to use the balance meter, on four pages where that meter is not rendered. Both now work.
**(G) The §B.4 ladder was missing a rung**: `wallet-bands.css` documented a tonal step and every
band computed `rgba(0, 0, 0, 0)`, leaving a near-uniform 64/48/64px gap to carry all separation. Now
an alternating `nth-of-type(even)` tint (position, not tone name — Payouts runs intel→flow→ledger
and a name-keyed rule would abut two tinted bands), a translucent `color-mix` overlay so it steps
against whatever ground it actually sits on, and the ledger hairline removed so every boundary
spends exactly one device (§B.9.3). **(H) Type ramp re-cut.** Six display steps, none more than
~1.4× its neighbour below 50px, with two inversions: the Standing score at 50.9px was 71% of the
balance and became the page's second hero on scroll (now 40px), and the pence at `0.55em` of a 72px
figure rendered **39.6px — larger than the commission rate**. That ratio is the SMALL end's
legibility floor and is not a ratio at display scale; a hero-only `0.36em` puts them at 25.9px. The
ramp is now 72 → 40 → 36 → 30 → 26 → 22. **(I) Policy.** Approve/Decline were a repeated
`filled --primary` row action carrying the amount in the label (both now `text` with severity doing
the work, amount out of the verb per the file's own RULE O-2); the parallel `.wlt-btn` family — a
second button system with no severity axis, which is how an irreversible approval came to look like
a safe primary — is deleted and its 11 sites migrated to `Button`; `●`/`–` capability marks became
drawn glyphs; `add_method` and `set_payout` stopped borrowing Recurring's and Withdraw's glyphs;
mobile Export stopped being nameless (`font-size: 0` with no `aria-label`); `aria-expanded` now
renders in both states (Preact drops `={false}`, so five menu buttons shipped without it). **(J) Two
correctness bugs found in passing:** the ledger's `loadMore` and sort refetch each built their own
params and both omitted the fund-state filter, so page 2 of a filtered ledger came back unfiltered
and appended onto filtered rows; and ten refetches were `if (res.ok && res.data)` with no else, so a
failed currency or account switch left the previous wallet's figures on screen indefinitely —
`applyRead` + the previously-unreferenced `BandError`/`WalletSkeleton` now close both. **Verified by
measurement** at 1440 / 1024 / 820 / 768 / 390, LTR + RTL, light + dark: lane 280px at every width
it exists, **zero clipped elements and zero document overflow in both directions** (the stage-gate
figure "56 / 50" was clipped 13px in BOTH — a nowrap label took 128px of an 86px box and collapsed
the `1fr` meter to zero; its panel now uses a container query, because the intel band splits into
~430px plates and a viewport media query could never see the width that was actually wrong). **NOT
verified: click-through of the drawers** — Fresh's deferred island revival does not run in the
hidden preview pane (no Preact listeners attach on any island, including long-shipped ones), so the
action layer is verified by SSR output and type-checking only. **Flagged (surface, do not silently
resolve):** (a) the `@media (pointer: coarse)` bump of the rig row to 40px cannot be exercised in
the preview, which reports a fine pointer at every width; (b) the detector's one remaining finding
is `--spring-standard` matched on the word "spring" — it resolves to
`cubic-bezier(0.22, 1, 0.36, 1)`, which is ease-out-quint with no overshoot, exactly what §B.5
specifies. | `DESIGN_SYSTEM.md` §B.4 / §B.6 / §B.8 / §B.9 ·
`packages/ui/navigation/styles/middle-nav.css` · `apps/web/features/wallet/**` ·
`packages/backend/services/finance/wallet-fixtures.ts` · Decisions #55 / #60 / #62 |

| 63 | **Messaging — the `/messages` root inverted the region contract; the inbox moves to the body
(2026-07-31).** A composed-page layout audit of the messaging surface found the index route built
the opposite way round from `/wallet`, the reference implementation of the contract: the **lane was
the surface** (search · filters · partitions · the entire conversation list · both primary actions)
and the **body was a placeholder** — 1096×852, ~80% of the content region, holding a glyph, an `h1`
and a sentence. Measured consequences: the conversation row got 234px, of which the message preview
got **114px — 8.3% of the content region — clipping at 47% of its natural width** (`scrollWidth`
240); the root had **no header band and no footer band at all** (`conversationHeaderFor`/`FooterFor`
return `null` off a specific conversation), which is why every global control had collected in the
lane head; and below the shell's `max-width: 767px` rule — which REMOVES `.ui-middle-nav__lane`
(`middle-nav.css:168`) — the list, search, filters, all five toggles, every row kebab, Settings and
New message all measured `0×0`, leaving copy that read _"Select a conversation from the list"_
beside no list. (`/projects` fails identically; `/wallet` proves it is solvable in the same shell —
it keeps a 3435px body and both bands at 390px.) **Resolved by restoring the contract on the root**,
while the DETAIL route keeps the conversation list in the lane, which is genuine sibling navigation:
new **`InboxView`** (body — the list, and the only fetch owner), **`InboxHeader`** (header band —
identity · live count · search · id-based refinements), **`InboxFooter`** (footer band — New message
· Settings · density), **`InboxScopeLane`** (lane — partitions and relation facets as NAMED rows
with LIVE COUNTS, replacing five unlabelled icon toggles), resolved by `inbox-slots.tsx`
(`inboxHeaderFor`/`inboxFooterFor`/`messagesLaneFor`, mirroring the wallet slots). The preview track
went **114px → 577px at 1440** and shows 100% of its natural width at every size. Four regions are
four hydration roots, so they share **`inbox-state.ts`** (the board-footer↔body precedent) — but the
row layout uses **container queries**, not viewport media queries, because at exactly 768px the lane
is still shown and the content region is 424px, narrower than it is at 768px with the lane hidden;
guessing from the viewport produced a 36px preview track at that boundary. **Also fixed:** the
duplicated `Starred` control (same glyph, same label, 160px apart, different behaviour AND different
latency — one refetched, one was a client overlay); **six silently discarded errors**, three of
which rendered a failed fetch as an EMPTY result (`ContactPicker` → _"No matching contacts"_,
`PopoutChat` → _"No messages yet"_, and a failed create/save closing its modal as though it had
succeeded); `busy` reaching the DOM as `aria-busy` and nothing else (`lane.css` had zero matching
rules, so a refine was invisible to sighted viewers); the missing not-found guard on
`[conversationId]/files.tsx` that its two sibling tabs both had; `hasMore`/`nextCursor` never being
read, so a truncated inbox was silently truncated; the message column and the composer resolving
**two different measures** (feed uncapped, composer `56rem` — the field sat 130px inside the column
and 125px short of where own bubbles land) now unified on one **`--chat-measure`** token; the filter
chip whose selected state differed by a **1.003:1 luminance ratio** while DROPPING its label
contrast from 7.14:1 to 4.36:1; the footer band pinning to `inset-block-end: 0` on mobile, which is
exactly where the fixed `.ui-bottom-nav` sits (measured: identical 390×56 rects); the `.msg-btn`
family that reimplemented `Button` and shipped the surface's only raw hex; **33 font sizes, 11
weights and 22 icon px** migrated to `--text-*`/`--fw-*`/ `--icon-*` (three sizes — `0.9rem`,
`0.95rem`, `1.25rem` — were off-ramp entirely); two focus vocabularies collapsed to the canonical
`--focus-ring-shadow` with eleven controls that had NO focus rule gaining one; sub-24px hit targets
raised; the auto-response three-level box-in-box flattened; the empty state's `min-block-size: 60vh`
(sized against the VIEWPORT, not its region); and four class hooks applied in TSX with no rule
anywhere in the repo. **Two bugs of one class found in the new code during verification and worth
remembering: `inboxAll.value.length === 0` was used both as "not seeded yet" and as a seed guard, so
a search matching nothing re-seeded the SSR list and rendered the full inbox back; and the header
inferred "not loaded" from the same emptiness and printed the SSR count above an empty list. Empty
is a real value — only an explicit `inboxSeeded` flag may gate a seed.** Verified in-browser at 1440
/ 1024 / 900 / 768 / 390, LTR and RTL (zero horizontal overflow in both directions at every width),
with the scope/search/filter/density/empty/clear paths exercised end-to-end; detector clean;
typecheck + fmt clean. **NOT verified in this environment (stated, not claimed): `:focus-visible`
rendering** — the preview pane never takes real keyboard focus, so the rules are confirmed present
and using the composite token by source audit only. No DB/lifecycle change (still a read projection
over fixtures) → no `documentation/database/*` or `PRODUCT_MANAGEMENT.md` change; no new
`@projective/ui` primitive → no `DESIGN_SYSTEM.md` §C.1 change (the two package edits are
behavioural fixes to existing components: a visible `aria-busy` state on `LaneList`, and the mobile
footer-band offset). **Flagged (surface, do not silently resolve):** (a) `/projects` has the SAME
mobile failure — its root body still reads _"Pick a project from the list on the left"_ with the
lane removed — and was deliberately left out of this pass; (b) the mobile row drops the
hover-revealed kebab entirely (there is no hover on touch), so Favourite/Archive/Delete are
reachable only from inside a conversation on a phone — a long-press or swipe affordance is the real
answer and is deferred. | `DESIGN_SYSTEM.md` Part D / §B.4 / §B.6 · `apps/web/features/messaging/**`
· `apps/web/routes/(dashboard)/messages/**` · `apps/web/routes/(dashboard)/_layout.tsx` ·
`packages/ui/navigation/styles/{lane,middle-nav}.css` ·
`apps/web/features/projects/styles/{chat-feed,chat-composer}.css` · `apps/web/utils/storage-keys.ts`
· `.impeccable/critique/2026-07-31T12-00-00Z__messaging-layout.md` · Decisions #49 / #50 / #52 / #60
|
