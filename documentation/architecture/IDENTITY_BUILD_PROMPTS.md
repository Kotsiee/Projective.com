# Identity Build Prompts — Claude Code Work Orders for Identity, Privacy & Workspaces

> **Status: WORK ORDERS, not binding.** A sequenced series of self-contained Claude Code prompts for
> track I of `FOUNDER_QUESTIONNAIRE.md` Part B §B.3: the identity, privacy and workspace rulings of
> Decision #336 (I1–I4, S7, Q0.2 (b) and (c)) and the findings they settle in
> [`IDENTITY_AND_WORKSPACES_AUDIT.md`](IDENTITY_AND_WORKSPACES_AUDIT.md) (`IW-*`) and
> [`IDENTITY_DECISIONS_AND_GAPS.md`](IDENTITY_DECISIONS_AND_GAPS.md) (`K*`, `F*`), plus SEC G16 from
> [`SECURITY_MODERATION_AND_AI_GAPS.md`](SECURITY_MODERATION_AND_AI_GAPS.md). Every prompt cites its
> evidence by finding ID and its ruling as `(Decision #336, ruling X)`. Paste each prompt into its
> **own fresh session**, after the standard header (§1). Written 2026-10-30 against `main` @
> `94d22e84`.
>
> **How to run them:** in the §0 order. A prompt marked **🧑 DECISION** stops and puts the named
> question to a human before it changes behaviour, with options and a recommendation. ⚖️ marks a
> ruling that stands pending counsel: build it behind a dial or a flag that stays off, and never
> switch it on. **Migrations are edited in place** (root `CLAUDE.md` §1); every prompt names the
> category file it edits.
>
> **Verified against git (2026-10-30), not taken from the brief:**
>
> - **Done.** IW-C1's column half and IW-H1 (`660c9658`). IW-H3, IW-M1/K10, IW-M2, IW-M3 and IW-H8
>   (`12a80862`). IW-H7, IW-M6 (RLS on, nothing dropped), IW-M8, IW-H4/IW-M4/K6, IW-L1, IW-L2, the
>   `teams.visibility` CHECK, and `org.fn_is_minor` failing closed (`81a108f0`). IW-M9 (`4c9482a2`).
>   IW-D1–D5 (`e30b4111`). The probe runner, `deno task test:probes` (`f9c4fc31`).
> - **Half done.** IW-M10: `ck_enterprise_member_status` landed, but `enterprise_members.user_id` is
>   still `ON DELETE CASCADE` (`00000011:980`); HK1 finishes it.
> - **Consequence of Wave 0.** `public.create_enterprise` seats a profile-less owner, so
>   `trg_workspace_member_adult` refuses the seat `PM403`: **enterprise sign-up is refused today**
>   until OWN1 and OWN2 land.
> - **Still open, and verified open.**
>   - `fn_erase_account` is unchanged (`00001060:555-582`), and both erasure windows are hard-coded
>     (`:434`, `:490`).
>   - The two dead `security` tables and all seven finance cascades are still there.
>   - TOTP is off (`supabase/config.toml:343-361`), and `SsoPanel` still renders
>     (`LoginForm.island.tsx:58`, `SignInPrompt.island.tsx:98`).
>   - `fn_team_archive_blockers` checks `escrow_held` and `live_assignments` only.
>   - The `users_public` row policy is unchanged (`00002010:10-13`).
>   - `resolveOnboardingBounce` skips enterprise owners (`auth-routing.ts:136-143`).
>   - No flag exists for the minors proxy.

---

## 0. Run order & dependencies

### 0.1 Run order

| Phase                         | Prompts                   | Lane                   | Why this order                                                                                                                                                      |
| :---------------------------- | :------------------------ | :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1 — The owner is a person** | OWN1 → OWN2               | SQL, then app          | Part C and #336: F4 first. It restores enterprise sign-up, and every later rule here (erasure, MFA, minors) assumes every natural person has a profile.             |
| **2 — Approved hygiene**      | HK1                       | SQL                    | Q0.2 (b) and (c): small, owner-approved, on files the erasure chain does not touch.                                                                                 |
| **3 — The erasure chain**     | ERA1 → ERA2 → ERA3 → ERA4 | SQL                    | Serial on `00001060`: scope, then windows, then seats, then the vault, which captures the identity set before ERA1's erasure blanks it. ERA3 and ERA4 stop at a 🧑. |
| **4 — SSO hidden**            | SSO1                      | app                    | No SQL, so it may overlap phase 3.                                                                                                                                  |
| **5 — Archive**               | ARC1                      | SQL                    | After ERA3 (`00001020`).                                                                                                                                            |
| **6 — MFA and the guard**     | MFA1 → MFA2 → MFA3        | app · SQL+app · SQL    | MFA1 may start any time (🧑 recovery). MFA2 follows ARC1 and ERA4 (`00001020`, `00001060`). MFA3 runs inside the F·DB phase.                                        |
| **7 — Minors**                | MIN1; MIN2                | app (+1 SQL step); SQL | MIN1 any time, its dispatch half ⏳ M. MIN2 after MFA2 (`00001020`), ⚖️ off, 🧑 for teams.                                                                          |
| **8 — Last**                  | RLS1                      | SQL                    | It breaks every invoker reader of other people's names, so every other track's readers move first.                                                                  |
| **Any time**                  | LOW1                      | app                    | The remaining Low findings.                                                                                                                                         |
| **Roadmap**                   | X1, X2                    | docs                   | Not buildable yet; each stops at a 🧑.                                                                                                                              |
| **Last**                      | Z1                        | docs                   | Docs sweep and the audit status columns.                                                                                                                            |

- **Part B names.** §B.3's steps map onto this file as:
  - F4 = OWN1 + OWN2;
  - the erasure chain = ERA1 → ERA4;
  - the F6 SSO-panel flag = SSO1;
  - IW-M5 = ARC1;
  - MFA + session guard = MFA1 → MFA3;
  - IW-M13 = RLS1.
  - Not in §B.3: HK1, MIN1, MIN2, LOW1, X1 and X2.
- **One identity SQL session at a time.** The SQL chain (OWN1 → HK1 → ERA1 → ERA2 → ERA3 → ERA4 →
  ARC1 → MFA2 → MIN2 → RLS1) is serial, so the track holds at most one of the two shared-DB slots
  (§B.0 rule 1). App-lane prompts (OWN2, SSO1, MFA1, MIN1's app half, LOW1) run beside it.

### 0.2 May not run in parallel (same files)

- OWN1 / OWN2 / SSO1: `AuthBackendService.ts`, `features/auth/`.
- OWN1 / MIN2: `00001010`.
- HK1 / ERA4: `00000012`, `00002001`, `00004002`.
- ERA1 → ERA2 → ERA3 → ERA4 → MFA2: `00001060`, serial.
- ERA3 / ARC1 / MFA2 / MIN2: `00001020`.
- ERA2 / ERA4: `00005060`, `features/legal/core/content/privacy.ts`.
- ERA1 / ERA2 / ERA3 / MFA2: `AccountLifecycleBackendService.ts` and the Settings account blocks
  (`features/settings/components/sections/account/`).
- SSO1 / MFA1 / MIN1: `features/devtools/` + `apps/web/utils/dev-seam.ts`.
- MFA1 / MIN1: `features/settings/core/settings-registry.ts`.
- Every prompt that edits `00002510` (OWN1 if a signature changes, ERA1, ERA2, ERA4, MFA2, MFA3,
  MIN2): one at a time, across **all** tracks.

### 0.3 Cross-track conflicts (§B.0 hot files)

| Hot file                             | Identity prompts                                                | Other writers (§B.0)                              | Rule                                                                                                                                        |
| :----------------------------------- | :-------------------------------------------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------ |
| `00001240` (finance money)           | MFA3 (`finance.begin_payout`)                                   | FBP DB1–DB8, PM-WP4                               | MFA3 runs only in a slot of F's serial chain that the coordinator hands it.                                                                 |
| `00005060` (jobs)                    | ERA2 (one row), ERA4 (one or two rows)                          | finance, comms, PM, scheduling, security          | One writer at a time. Use the `to_regproc` dormant-row guard jobs-sql uses. `search-query-log-retention` is already seeded: no edit.        |
| `00001155` (sessions)                | —                                                               | every SCH work package                            | No identity prompt touches it.                                                                                                              |
| `00001020` (workspaces)              | ERA3, ARC1, MFA2, MIN2                                          | SA G4 = F's payout gate (M4); also F·splits (M10) | Never at the same time as F's payout-gate or splits prompt.                                                                                 |
| `00001060` (erasure)                 | ERA1–ERA4, MFA2                                                 | SEC G16                                           | G16 is folded into ERA1, so the T track never writes this file.                                                                             |
| `00001300` (comms)                   | none directly                                                   | SEC L2/L4–L8, CAS messaging                       | ERA1's message clause lives in `00001060` but reads comms tables: its probe is the contract (§0.4). MIN1 edits `00001310`, M's notify file. |
| `00002510` (grants)                  | ERA1, ERA2, ERA4, MFA2, MFA3, MIN2; OWN1 if a signature changes | many                                              | One writer at a time; rebase on the latest main before editing.                                                                             |
| `stripe-webhook.ts` + `00001230`     | MFA3 (`finance.record_payout_account`)                          | FBP DB2, DB6; SBP S4                              | MFA3 after DB2 and DB6, and never at the same time as S4.                                                                                   |
| `live-wallet.ts` / `wallet-scope.ts` | RLS1 (its `users_public` reads)                                 | FBP SV2, SV3, SV5; RED WP2                        | RLS1 after all of them.                                                                                                                     |
| `features/devtools` + `dev-seam.ts`  | SSO1 (IDG F6), MFA1, MIN1                                       | FBP SV4, UI3; SBP S4, S6                          | One writer at a time.                                                                                                                       |

Shared files outside §B.0 that still collide:

- `00000017_tables_finance.sql` + `database/finance/Tables.md`: HK1's RESTRICT edits against any
  F·DB prompt that edits finance tables.
- `00001210`: ARC1's possible hand-off and RLS1's `finance.list_ledger` move, against F·DB3/DB7.
- `00001400`: avoided on purpose. ERA2's `search.fn_prune_query_logs` lives in `00001060`, because
  M·search (CAS S11/S14, RED WP14) edits `00001400`.
- `00005001`: each prompt adds its own `#region` with its own statement (Decision #274), so these
  writes are parallel-safe.
- `features/wallet/` dialogs: MFA2's withdrawal hook against F·UI2/UI3.

### 0.4 Cross-track waits

- **OWN1 waits for nothing.** It is the track's first step, because enterprise sign-up has been
  refused since Wave 0's fail-closed `fn_is_minor`.
- **ERA1 ↔ M·N1** (the unified-messaging schema window). ERA1 does not wait. Its probe,
  `account_erasure_scope.sql`, fails on any FK onto a person that erasure does not classify, so N1
  must keep it green and carry the message clause onto its new tables.
- **ERA3 ↔ F·splits (M10).** ERA3 reaches the split rule through `org.fn_rebalance_departed_stake`.
  Whichever lands second keeps `erasure_seats.sql` and `workspace_member_stakes.sql` green.
- **ARC1 → F.** A finance door that still admits an archived team is fixed in F's window (`00001210`
  / `00001240`): ARC1 writes the helper, F writes the call site.
- **MFA2 ⏳ F·UI2/UI3** for the withdrawal dialog's submit hook (`WalletDialogs.tsx`,
  `WalletHome.island.tsx`), or MFA2 hands them the helper.
- **MFA3 ⏳ the F·DB phase**: the `00001240` serial chain, and `00001230` after DB2/DB6, never with
  SBP S4.
- **F·E1 ⏳ MFA2/MFA3.** The money-lifecycle E2E must step up before it withdraws (TOTP codes
  generated from the secret enrolled in the test).
- **MIN1 ⏳ M·notify engine (N8–N12)** for the dispatch half when that engine is in flight.
  Otherwise MIN1 builds it in `00001310`, and the probe binds the engine to keep it.
