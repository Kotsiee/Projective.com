# Architectural Decisions & Clarifications: Redundancy and Caching Audit (2026-10-29)

> **Evaluation, not binding.** This is the companion to
> [`PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md`](PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md).
> It lists every question the audit cannot settle without founder or lead-architect sign-off:
>
> - contradictions between the docs and the shipped code;
> - the boundary between database triggers and application-layer caching;
> - the trade-off between memory footprint (per-isolate memory, Deno KV) and Supabase read pressure.
>
> Each question gives 2–3 options with pros and cons, and closes with one recommendation. Finding
> IDs (`U-`, `L-`, `D-`, `G-`) refer to the audit. Recorded as **Decision #341**: flags (a)–(q) map
> 1:1 to Q1–Q17, all **OPEN**.
>
> The audit does **not** re-open questions that sibling audits of the same day already own:
>
> | Question                                  | Owned by              |
> | :---------------------------------------- | :-------------------- |
> | "Fee adjusted by Standing"                | #337 X4               |
> | MoneyView exclusivity on finance surfaces | #337 N10              |
> | Who may drag a claimed ticket             | #293 (b) and #338 X11 |
>
> Where a question here touches one of these, it says so.

---

## Summary: the sign-off sheet

| Q   | Question                                             | Recommendation                                                                      | Unblocks                     |
| :-- | :--------------------------------------------------- | :---------------------------------------------------------------------------------- | :--------------------------- |
| Q1  | Hard numbers that drift in the root `CLAUDE.md`      | **B.** Replace counts with pointers; the fee wording follows #337                   | Doc hygiene                  |
| Q2  | SA §Caching Strategy vs the shipped cache            | **A.** Rewrite it to the four real tiers and replace the `withCache` sample         | DB-10, every cache item      |
| Q3  | No visible focus indicator vs WCAG 2.4.7 (AA)        | **A.** A keyboard-only `:focus-visible` ring app-wide, plus forced-colors           | U-27, F.1                    |
| Q4  | Scope of §B.4.2's "solid active state"               | **B.** Ban brand washes everywhere; formalise the neutral `--tint` step             | U-25, SC-8                   |
| Q5  | §F.5 split-pane carve-out (its list is stale)        | **A.** Ratify "one device, no shadow" and refresh the list                          | —                            |
| Q6  | Is `Card` the canonical primitive or a reference?    | **B.** The token contract plus a lint gate; `Card` stays as the reference           | U-01, U-21, SC-6, SC-11      |
| Q7  | Cache invalidation: TTL vs DB triggers vs notify     | **B.** KV version keys bumped by the fat-service writer; TTL as the backstop        | D-14, D-22, DB-4, DB-8       |
| Q8  | Inbox read model                                     | **A now, B next schema window.** An RPC, then trigger-maintained summary columns    | D-04, D-05, DB-3             |
| Q9  | The JWT `active_context` as a read model             | **A.** Claims drive presentation only; refresh the session after a preference write | D-07, D-10, D-11, DB-5       |
| Q10 | Coalescing in `ArcCache`                             | **C.** A per-request memo **and** single-flight in `through()`                      | D-06, D-23, SC-9             |
| Q11 | Tiering policy: memory vs KV vs Postgres             | **B + C.** Memory-first; KV only for small global data; aggregate in SQL            | D-12, D-24, DB-7             |
| Q12 | Catalogue loading model                              | **C.** In-memory now with a keyset loader; switch to per-query search past a budget | D-09, D-14, DB-4             |
| Q13 | Wallet read model                                    | **C.** Memoise the context now, then SQL aggregates                                 | D-01–D-03, DB-1, DB-2        |
| Q14 | Client mirrors vs server capability flags            | **A for pure rules, B for state-dependent ones**                                    | L-03, L-06, L-08, L-20, SC-4 |
| Q15 | Platform constants on product and marketing surfaces | **A for product (DTO), B for landing (parity test)**                                | L-15, L-19                   |
| Q16 | When may money be a string?                          | **A + C.** `MoneyView` for every visible figure; lint `formatMoney`                 | L-11, L-13, SC-5             |
| Q17 | The unused, non-compliant `Overlay` export           | **B.** Delete it and extract a `useAppModal()` composite hook                       | G-1, SC-10                   |

---

## Part A: discrepancies between document rules and the implementation

### Q1. Hard numbers that drift in the root `CLAUDE.md`

**Evidence.**

- **Decision count:** root `CLAUDE.md` §8 says "135 logged decisions". The index
  (`reference/decisions/README.md`) now runs to #338.
