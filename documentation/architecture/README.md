# Architecture Documentation

Technical architecture and system directives for Projective, and the index of the audit set.

## Source of truth and reference designs

| File                                                               | Purpose                                                                                                                                                                                                                                                                                                 |
| :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md)                 | **Canonical technical source of truth** (renamed from `brain2.md`). System Directives, Islands boundary, SOLID, the `@projective/ui` taxonomy, package overviews (Fields/Data/UI/Charts/WASM), Database conventions, Security, Caching, State Hydration, Integration Blueprints, Testing, Env contract. |
| [`ROUTING.md`](ROUTING.md)                                         | Routing and folder conventions for `apps/web`: route groups, the route skeleton under `apps/web/routes/`, link shapes, slugs and query state. Companion to `SYSTEM_ARCHITECTURE.md` §2 and the `PRODUCT_SPEC.md` sitemap.                                                                               |
| [`ASSET_DELIVERY_ARCHITECTURE.md`](ASSET_DELIVERY_ARCHITECTURE.md) | **Proposed design, not binding.** Asset storage isolation, proxy-only delivery, direct-link interception, upload safety and per-format strategy for the digital marketplace, opening with the blocker that no buyer can receive a purchase today. Decision #393, rulings A1 to A11.                     |
| [`ANTI_PIRACY_ENGINE.md`](ANTI_PIRACY_ENGINE.md)                   | **Proposed design, not binding.** Transaction fingerprinting, creator watermark controls and diff verification, best-effort leak detection, creator-confirmed takedowns, and AI scraping resistance. Decision #393, rulings B1 to B10.                                                                  |
| [`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md)             | **Answered 2026-10-30.** Every open ruling across the 2026-10 audits in one form (Part A, answered), the execution order and parallel-session lanes for the build work (Part B), and the ruling table (Part C) whose IDs (M1, C1, P1, …) the audits and prompts cite.                                   |

## Audits and work orders

**Evaluation and work orders, not binding.** Each domain has one audit and at most one build-prompts
file. Every finding carries a Status derived from the audits' banners, the run orders, the
questionnaire's Part C and commit messages, not re-verified in code. Rulings are never restated
here: their full text is the decision row named in the last column (`reference/decisions/`).

| Domain                                                                                                                                                                                            | Audit                                                                                                | Work orders                                                        | Decision   |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- | :--------- |
| Finance & ledger: the ledger, pending window, escrow, Connect, KYC/KYB, webhooks, sub-ledgers, vault doors, multi-currency, checkout and the wallet; contradictions X1–X24 and decisions D-1–D-13 | [`FINANCE_AUDIT.md`](FINANCE_AUDIT.md)                                                               | [`FINANCE_BUILD_PROMPTS.md`](FINANCE_BUILD_PROMPTS.md)             | #337       |
| Subscriptions, agency scale and public pricing                                                                                                                                                    | [`SUBSCRIPTIONS_AUDIT.md`](SUBSCRIPTIONS_AUDIT.md)                                                   | [`SUBSCRIPTIONS_BUILD_PROMPTS.md`](SUBSCRIPTIONS_BUILD_PROMPTS.md) | #252       |
| Projects & execution: the three project types, claims, $W_i$, Chain Reaction, Fair Exit, ghosting, Submissions, Kanban/Gantt, the stage-dependency guard, workload reports                        | [`PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md`](PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md)               | [`PM_BUILD_PROMPTS.md`](PM_BUILD_PROMPTS.md)                       | #338       |
| Scheduling, calendar & sessions: booking, coordination, the session money path, paid 1-on-1 calls, integration readiness, privacy                                                                 | [`SCHEDULING_COMPLETENESS_AUDIT.md`](SCHEDULING_COMPLETENESS_AUDIT.md)                               | [`SCHEDULING_BUILD_PROMPTS.md`](SCHEDULING_BUILD_PROMPTS.md)       | #343       |
| Identity & workspaces: auth paths, the acting context, restricted minors, the permission engine, RLS, erasure, MFA, SSO                                                                           | [`IDENTITY_AND_WORKSPACES_AUDIT.md`](IDENTITY_AND_WORKSPACES_AUDIT.md)                               | [`IDENTITY_BUILD_PROMPTS.md`](IDENTITY_BUILD_PROMPTS.md)           | #336       |
| Messaging, notifications, assets & discovery search                                                                                                                                               | [`COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`](COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md)                     | [`COMMS_BUILD_PROMPTS.md`](COMMS_BUILD_PROMPTS.md)                 | #339       |
| Security, moderation & the AI pipeline, and the safety node (its runbook and node prompts are the prompts file's §8)                                                                              | [`SECURITY_MODERATION_AND_AI_GAPS.md`](SECURITY_MODERATION_AND_AI_GAPS.md)                           | [`TRUST_SAFETY_BUILD_PROMPTS.md`](TRUST_SAFETY_BUILD_PROMPTS.md)   | #340, #345 |
| Redundancy, `@projective/ui` adoption, caching and doctrine (sign-off questions Q1–Q17), and modals and overlays (§9)                                                                             | [`PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md`](PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md) | [`OPTIMIZATION_BUILD_PROMPTS.md`](OPTIMIZATION_BUILD_PROMPTS.md)   | #341, #404 |

### Short names and IDs

ID letters repeat across audits, so an ID is always cited with its audit's short name: `CAS S17`,
`SCA S-02`, `FCA N7`, `RED D-07`. A short name of a merged file still resolves: its IDs are
unchanged in the audit it went into, and that audit ends with a map of the merged file's old
sections.

| Short name                                                                          | Now                                                                                       | ID namespaces                                                                                                                                        |
| :---------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| FA · FCA · FDD                                                                      | `FINANCE_AUDIT.md` (old sections: §14)                                                    | FA: L · W · E · S · K · H · A · V · R · M · Z · C · CO · D1–D30 (design) · flags (a)–(t). FCA: N1–N34. FDD: X1–X24 · D-1–D-13 (hyphenated decisions) |
| SBP-A ("SA" in the questionnaire)                                                   | `SUBSCRIPTIONS_AUDIT.md`                                                                  | L1–L17 · M1–M4 · G1–G6 · R1–R6 · D1–D11 · #252 (a)–(m)                                                                                               |
| PMA · DL                                                                            | `PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md` (DL §n = §n+8; old sections: §16)              | PMA: X1–X19 · F1–F5. DL: S1–S13 · C1–C6 · W1–W10 · D1–D16 (D16-a/b/c) · #338 (a)–(n)                                                                 |
| SCA · SDG                                                                           | `SCHEDULING_COMPLETENESS_AUDIT.md` (SDG §n.m = §12.n.m; old sections: §16)                | SCA: S-01–S-41 · #343 (a)–(e). SDG: D0–D9                                                                                                            |
| IWA · IDG                                                                           | `IDENTITY_AND_WORKSPACES_AUDIT.md` (old sections: §15)                                    | IWA: IW-C1 · IW-H1–H8 · IW-M1–M13 · IW-L1–L7 · IW-D1–D5. IDG: K1–K12 · F1–F9                                                                         |
| CAS                                                                                 | `COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`                                                   | M1–M25 · N1–N12 · F1–F33 · S1–S39 · D1–D9 · #339 (a)–(n)                                                                                             |
| SEC                                                                                 | `SECURITY_MODERATION_AND_AI_GAPS.md`                                                      | E1–E8 · L1–L9 · T3-1–T3-4 · Z1–Z6 · P-1–P-5 · R1–R5 · V1–V6 · AV-1–AV-5 · G1–G20 · #340 (a)–(m)                                                      |
| RED · ADC · MOD                                                                     | `PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md` (ADC = §2, MOD = §9; old sections: §10) | RED: U-01–U-30 · L-01–L-20 · D-01–D-31 · G-1–G-6 · QW / SC / DB rows. ADC: Q1–Q17, flags (a)–(q). MOD: FA M1–M5 and the per-overlay rows             |
| FBP · SBP · PMBP · SCHBP · IBP · COMMS · TRUST (with the node's H1–H5, N0–N6) · OPT | the build-prompts files, in the table above                                               | prompt IDs (DB, SV, UI, PM-WP, SCH-WP, SN, …)                                                                                                        |

"SA" means `SYSTEM_ARCHITECTURE.md` everywhere except the questionnaire's source list, where it
named the subscriptions audit.

### Shared topics: one owner each

A topic more than one audit covered is analysed in full only by its owner; the others keep their IDs
as aliases, their own facts and a pointer. The last column is the ruling that settled it.

| Topic                                                     | Owner                             | Aliases elsewhere                           | Ruling |
| :-------------------------------------------------------- | :-------------------------------- | :------------------------------------------ | :----- |
| Paid 1-on-1 calls: the consultation money path            | SCA §12.1 (SDG D1, S-02)          | FCA N2 · FDD X2, D-2                        | C1     |
| Session cancellation, reschedule and release windows      | SCA §12.2 (SDG D2)                | FDD X1, X5, D-1, D-4                        | C2     |
| Fair Exit, removal and deletion refunds                   | PMA (DL D2, D3, D4)               | FDD D-9 (b), X7                             | P1, P2 |
| Ghosting auto-approve: a held escrow that never times out | PMA §12.3                         | FCA N16 · FDD X16, D-9 (a)                  | P3     |
| Claim-TTL sweeps                                          | PMA (DL D1)                       | SBP-A claim-TTL fairness rows               | Q0.3   |
| Board authority and addressable board state               | PMA (DL D10–D14, D16-b)           | ADC Q14 (the general doctrine stays in RED) | P5, P7 |
| Deadline bonus funding                                    | FCA (N4, D-11)                    | DL D16-a                                    | M7     |
| Payout-ready gate scope                                   | FCA (K-rows, N12, N14, D-7)       | SBP-A §2.3 (roster scale)                   | M4     |
| Product-sale commission vs the stage fee                  | FCA (N3, X3, X4, D-3)             | ADC Q1 · SBP-A #252 (l)                     | M1     |
| Team money: splits, departures, treasury                  | FCA (A19)                         | IDG F3 rider · SBP-A §2.4 (nested splits)   | M10    |
| Wallet and checkout design-gate defects                   | FCA (FA D1–D30, N28)              | RED U-rows (cross-cutting primitives)       | E3     |
| Erasure model                                             | IWA (IDG F1–F3, K1)               | SEC G16 · CAS S17                           | I1     |
| MFA, step-up and session revocation                       | IWA (IDG F7, F9)                  | FBP step-up notes                           | I3     |
| Minors (13–17)                                            | IWA (§4.2, §6.4, IDG F8)          | the other audits' minor rows                | I4     |
| Enterprise SSO and domains                                | IWA (IDG F5, F6)                  | SBP-A #252 (b), (j)                         | S7     |
| Money on screen (`MoneyView`)                             | RED (ADC Q16, L-rows)             | FCA N10 (finance instances)                 | E2     |
| Caching, read models and invalidation                     | RED (ADC Q2, Q7, Q10–Q13, D-rows) | CAS §6.2 (the real-time stream)             | E1, N2 |
| Root `CLAUDE.md` hard numbers and fee wording             | RED (ADC Q1)                      | FCA N31 · FDD X4 (applied in `f1f10e31`)    | Q0.5   |
| Unified messaging and the inbox read model                | CAS §6.1                          | ADC Q8                                      | N1     |
| Search ranking                                            | CAS (S11)                         | RED D-28 / DB-9                             | N4     |
| Notification engine and the comms queue worker            | CAS §2                            | SDG D9                                      | N3     |
| Modal and overlay inventory                               | RED §9 (MOD)                      | FA §1.10 (statuses in FCA §5.10) · ADC Q17  | #404   |

### Open contradictions

Comparing the audits turned up about forty-five disagreements; most were stale statuses, counts or
line drift, settled in the Status columns. Eight are conflicts between source documents, logged as
**Decision #410** flags (a)–(h) and not resolved: (a) checkout's Save card tier (FCA §9); (b)
erasure nulling vs deleting query logs and (c) HK1's RESTRICT on `enterprise_members` (IWA §11); (d)
the `styleVars` guardrail (PMA §13); (e) the `inbox_tails` signature (RED §6); (f) showcase video
bytes and (g) where the notification dispatcher runs (CAS §10); (h) screening public copy before
publication (SEC §10).

### Retired and merged files

Recover any of these with `git show <commit>:documentation/architecture/<file>`. Decision rows still
cite their old names, as history.

| File                                                                                                                                                                                                                          | Went                                                                    | Commit to read it at |
| :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- | :------------------- |
| `FINANCE_COMPLETENESS_AUDIT.md` · `FINANCE_DISCREPANCIES_AND_DECISIONS.md` (and the first `FINANCE_AUDIT.md`)                                                                                                                 | merged into `FINANCE_AUDIT.md` (2026-11-11)                             | `08296359`           |
| `PROJECT_MANAGEMENT_DECISION_LOG.md`                                                                                                                                                                                          | merged into `PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md`                  | `08296359`           |
| `SCHEDULING_DECISIONS_AND_GAPS.md`                                                                                                                                                                                            | merged into `SCHEDULING_COMPLETENESS_AUDIT.md`                          | `08296359`           |
| `IDENTITY_DECISIONS_AND_GAPS.md`                                                                                                                                                                                              | merged into `IDENTITY_AND_WORKSPACES_AUDIT.md`                          | `08296359`           |
| `ARCHITECTURAL_DECISIONS_AND_CLARIFICATIONS.md` · `MODAL_AUDIT.md`                                                                                                                                                            | merged into `PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md`           | `08296359`           |
| `SAFETY_NODE_SETUP_AND_BUILD_PROMPTS.md`                                                                                                                                                                                      | merged into `TRUST_SAFETY_BUILD_PROMPTS.md` §8                          | `08296359`           |
| `WAVE1_CLAUDE_MD_PROPOSAL.md`                                                                                                                                                                                                 | deleted: the root `CLAUDE.md` edit it drafted was applied as `f1f10e31` | `08296359`           |
| `MVP_FLOW_AUDIT.md` · `MVP_FIX_PROMPTS.md` · `TEAMS_AUDIT.md` · `TEAMS_BUILD_PROMPTS.md` (#226) · `BUSINESSES_AUDIT.md` · `BUSINESSES_BUILD_PROMPTS.md` (#229) · `QUERY_OPERATOR_RECOMMENDATIONS.md` · `READ_API_FINDINGS.md` | retired 2026-10-29 in `660c9658`                                        | `660c9658^`          |

### Keeping the set free of duplicates

- **One audit and one prompts file per domain.** A re-verification updates the domain's audit in
  place (its Status column and evidence) rather than adding a second file that restates the first.
- **Merge, then delete.** A file folded into another is deleted; the survivor ends with a map of the
  old sections, and its IDs keep their names. No redirect stubs.
- **Rulings go to the decision log.** An audit keeps its option analysis (the only home of the
  rationale), each with a `Ruled:` or `Open:` line; it never copies a decision row.
- **Work goes to the build prompts.** An audit's backlog is a remediation map
  (`ID | Priority |
  Prompt | Status`); the fix text stays in the finding row.
- **A shared topic has one owner** (above); other audits keep aliases, their own facts and a
  pointer.
- **Status vocabulary:** `Fixed (<prompt>, <commit>)` · `Partly fixed` · `Ruled → <id>` ·
  `Open → <prompt>` · `Open (no prompt)` · `Superseded by <ID>` · `Unverified`.

## Relationship to the other pillars

- **Business logic** it serves lives in
  [`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md).
- **Component-layer** rules it delegates live in
  [`../design-system/DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md).
- **Per-domain schema** detail lives in [`../database/`](../database/README.md).
- **API / integration / route** detail lives in [`../api/`](../api/README.md).

## For future agents

`SYSTEM_ARCHITECTURE.md` is binding. Additive changes only; surface conflicts (root
[`CLAUDE.md`](../../CLAUDE.md) §8) rather than resolving them silently. The "Restructure Change Log"
at the bottom of `SYSTEM_ARCHITECTURE.md` records exactly what changed when it was renamed from
`brain2.md`. A new audit follows "Keeping the set free of duplicates" above.