- **RLS1 ⏳** the F, P and C SQL steps; F·SV2/SV3/SV5 and RED WP2 (`live-wallet.ts`); and M·N1 (the
  messaging services).
- **Already done by jobs-sql (Wave 1.3):** `search-query-log-retention` is seeded dormant and
  registers itself once `search.fn_prune_query_logs` exists (ERA2).

### 0.5 Open decisions and new contradictions

**Still open with the owner after Wave 1.1:** five items, of which only the fifth bears on this
track: every ⚖️ ruling is pending counsel. Here that means I1's retention values, the AML "No" and
the PITR statement (ERA2, ERA4, X2), and I4's proxy (MIN2). The other four (whether
`create_category` is stored, Agency and Enterprise storage, the FX margin, and which fee an Agency's
contract rate applies to) touch no identity prompt.

**🧑 stops in this file:**

1. **HK1 (conditional).** Keep `security.turnstile_verifications` if #335 (h) has since adopted it.
   Recommended: drop it, as Q0.2 (b) rules.
2. **ERA3.** Which seats the freelancer-profile scope leaves. Recommended: team seats only.
3. **ERA4.** Where the PII-free erasure tombstone lives outside the database. Recommended: export it
   before any restore, plus a nightly copy to an external write-only bucket.
4. **MFA1.** Recovery when an authenticator is lost. Recommended: a second factor, plus a
   support-assisted reset that starts the 72-hour Safety Hold.
5. **MIN2.** Proxied minors on teams. Recommended: business seats only until counsel designs team
   work.
6. **X1.** When the verified-domain, SAML and JIT build starts. Recommended: when the first
   Enterprise customer asks.
7. **X2.** Who builds the dormant AML programme. Recommended: F builds the signals; this track
   builds the flags.

**New contradictions** (listed here, not logged — each needs a decision row from the coordinator):

- (a) **Q0.2 (b) vs the providers spec.** The owner approved dropping
  `security.turnstile_verifications`. `EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md`
  §Turnstile steps 4 and 6 (Proposed, Decision #335 flag (h), unruled) write app-side Turnstile
  verifications into it and propose a 30-day purge.
- (b) **PRODUCT_MANAGEMENT vs PRODUCT_SPEC on seats.** `PRODUCT_MANAGEMENT.md` §3.5 says "scheduling
  **either** scope leaves every workspace seat". `PRODUCT_SPEC.md` says "scheduling an erasure
  leaves every team and business seat". Read literally, PRODUCT_MANAGEMENT makes a freelancer who
  switches to client lose their **business** seats too, which are the client side.
- (c) **The proxy model vs the persona rules.** PRODUCT_SPEC lets a proxied 13–17-year-old
  "contribute within a Team or Business". Decision #228 (A) makes Teams the freelancer side
  (`org.fn_assert_team_persona`), and #190/#192 give nobody under 18 a freelancer persona.
- (d) **Factual.** Ruling I4 builds the proxy "behind its existing off flag", but no flag exists.
  The off state is `trg_workspace_member_adult`'s hard refusal (`00001010:784`); MIN2 creates the
  flag.
- (e) **Ordering.** `FOUNDER_QUESTIONNAIRE.md` §B.3's track-I row lists the erasure chain before F4.
  Part C and #336's ruling text say F4 first. This file follows Part C.
- (f) **A reading.** I2's "back-fill" cannot write a date of birth that was never collected, and a
  placeholder would make the owner adult and fail open. It is read as a forced completion step at
  the next sign-in (OWN2), with a probe that counts profile-less owners.

**Architect defaults** (confirm or override before the prompt runs; none blocks):

- **OWN1.** The owner's personal `@handle` is derived from their name, because PRODUCT_SPEC's step
  1.6 asks for no username and `username` is `NOT NULL`. The owner's profile starts `private`, and
  their first acting context is the enterprise.
- **ERA1.**
  - Erased messages and posts are blanked to an erased marker rather than deleted, so other people's
    threads keep their shape.
  - The person's `search.query_logs` rows are deleted, because the retention table says "erased with
    the account"; nulling `user_id` would leave the raw query text.
  - Audit-log IPs follow the 12-month security-log class (ERA2's prune) and are not nulled at
    erasure.
- **ERA2.** The prune functions live in `00001060`, not `00001400`.
- **ERA4.** The hold stores the dates its classes run from and the jurisdiction, never a computed
  purge date, so a changed dial applies at the next purge.
- **SSO1.** The flag is the env key `AUTH_SSO_ENABLED` plus a `pj.dev.sso` dev override (the
  `EMBEDDINGS_ENABLED` precedent).
- **MFA2.** The SQL step-up helper also checks that the session is live.
- **ARC1.** A `pending_funds` team-archive blocker sits beside `wallet_balance`.

---

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere; Supabase Auth (GoTrue) with public.custom_access_token_hook; Stripe
Connect Express).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md; documentation/database/CLAUDE.md when SQL changes;
     packages/ui/CLAUDE.md for UI), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read documentation/architecture/IDENTITY_AND_WORKSPACES_AUDIT.md (finding IDs IW-*) and
     IDENTITY_DECISIONS_AND_GAPS.md (conflicts K1-K12, questions F1-F9). Then read Decision #336 in
     documentation/reference/decisions/decisions-122-126.md (grep -n '^| 336 |'): its OWNER
     RULINGS are the law here. The ruling table is FOUNDER_QUESTIONNAIRE.md Part C, and this
     file's §0 lists the open stops.
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. At minimum: #87, #150, #151, #156, #185, #190, #192, #193, #196,
     #201, #205, #207, #208, #226, #228, #230, #231, #238, #270, #274, #318, and #337 (ruling
     M10) wherever splits move.
  4. Read documentation/database/{org,security}/{Tables,Functions,Policies}.md for every object you
     change. Read PRODUCT_SPEC.md §Authentication, onboarding and the age guardrails, and
     §Identity, Taxes & Compliance. Read finance-model.md §17 (retention) and
     PRODUCT_MANAGEMENT.md §3.5.
  5. The verified state in IDENTITY_BUILD_PROMPTS.md is as of main @ 94d22e84. Re-check it against
     git before you start: another track may have landed a change since.