- **Fee wording:** the persona table, row 3, calls the stage-completion fee "5% base … adjusted by
  Standing". `finance-model.md` §16.4 says the fee "does **not** taper with Standing". The code
  agrees with finance-model: `finance.fn_effective_platform_fee_bp` reads only `negotiated_rates`,
  then `platform_fee_bp`. That half is already open as **#337 X4**.

**Options.**

| Option                                                                                                                          | Pros                         | Cons                                                                                                                                                  |
| :------------------------------------------------------------------------------------------------------------------------------ | :--------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** Keep the counts and update them with every decision                                                                      | Gives a quick sense of scale | Many sessions write decisions in parallel, so it drifts again within a day. A stale number in a merge-gate file erodes trust in the rest of the file. |
| **B.** Remove hard counts from guardrail files and point to the index. Fix the fee wording in the same change as #337's ruling. | Cannot drift. One source.    | Loses the at-a-glance count.                                                                                                                          |
| **C.** Leave as is                                                                                                              | No work                      | Every new agent reads a wrong number and a wrong fee rule from the highest-precedence file it loads                                                   |

**Recommendation: B.** Guardrail files should hold rules, not inventory. The fee sentence is a
business rule in a file every agent reads first, so it must be corrected the moment #337 X4 is
ruled. Until then, an agent should treat `finance-model.md` §16.4 as authoritative (source
hierarchy, row 1).

### Q2. SA §Caching Strategy vs the shipped cache