Hard rules (merge gates; reject your own diff if any fails):
  Identity & privacy
  - Age is DERIVED from users_public.dob at every call (org.fn_age_years, fn_is_minor,
    fn_assert_adult). Never store an age or trust a client flag. fn_is_minor fails CLOSED: an
    auth.users identity with no profile row is not provably adult. Never loosen that.
  - The acting context is a preference, never a grant. No RLS policy reads JWT claims, and every
    write RPC re-checks fn_member_can or a current seat. Claims drive chrome and scoping only.
  - Identity writes go through SECURITY DEFINER doors with search_path = '' and an explicit grant
    in 00002510. No client INSERT/UPDATE/DELETE policy on an org or security identity table.
  - The service role is used only before a session exists, or inside a definer or cron door (the
    AuthBackendService precedent). A signed-in request runs under the user's JWT.
  - Nothing is hard-deleted (archive, status or tombstone) EXCEPT what erasure must destroy by law,
    after the Decision #156(a) precedent for GoTrue identities and sessions. Name each such DELETE
    in documentation/database/*/Functions.md with its retention class (finance-model.md §17).
  - ⚖️ items are built behind dials or flags; their values are counsel's: retention periods, the
    AML posture, the PITR statement, the minors proxy. Never switch a ⚖️ flag on. Legal copy in
    features/legal/core/content/ stays a DRAFT version pending legal review (Decision #270).
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE (vvvvtooo_type_purpose.sql). Never append an
    ALTER patch or a new "fix" file. Each statement goes in its category file:
      0 tables: 00000011 org, 00000012 security;
      1 functions: 00001001 security context, 00001010 onboarding, 00001020 workspaces,
        00001040 profiles, 00001060 account lifecycle, 00001700 token hook, 00001810 auth triggers;
      2 policies and grants: 00002001, 00002010, 00002019, 00002510, 00002520;
      4 indexes: 00004001, 00004002;
      5 seed: 00005001 params and flags (your own #region, Decision #274), 00005060 jobs.
  - The Additive Rule: never drop a table, column or FK without the owner's approval. The only
    approved drops and FK changes on this track are Q0.2 (b) and (c), in HK1.
  - A schema or RPC-contract change lands in the SAME change with: its Zod schema
    (packages/types/org/identity.ts and friends; identity-tables.contract.test.ts pins every
    identity column), the backend mapper, and documentation/database/*. Also in the same change:
      a lifecycle change → PRODUCT_MANAGEMENT.md;
      a business rule → PRODUCT_SPEC.md (numbers in finance-model.md);
      a route or URL state → ROUTING.md;
      an env key → SYSTEM_ARCHITECTURE.md §Environment Variable Contract and .env.example.
    A prompt that builds a rule marked **Not built yet** or **Planned** removes that marker.
  - Thin routes: HTTP parse + Zod + auth guard only. Logic lives in packages/backend/services/*
    and returns ServiceResult<T> (Decision #10). Islands never import Supabase or @server/*; they
    fetch /api/*.
  - Signal-first state; useEffect only for external DOM or browser APIs; no useState. Path aliases
    only; folders components/ islands/ styles/ hooks/ wrappers/ types/ core/; no src/. JSDoc on
    exports; // #region [Name] … // #endregion; no meta-comments.
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3)
  - Token-only pure CSS and strict BEM: no hex, rgb, or literal radius, duration or shadow; no
    inline style=. apps/web/features/auth/styles/styles.gate.test.ts polices the auth sheets (Wave
    0); keep it green. /join stays fixed, viewport-height and non-scrolling (PRODUCT_SPEC).
  - Headings never ≥ --fw-bold; changing figures use tabular-nums; anti-card and anti-tag rules
    hold. Press feedback is transform: scale(), removed under BOTH reduced-motion channels. A
    control that renders must do something (§3.11). A new or changed @projective/ui component
    updates the DESIGN_SYSTEM.md §C.1 roster.
  Product
  - Every new simulatable axis gets its Dev Context Switcher control in the same change:
    DevOverrides + DEV_DEFAULTS, the DevOption list, the DevContextPanel control, and reflect()'s
    set AND delete (apps/web/features/devtools/, seam apps/web/utils/dev-seam.ts). A dev override
    is honoured only when DENO_ENV is development by name (Wave 0, IW-M1).
  - A NEW contradiction between source docs: do not pick a side. Add a decision row (the newest
    decisions-*.md plus a README index line; re-check the next free number right before writing)
    and ask me.

Verification: reproduce the defect first, then fix. Use a rollback-safe probe under
supabase/probes/ (BEGIN … ROLLBACK) or a Deno unit test.
  SQL prompts: run probes with `deno task test:probes`. At most 2 SQL sessions run at once on the
  one local DB, on disjoint migration files; announce each reset before you run it. Finish with
  your own clean `deno task test:probes:fresh` (db:reset plus every probe).
  Every prompt: then run `deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt`
  on the files you touched only, never a directory. The working tree is CRLF: edit docs with an
  editor tool, never sed. Four theme-engine.test.ts failures are pre-existing (Decision #96(a)).
  UI prompts: also run `deno task dev`, sign in as the seeded personas
  (documentation/database/Seed.md), and capture 1440, 900 and 390 px in light, dark,
  data-contrast="high" and data-motion="reduced".
Commit on the branch you were given. Do not push or open a PR unless I ask.
```

---

## 2. Phase 1 — The enterprise owner is a person (ruling I2)

### OWN1 — The owner's profile in the same transaction as the enterprise

```text
PROMPT OWN1: Every natural person has a profile, the enterprise owner included

ROLE: Postgres identity engineer and auth-service engineer. SQL lane; the track's first step.

CONTEXT:
  Findings:
  - IW-H2 / K3: the enterprise path collected no DoB and wrote no org.users_public row.
  - IW-M7: the second FK, session_context_user_id_fkey1 → users_public (00000012:77), so an
    enterprise-only owner could not hold the enterprise context.
  - Decision #87 (b): the profile-less owner, never ruled. #87 (c): null isClient/isFreelancer
    claims on a profile-less token.
  Ruled: every natural person, an enterprise owner included, gets a users_public row with a DoB
  (Decision #336, ruling I2).
  Verified state:
  - Since Wave 0 (81a108f0), org.fn_is_minor fails closed for a profile-less identity. So
    trg_workspace_member_adult refuses public.create_enterprise's owner seat PM403, and
    enterprise sign-up is refused today.
  - IW-H8's cleanup (12a80862) deletes the GoTrue user when create_enterprise fails.
  This prompt restores the server half; OWN2 sends the fields.

FILES:
  - supabase/migrations/00001010_functions_org_onboarding.sql:
    public.create_enterprise :287; public.provision_user_profile :26; org.seed_owner_preferences
    :498 and the comment at :391.
  - supabase/migrations/00001810_triggers_auth_onboarding.sql: only if the owner-preferences
    trigger binding goes.
  - supabase/migrations/00002510_permissions_function_grants.sql: only if a signature changes.
  - packages/types/org/enterprises.ts: CreateEnterprise gains the owner block.
  - packages/types/auth/join.ts: EnterpriseJoinSchema gains the owner's first and last name, dob
    and timeZone, plus the age superRefine; update join-hints.test.ts.
  - packages/backend/services/auth/AuthBackendService.ts: provisionAccount's enterprise branch
    (:369-407) and discardOrphanedOwner's JSDoc (:464).
  - apps/web/routes/api/auth/join.ts: the under-13 age lock, individual-only today (:51-57).
  - supabase/probes/enterprise_owner_profile.sql (new). Update identity_schema_guards.sql where it
    asserts the profile-less refusal.
  - documentation/database/org/Functions.md (create_enterprise, provision_user_profile) and
    documentation/business/PRODUCT_SPEC.md §Enterprise onboarding (one sentence on the derived
    handle and the private profile).

STEPS:
  1. Reproduce with a probe:
     a. create_enterprise for a fresh auth.users id, called as the service role, raises PM403
        today (the fail-closed owner seat);
     b. a profile-less owner cannot hold the enterprise context. IW-M7 was never probed, so record
        exactly what happens.
  2. Provision the owner INSIDE create_enterprise, before the enterprise row:
     - call PERFORM public.provision_user_profile(p_owner, the corporate email, NULL, meta);
     - build meta from p_payload.owner: first_name, last_name, username, dob, timezone,
       objective = 'client', locale, display_currency, visibility;
     - provision_user_profile reads visibility from meta and keeps 'unlisted' as the default for
       individuals.
     How a refusal unwinds:
     - under 13: fn_check_dob raises PM422 and the whole call rolls back;
     - 13 to 17: the owner seat raises PM403 and the call rolls back.
     Either way nothing is left behind, so discardOrphanedOwner can still delete the GoTrue user:
     no users_public row blocks it. GoTrue's createUser keeps only objective, locale and
     display_currency in user_metadata, so public.handle_new_user never provisions a second
     profile.
  3. The owner's personal @handle. PRODUCT_SPEC's step 1.6 asks only for a name, a DoB and a
     password, and users_public.username is NOT NULL UNIQUE. So:
     - derive a base handle from the owner's name in the service, in the USERNAME_RE shape;
     - fall back through handleAlternatives (packages/types/workspace/workspace.ts:533, the
       live-handle.ts suggestion precedent);
     - the SQL door re-checks org.fn_handle_refusal;
     - on 23505 the service retries the next alternative once, then refuses with the generic
       ENTERPRISE_REFUSED.
     The owner's profile starts 'private'. Both are architect defaults: IDENTITY_BUILD_PROMPTS
     §0.5.
  4. After the owner seat, point the owner's security.session_context row at the new enterprise.
     Write it directly, as provision_user_profile writes it: security.fn_set_session_context
     resolves the user from auth.uid(), which the service-role call does not have. The first token
     after confirmation then carries the enterprise context, which closes IW-M7.
  5. Retire the profile-less special case. org.seed_owner_preferences and its trigger exist only
     because owners had no users_public row (the comment at :391). The users_public seeders now
     cover them. Remove the function and its binding if the probe shows user_preferences and
     comms.notification_prefs seeded for a new owner. Otherwise keep it idempotent and say why.
  6. Zod:
     - EnterpriseJoinSchema gains ownerFirstName, ownerLastName, dob and timeZone, with the
       IndividualJoinSchema validators;
     - its superRefine: under 13 → UNDER_MINIMUM_REFUSAL; 13 to 17 → "An enterprise's owner must
       be 18 or over" (the database refuses anyway);
     - CreateEnterprise gains owner { firstName, lastName, username, dob, timeZone }.
  7. join.ts: the under-13 lock (pj_join_age_lock) covers the enterprise path too.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place (§1). The Zod schema and database/org/Functions.md with the RPC
contract. PRODUCT_SPEC §Enterprise onboarding (the handle and visibility sentence). Step 1.6's
"Not built yet" marker stays until OWN2 ships the fields. No new Dev Context Switcher axis: the
enterprise context exists already.

ACCEPTANCE:
  - enterprise_owner_profile.sql:
    - an adult owner → a users_public row (dob set, visibility private); user_emails primary =
      the corporate email; the owner seat; session_context naming the enterprise; and the hook's
      claims carry onboarded = true and boolean isClient and isFreelancer (#87 (c));
    - under 13 → PM422 and no row anywhere;
    - aged 15 → PM403 and no row anywhere;
    - a taken derived handle → the next alternative is used.
  - In the same probe, switch_enterprise_context and clear_session_context work for the owner
    (IW-M7).
  - AuthBackendService tests: the enterprise branch passes the owner block, and an RPC failure
    still deletes the orphaned GoTrue user.
  - `deno task test:probes` green, then your own clean `deno task test:probes:fresh`.
```

### OWN2 — Step 1.6 asks for the owner, and profile-less owners complete it

```text
PROMPT OWN2: The owner's details on step 1.6, and a completion step for owners without a profile

ROLE: Frontend engineer (Fresh islands, signals, the auth design gates). App lane. ⏳ OWN1.

CONTEXT:
  Ruled: wizard step 1.6 plus a back-fill (Decision #336, ruling I2).
  The spec, PRODUCT_SPEC:
  - §Onboarding step sequence: Enterprise 1.6 = corporate email, phone, the owning admin's DoB,
    and the admin password.
  - §Enterprise onboarding: "Admin login: the owning admin's name, date of birth and password".
  Audit §4.1: the tall Enterprise 1.6 step already scrolls inside the frame.
  The back-fill: a migration cannot write a date of birth that was never collected, and a
  placeholder would make the owner adult and fail open. So existing profile-less owners complete
  the step at their next sign-in, through the #87 bounce pattern. resolveOnboardingBounce skips
  them on purpose today (auth-routing.ts:136-143).

FILES:
  - apps/web/features/auth/core/wizardStore.ts and wizardValidation.ts (the enterprise
    "credentials" case and buildPayload); age-lock.ts.
  - apps/web/features/auth/components/StepForm.tsx: the Enterprise 1.6 fields.
  - apps/web/features/auth/styles/auth.css; keep styles.gate.test.ts green.
  - apps/web/features/auth/core/auth-routing.ts and its test: resolveOnboardingBounce.
  - apps/web/routes/(dashboard)/_middleware.ts: only to pass what the bounce needs.
  - apps/web/routes/(public)/(auth)/join.tsx: the completion state.
  - packages/types/auth/join.ts: an OwnerCompletion input.
  - packages/backend/services/auth/AuthBackendService.ts: completeOwnerProfile. It derives the
    handle as OWN1 does, then calls public.complete_onboarding under the user's JWT.
  - apps/web/routes/api/auth/join.ts: route the completion input.
  - documentation/architecture/ROUTING.md: /join's completion query state.
  - documentation/business/PRODUCT_SPEC.md: remove step 1.6's "Not built yet" sentence.
  - DESIGN_SYSTEM.md §C.1: only if a @projective/ui component changes.

STEPS:
  1. Step 1.6 (Enterprise) adds the owner's first name, last name and date of birth beside the
     corporate email, phone and password.
     - The DoB field reuses the individual dobError and the live age note.
     - The under-13 lock is the individual one.
     - Lay the step out in paired rows so it stays inside the fixed, non-scrolling frame at 390 px.
       Token-only CSS.
  2. buildPayload sends ownerFirstName, ownerLastName, dob, and timeZone (browserTimeZone()).
  3. A legacy profile-less owner completes the step.
     - resolveOnboardingBounce sends an account to /join?complete=owner&redirectTo=… when its
       token says onboarded = false AND its user_metadata objective is "enterprise". No OAuth
       prefill is needed: GoTrue already holds the email.
     - /join renders one step (first name, last name, DoB) and posts { type: "owner", … }.
     - completeOwnerProfile derives the handle and calls public.complete_onboarding (objective
       client, visibility private) under the user's JWT.
     - renewSession then re-stamps the claims (the #87 self-healing gate), so the bounce ends.
  4. Refusals on that step: a DoB under 18 gets the sign-up refusals. The account stays
     profile-less, which fails closed, and the service writes one ops.log_entries row so a human
     follows up. Never delete an account that owns an enterprise.

SAME CHANGE: ROUTING.md (the new query state); the PRODUCT_SPEC step 1.6 marker removed; the
auth style gate kept green.

ACCEPTANCE:
  - Live auth on `deno task dev`: a full enterprise sign-up lands in the enterprise context with a
    private owner profile.
  - Screenshots of step 1.6 at 1440, 900 and 390 px in the four modes, with no internal scroll.
  - auth-routing tests: a profile-less owner token bounces to ?complete=owner. An onboarded token,
    an absent claim and an OAuth prefill keep today's behaviour.
  - deno task check, lint and test:unit green.
```

---

## 3. Phase 2 — Approved schema hygiene (rulings Q0.2 (b), (c))

### HK1 — Drop the two dead tables; RESTRICT the split and identity cascades

```text
PROMPT HK1: Drop the two dead security tables, and RESTRICT the split and identity cascades

ROLE: Postgres schema engineer. SQL lane. Owner-approved exceptions to the Additive Rule only.

CONTEXT:
  Findings:
  - IW-M6: security.refresh_tokens and security.turnstile_verifications are referenced by no code.
    Wave 0 (81a108f0) turned RLS on for them and dropped nothing.
  - K11 / IW-L7: payout_splits, split_rules, contribution_agreements and vault_permissions cascade
    from users_public, teams, escrows and wallets. A service-role delete would silently erase split
    history.
  - IW-M10's remainder: Wave 0 added ck_enterprise_member_status, but enterprise_members.user_id
    is still ON DELETE CASCADE from auth.users (00000011:980).
  Ruled: drop both tables (Decision #336, ruling Q0.2 (b)); RESTRICT instead of CASCADE on the four
  finance tables (ruling Q0.2 (c)). Both are owner-approved exceptions to the Additive Rule. The
  enterprise_members FK needs no ruling: IDG says K11 needs none, and it is not an escrow, wallet
  or stage FK.

CONFLICT WITH THE FINANCE FILES:
  - The four FKs live in supabase/migrations/00000017_tables_finance.sql (contribution_agreements
    :345, payout_splits :358, vault_permissions :476, split_rules :487). The F track edits that
    file in its DB phase.
  - Their documentation is documentation/database/finance/*.
  - Do not run while an F·DB prompt has 00000017 or database/finance/Tables.md open; ask the
    coordinator.
  - Keep supabase/probes/finance_invariants.sql green.

CONFLICT WITH THE PROVIDERS SPEC (new; IDENTITY_BUILD_PROMPTS §0.5 (a)):
  EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md §Turnstile steps 4 and 6 (Proposed,
  Decision #335 flag (h)) write app-side Turnstile verifications into
  security.turnstile_verifications.

🧑 DECISION — STOP only if Decision #335 (h) has been ruled since 2026-10-30 to adopt app-side
Turnstile verification with this table. Check: grep #335's row for "OWNER RULINGS". If so, put this
to me:
  Option A (recommended): drop it anyway, per Q0.2 (b). When Turnstile is adopted, it lands its own
  store with its code, with the 30-day retention #335 (h) proposes.
  Option B: keep turnstile_verifications (RLS on, definer-only) and drop only refresh_tokens.
Otherwise proceed with A, and mark the spec's two mentions as dropped, linking Q0.2 (b).

FILES:
  - supabase/migrations/00000012_tables_security.sql: remove both CREATE TABLE blocks (:32-56).
  - supabase/migrations/00002001_policies_enable_rls.sql: their ENABLE RLS lines (:256-265).
  - supabase/migrations/00004002_indexes_security.sql and 00002520_permissions_table_grants.sql:
    any statement that names them.
  - supabase/migrations/00000017_tables_finance.sql: the seven ON DELETE CASCADE clauses → ON
    DELETE RESTRICT. split_rules.finder_user_id keeps SET NULL.
  - supabase/migrations/00000011_tables_org.sql: enterprise_members_user_fkey → RESTRICT.
  - supabase/probes/rls_exposed_tables.sql: its IW-M6 block names the two tables.
  - supabase/probes/identity_schema_guards.sql: add the RESTRICT assertions there, or in a new
    identity_restrict.sql.
  - Docs: documentation/database/security/{Tables,Policies}.md, database/finance/Tables.md,
    database/org/Tables.md, and the providers spec's two Turnstile mentions.

STEPS:
  1. Prove nothing reads the tables. Grep apps/, packages/, supabase/ and scripts/ for both names:
     the only hits must be the files above.
  2. Delete their CREATE TABLE statements in place, along with every statement that names them
     (RLS, grants, indexes). No ALTER … DROP file.
  3. Change the cascades.
     - In 00000017, change each CASCADE to RESTRICT: contribution_agreements (team_id,
       member_user_id), payout_splits (escrow_id, member_user_id), vault_permissions (wallet_id,
       member_user_id) and split_rules (team_id).
     - In 00000011, change enterprise_members.user_id to RESTRICT.
     - Re-read every function that deletes a parent: grep "DELETE FROM" for finance.escrows,
       finance.wallets, org.teams, org.users_public and auth.users. Today only
       public.discard_underage_signup deletes auth.users, and only for an identity with no
       profile, so it is unaffected.
  4. Probe: inside a rollback, deleting a parent that has child rows (users_public, team, escrow or
     wallet) is refused 23503 for each of the eight FKs, and the two tables are gone.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place (§1). documentation/database/* for every dropped table and every
changed FK action. No Zod row schema exists for the two dropped tables, but re-run
identity-tables.contract.test.ts anyway. No lifecycle change.

ACCEPTANCE:
  - `deno task test:probes` green, including rls_exposed_tables.sql, finance_invariants.sql and
    the new RESTRICT assertions; then your own clean `deno task test:probes:fresh`.
  - grep -rn "refresh_tokens\|turnstile_verifications" supabase/ apps/ packages/ → no hits.
    Documentation mentions them only where it records the drop.
```

---

## 4. Phase 3 — The erasure chain on `00001060` (ruling I1 + SEC G16)

### ERA1 — Erasure reaches every personal row

```text
PROMPT ERA1: Erasure reaches every personal row: profile content, credentials, files, messages and
search

ROLE: Postgres privacy engineer, plus the sweep service for storage objects. SQL lane. ⏳ HK1.

CONTEXT:
  Findings:
  - IW-H6 / K1: fn_erase_account leaves portfolios, education, experience, certifications,
    languages, links, skills, showcase, follows, bookmarks, recent views, preferences, past
    handles, member titles, avatar and banner objects, the password hash and MFA factors.
  - SEC G16 = CAS S17: the search schema keeps the person's embedding; query_logs keeps user_id and
    the query vector forever; user_affinity and interest_events stay linked.
  - Audit §9: message retention after erasure was never checked.
  Ruled:
  - Erasure also nulls search embeddings, query logs and affinity rows (Decision #336, ruling
    I1 (d)).
  - What survives follows the owner's retention table (finance-model.md §17, ⚖️ pending counsel).
    ERASED with the account: messages, files and profiles that are not under a hold. KEPT, linked
    only to the anonymous tombstone: ledger, escrow, payout, invoice, order and fee rows; disputes
    with their evidence and attached messages; reviews and Standing (#156 (a)); consent records;
    and security logs (12 months).
  The legal-hold identity record is ERA4. The 12-month security-log prune is ERA2.

FILES:
  - supabase/migrations/00001060_functions_org_account_lifecycle.sql: fn_erase_freelancer_profile
    :532, fn_erase_account :555, fn_purge_due_deletions :587. Add a claim of the storage objects
    to remove, after the ops.fn_claim_stale_contact_attachments precedent (00001655:490).
  - supabase/migrations/00002510_permissions_function_grants.sql: the claim door, service_role
    only.
  - packages/backend/services/user/AccountLifecycleBackendService.ts: sweepDue (:187) deletes the
    claimed objects through the Storage API, because SQL cannot delete them.
  - apps/web/routes/api/user/cron/erasures.ts: only if the response shape changes.
  - supabase/probes/account_erasure_scope.sql (new).
  - Docs: documentation/database/org/Functions.md § Account lifecycle (the classification table);
    PRODUCT_SPEC.md §Data Privacy & The "Vault" (the "Search forgets too" bullet and the closing
    "Not built yet" sentence); PRODUCT_MANAGEMENT.md §3.5 Scheduled removal (the search half of
    its "Not built yet").

STEPS:
  1. Inventory, then classify.
     - Query pg_constraint for every FK onto org.users_public(user_id) and auth.users(id): about
       140 today, across org, projects, comms, finance, search, scheduling, integrations,
       catalogue, marketplace, community, reviews, files, security and ops.
     - Add the polymorphic person columns that have no FK: files.items.owner_user_id,
       finance.wallets.owner_id, search.profiles_index.entity_id, and any others you find.
     - Classify each column as:
       ERASE;
       HOLD (kept and tombstone-linked; finance-model §17's classes); or
       KEEP-ANONYMISED (other people's evidence: reviews, Standing, projects the person worked
       on).
     - Put the table in database/org/Functions.md.
  2. Make the probe the contract. account_erasure_scope.sql:
     - seeds or picks a person with a row in every ERASE class and runs org.fn_erase_account in a
       rollback;
     - asserts each ERASE class is empty or blanked, and each HOLD class is intact;
     - FAILS when an FK onto users_public or auth.users exists that its classification list does
       not name, so no new table can dodge erasure. M·N1's schema window must keep it green.
  3. Extend fn_erase_account, and fn_erase_freelancer_profile for the seller-only half.
     - org: delete the person's portfolios, education_entries, experience_entries,
       certifications, user_languages, user_skills, profile_links, profile_showcase_items,
       profile_settings, user_bookmarks and their collections, recent_views, profile_follows (both
       directions) and user_preferences. Delete their handle_changes rows: no row may link the
       tombstone to a past handle. Clear the member titles on their team and business seats.
     - auth: clear encrypted_password. Delete auth.mfa_factors (their challenges go with them),
       and the user's one_time_tokens and flow_state, beside the existing identities and sessions
       deletes (the #156 (a) precedent). List each one in Functions.md.
     - comms: blank the person's messages to an erased marker, body and attachments, unless
       finance.dispute_messages or finance.dispute_evidence references them. Remove their
       reactions, pins, favourites, device tokens, notifications and notification prefs.
     - files: soft-delete the person's personal files.items rows (owner_type 'user', owner_user_id
       = the person) and claim their (bucket, path) for the sweep, unless a hold references them:
       dispute evidence, a stage submission or deed, or a project's files. The avatar_file_id and
       banner_file_id rows are included.
     - integrations: delete the person's connections and stored secrets. Revoking the token at the
       provider is a documented follow-up; deleting it ends Projective's own access.
     - community: delete the newsletter subscriptions for the person's addresses; blank their posts
       and comments like messages.
     - search (G16):
       - search.profiles_index rows for the person (the user and freelancer entity types):
         is_active and is_public false, embedding* NULL;
       - delete the person's search.query_logs rows. finance-model §17 says erased with the
         account, and nulling user_id alone would leave the raw query text;
       - delete their search.user_affinity rows (derived data; the §5.4 exception, named in
         Functions.md);
       - null user_id and session_id on their search.interest_events (others' engagement
         aggregates stay whole);
       - delete their search.talent_signals rows.
     Leave every HOLD class untouched. Keep the function idempotent: a second run changes nothing.
  4. The sweep. fn_purge_due_deletions returns the claimed objects, or a new
     security.claim_erased_objects(p_limit) does.
     - AccountLifecycleBackendService.sweepDue removes them with
       getServiceClient().storage.from(bucket).remove(paths), then confirms each one.
     - A failure is retried on the next run, and it never un-erases the rows.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place. documentation/database/org/Functions.md: the classification, and
every lawful hard delete. PRODUCT_SPEC: "Search forgets too" is built, so narrow §Data Privacy's
closing "Not built yet" sentence to what remains. PRODUCT_MANAGEMENT §3.5 (the search half).

ACCEPTANCE:
  - account_erasure_scope.sql green, including the unclassified-FK check and an idempotent second
    run.
  - The sweep's unit test: claimed objects are removed and confirmed, and a Storage failure leaves
    them claimed for the next run.
  - `deno task test:probes` green; your own clean `deno task test:probes:fresh`.
```

### ERA2 — Erasure windows and retention periods become dials

```text
PROMPT ERA2: Erasure windows and retention periods become dials, and the retention sweeps run

ROLE: Postgres engineer (params, sweeps), plus Settings frontend for the two wordings. SQL lane.
⏳ ERA1 (00001060).

CONTEXT:
  Findings:
  - K2 / F2: one 90-day code path serves both "switch to client" and a wish to have the seller
    data gone. GDPR Art. 12(3) asks for an answer within one month.
  - Audit §6.5: both windows are hard-coded (00001060:434, :490).
  Ruled:
  - 90 days for "switch to client", ≤ 30 days for an explicit erasure, both as
    security.platform_params (Decision #336, ruling I1 (b)).
  - Every retention period is a platform_params dial with a per-jurisdiction override (I1, ⚖️;
    the table in finance-model.md §17). Build the dials; counsel confirms the values.
  Already seeded: jobs-sql (Wave 1.3) registered a DORMANT job, search-query-log-retention. It
  registers itself once search.fn_prune_query_logs exists (a to_regproc guard), so name the
  function exactly that; 00005060 needs no edit for it.

FILES:
  - supabase/migrations/00005001_seed_platform_params.sql: one new #region [erasure_retention]
    with its own INSERT … ON CONFLICT DO NOTHING (Decision #274).
  - supabase/migrations/00001060_functions_org_account_lifecycle.sql:
    - schedule_freelancer_removal and schedule_account_deletion read the windows;
    - security.fn_retention_period(p_class text, p_country text) RETURNS interval;
    - search.fn_prune_query_logs() and security.fn_prune_security_logs(). They live here, not in
      00001400: §0.3.
  - supabase/migrations/00002510_permissions_function_grants.sql: the changed signature; the prune
    functions are service_role only.
  - supabase/migrations/00005060_seed_scheduled_jobs.sql: ONE row, security-log-retention, with
    the to_regproc guard. This prompt owns the file only while it runs.
  - packages/types/org/account-lifecycle.ts;
    packages/backend/services/user/AccountLifecycleBackendService.ts;
    apps/web/routes/api/user/lifecycle.ts (the explicit flag).
  - apps/web/features/settings/components/sections/account/{AccountTypeBlock,RemovalDialog,
    DeleteAccountBlock}.tsx: the two wordings.
  - apps/web/features/legal/core/content/privacy.ts: a new DRAFT version stating the explicit
    ≤ 30-day path (⚖️ pending legal review; Decision #270 versioning).
  - supabase/probes/erasure_windows.sql (new).
  - Docs:
    - finance-model.md §17: remove the dials' "Not built yet" and name each key;
    - PRODUCT_SPEC.md: the "Two windows" bullet;
    - PRODUCT_MANAGEMENT.md §3.5: the dials;
    - database/{org,security}/Functions.md, and database/security/Tables.md for the param keys.

STEPS:
  1. Seed the dials. The values are counsel's (⚖️); seed the owner's table as the starting values.
     Every period has one JSON shape, {"default": n, "by_country": {"XX": n}}:
     - erasure_freelancer_profile_days = 90;
     - erasure_account_days = 30;
     - retention_ledger_years: default 7, by_country DE 10 and FR 10;
     - retention_legal_hold_years: default 5;
     - retention_tax_reporting_years: default 6; the EU member states at 10 (DAC7);
     - retention_dispute_years: default 6;
     - retention_consent_years: default 6, counted after the account ends;
     - retention_security_log_months: default 12;
     - retention_search_query_log_days: default 90.
     fn_retention_period reads the default plus the country's override, and refuses an unknown
     class.
  2. The windows.
     - schedule_account_deletion uses erasure_account_days.
     - schedule_freelancer_removal gains p_explicit boolean DEFAULT false. False is "switch to
       client" (restorable) and uses erasure_freelancer_profile_days. True is an explicit erasure
       of the seller data: it uses erasure_account_days and records metadata.explicit.
     - A missing or invalid dial falls back to 30 days, the legal ceiling, never longer.
     - deletion_requests_window_check (scheduled_for > requested_at) still holds.
  3. search.fn_prune_query_logs() deletes query_logs older than retention_search_query_log_days,
     in batches.
  4. security.fn_prune_security_logs().
     - Null ip and user_agent on security.audit_logs older than retention_security_log_months.
       The rows stay, because some are consent and lifecycle records kept for the consent class.
     - Delete GoTrue's auth.audit_log_entries older than the same period.
     - Register security-log-retention in 00005060: daily, on a minute no other job uses, with the
       to_regproc guard.
  5. Settings → Account shows two wordings, each reading its window from the lifecycle payload. No
     "90" or "30" is hard-coded in the UI.
     - "Switch to a client account: we keep your freelancer profile for N days in case you come
       back."
     - "Erase my freelancer data: done within N days."
  6. Probe erasure_windows.sql:
     - both windows follow their dials (change a dial inside the rollback and reschedule);
     - an explicit freelancer erasure lands at ≤ 30 days;
     - each prune function deletes or blanks only the rows past its dial.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place. Zod (account-lifecycle.ts) and the database/* docs.
finance-model §17 and PRODUCT_SPEC lose their "Not built yet" for the windows and the dials (the
⚖️ mark stays). PRODUCT_MANAGEMENT §3.5. The privacy notice's draft version.

ACCEPTANCE:
  - erasure_windows.sql green. After a fresh reset, the dormant search-query-log-retention job is
    registered (check ops.scheduled_jobs).
  - Settings screenshots of both wordings at 1440 and 390 px; lifecycle route tests cover the flag.
  - `deno task test:probes` green; your own clean `deno task test:probes:fresh`.
```

### ERA3 — Scheduling an erasure leaves every seat

```text
PROMPT ERA3: Scheduling an erasure leaves every seat, and the share redistributes by the split rule

ROLE: Postgres workspace engineer, plus Settings frontend. SQL lane. ⏳ ERA2 (00001060). 00001020
is a hot file: never run at the same time as F's payout-gate or splits prompt.

CONTEXT:
  Findings: IW-H5 / K7. Erasure leaves seats active, so splits keep crediting a tombstone's wallet
  and seat counts stay inflated.
  Ruled: every seat is left when the erasure is SCHEDULED, and the person's stake redistributes by
  the team's split rule (Decision #336, ruling I1 (c); Decision #337, ruling M10 (b)).
  Already true:
  - Owner seats never reach this path: owns_workspaces already blocks scheduling
    (fn_account_blockers, 00001060:220-241).
  - A cancelled deletion does not restore seats (IDG F3).

🧑 DECISION — STOP before you write the freelancer scope.
  The conflict:
  - PRODUCT_MANAGEMENT §3.5 says "scheduling EITHER scope leaves every workspace seat at once".
  - PRODUCT_SPEC says "scheduling an erasure leaves every team and business seat".
  For the freelancer_profile scope ("switch to client"), the literal reading would also drop the
  person's BUSINESS seats, which are the client side. Put this to me:
  Option A (recommended): the account scope leaves every team, business and enterprise seat. The
  freelancer_profile scope, and ERA2's explicit freelancer erasure, leave team seats only, because
  a team seat needs the freelancer persona (Decision #228 (A)).
  Option B: both scopes leave every seat, as PRODUCT_MANAGEMENT reads literally.
  Option C: only the account scope leaves seats; switching to client keeps team seats until the
  90-day erasure runs.
The account scope needs no ruling: build it first.

FILES:
  - supabase/migrations/00001020_functions_org_entities.sql §13: a new
    org.fn_leave_all_seats(p_user uuid, p_kinds text[]) beside fn_rebalance_departed_stake
    (:2667). It reuses the removal block's effects (:2795-2815).
  - supabase/migrations/00001060_functions_org_account_lifecycle.sql: schedule_account_deletion;
    schedule_freelancer_removal per the ruling; get_account_lifecycle lists the seats that would be
    left.
  - packages/types/org/account-lifecycle.ts and AccountLifecycleBackendService.ts.
  - apps/web/features/settings/components/sections/account/{DeleteAccountBlock,RemovalDialog}.tsx:
    the dialog lists the seats before the typed CONFIRM, and says a cancel will not restore them.
  - supabase/probes/erasure_seats.sql (new).
  - Docs: documentation/database/org/Functions.md (§13 and § Account lifecycle);
    PRODUCT_MANAGEMENT.md §3.5 (the seat half of "Not built yet") and its Workspace membership row;
    PRODUCT_SPEC.md (the "Seats are left at once" marker).

STEPS:
  1. fn_leave_all_seats. For every ACTIVE non-owner seat the person holds (team_members,
     business_members and enterprise_members, per p_kinds):
     - set status 'left' and left_at; clear grants and revokes;
     - clear reports_to on the seat, and on every row that reports to it;
     - for a team, call org.fn_rebalance_departed_stake: the M10 (b) redistribution. F·splits owns
       its rule; this prompt only calls it;
     - call fn_sync_vault_permissions and fn_refresh_membership_flags;
     - write one audit row per seat: '<kind>.member_left', with metadata.reason =
       'erasure_scheduled'.
     It has the same effects as a self-leave and adds no new notification type. It is internal: no
     client grant.
  2. Call it from schedule_account_deletion (every kind) in the same transaction, after the
     blockers pass. Call it from schedule_freelancer_removal per the 🧑 ruling.
  3. get_account_lifecycle returns the seats that scheduling would leave (kind, entity handle,
     name). Settings lists them, and the cancel copy says the seats stay left.
  4. Probe: a person in two teams and a business schedules account deletion. Then:
     - every seat is left;
     - contribution_agreements still total 10000 bp without them;
     - vault_permissions are '{}' for them;
     - seat counts drop.
     After a cancel, the seats stay left. An owner is still refused owns_workspaces.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place. Zod and the docs. PRODUCT_MANAGEMENT §3.5, and its Workspace
membership row (a departure by erasure). The PRODUCT_SPEC marker.

ACCEPTANCE:
  - erasure_seats.sql green; vault_sync_backstop.sql and workspace_member_stakes.sql still green.
  - Screenshots of the Settings dialog listing the seats, at 1440 and 390 px.
  - `deno task test:probes` green; your own clean `deno task test:probes:fresh`.
```

### ERA4 — The legal-hold vault, the erasure tombstone and the restore replay (⚖️)

```text
PROMPT ERA4: The legal-hold vault, the erasure tombstone and the restore replay (⚖️)

ROLE: Postgres security engineer, plus SRE for the restore runbook. SQL lane. ⏳ ERA3 (00001060).

CONTEXT:
  Findings: K1 / F1, what survives an erasure.
  Ruled:
  - A legal-hold vault: a minimal encrypted identity record linked to the retained ledger rows,
    readable by the service role only, purged at the end of the statutory period. It holds the
    AML-grade identity set: legal name, DoB, country, and the Stripe and KYC references (Decision
    #336, ruling I1 (a)).
  - The erasure statement covers PITR backups: they are encrypted, kept at most 30 days, and never
    used for normal access. A restore re-applies every erasure from a tombstone log of erased
    subject ids and times that holds no personal data (ruling I1, ⚖️ pending counsel).
  The periods come from ERA2's dials (retention_legal_hold_years, retention_ledger_years,
  retention_tax_reporting_years, retention_dispute_years); counsel confirms the values. Ruling
  I1 (d) already landed in ERA1 with G16.

🧑 DECISION — STOP before step 4. A PITR restore rolls back every table in the database, the
tombstone included, so the replay needs a copy that lives outside it. Put this to me:
  Option A (recommended): the runbook exports security.erasure_log from the live database before
  any restore. A nightly job also writes the PII-free log to an external, write-only
  S3-compatible bucket outside the Supabase project: two new env keys, placeholders XXXX-XXXX.
  Option B: export before a restore only. Then no copy survives losing the database.
  Option C: a private Supabase Storage bucket. Its object metadata rows roll back with the
  restore, so the restored database cannot list the copy.

FILES:
  - supabase/migrations/00000012_tables_security.sql: security.legal_hold_identities and
    security.erasure_log.
  - supabase/migrations/00002001_policies_enable_rls.sql (RLS on both, no policy);
    00002520_permissions_table_grants.sql (no client grant); 00004002_indexes_security.sql.
  - supabase/migrations/00001060_functions_org_account_lifecycle.sql:
    - fn_erase_account captures the hold BEFORE it anonymises, and writes erasure_log;
    - security.replay_erasures(p_since timestamptz);
    - security.fn_purge_legal_holds().
  - supabase/migrations/00002510_permissions_function_grants.sql: service_role only.
  - supabase/migrations/00005060_seed_scheduled_jobs.sql: ONE row, security-legal-hold-purge, with
    the to_regproc guard; plus the nightly tombstone export if Option A.
  - packages/types: row schemas for both tables beside identity.ts. Extend
    identity-tables.contract.test.ts to cover them.
  - supabase/probes/legal_hold_vault.sql (new).
  - apps/web/features/legal/core/content/privacy.ts: a new ⚖️ DRAFT version with the hold and the
    backup statement. "Financial records are kept, anonymised" becomes the legal-hold sentence.
  - Docs:
    - documentation/database/security/{Tables,Functions,Policies}.md;
    - SYSTEM_ARCHITECTURE.md: a "Backups, restores and the erasure replay" subsection (the
      runbook);
    - PRODUCT_SPEC.md §Data Privacy: remove the remaining "Not built yet" for the vault and the
      backups; keep ⚖️;
    - PRODUCT_MANAGEMENT.md §3.5: the vault half;
    - finance-model.md §17: the vault is built; its values stay ⚖️.

STEPS:
  1. legal_hold_identities columns:
     - id;
     - subject_id uuid NOT NULL, an FK onto auth.users with RESTRICT (the banned tombstone
       identity stays);
     - vault_secret_id uuid: the identity set as JSON, held in Supabase Vault by vault.create_secret
       and encrypted at rest. If vault.create_secret is missing on the local image, enable
       supabase_vault in 00000002 with the guarded DO-block pattern pg_cron uses;
     - jurisdiction char(2);
     - the dates each applicable class runs from: relationship_ended_at, the end of the financial
       year of the last ledger row, and the close of the last dispute, plus a seller flag for the
       tax-reporting class;
     - created_at.
     Write a row only when the person has retained money or KYC records: escrows, ledger rows,
     payouts, payout_accounts, invoices, orders or verification references. A person with none
     leaves no hold. No client role can read the table. Only the service role reads the secret,
     through vault.decrypted_secrets.
  2. A hold is due for purge once every applicable class has run out. Compute it at purge time
     from the CURRENT dials (fn_retention_period with the jurisdiction), never from a stored date,
     so a changed dial applies at the next run.
  3. erasure_log holds subject_id, scope and erased_at, and nothing else. fn_purge_due_deletions
     writes one row per completed erasure. security.replay_erasures(p_since) re-runs
     fn_erase_account or fn_erase_freelancer_profile for every subject logged after p_since. It is
     idempotent, per ERA1.
  4. Per the 🧑 ruling, write the runbook into SYSTEM_ARCHITECTURE:
     a. export the log;
     b. restore;
     c. import the log into a temp table;
     d. run replay_erasures(the restore point);
     e. verify with account_erasure_scope.sql's assertions;
     f. go live.
     Add the off-database copy if Option A or C is chosen.
  5. fn_purge_legal_holds() deletes the vault secret and the row once the hold is due: the purpose
     of the hold is spent, so name the deletion in Functions.md. Register the daily job.
  6. Probe legal_hold_vault.sql:
     - an erased payee with ledger rows gets one hold row, whose secret decrypts (as the service
       role) to exactly the identity set;
     - a person with no money records gets none;
     - authenticated and anon read nothing;
     - the purge removes a hold only once its dials have run out, and shortening a dial inside
       the rollback brings that forward;
     - replay_erasures re-erases a "restored" profile.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place. Zod, the contract test and database/security/*. The PRODUCT_SPEC,
PRODUCT_MANAGEMENT §3.5 and finance-model §17 markers. The SYSTEM_ARCHITECTURE runbook. The privacy
draft (⚖️; this prompt never publishes it as final).

ACCEPTANCE:
  - legal_hold_vault.sql green; account_erasure_scope.sql still green.
  - `deno task test:probes` green; your own clean `deno task test:probes:fresh`.
```

---

## 5. Phase 4 — SSO hidden (ruling S7 (b))

### SSO1 — Hide the SSO panel until an identity provider can answer it

```text
PROMPT SSO1: Hide the SSO panel until an identity provider can answer it

ROLE: Frontend and auth-service engineer. App lane, no SQL. Any time; one writer at a time on
features/devtools.

CONTEXT:
  Findings: IW-M11 / K8.
  - SsoPanel renders on /login and in the SignInPrompt dialog.
  - signInWithSSO is SAML-only, and [auth.sso.saml] is commented out (supabase/config.toml:286),
    so every domain is refused.
  - That makes it a dead control, against root CLAUDE.md §3.11.
  Ruled: hide the SSO panel now. The roadmap is verified domains → SAML through GoTrue → JIT seats,
  on the Enterprise plan only (Decision #336, ruling S7 (b), (c); X1 below).

FILES:
  - packages/backend/core/env.ts and env.test.ts: AUTH_SSO_ENABLED, a boolean, default false. The
    EMBEDDINGS_ENABLED precedent is SYSTEM_ARCHITECTURE.md:808 and :3726.
  - apps/web/features/auth/islands/LoginForm.island.tsx (:58) and SignInPrompt.island.tsx (:98):
    render <SsoPanel> only when a server-resolved ssoEnabled prop is true.
  - Whatever mounts them (apps/web/routes/(public)/(auth)/login.tsx and the SignInPrompt host):
    resolve the flag server-side and pass it down. Islands stay dumb.
  - apps/web/routes/api/auth/sso.ts and AuthBackendService.resolveSso (:924+): refuse 404 while the
    flag is off.
  - An `sso` axis in apps/web/features/devtools/core/dev-context.ts,
    components/DevContextPanel.tsx and apps/web/utils/dev-seam.ts: auto (follow
    AUTH_SSO_ENABLED), on or off. Cookie pj.dev.sso, honoured only under DENO_ENV=development. The
    embeddings axis is the template.
  - Docs: .env.example; SYSTEM_ARCHITECTURE.md §Environment Variable Contract and §Authentication
    (:2748-2751); PRODUCT_SPEC.md §Authentication (:3250-3255); ROUTING.md (/api/auth/sso answers
    404 while off).

STEPS:
  1. Reproduce: /login shows "Enterprise SSO", and every domain answers with a refusal.
  2. Add the flag and the axis: DevOverrides + DEV_DEFAULTS, the DevOption list, the
     DevContextPanel control, and reflect()'s set AND delete.
  3. Gate both islands and the route on it. Keep SsoPanel.tsx and resolveSso intact for X1.

SAME CHANGE: the env contract and .env.example; the Dev Context Switcher axis. Remove
PRODUCT_SPEC's "Not built yet: today /login still shows an SSO panel…" sentence; SSO itself stays
**Planned**. Narrow SA §Authentication's "Not built yet" to the roadmap.

ACCEPTANCE:
  - With the flag unset, /login and the sign-in dialog render no SSO entry. With pj.dev.sso=on in
    development, they do.
  - POST /api/auth/sso answers 404 while the flag is off (a unit test).
  - Screenshots of /login at 1440 and 390 px, light and dark, with no orphaned divider or gap.
  - deno task check, lint and test:unit green.
```

---

## 6. Phase 5 — Workspace archive (IW-M5)

### ARC1 — An archived workspace holds no money rights and strands no money

```text
PROMPT ARC1: An archived workspace holds no money rights and strands no money

ROLE: Postgres workspace engineer at the finance boundary. SQL lane. ⏳ ERA3 (00001020). 00001020
is a hot file (§0.3).

CONTEXT:
  Findings: IW-M5.
  - org.set_workspace_status re-projects no vault rights.
  - Team archive has no wallet_balance blocker.
  - The team money doors' archived checks were never verified (audit §9).
  Precedent: a business already refuses archive on wallet_balance and pending_payouts
  (fn_business_archive_blockers), and takes no money in once archived (#248 (k)).
  The rule restored is SA:1965-1971: vault rights follow membership and the entity's state. No
  ruling is needed (IDG §3).

FILES:
  - supabase/migrations/00001020_functions_org_entities.sql:
    - fn_vault_capabilities_for (:691): an archived entity projects to 'view' only;
    - set_workspace_status (:1463): call fn_sync_vault_permissions(kind, id) after archive AND
      after restore;
    - fn_team_archive_blockers (:1302): add wallet_balance and pending_funds.
  - supabase/probes/team_archive_money.sql (new). Keep business_lifecycle.sql and
    vault_sync_backstop.sql green.
  - packages/types/workspace (the archive blocker codes, if they are typed) and the console's
    blocker copy in features/workspaces, for the two new codes.
  - Docs: documentation/database/org/Functions.md; PRODUCT_MANAGEMENT.md (the Workspace entity row:
    a team's blockers); PRODUCT_SPEC.md §Freelancers & Teams (Settings and the lifecycle), if it
    lists them.

STEPS:
  1. Reproduce: archiving a team whose vault wallet holds money or pending releases succeeds today,
     and its members keep spend, withdraw and distribute on vault_permissions.
  2. fn_team_archive_blockers adds two codes after the existing two, in this order:
     - wallet_balance: any team wallet above 0, in any currency;
     - pending_funds: finance.pending_releases owed to a team wallet that are still pending or
       on_hold.
  3. Projection: an archived team or business projects every member to 'view', so history stays
     readable. A restore re-projects from capabilities. Both go through fn_sync_vault_permissions.
  4. Probe every team money door against an archived team: top-up, transfer in, contribute, spend,
     distribute, withdraw and recurring deposit.
     - With 'view'-only rights, the vault doors refuse.
     - A door that skips fn_has_vault_capability and still admits an archived team is a FINANCE
       fix: 00001210 and 00001240 belong to the F track. List it and hand it to F's open window.
       Write org.fn_assert_team_not_archived here, mirroring fn_assert_business_not_archived; F
       writes the call site.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place; the docs; PRODUCT_MANAGEMENT's Workspace entity row (the team
blockers).

ACCEPTANCE:
  - team_archive_money.sql green:
    - archive is refused on wallet_balance and on pending_funds;
    - an archived team's members hold only 'view';
    - a restore gives the rights back.
  - `deno task test:probes` green; your own clean `deno task test:probes:fresh`.
```

---

## 7. Phase 6 — MFA and the sensitive-route guard (ruling I3)

### MFA1 — Opt-in two-step verification (TOTP) for everyone

```text
PROMPT MFA1: Opt-in two-step verification (TOTP) for everyone

ROLE: Auth engineer (GoTrue MFA), plus Settings frontend. App lane: config, routes, services and
UI. Any time.

CONTEXT:
  Findings: IW-M12. There is no MFA and no step-up; [auth.mfa.totp] is off
  (supabase/config.toml:343-361).
  Ruled: opt-in TOTP for everyone (Decision #336, ruling I3 (a)). The mandatory AAL2 step-up is
  MFA2.

🧑 DECISION — STOP before step 5. Ruling I3 makes AAL2 mandatory for withdrawals and erasure, so a
person who loses their authenticator is locked out of both. GoTrue has no recovery codes. Put this
to me:
  Option A (recommended): offer a second authenticator at enrolment, since GoTrue allows several
  factors. Add a support-assisted reset: an operator removes the factors after re-verifying the
  person through their payout account's KYC, and the reset starts PRODUCT_SPEC's 72-hour Safety
  Hold on withdrawals.
  Option B: app-generated single-use recovery codes, hash-stored in a new security table.
  Option C: a support-assisted reset only, with no hold.

FILES:
  - supabase/config.toml: [auth.mfa] max_enrolled_factors; [auth.mfa.totp] enroll_enabled = true
    and verify_enabled = true. Note the matching hosted settings in SYSTEM_ARCHITECTURE.
  - packages/backend/core/access-token.ts and its tests: surface aal, amr and session_id from the
    verified claims. packages/types/auth/user-context.ts: UserContext gains aal.
  - packages/backend/services/auth/MfaBackendService.ts (new): factors, enroll, challenge + verify,
    and unenroll, under the user's session. verify returns the aal2 session for re-issue.
  - apps/web/routes/api/auth/mfa/{factors,enroll,verify,unenroll}.ts: thin routes. verify uses the
    auth-throttle buckets (IW-H3), then respondWithReissuedSession.
  - packages/types/auth/mfa.ts (new): Zod inputs and outputs.
  - apps/web/features/settings/core/settings-registry.ts: an account.two-step entry.
  - apps/web/features/settings/components/sections/account/TwoStepBlock.tsx (new). Enrol with the
    QR image GoTrue returns plus the secret, and a CodeField to confirm. List and remove factors.
    The CSP already allows data: images (apps/web/utils/csp.ts:80).
  - apps/web/features/auth/components/StepUpDialog.tsx (new; MFA2 uses it too): the TOTP
    challenge.
  - An `aal` axis in apps/web/features/devtools/* and apps/web/utils/dev-seam.ts, for stub auth:
    auto, aal1 or aal2. Cookie pj.dev.aal, development only.
  - Docs:
    - ROUTING.md: /api/auth/mfa/*;
    - SYSTEM_ARCHITECTURE.md §Authentication: the auth route table and MFA;
    - PRODUCT_SPEC.md §Authentication, "Two-step verification": enrolment is built; the step-up
      stays "Not built yet" until MFA2;
    - DESIGN_SYSTEM.md §C.1, if you add a @projective/ui component (a QR display, say).

STEPS:
  1. Turn TOTP on locally. Confirm that the access-token hook keeps aal, amr and session_id: it
     edits claims with jsonb_set, so decode a token after a verify to check.
  2. Build the service and the routes.
     - A failed verify counts against the per-identifier throttle.
     - Unenrolling needs an aal2 session; GoTrue enforces that, so map its refusal to a step-up
       answer.
  3. The Settings entry and section: enrol, confirm, list and remove. The copy names the five
     actions that will ask for the code (MFA2).
  4. StepUpDialog takes a factor id, runs challenge + verify, then resolves so the caller can
     retry. With no factor enrolled, it explains and links to Settings → Account → Two-step.
  5. Build recovery per the 🧑 ruling.

SAME CHANGE: ROUTING and the SA route table; the Dev Context Switcher axis; PRODUCT_SPEC; §C.1 if
a @projective/ui component changes. No schema change, unless the ruling is Option B.

ACCEPTANCE:
  - Live (deno task dev with AUTH_BACKEND_LIVE): enrol with a TOTP app, sign out, sign in and step
    up. The token's aal is now aal2. Then remove the factor.
  - Unit tests: claim decoding (aal present and absent), route validation, and the throttle on
    verify.
  - Screenshots of the enrolment section and the dialog at 1440 and 390 px, in the four modes.
```

### MFA2 — The sensitive-route guard: AAL2 step-up and a live-session check

```text
PROMPT MFA2: The sensitive-route guard: an AAL2 step-up and a live-session check on five actions

ROLE: Auth and security engineer. SQL lane for steps 2 and 3 (00001001, 00001020, 00001060); app
lane for the rest. ⏳ MFA1; ⏳ ARC1 (00001020) and ERA4 (00001060).

CONTEXT:
  Findings: IW-M12 and F9. Access tokens live 1 hour and are verified locally, so a banned, erased
  or signed-out-elsewhere token keeps acting until it expires (SA:2197-2200).
  Ruled (Decision #336, ruling I3 (a), (b)):
  - a mandatory AAL2 step-up for withdrawals, payout-account changes, ownership transfer, co-owner
    grants and erasure;
  - keep the 1-hour JWT, and check auth.sessions (KV-cached) on the same money, authority and
    erasure routes.
  The AAL2 checks inside the money RPCs are MFA3, ⏳ the F·DB phase.

THE FIVE ACTIONS (routes → SQL doors):
  - Withdrawal: POST /api/wallet/payouts, and /api/wallet/action with withdraw →
    finance.begin_payout (00001240:248; MFA3).
  - Payout-account change: /api/finance/connect/onboarding and /refresh →
    finance.record_payout_account (00001230:1464; MFA3).
  - Ownership transfer: /api/workspace/transfer-ownership → org.transfer_workspace_ownership
    (00001020:3037).
  - Co-owner grant, a reserved right given to a named admin (Decision #238): /api/workspace/member →
    org.fn_assert_reserved_change (00001020:877). Only when the change ADDS a reserved right; giving
    one up needs no step-up.
  - Erasure: POST /api/user/lifecycle, account scope and ERA2's explicit freelancer erasure →
    org.schedule_account_deletion and schedule_freelancer_removal(p_explicit) (00001060).

FILES:
  - supabase/migrations/00001001_functions_security_context.sql, two helpers:
    - security.fn_session_is_live(): the caller's session (auth.jwt()->>'session_id') is still in
      auth.sessions and not past not_after, and the user is not banned;
    - security.fn_assert_step_up(): a live session AND auth.jwt()->>'aal' = 'aal2'. A NULL
      auth.uid() is the service role and passes (the fn_assert_adult convention). It raises a new
      SQLSTATE that no migration uses yet (grep first; PT401 is free today), with the messages
      step_up_required and session_revoked.
  - supabase/migrations/00001020_functions_org_entities.sql and 00001060_…: PERFORM
    security.fn_assert_step_up() in the three org doors above.
  - supabase/migrations/00002510_permissions_function_grants.sql: fn_session_is_live to
    authenticated; fn_assert_step_up stays internal.
  - packages/backend/core/step-up.ts (new): maps the SQLSTATE to { stepUp: true } or to a revoked
    session, after the age-gate.ts and payout-gate.ts precedent.
  - packages/backend/services/auth/session-guard.ts (new): calls fn_session_is_live under the
    user's JWT, cached in Deno KV (openSharedKv, packages/backend/core/kv.ts) for a short TTL, keyed
    by session id. No cache when KV is unavailable. Logout deletes the key.
  - apps/web/utils/sensitive-guard.ts (new; route-level, like utils/age-gate.ts):
    requireLiveSession and requireStepUp, wired into the routes above. Thin routes stay thin.
  - The islands that start the five actions open StepUpDialog on a stepUp answer, then retry:
    - wallet withdraw (features/wallet). ⏳ F·UI2/UI3, who own WalletDialogs.tsx and
      WalletHome.island.tsx: touch only the submit handler, or hand them the helper;
    - Settings' payout account;
    - the workspace transfer dialog;
    - the member editor's reserved-grant confirm;
    - the account-delete dialog.
  - supabase/probes/step_up_guard.sql (new); unit tests for the mapper, the guard and the cache.
  - Docs:
    - SYSTEM_ARCHITECTURE.md §Authentication and §Session Integrity: the guard, the cache TTL, and
      the revocation window that remains;
    - PRODUCT_SPEC.md, the "Two-step verification" marker: built, except inside the payout doors,
      which MFA3 finishes;
    - ROUTING.md: the 401 step-up answer on the five routes.

STEPS:
  1. Reproduce: sign in twice, then sign out everywhere from one session. The other token still
     withdraws for up to an hour, and an aal1 session can transfer ownership.
  2. Write the SQL helpers and the three org doors. Probe them with request.jwt.claims set to aal1
     and to aal2, and with the auth.sessions row deleted.
  3. The route guard runs requireLiveSession first (cached), then requireStepUp.
     - A revoked session answers 401 and clears the cookies.
     - An aal1 session answers 401 { stepUp: true }.
  4. The islands share one helper: it runs the action, opens StepUpDialog on stepUp, and retries
     once.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place; the docs; ROUTING. No new Dev Context Switcher axis beyond
MFA1's `aal`, which the guard reads in stub mode.

ACCEPTANCE:
  - step_up_guard.sql:
    - aal1 → PT401 on transfer, on a reserved grant and on account deletion;
    - aal2 with a live session → passes;
    - a deleted auth.sessions row → session_revoked;
    - the service role passes.
  - Live: each of the five actions asks for the code once, then completes. A session signed out
    elsewhere is refused within the cache TTL.
  - `deno task test:probes` green; your own clean `deno task test:probes:fresh`; check, lint and
    test:unit green.
```

### MFA3 — AAL2 inside the payout doors (⏳ the F·DB phase)

```text
PROMPT MFA3: AAL2 inside the payout doors

ROLE: Postgres payments engineer. SQL lane, inside the F track's DB window on 00001240 and
00001230: run only when the coordinator hands this prompt the slot (§0.3).
⏳ MFA2 (the helper), F·DB2 and DB6 (00001230), and the F track's serial chain on 00001240.

CONTEXT:
  Findings: IW-M12.
  Ruled: withdrawals and payout-account changes need AAL2 (Decision #336, ruling I3 (a)).
  Why the SQL door matters: MFA2 guards the routes, but finance.begin_payout and
  finance.record_payout_account are granted to authenticated, and PostgREST is exposed. A stolen
  aal1 token can call them directly, so the SQL door is the real gate.

FILES:
  - supabase/migrations/00001240_functions_finance_money_movement.sql: begin_payout (:248).
  - supabase/migrations/00001230_functions_finance_stripe.sql: record_payout_account (:1464).
  - supabase/probes/step_up_guard.sql: extend it. Keep payout_lifecycle.sql and
    identity_payout_doors.sql green, setting aal2 claims wherever they withdraw.
  - packages/backend/services/finance/*: touch a call site only if a refusal needs mapping;
    MFA2's step-up.ts already maps the SQLSTATE.
  - Docs: documentation/database/finance/Functions.md; remove PRODUCT_SPEC's "Two-step
    verification" marker.

STEPS:
  1. PERFORM security.fn_assert_step_up() first in both doors. The service role passes: the cron
     payout sweeps and the webhook's sync_payout_account.
  2. Update every probe that withdraws as a user so it carries aal2 claims.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place; the finance docs; the PRODUCT_SPEC marker.

ACCEPTANCE:
  - step_up_guard.sql: begin_payout and record_payout_account refuse aal1 with PT401 and pass
    aal2.
  - finance_invariants.sql and every payout probe green. `deno task test:probes` green, then your
    own clean `deno task test:probes:fresh`.
```

---

## 8. Phase 7 — Minors (ruling I4)

### MIN1 — Under 16: no marketing email, no non-essential cookies

```text
PROMPT MIN1: Under 16, no marketing email and no non-essential cookies, under one global rule

ROLE: Comms and privacy engineer. App lane, plus one SQL step in the notify path (⏳ M·notify
engine, §0.4).

CONTEXT:
  Findings: K9 / F8 (ii).
  Ruled: one global rule on a non-consent lawful basis for EU/EEA users aged 13 to 15, with no
  marketing email and no non-essential cookies under 16 (Decision #336, ruling I4). Wave 1.1
  already corrected PRODUCT_SPEC's Art. 9 rationale to Art. 5(1)(c).
  Today:
  - the comms 'marketing' category is opt-in (00005010:126-128), and the newsletter is double
    opt-in (community.newsletter_subscriptions);
  - the cookie inventory (features/legal/core/content/cookies.ts) lists only essential and
    preference cookies: none is non-essential.

FILES:
  - The notify path's channel resolution: supabase/migrations/00001310_functions_comms_
    notifications.sql today, or the M track's notify engine if it has landed. A recipient under 16
    (org.fn_age_years(dob, timezone) < 16) gets no 'marketing' category on any channel.
  - The newsletter subscribe door (community: 00001320, or its service): refuse a signed-in
    account under 16, with the same sentence the UI shows.
  - apps/web/features/settings, the notifications section: hide the marketing toggles under 16.
    Read the age band from the server (get_own_private_profile), never from a client flag.
  - apps/web/features/legal/core/content/cookies.ts, plus a unit test that pins every cookie's
    class (essential or preference). Document beside the inventory that a new non-essential cookie
    must check the age band first.
  - The age axis in apps/web/features/devtools/* and apps/web/utils/dev-seam.ts gains a 13 to 15
    position (DEV_AGE_RESTRICTIONS, dev-context.ts:964), so the band can be simulated.
  - supabase/probes/under16_marketing.sql (new).
  - Docs: PRODUCT_SPEC.md, the age-bands paragraph (remove "Not built yet for the under-16 rule");
    documentation/database/comms/Functions.md.

STEPS:
  1. Probe first:
     - a 15-year-old's marketing.product_update produces no delivery on any channel;
     - a 17-year-old's follows their prefs;
     - a newsletter subscription for a 15-year-old's account is refused.
  2. Build it at the one channel-resolution point, not per sender.
  3. Settings, the cookie guard and the dev axis.

SQL SESSION RULES (for the notify step): run probes with `deno task test:probes`. At most 2 SQL
sessions on the one local DB at once, on disjoint migration files; announce each reset first.
Finish with your own clean `deno task test:probes:fresh`.

SAME CHANGE: the PRODUCT_SPEC marker; the database/comms docs; the Dev Context Switcher axis
(reflect()'s set AND delete).

ACCEPTANCE:
  - under16_marketing.sql green, and the cookie classification test passes.
  - Settings screenshots for an account aged 13 to 15.
  - `deno task test:probes` green; your own clean `deno task test:probes:fresh`.
```

### MIN2 — The adult-proxy model, behind a flag that stays off (⚖️)

```text
PROMPT MIN2: The adult-proxy model for contributors aged 13 to 17, built behind a flag that stays
off (⚖️)

ROLE: Postgres workspace engineer. SQL lane. ⏳ MFA2 (00001020). ⚖️: never switch the flag on.

CONTEXT:
  Findings: F8 / K9.
  Ruled: for workspaces the owner chose to BUILD the adult-proxy model. It is built behind its off
  flag and switched on only after counsel signs off (Decision #336, ruling I4, ⚖️).
  The spec (PRODUCT_SPEC §Age guardrails):
  - an adult (18+) holds the verified Team or Business vault, executes the stage contracts, and
    assumes full legal, contractual and IP-indemnification liability;
  - the minor never holds money;
  - no raw guardian ids are stored.
  Today the "off" state is trg_workspace_member_adult's hard refusal (00001010:784). Despite the
  ruling's "existing off flag", NO flag exists (§0.5 (d)): this prompt creates it.

🧑 DECISION — STOP before you admit a minor to a TEAM. Teams are the freelancer side of the market
(Decision #228 (A), org.fn_assert_team_persona), and nobody under 18 holds a freelancer persona
(Decisions #190, #192). So PRODUCT_SPEC's "contribute within a Team or Business" cannot hold for
teams without an exception. Put this to me:
  Option A (recommended): the proxy covers business seats only, until counsel designs team work.
  Option B: a proxied minor may hold a team seat without the persona, with no share and never as a
  payee: an exception to #228 (A).
  Option C: build nothing for teams, and record it for counsel.
The business half needs no further ruling: build it.

FILES:
  - supabase/migrations/00005001_seed_platform_params.sql: a #region seeding
    security.feature_flags ('org.minor_workspace_proxy', enabled = false).
  - supabase/migrations/00001010_functions_org_onboarding.sql: trg_workspace_member_adult. While
    the flag is off, refuse exactly as today. While it is on, admit a minor only to a business (per
    the ruling) whose owner is an adult with a verified vault, at a member preset with no money
    capability.
  - supabase/migrations/00001020_functions_org_entities.sql: fn_member_capabilities and
    fn_vault_capabilities_for.
    - A minor's seat never carries contribute_funds, spend_funds, withdraw_funds, approve_spend,
      manage_billing, purchase or hire, and it projects to 'view'.
    - Invites, join requests and role edits refuse to grant those to a minor.
    - A minor holds no contribution_agreements share.
  - supabase/probes/minor_proxy_flag.sql (new):
    - flag off → every minor seat refused PM403;
    - flag on (inside the rollback) → a business seat admitted with 'view' only and no money right;
    - teams per the ruling.
  - Docs: documentation/database/org/{Functions,Policies}.md; PRODUCT_SPEC.md, the proxy
    paragraph: "Not built yet" → built, switched off pending counsel; PRODUCT_MANAGEMENT.md if the
    seat lifecycle notes change.

STEPS:
  1. Create the flag, off. Read it through one helper, org.fn_minor_proxy_enabled().
  2. Build the admission rule and the capability caps above. The database stays the only gate.
     There is no app axis, because the gate lives in Postgres (the workspace-axes precedent,
     SA:1945-1947).
  3. Probe both flag states inside rollback transactions.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place; the docs; PRODUCT_SPEC. No Dev Context Switcher axis: say why in
the commit message.

ACCEPTANCE:
  - minor_proxy_flag.sql green, with the flag off by default after a fresh reset.
  - workspace_seats.sql and workspace_rank_rule.sql still green.
  - `deno task test:probes` green; your own clean `deno task test:probes:fresh`.
```

---

## 9. Phase 8 — Last: the `users_public` row policy (IW-M13)

### RLS1 — `org.users_public` rows follow profile visibility

```text
PROMPT RLS1: org.users_public rows follow profile visibility

ROLE: Postgres RLS engineer and backend-services engineer. SQL lane, LAST in the track.
⏳ the F, P and C SQL steps; F·SV2, SV3 and SV5 (live-wallet.ts); and M·N1 (the messaging
services): §0.4.

CONTEXT:
  Findings: IW-M13. The users_public SELECT policy admits every signed-in account to every row
  (00002010:10-13). So the names, handles, headlines and interests of PRIVATE profiles, minors'
  included, are enumerable. IW-C1's column half is already fixed (00002520).
  The rule restored: PRODUCT_SPEC's 13-17 rules 3 and 5, and SA:2788. No ruling is needed. It runs
  last because it breaks every invoker reader of other people's names.

FILES:
  - supabase/migrations/00002010_policies_org.sql: the policy at :10-13 becomes own row OR
    org.fn_profile_visible('user', user_id).
  - The invoker readers, each moved to a definer or onto org.get_party_cards (00001040:914):
    - org.view_business_staff (00003001:7);
    - projects.get_dashboard_projects (00001100:550);
    - catalogue.get_client_pipeline (00001170:1411);
    - finance.list_ledger (00001210:3199);
    - the service reads of other people's rows in packages/backend/services/**. Grep
      users_public: finance/live-wallet.ts and wallet-ledger.ts, messaging/live-*.ts,
      projects/live-*.ts, files/live-library.ts, explore/*, editorial,
      user/SettingsBackendService.ts, and others.
  - supabase/probes/users_public_rows.sql (new). Keep users_public_private_columns.sql green.
  - Docs: documentation/database/org/Policies.md, and Functions.md for each moved reader.

STEPS:
  1. Probe first. As an unrelated signed-in account, SELECT a private profile's row: 1 row today,
     0 after the change. The owner still reads their own, and fn_profile_visible's public and
     unlisted rules still hold.
  2. List every invoker read of another person's users_public row, in SQL and in TypeScript. Move
     each onto a definer projection that returns only the columns its surface shows; use party
     cards first.
  3. Flip the policy. Run every probe and the unit suites. Then walk the seeded personas through
     the wallet ledger, a project board, messaging, the business staff list and the client
     pipeline.

SQL SESSION RULES: run probes with `deno task test:probes`. At most 2 SQL sessions on the one
local DB at once, on disjoint migration files; announce each reset first. Finish with your own
clean `deno task test:probes:fresh`.

SAME CHANGE: migrations in place; database/org/Policies.md. Nothing else changes shape.

ACCEPTANCE:
  - users_public_rows.sql green, and every other probe green.
  - The persona walk shows every name it showed before.
  - `deno task test:probes` green; your own clean `deno task test:probes:fresh`.
```

---

## 10. Any time — the remaining Low findings

### LOW1 — The Low identity findings

```text
PROMPT LOW1: The remaining Low identity findings

ROLE: Full-stack engineer. App lane, any time; file-disjoint from the SQL chain, but never at the
same time as OWN2 or SSO1 (features/auth).

CONTEXT: IDENTITY_AND_WORKSPACES_AUDIT §7, the Low list. No ruling is needed. Check each item
against the code before you touch it: Wave 0 closed IW-L1, IW-L2, the teams.visibility CHECK and
enable_freelancer_profile's search_path.

ITEMS (one small commit each):
  1. IW-L3, stale comments. ContextBackendService.ts:32-39 and :65: the route re-issues the
     session itself. useContextSwitch.ts:27: RLS reads no claims.
  2. IW-L4: unit tests for ContextBackendService.switchContext and the switch route (refusal
     mapping, claimsStale).
  3. IW-L5: GET /api/settings/[section] serves the billing, verification and scheduling payloads to
     a minor. Gate the adult-only sections server-side (settings-ssr.ts, the registry's adultOnly)
     with refuseIfRestricted.
  4. PII in the URL. joinCompletionTarget (auth-routing.ts:95-101) puts the email and names in
     /join's query string. /join is reached already authenticated, so read the prefill from the
     session's own claims on the server (oauthPrefillFromClaims), and keep only the oauth marker and
     redirectTo in the URL.
  5. /join ignores the server's lock cookie: age-lock.ts uses per-tab sessionStorage. The page
     should read pj_join_age_lock on the server and render the locked state.
  6. /register and /reset sit in AUTH_PATHS (redirect.ts:27-36) with no route. Either 301 /register
     → /join and /reset → /forgot-password, or drop them from the list.
  7. safeRedirect accepts /api/* as a return target: refuse it.
  8. IW-L6: fn_profile_visible('enterprise', id) answers true for any active enterprise, which makes
     it an existence oracle. If no private enterprise page exists, record that as intended in
     database/org/Functions.md. A SQL change needs a ruling.
  9. api/user/preferences.ts re-implements readActor inline: use the shared helper.

SAME CHANGE: ROUTING.md for items 4 to 6, and a test beside each change.

ACCEPTANCE: each item has a test or a recorded reason; deno task check, lint and test:unit green.
```

---

## 11. Roadmap (not buildable yet)

### X1 — Verified domains, SAML and JIT seats; domain-colleague alerts

```text
PROMPT X1: Verified domains, SAML and JIT seats, and domain-colleague alerts (roadmap)

ROLE: Product architect. Docs only until the 🧑 stop is answered.

CONTEXT:
  Findings:
  - IW-H1 / K12: fixed by deletion on 2026-10-29.
  - IW-M11 / K8: the dead SSO control.
  - Audit §6.6: there is no domain table.
  Ruled (Decision #336, ruling S7):
  - (a) the alerts return later, on DNS-verified domains, with a free-mail denylist;
  - (b) the SSO roadmap is verified domains → SAML through GoTrue → JIT seats;
  - (c) on the Enterprise plan only.
  The plan table's "SAML/OIDC" means this roadmap, not OIDC first.

🧑 DECISION — STOP. Put this to me: when does the build start?
  Option A (recommended): when the first Enterprise customer asks. Supabase SSO needs a paid
  project tier and a registration per identity provider (`supabase sso add`). Build verified
  domains first, since they also unlock the alerts; then SAML; then JIT seats.
  Option B: build verified domains now, and SAML on demand.

SPEC TO RECORD (no code):
  - org.enterprise_domains (domain, txt token, verified_at, status), checked by a DNS TXT lookup,
    with a free-mail denylist.
  - An alert goes out only after the colleague confirms their address. It names no address and
    offers "invite your colleagues" instead.
  - SAML per verified domain, and a JIT seat into enterprise_members at a default role.
  - Every SSO identity still passes the DoB and profile step (IW-M11). Today callback.ts:67 routes
    a new SSO identity as provider "google" and never returns it to onboarding, so the JIT build
    must route it through /join completion.
  - All of it is gated by the Enterprise plan's entitlement (#252).
  Land these as **Planned** entries in PRODUCT_SPEC §Authentication, SYSTEM_ARCHITECTURE
  §Authentication, and the SSO row of finance-model §16.1 (already Planned). Check that they say
  exactly this, and no more.

ACCEPTANCE: the three docs agree, and no code changed.
```

### X2 — The AML-ready programme, dormant behind flags (⚖️)

```text
PROMPT X2: The AML-ready programme, dormant behind flags (roadmap; ⚖️)

ROLE: Compliance architect. Docs only until the 🧑 stop is answered.

CONTEXT: Ruled, pending counsel (Decision #336, ruling I1 ⚖️; PRODUCT_SPEC §AML "Posture": Not
built yet):
  - Projective operates as not AML-obliged, but every AML function, record and process exists and
    is deployable.
  - The data half runs from day one: CDD and KYC references, transaction-monitoring signals, and
    retention covering the AML period. ERA2 and ERA4 build the retention and the AML-grade identity
    set.
  - The programme half stays dormant behind flags: an MLRO role, a suspicious-activity review
    queue, regulator registration, and reporting exports.
  PRODUCT_SPEC §AML 3 already promises the ComplianceService's round-tripping and rapid-churn flags,
  and the 72-hour Safety Hold.

🧑 DECISION — STOP. Put this to me: who builds what?
  Option A (recommended): the F track builds the monitoring signals, which read money movement on
  00001240, and the Safety Hold. This track builds the dormant programme: security.feature_flags
  aml.* = false, an operator role row, and a review-queue table with no writer. Counsel's sign-off
  switches nothing on.
  Option B: one compliance track owns all of it after Wave 2.

ACCEPTANCE: the ruling is recorded, and PRODUCT_SPEC's marker names the prompts that will build it.
```

---

## 12. Last — Docs

### Z1 — Identity docs sweep and the audit status columns

```text
PROMPT Z1: Identity documentation sweep and the audit status columns

ROLE: Documentation steward. Runs after every prompt above has merged.

FILES:
  - documentation/database/{org,security}/*.
  - business/PRODUCT_SPEC.md: §Authentication, onboarding, the age guardrails, and §Identity,
    Taxes & Compliance.
  - business/finance-model.md §17 and PRODUCT_MANAGEMENT.md §3.5.
  - architecture/SYSTEM_ARCHITECTURE.md: §Authentication, §Security, the env contract and the
    restore runbook.
  - architecture/ROUTING.md and design-system/DESIGN_SYSTEM.md §C.1.
  - architecture/IDENTITY_AND_WORKSPACES_AUDIT.md and IDENTITY_DECISIONS_AND_GAPS.md: add a Status
    column, reading "Fixed by <prompt or Wave 0 commit>" or "Open, owner <track>".
  - The #336 row (each flag resolved, with its ruling and prompt), and #87 (b), (c), which OWN1
    closes.

SPEC: rollup, not restatement (documentation/CLAUDE.md rule 2).
  - Every IW-*, K* and F* item ends Fixed, or Open with an owner.
  - Every "Not built yet (Decision #336 …)" marker is gone, or names the prompt that still owes it.
  - ⚖️ items stay marked pending counsel.

ACCEPTANCE:
  - grep -n "Decision #336" in documentation/business and documentation/PRODUCT_MANAGEMENT.md
    shows no "Not built yet" without an owner.
  - The status columns have no blank cell.
```