**Evidence.** The `withCache` sample (`SYSTEM_ARCHITECTURE.md` §Caching Strategy, "Implementation
Patterns") has **no implementation**, and it would be unsafe if copied:

1. It calls `Deno.openKv()` on every call. The code memoises one handle and degrades to `null`
   (`core/kv.ts`).
2. `if (cached.value)` treats `0`, `""`, `false` and `null` as misses, so a "not found" answer can
   never be cached.
3. Its key has **no tenant**. That invites caching an RLS-scoped read under a global key, which is
   exactly the cross-tenant disclosure `core/cache.ts` makes impossible by type.
4. It has no memory tier and no single-flight, and it awaits `kv.set` on the request path.
5. It ignores Deno KV's 64 KiB value limit. The catalogue and profile payloads exceed it.

The prose also describes behaviour the code does not have:

- **Project metadata:** the doc says it is cached "5 minutes in KV". In the code it is a
  per-isolate, tenant-keyed `ArcCache` for 30 s, and never KV.
- **Stale-while-revalidate:** the doc says the server uses SWR. Nothing on the server does; the
  catalogue blocks when its TTL expires.
- **Static metadata:** "roles, enums, platform config" are cached according to the doc. None is
  cached.
- **pgvector results:** said to live in KV. Only query **vectors** are in KV; neighbours sit in a 60
  s per-isolate LRU.
- **Profile-view counters:** said to use `kv.atomic()`. The code uses the `search.record_view`
  definer.

`core/cache.ts` also contradicts itself:

- **Expiry:** the comment at `:302` says an expired entry is "demoted to its ghost list", but
  `#expire` deletes it.
- **Coalescing:** the rationale at `:428-431` against coalescing does not hold, because keys are
  tenant-prefixed (see Q10).

**Options.**

| Option                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pros                                                                                                         | Cons                                                                        |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| **A.** Rewrite the section to the shipped model: **request memo → `ArcCache` (per isolate, tenant-scoped, size- and TTL-bounded) → Deno KV (global, small, cross-isolate) → Postgres**. State the tenant rule, single-flight, "TTL is the guarantee, invalidation the optimisation", and the 64 KiB limit. Replace the sample with a real `cachedGlobal(key, ttlMs, fetch)` on `openSharedKv`, which never takes a tenant-scoped value. | The binding doc matches the code. The unsafe sample can no longer be copied. Agents get one correct pattern. | It is an SA amendment and needs sign-off. A small helper has to be written. |
| **B.** Implement `withCache` as documented                                                                                                                                                                                                                                                                                                                                                                                              | Doc and code agree with minimal doc churn                                                                    | It ships the five defects above, including a cross-tenant leak path         |
| **C.** Delete the sample and keep the prose                                                                                                                                                                                                                                                                                                                                                                                             | Removes the trap                                                                                             | Leaves a vacuum and misleading prose. The next agent reinvents the helper.  |

**Recommendation: A.** SA is the binding technical authority, so a sample in it reads as a mandate.
A mandate that leaks across tenants is worse than no mandate.

### Q3. No visible focus indicator vs accessibility (WCAG 2.4.7, Level AA)

**Evidence.**

- **The neutralisation:** `apps/web/styles/global.css` ("NO VISIBLE FOCUS INDICATOR", commit
  152a27a) sets every `--focus-ring-*` token to transparent with `!important`, and neutralises
  element-level `:focus`, `:focus-visible` and `:focus-within`. This is the owner's directive.
- **Scoped exceptions:** overlays (#171), discovery controls (#176). Landing chose no ring (#285).
- **Already ruled once:** the owner reaffirmed the directive on 2026-10-19 (**#245 (a)**: "the
  directive stands … nothing is restored").
- **Why re-raise it:** the citation correction and the commercial evidence below are new since that
  ruling.
- **What it contradicts:**
  - DS §A.7.3, the state contract;
  - the root guardrail §3 UI gate 2, "Accessibility";
  - DS §F.1, which is still open for forced-colors.
- **The cited criterion is wrong.** The code comment calls the regression "WCAG 2.2 SC 2.4.11 (Focus
  Appearance)". In WCAG 2.2, Focus Appearance is **2.4.13 (AAA)**. The criterion actually failed is
  **2.4.7 Focus Visible (Level AA)**. That is a conformance failure at the level that procurement
  and EU law reference, not an enhancement left out.

**Why it is commercial, not cosmetic.**

- **EU law:** EN 301 549, the technical standard behind the European Accessibility Act (in force for
  services since 28 June 2025), maps to WCAG AA. The EAA exempts service micro-enterprises, but it
  is likely to bite once Projective sells to EU consumers above that threshold.
- **Procurement:** the Business and Enterprise accounts the pitch depends on routinely ask for an
  accessibility conformance report.
- **Money paths:** a keyboard user cannot see which control holds focus on Fund, Approve or
  Withdraw.

**Options.**

| Option                                                                                                                                                                                                                                                                                                                         | Pros                                                                                                    | Cons                                                                                                             |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------- |
| **A.** Restore a **keyboard-only** ring app-wide. Use `:focus-visible` only, which browsers do not match on a mouse click for buttons and links, so pointer users still see no ring. Add `@media (forced-colors: active) { outline: 2px solid Highlight }`, which closes F.1. Fields keep their own `--fld-focus-glow` (#334). | AA conformance. Pointer users still see no ring. The comment documents a one-region revert. Closes F.1. | Reverses an owner directive. The 455 token consumers light up at once and need one visual QA pass.               |
| **B.** Keep the removal and grow scoped exceptions (#171/#176 style): commit buttons, forms, nav                                                                                                                                                                                                                               | Incremental. Keeps the clean look elsewhere.                                                            | Still non-conformant. The exception list sprawls. Focus behaviour becomes unpredictable from surface to surface. |
| **C.** Status quo                                                                                                                                                                                                                                                                                                              | No work                                                                                                 | Legal and procurement exposure, and keyboard users are effectively locked out of the money paths                 |

**Recommendation: A.** `:focus-visible` already gives the owner what they most plausibly objected
to, a ring on mouse click, without failing keyboard users. Correct the SC citation in `global.css`
in the same change.

### Q4. The scope of §B.4.2's "solid active state"

**Evidence.**

- **What §B.4.2 bans:** translucent active fills on a nav-rail item, a middle-nav row or a tag.
- **What it allows:** `color-mix` for "states" and "a hover tint over a known parent".
- **#330:** shipped a neutral `--tint` (12%) active fill on `NavItem`, `.proj-chan` and
  `.wsp-rail__item`, and logged it as an exception (flag a).
- **The drift:**
  - 27 feature and 30 package state rules still use alpha fills;
  - about 15 of the feature rules are `--primary` washes (U-25);
  - so are the selected options of 10 package components: listbox, menu, multiselect, cascadeselect,
    command palette, treetable, calendar month and mini, money-flow popover, gantt.

**Options.**

| Option                                                                                                                                                                                                                                                                      | Pros                                                                                                                                                                                                        | Cons                                                                                                                                 |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **A.** Strict: every selected or active row anywhere is solid `--surface-2`                                                                                                                                                                                                 | One measurable rule                                                                                                                                                                                         | Contradicts the shipped #330. A listbox already sits on a `--surface-2` popover and there is no `--surface-3`. A package-wide sweep. |
| **B.** Two clauses. (1) A **brand** wash (`--primary`/`--accent` over `transparent`) is banned on every state fill. (2) The **neutral `--tint` step over a known parent** is the sanctioned active fill everywhere: #330 (a) stops being an exception and becomes the rule. | Matches what shipped. Deterministic, because the parent tone is known and so the contrast is measurable. A small sweep: about 15 feature rules and 10 package rules swap their colour, not their structure. | The fill is still translucent, so contrast must be verified per parent tone once (light, dark and high contrast).                    |
| **C.** Keep the narrow ban and judge case by case                                                                                                                                                                                                                           | No work                                                                                                                                                                                                     | Drift continues; reviewers cannot apply it consistently                                                                              |

**Recommendation: B.** The rule's own rationale is that a fill must be measurable. A neutral step
over a known parent is measurable. A brand wash spends the hue on a state the brand makes no claim
about, and that is the part worth banning.

### Q5. The §F.5 split-pane carve-out, whose list is stale

**Evidence.**

- **Stale entry:** §F.5 lists attachment preview, ticket, project-create and submission review.
  Project-create (`ProjectCreateModal.tsx`) no longer uses a `Splitter`.
- **Missing entries:** the same pattern appears unlisted in `EventModal` (`.evm__side`),
  `SettingsModalBody` and `AssetPicker`.
- **Two devices:** `.tkv__side` and `.evm__side` use a tint **and** a hairline, two devices on one
  boundary (§B.9.3).
- **Fails anyway:** `.subm-review__aside` uses a translucent fill, which breaks §B.4.2 whatever F.5
  decides.

**Options.**

| Option                                                                                                                                                    | Pros                                                                                                                                | Cons                                                                                |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| **A.** Ratify: "A layout region inside an elevated panel may carry **one** tonal step **or** one hairline, never a shadow, never both". Refresh the list. | Enforceable. Matches the intent ("nested surface plus shadow" is the defect). Removes the ambiguity that blocks every modal review. | Two panes (`.tkv__side`, `.evm__side`) lose either the tint or the hairline         |
| **B.** Ban tinted panes: separation by spacing and one hairline only                                                                                      | The strictest anti-card reading                                                                                                     | Flattens genuinely two-pane workspaces, and the aside loses its "secondary" reading |
| **C.** Defer again                                                                                                                                        | —                                                                                                                                   | Four, now seven, modals stay in limbo                                               |

**Recommendation: A**, and fix `.subm-review__aside` to a solid tone in the same change.

### Q6. Is `Card` the canonical primitive, or a reference implementation?

**Evidence.**

- **Adoption:** `Card` (`@projective/ui/display`) has **0** consumers. There are 17 hand-rolled card
  families. About 8 read the `--card-*` tokens and 9 set their own geometry (U-21).
- **No lint safety net:** four **undefined** tokens shipped across 30 declarations with no failing
  check (U-01). Nothing in `deno task lint` validates custom properties.

**Options.**

| Option                                                                                                                                                                                                                                                                                                                            | Pros                                                                                        | Cons                                                                                                                                         |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** Migrate all 17 families to `Card` (compound slots)                                                                                                                                                                                                                                                                         | One implementation                                                                          | Large effort. The families have legitimate layout differences (media ratio, list-row cards, payment card), so `Card` risks growing 20 props. |
| **B.** **The contract is the tokens.** Any `*card*` block must read `--card-pad`, `--card-radius` and `--card-media-ratio*`. Add a lint gate for undefined custom properties and for literal radius, duration, shadow and state brand washes. Restate DS §B.9.6 as a token contract, with `Card` as the reference implementation. | Cheap and enforceable. Catches the U-01 class of silent bugs. Keeps the legitimate variety. | The ~17 CSS blocks remain, though tokenised                                                                                                  |
| **C.** Remove `Card` from the package                                                                                                                                                                                                                                                                                             | Honest about adoption                                                                       | Breaks copy-paste portability and loses the reference                                                                                        |

**Recommendation: B.** The lint gate is worth doing whatever is decided here. It is the only measure
in this audit that prevents a whole class of findings from recurring.

---

## Part B: database triggers vs application-layer caching

### Q7. Cache invalidation: TTL vs DB triggers vs notify

**Evidence.**

- **Where the caches live:** every server cache is per isolate except the KV ones (FX, embeddings).
- **How far invalidation reaches:** `invalidatePrefix` and `invalidateCatalog()` reach only the
  **writer's** isolate, and for messaging only the writer's tenant. Recipients see a stale inbox for
  up to 30 s (D-22). `FxService.invalidate()` has no caller.
- **The cost of the TTL:** the catalogue's 30 s TTL exists because nothing can invalidate it across
  isolates, and each expiry costs a ~20-request reload (D-14).

**Options.**

| Option                                                                                                                                                                                                                                                                                                                                                                                                                             | Pros                                                                                                                                                                                                                  | Cons                                                                                                                               |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| **A.** TTL only (status quo), tuned shorter                                                                                                                                                                                                                                                                                                                                                                                        | Simple and already shipped                                                                                                                                                                                            | Locks in the staleness-vs-read-pressure trade-off. A short TTL means frequent full reloads.                                        |
| **B.** **Version keys in Deno KV**, bumped by the fat-service writer after a successful write. Use one key per global domain (`["cache","v","catalogue"]`, `"fx"`, `"reference"`) and one per affected tenant for messaging (each participant's key, which the writer knows). Isolates compare the version at most once a second and drop stale entries. The TTL stays as the backstop for out-of-band writes (SQL console, cron). | Cross-isolate invalidation for one small KV write per mutation. Allows long TTLs (5–15 min) on the catalogue and reference data. No new Postgres objects. Fits "all writes go through fat services or definer doors". | Writes made outside the services are covered only by the TTL. Adds one throttled KV read per domain per isolate.                   |
| **C.** **Postgres triggers → `pg_notify` / Supabase Realtime** → per-isolate listeners that evict                                                                                                                                                                                                                                                                                                                                  | Catches every write, including out-of-band ones. Near-instant.                                                                                                                                                        | A long-lived listener per isolate, plus connection cost, reconnect logic and complexity. Realtime per tenant at scale costs money. |

**Recommendation: B.** It buys most of C's freshness for a fraction of the moving parts. Keep C in
reserve for a surface that needs sub-second freshness, such as live presence, which already has its
own channel.

### Q8. Inbox read model

**Evidence.**

- **N+1:** `live-queries.ts:542` makes one tail query per thread (D-04).
- **Single thread:** `fetchConversation` runs the full fan-out to read one thread (D-05).
- **The code's own advice:** its comment says a single `.in().limit()` window starves quiet threads,
  and it recommends trigger-maintained summary columns.

**Options.**

| Option                                                                                                                                                                                                        | Pros                                                                                                                         | Cons                                                                                                                                                                                                                             |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** A definer RPC, `comms.inbox_tails(p_thread_ids uuid[], p_k int)`, using `LATERAL (… ORDER BY created_at DESC LIMIT p_k)`                                                                               | One roundtrip and no schema change. Ships this week.                                                                         | Still reads every thread to sort the inbox. The inbox itself is not keyset-paginated.                                                                                                                                            |
| **B.** **Additive** columns `dm_threads.last_message_at`, `last_message_id` and `message_count`, maintained by an `AFTER INSERT` trigger on `comms.dm_messages`, with an index on `(…, last_message_at DESC)` | The inbox becomes one indexed, keyset-paginated read. The trigger is the natural hook for Q7's per-participant version bump. | A schema change. It needs approval, the Zod schema and `documentation/database/comms/` in the same change (§1), and the migration edited in place. One extra `UPDATE` per message, with hot-row contention on very busy threads. |
| **C.** A materialised view refreshed on a schedule                                                                                                                                                            | No trigger                                                                                                                   | Stale between refreshes; refresh cost grows with the table                                                                                                                                                                       |

**Recommendation: A now, B in the next schema window.** B is additive, so it never drops or alters
existing columns, and it removes the N+1 by construction.

### Q9. The JWT `active_context` as a read model

**Evidence.**

- **What the hook stamps:** `custom_access_token_hook` (00001700) already stamps type, id, role,
  handle, `isClient`/`isFreelancer`/`isOperator`, `onboarded`, `isRestricted`,
  `belongsToTeam`/`belongsToBusiness`, `businessHeadroom`, `displayCurrency`, `locale` and
  `dateFormat`. The token itself also carries `email` and `user_metadata`.
- **What every hydration still reads:**
  - preferences (twice);
  - the identity, through a GoTrue HTTP call;
  - the handle.
- **The precedent:** `currency-context.ts` already trusts the claim first.

**Options.**

| Option                                                                                                                                                                                                                                                                                                                   | Pros                                                                                      | Cons                                                                                                                     |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| **A.** **Claims drive presentation and chrome**: identity display, currency, locale, date format, handle, and (added) `layout_direction` and timezone. **Never** a write, a money decision or an authorisation, where RLS stays the gate. After `PATCH /api/user/preferences`, refresh the session so the claim updates. | −1 HTTP and −3 reads per hydration. Consistent with the currency model. RLS is untouched. | The JWT grows slightly, which matters for cookie size. A change made on another device shows only after a token refresh. |
| **B.** Also trust role and capability claims for server-side decisions                                                                                                                                                                                                                                                   | Fewer reads                                                                               | A stale role after removal from a team grants access until refresh. This is unacceptable on vault and spend paths.       |
| **C.** Status quo DB reads                                                                                                                                                                                                                                                                                               | Always fresh                                                                              | The per-page tax (D-07, D-08)                                                                                            |

**Recommendation: A.** The hook is already the invalidation boundary for preferences, so a session
refresh after the write is all the "cache invalidation" that is needed.

### Q10. Coalescing in `ArcCache`

**Evidence.**

- **No coalescing:** `ArcCache.through` does not coalesce concurrent misses
  (`core/cache.ts:428-440`).
- **The rationale's flaw:** the comment says shared failures could reach callers "whose RLS scope
  would have succeeded". But keys are tenant-prefixed by type, so one key means one RLS scope.
- **Precedent:** `PublicMetricsService` already coalesces safely.
- **Duplicated workaround:** six copies of a per-request memo exist (D-23).

**Options.**

| Option                                                                                                                                      | Pros                                                                                              | Cons                                                                                                 |
| :------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------- |
| **A.** Single-flight inside `through()`: an in-flight map under the same key; a rejection is shared only by that flight and is never cached | Removes duplicate concurrent reads across requests (double submits, parallel API calls, prefetch) | Does nothing for the layout and slot fan-out inside one request when the TTL is 0 or the key differs |
| **B.** Only a shared request memo (`apps/web/utils/request-memo.ts`), replacing the six copies                                              | Dedupes within one request (D-06's three slots)                                                   | Misses duplicates across concurrent requests                                                         |
| **C.** **Both**                                                                                                                             | Each solves a different duplication                                                               | Two small mechanisms to document                                                                     |

**Recommendation: C.** Correct both misleading comments in `cache.ts` in the same change.

---

## Part C: memory footprint (Deno KV and isolates) vs Supabase read pressure

### Q11. Tiering policy: which data lives where

**Evidence.**

- **Memory:** two `ArcCache` instances of 512 entries per isolate. The public catalogue is held
  whole per isolate, including article bodies today (D-09), so memory grows linearly with the
  marketplace.
- **KV:** values are capped at 64 KiB, and each read is a network hop.
- **Uncached reference data:** plans, `platform_params`, `standing_*` and skills (D-24, D-18).
- **Postgres:** read pressure is dominated by the duplicate fan-outs (D-01, D-04), not by missing
  caches.

**Options.**

| Option                                                                                                                                                                                                                | Pros                                                                         | Cons                                                                                                                                                      |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** **KV-first**, as SA's prose implies: everything cacheable goes to KV                                                                                                                                           | Cross-isolate hit rate; survives cold starts                                 | Per-request KV latency and cost. The 64 KiB limit rules out the large payloads. Tenant-scoped data is multiplied by tenants. Invalidation still needs Q7. |
| **B.** **Memory-first; KV only for small, global, expensive values:** request memo → `ArcCache` (tenant or anonymous tenant, bounded) → KV for FX tables, embeddings, version keys and rate-limit counters → Postgres | Matches the shipped code. Lowest latency. Memory is bounded by construction. | Cold isolates start empty, and the hit rate splits across isolates                                                                                        |
| **C.** **Fetch less instead of caching more:** SQL aggregates, slim projections and summary columns, so the cached payloads shrink                                                                                    | Cuts payload size, JS CPU and memory together                                | Function and possibly schema work                                                                                                                         |

**Recommendation: B + C**, with this placement table written into SA (Q2):

| Data class                                                                      | Tier                         | TTL          | Key scope                                                                | Invalidation                               |
| :------------------------------------------------------------------------------ | :--------------------------- | :----------- | :----------------------------------------------------------------------- | :----------------------------------------- |
| Per-request fan-out (layout and slots)                                          | Request memo                 | 1 request    | Request                                                                  | —                                          |
| Viewer-scoped reads (projects, messaging, wallet)                               | `ArcCache`                   | 30 s         | Tenant (user + context)                                                  | `invalidatePrefix` + Q7 per-tenant version |
| Public read models (catalogue projection, anonymous profile view, similar rail) | `ArcCache`, anonymous tenant | 5–15 min     | Anonymous tenant                                                         | Q7 global version                          |
| Reference data (plans, `platform_params`, `standing_*`, skills)                 | Module memo                  | 1 h          | Global, only if RLS does not vary by viewer (**verify per table first**) | Q7 global version                          |
| FX tables, query embeddings                                                     | Memory → KV                  | 15 min / 7 d | Global                                                                   | Q7 `fx` version                            |
| Aggregates (wallet flow, inbox order)                                           | **Postgres**, not a cache    | —            | —                                                                        | Always fresh                               |

Also add a memory budget for the in-isolate catalogue: drop `body`, and alert when the projection
passes the budget (see Q12).

### Q12. Catalogue loading model

**Evidence.**

- **Unbounded loading:** `live-catalog.ts` loads every public profile, listing, project, article and
  skill into each isolate.
- **Silent truncation:** each read is unbounded except for PostgREST's silent `max_rows = 1000` cap.
- **Cost of expiry:** each 30 s expiry blocks one request on a ~20-request reload.

**Options.**

| Option                                                                                                                                                                     | Pros                                                                              | Cons                                                                                     |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| **A.** Keep the in-memory catalogue but load it correctly: keyset loops or definer RPCs, a slim projection (no `body`), SWR, Q7 version invalidation and a 5–15 min TTL    | Fixes truncation. Keeps the instant in-memory ranking and facets. A small change. | Memory still grows with the marketplace                                                  |
| **B.** Query `search.*` per request: HNSW for semantic, btree or trigram for filters, keyset pages; cache only first pages per normalised query under the anonymous tenant | Scales without bound. Memory stays flat.                                          | More Postgres read pressure, and the in-memory facet and ranking code must move into SQL |
| **C.** **A now, with a defined switch to B** once the projection passes a measured budget (heap size or entity count)                                                      | The right cost at each stage of growth                                            | Requires measuring the heap and naming the threshold                                     |

**Recommendation: C.** Treat D-09 as P0 regardless, because silent truncation is a correctness bug,
not a performance one.

### Q13. Wallet read model

**Evidence.**

- **Context resolution:** one `/wallet` render resolves the wallet context seven times: 36+
  identical reads, plus a repeated `overviewOf` (D-01, D-02).
- **JS folds:** `overviewOf`, `activityOf` and `payoutsOf` fold up to 1,000 ledger rows each in JS
  (D-03).
- **To verify:** if any displayed figure is derived from that window rather than from a balance
  column or an SQL aggregate, it becomes **wrong** for accounts with more than 1,000 transactions.

**Options.**

| Option                                                                                       | Pros                                              | Cons                                                  |
| :------------------------------------------------------------------------------------------- | :------------------------------------------------ | :---------------------------------------------------- |
| **A.** Memoise the context per request (`home()`) and keep the JS folds                      | S effort; removes about 40 duplicate reads        | Keeps the window-truncation risk and the JS CPU cost  |
| **B.** SQL aggregates (`finance.ledger_flow` and summary RPCs) replace the 1,000-row windows | Correct at any history length. Smallest payloads. | M effort. Function edits in place, plus Zod and docs. |
| **C.** **A then B**, sequenced                                                               | Takes the immediate win, then the correctness fix | Two changes                                           |

**Recommendation: C.** Run the verification above before A ships. If a figure **is** window-derived,
B becomes P0.

---

## Part D: who owns the shared rules

### Q14. Client mirrors vs server-computed capability flags

**Evidence.**

- **Ticket moves:** the board island re-derives move permission more loosely than
  `fn_assert_ticket_move` (L-03; open as #293 (b) and #338 X11).
- **Claimability:** `claimableOf` re-checks the $W_i$ cap (L-06).
- **Funding:** the funding rollup and the "wallet covers" check are recomputed on the client (L-08,
  L-20).

**Options.**

| Option                                                                                                           | Pros                                                                            | Cons                                                               |
| :--------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ | :----------------------------------------------------------------- |
| **A.** A pure TS mirror in `@projective/types`, with a parity test that runs the same matrix against a SQL probe | Instant UI feedback with no roundtrip. Drift is caught in CI.                   | Only works for **pure** rules (status × role → allowed)            |
| **B.** Server-computed flags on the DTO (`canMove`, `claimable`, `walletCovers`, the funding rollup)             | Always agrees with the server, including state-dependent rules (caps, balances) | Optimistic UI needs a refetch after each mutation                  |
| **C.** A permissive client with server rejection (the status quo for moves)                                      | No work                                                                         | A user drags, then gets bounced. On money paths that erodes trust. |

**Recommendation: A for pure transition rules** (the move matrix), **B for state-dependent ones**
(caps, balances, rollups). C is never acceptable on a money path.

### Q15. Platform constants on product and marketing surfaces

**Evidence.**

- **The 7-day window:** `pending_release_days = 7` is correct (#191) but reaches no DTO. It appears
  as a literal in about 15 places, in the wallet and on the landing (L-15).
- **Landing demos:** they restate the fair-exit tiers and the team split (L-19).

**Options.**

| Option                                                                                                                                                        | Pros                                               | Cons                                                                                  |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------- | :------------------------------------------------------------------------------------ |
| **A.** Serve platform parameters at runtime: on the wallet DTO for product surfaces, and through `PublicMetricsService` (1 h, anonymous tenant) for marketing | One source; a parameter change shows up everywhere | Adds a runtime dependency to the landing, whose performance budget is strict (#280)   |
| **B.** Keep the literals, with a unit test asserting each one equals the seeded value (`00005001`) or `FairExitTier`                                          | Zero runtime cost. CI catches drift.               | A parameter change needs a code change, though the test makes that impossible to miss |
| **C.** Status quo                                                                                                                                             | —                                                  | Silent drift the day the window changes                                               |

**Recommendation: A for product surfaces, B for the landing.** The wallet must show the rule that
will actually be applied. A marketing page only needs to never be wrong, and a parity test
guarantees that more cheaply.

### Q16. When may money be a string?

**Evidence.**

- **Formatter use:** there are 28 `formatMoney(` calls in 16 non-landing files (L-13).
- **Hand-rolled cases:** `PolicyAmount` splits the server string by hand, and the explore filters
  hard-code `$` (L-11).
- **`formatTicketMoney`:** it ignores currency altogether (L-01).
- **Overlap:** the finance audit's **#337 N10** covers the finance surfaces.

**Options.**

| Option                                                                                                                                                                                                     | Pros                                                                | Cons                                                              |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------ | :---------------------------------------------------------------- |
| **A.** Every **visible** figure uses `MoneyView`. Strings are allowed only for `aria-label`, sentence copy (notifications, emails) and commit-button labels in the **charge** currency. Codify this in DS. | One renderer, live re-projection and `data-money` sweeps everywhere | A migration of about 30 call sites                                |
| **B.** Allow strings anywhere in the charge currency                                                                                                                                                       | Less work                                                           | No re-projection on a currency switch. This is how L-01 happened. |
| **C.** Enforce A with a lint rule: `formatMoney`/`Intl.NumberFormat` banned in `apps/web/**` outside an allowlist                                                                                          | Prevents regression                                                 | A small lint addition                                             |

**Recommendation: A + C.**

### Q17. The unused, non-compliant `Overlay` export

**Evidence.**

- **The export:** `@projective/ui/overlay` exports `Overlay`, which composes Portal, Backdrop, trap,
  dismiss and z-stack. It renders through `Portal`, not `BodyPortal`, which fails §B.10.4, and it
  has **0** consumers.
- **The duplication:** the 10 app modals each hand-assemble the same six hooks (G-1).

**Options.**

| Option                                                                                                                                                                                        | Pros                                                                                         | Cons                                                                             |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| **A.** Fix `Overlay` onto `BodyPortal`, promote it as the app-modal shell and migrate the 10 modals                                                                                           | Maximum de-duplication                                                                       | L effort. A component shell must stretch across 10 different layouts.            |
| **B.** **Delete `Overlay`** (unused and non-compliant, so a trap for the next agent) and extract the six-hook assembly into one `useAppModal()` composite hook in `packages/ui/overlay/hooks` | Removes the trap. Most of A's de-duplication at S–M effort. Each modal keeps its own layout. | A breaking removal for a copy-paste-portable package, though with zero consumers |
| **C.** Status quo                                                                                                                                                                             | —                                                                                            | The trap stays, and so does the six-hook duplication                             |

**Recommendation: B.** Update the DS §C.1 roster in the same change (guardrail §3 gate 5).

---

## Decision #341: what is logged

Logged as **#341**, _Redundancy, `@projective/ui` adoption and read-path optimisation audit_
(2026-10-29), in
[`../reference/decisions/decisions-122-126.md`](../reference/decisions/decisions-122-126.md), with
its index line. FLAGS (a)–(q) = Q1–Q17, all **OPEN**.

- **New doc contradictions under §8:** two.
  - **(b)** The SA caching section contradicts `core/cache.ts`'s tenant rule and the shipped tiers.
  - **(e)** §F.5's list no longer matches the code.
- **A re-raise:** **(c)** re-raises #245 (a), the no-focus directive. It brings the corrected
  criterion: 2.4.7, AA, not 2.4.11/2.4.13. It also brings EAA and procurement exposure that the
  earlier ruling did not weigh.
- **The rest** are rulings on implementation direction.
