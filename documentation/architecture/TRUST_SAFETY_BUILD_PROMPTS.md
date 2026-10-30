# Trust & Safety Build Prompts — Claude Code Work Orders for the Leakage Pipeline, the Moderation Loop and the Safety Node

> **Status: WORK ORDERS, not binding.** This is a sequenced series of self-contained Claude Code
> prompts. Together they build Part B §B.3 track **T** of
> [`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md) and close the open gaps in
> [`SECURITY_MODERATION_AND_AI_GAPS.md`](SECURITY_MODERATION_AND_AI_GAPS.md) (SEC). Every prompt
> cites its evidence by finding ID (SEC `E*`, `L*`, `Z*`, `P-*`, `R*`, `V*`, `AV-*`, `T3-*`, `G*`;
> CAS `F*` from [`COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`](COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md);
> EPI flags from
> [`../api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md`](../api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md))
> and its ruling as `(Decision #340, ruling X)`. Paste each prompt into its **own fresh session**,
> after the standard header (§1).
>
> **Rulings.** Decision #340's OWNER RULINGS (2026-10-30) hold T1–T5 and Q0.2 (a) and (f); the
> questionnaire's Part C is the table. Run the prompts in the §0 order. A prompt marked **🧑
> DECISION** stops and puts the named question to a human, with options and a recommendation, before
> it changes behaviour there. **⚖️** means ruled pending counsel: build it behind a flag that stays
> off, and never switch it on.
>
> **Verified against the tree at `94d22e84` (2026-10-30).** Wave 0 closed SEC E1–E5, E7, E6/G12,
> G1–G3, G8, G9, G20, L1–L3, L4 (a) and (c), L5, L6, and SEC-P1c (Z2/P-2 by refusing video
> renditions; V1, V2, V4); `supabase/functions/scan-file` is gone. Still open, and built here:
> E8/G10 and the G11 deletion, L4 (b) and (d), L7, L8, L9, the public-copy check (§2.5, P-5), Tier
> 1, Tier 3, R1–R5 (with G15 and G19), G5, G6, G13, G14, G18 (the sync-trigger half), Z1, Z3–Z6, V3,
> V5, V6, AV-1–AV-5, the publication gate and Web Risk. Not in this track: G16 (identity's erasure
> chain), G17 (#336), CAS F14 metering and CAS F20–F29 (proxy and inspector hardening).
>
> **Migrations are edited in place** (root `CLAUDE.md` §1). Every prompt names the category file to
> edit. A new category-1 file for a new module (`00001660_functions_ops_moderation.sql`, created by
> P1d) is a new home, not a patch file.

---

## 0. Run order & dependencies

| Phase                        | Prompts                                                         | Why this order                                                                                                                                                                                                                                                                                                            |
| :--------------------------- | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0 — The last P0**          | E8                                                              | Q0.2 (a) removes the client write policies on six buckets and SVG from `public_assets`; Q0.2 (f) deletes the dead search definers. Every scanner and gate below sits behind a door an attacker can walk around until E8 lands (SEC §6, AV-1).                                                                             |
| **Any time**                 | W1                                                              | Web Risk and the Voyage pin (T5): two provider modules, no SQL.                                                                                                                                                                                                                                                           |
| **1 — The leakage pipeline** | P1d → P2a → P2b → P2c; P2d                                      | P1d builds Tier 1 and, in the same change, every Tier 2 category Tier 1 refuses (L8; PRODUCT_SPEC §Messaging 1.A: the database tier is the floor). P2a reuses P1d's categoriser for public copy. P2b widens the protected phase (T1) before P2c masks new surfaces with it. P2d closes the SEC grant leftovers.           |
| **2 — The moderation loop**  | R1 → R4 → R5 → R3 → R2                                          | SEC §3.3's order: the sink, the penalty writer, Standing, the reviewer, then the report button last, so it never renders before a reviewer can act on it (root `CLAUDE.md` §3.11).                                                                                                                                        |
| **3 — The safety node**      | SN1 → SN2 → SN3 → SN4 → SN5; SN6 after R3 and P2b; H1 after SN2 | ClamAV, then the one admission contract, then the publication gate (NudeNet + OCR), then Sightengine, then video. SN1 may start as soon as E8 merges (SEC §6 step 2) because it is file-disjoint from phases 1–2 apart from `00005060`. SN6 (Presidio) needs the review sink, the reviewer and the final phase predicate. |
| **Last**                     | Z1                                                              | Docs sweep, the SEC status column and the decision rows.                                                                                                                                                                                                                                                                  |

**SQL lane (Part B §B.0).** E8, P1d, P2a, P2b, P2c, P2d, R1, R4, R5, R3, SN1 (its job), SN2 (its
job), SN3, SN4 (dials) and SN6 run SQL. At most **two SQL sessions at once** across all tracks, on
disjoint migration files. Each announces its `deno task db:reset` to the other sessions, runs
`deno task test:probes` after each reset, and finishes with its own clean
`deno task test:probes:fresh`. W1, R2, SN5 and H1 are app or node work only.

### 0.1 Cross-track waits (⏳)

Track and step names are Part B's; the comms prompt IDs (MS1–MS5, NT1–NT5, SR1–SR4) are
`COMMS_BUILD_PROMPTS.md`'s.

| T prompt          | Waits for                                               | Why                                                                                                                                                                                                                                         |
| :---------------- | :------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E8                | —                                                       | Runs first. Q0.2 (f) is E8's per the Wave 1.2 brief; COMMS SR1 also lists that deletion (RED D-29), so SR1 skips it once E8 has merged. Both edit `00001400` and `00002510`: never run them in parallel.                                    |
| P1d               | ⏳ M·MS2 (soft)                                         | MS2 builds the single send door `MessagingBackendService.sendMessage(actor, ref, input)` (CAS §6.1, ruling N1): one Tier 1 insertion point, not two. If P1d must go first, it wires both doors and leaves a `shortcut:` comment naming MS2. |
| P2a               | ⏳ P·WP4                                                | `projects.projects` copy and its trigger file belong to the projects track while WP4 runs.                                                                                                                                                  |
| P2b               | ⏳ M·MS1, M·MS2, P·WP4                                  | `comms.dm_threads` (`00000016`) is in MS1's schema window; the thread openers sit behind MS2's door; a cancelled project's cooling-off reads WP4's lifecycle.                                                                               |
| P2c               | ⏳ P·WP4, C·WP10                                        | Ticket and submission text (`00000015`, `00001850`) and scheduling event text (`00001860`). Reactions are out: COMMS MS5 pins them to one emoji set.                                                                                        |
| P2d               | —                                                       | COMMS leaves G5, G6, G13, G14 to this track; SR1 pins `fn_nearest` / `fn_nearest_to_entity` (G18's function half), so P2d does only the sync triggers.                                                                                      |
| R1, P1d           | I's erasure chain (coordinate)                          | `ops.reports`, `ops.refusal_counts` and the evidence copies are personal data. The erasure arm lives in `00001060` (identity's hot file): whichever lands second adds it, as that file's single writer at the time.                         |
| R2                | ⏳ M·MS2, M·MS3                                         | The message menus live in the islands MS2 and MS3 rework.                                                                                                                                                                                   |
| R4                | not beside I's Q0.2 (b) prompt                          | Both edit `00000012_tables_security.sql`.                                                                                                                                                                                                   |
| R5                | not beside O's read-path work                           | `services/explore/live-catalog.ts` and `00002520`.                                                                                                                                                                                          |
| SN1, SN2, R5, SN6 | ⏳ jobs-sql (Wave 1.3)                                  | Each registers a job in `00005060`; one writer at a time across every track after that.                                                                                                                                                     |
| W1                | not beside M's search prompts (SR1–SR4)                 | `services/search/voyage-client.ts`.                                                                                                                                                                                                         |
| SN4               | ⏳ P2a and the owners of the public-copy write services | The text screen runs in the same doors.                                                                                                                                                                                                     |

### 0.2 Hot files (Part B §B.0) and other shared files

| File                                                    | T writers                              | Other writers                                    |
| :------------------------------------------------------ | :------------------------------------- | :----------------------------------------------- |
| `00001240` (finance money)                              | none                                   | F, P·WP4                                         |
| `00005060` (jobs)                                       | SN1, SN2, R5, SN6                      | F, M, P, C, jobs-sql                             |
| `00001155` (sessions)                                   | none                                   | every C step                                     |
| `00001020` (workspaces)                                 | none                                   | I, SA G4                                         |
| `00001060` (erasure)                                    | none (R1 and P1d hand their arms to I) | I, SEC G16                                       |
| `00001300` (comms)                                      | P1d, P2b, P2c, P2d, SN6                | COMMS MS1, MS4, MS5 and every CAS messaging step |
| `00002510` (grants)                                     | E8, P1d, P2d, R1, R3, R4, SN6          | many                                             |
| `stripe-webhook.ts` + `00001230`                        | none                                   | F DB2, DB6; S S4                                 |
| `live-wallet.ts` / `wallet-scope.ts`                    | none                                   | F SV2, SV3, SV5; O WP2                           |
| `features/devtools` + `dev-seam.ts`                     | SN1, SN3, R3                           | F SV4, UI3; S S4, S6; I F6                       |
| `00001400` (search functions)                           | E8, P2d                                | COMMS SR1–SR4                                    |
| `00002520` (table grants)                               | P2d, R5                                | many                                             |
| `00000012` (security tables)                            | R4                                     | I (Q0.2 (b) drops)                               |
| `00000013` (ops tables)                                 | P1d, R1, SN6                           | —                                                |
| `00000016` (comms tables)                               | P2b, P2d                               | COMMS MS1                                        |
| `00001840` (comms triggers)                             | P2c, P2d, SN6                          | COMMS                                            |
| `00005001` (platform params)                            | P2b, P2d, R4, SN1, SN2, SN3, SN4, SN6  | F (FX margin and dials)                          |
| `00005010` (notification catalog)                       | R3, SN3                                | COMMS NT1–NT5                                    |
| `MessagingBackendService.ts`, `projects/live-writes.ts` | P1d                                    | COMMS MS2, MS3; O D-06 / SC-9                    |

### 0.3 These cannot run in parallel inside T

- P1d / P2b / P2c / P2d / SN6 (`00001300`)
- E8 / P1d / P2d / R1 / R3 / R4 / SN6 (`00002510`)
- P1d / R1 / R3 / SN6 (`00000013`, `00001660`)
- SN1 / SN2 / R5 / SN6 (`00005060`)
- R3 / SN1 / SN3 (devtools + `dev-seam.ts`)
- SN2 / SN3 / SN5 / H1 (the upload and publish pipeline: `services/files/*`, `services/media/*`)
- SN1 / SN3 / SN5 (each waits for the node prompt that adds its route, §0.5)
- P2a / SN4 (the public-copy write services)
- P2c / P2d / SN6 (`00001840`)
- R3 / SN3 (`00005010`)
- E8 / P2d (`00001400`)

`00005001` is shared by eight T prompts, but each adds its own rows: two may overlap, and the second
rebases before it merges.

### 0.4 Open decisions the prompts stop at

None of the four non-⚖️ items still open after Wave 1.1 (`create_category` as a label, Agency and
Enterprise storage, the FX margin, the Agency contract rate) touches this track. The ⚖️ item here is
H1. These were found open while writing the prompts:

| Prompt | Question                                                                                                                                                                                                             | Recommendation                                                                                     | Kind                                           |
| :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- | :--------------------------------------------- |
| P2a    | Decision #147 flag (a): structured links (`org.profile_links`, a business's `website`) and article bodies                                                                                                            | Structured links refuse only payment and messaging hosts; article bodies follow the free-text rule | Open since #147                                |
| P2b    | The cooling-off length (T1 names the window, not its length)                                                                                                                                                         | 30 days, its own dial                                                                              | Unruled value                                  |
| P2b    | A cold DM opened from a profile reached through Explore (T1 covers marketplace surfaces and connected people only)                                                                                                   | Protect a thread between people who were not connected when it opened                              | Gap in T1                                      |
| R1     | The report reason vocabulary (Decision #148 flag (g); only `evasion_fragmentation` is ruled)                                                                                                                         | The eleven-reason list in R1                                                                       | Open since #148                                |
| SN3    | T3 (a) for a library file that is not an image or video                                                                                                                                                              | Only images (and videos after SN5) may be made Public                                              | Gap in T3 (a)                                  |
| SN4    | **New contradiction.** PRODUCT_SPEC §Messaging 1.C screens public text before publication and exempts nothing, but a hosted classifier cannot run in a trigger while clients hold direct write grants on public copy | Revoke the client write grants on public-copy columns (an approval like Q0.2 (a))                  | New — flagged here, not logged (Wave 1.2 rule) |
| SN4    | Sightengine's data-processing terms                                                                                                                                                                                  | A human signs them before `HOSTED_MODERATION_LIVE` is set                                          | Action                                         |
| W1     | Voyage's written no-training terms                                                                                                                                                                                   | A human obtains them before `EMBEDDINGS_ENABLED` is set (ruling T5)                                | Action                                         |
| SN1    | The node's VM and private link (4 vCPU / 8 GB, ruling T5)                                                                                                                                                            | A human provisions them; nothing here deploys                                                      | Action                                         |
| H1     | ⚖️ Known-image hash matching: provider, reporting body, preservation                                                                                                                                                 | Counsel decides; the flag stays off                                                                | ⚖️                                             |

Stale passages Wave 1.1 left, each corrected by the prompt that builds the thing: SA §Tier 3's "2 GB
RAM VPS" (SN1); SA §Content moderation's and EPI §6.3's "hosted fallback, off by default" (SN4); EPI
§6.3's "up to 16 sampled stills" against ruling T2's 30 (SN3); EPI §1.1 row 9's Safe Browsing (W1).

---

### 0.5 The safety node lives in its own repo

The owner created the node's repository, `Projective-Safety`, a sibling folder of this repo, and
committed its N0 (the scaffold and the HTTP contract) there, as
[`SAFETY_NODE_SETUP_AND_BUILD_PROMPTS.md`](SAFETY_NODE_SETUP_AND_BUILD_PROMPTS.md) §1 recommended.
That file owns the node: the human setup (H1–H5) and the node prompts (N1–N5). This file is the app
side only, and nothing here creates `infra/safety-node/`.

- **The contract wins on route names.** The node's `contract/openapi.yaml` serves `GET /healthz`,
  `POST /scan/file`, `POST /screen/image`, `POST /screen/video` and
  `POST /presidio/analyzer/analyze`, and node prompt N3 adds `POST /remux/video`. EPI §6's `/v1/…`
  examples yield to it, and the app's Zod is copied from it.
- **Order across the two repos.** Node N1 (the gateway) and N2 (ClamAV) before SN1; N3 (NudeNet,
  OCR, frame sampling and the video remux) before SN3 and SN5; N4 (Presidio) before SN6.
- **Sightengine stays in the app.** SN4 calls it for public media and public text only (ruling T2).
  The node has no Sightengine code and nudity never falls back to it, so the node file's N6 is
  withdrawn.

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere; Supabase Storage; the self-hosted safety node of EPI §6).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md; documentation/database/CLAUDE.md when SQL changes;
     packages/ui/CLAUDE.md when UI changes), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read documentation/architecture/SECURITY_MODERATION_AND_AI_GAPS.md (SEC: the finding IDs
     below), documentation/api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md §3.2, §3.4,
     §3.5, §3.6, §6 and §10 (EPI), and Decision #340's OWNER RULINGS
     (documentation/reference/decisions/decisions-122-126.md, grep '^| 340 |'; the ruling table is
     FOUNDER_QUESTIONNAIRE.md Part C).
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. At minimum read #128, #147, #148, #203, #212, #276, #308, #314,
     #335, #336, #339 and #340.
  4. Read PRODUCT_SPEC.md §Messaging 1 (1.A-1.C), SYSTEM_ARCHITECTURE.md §Contact & financial
     leakage prevention, §Content moderation and §Storage Lifecycle, and
     documentation/database/{comms,files,ops,security,search}/* for the objects you change.

Hard rules (merge gates; reject your own diff if any of these fails):
  Trust & safety
  - Tier 2 (comms.mask_pii in BEFORE triggers) is the floor. A category Tier 1 refuses is masked
    by Tier 2 in the SAME change. Tiers 1 and 3 run only where Tier 2 would mask: they ask the one
    SQL protected-phase predicate and never re-derive the phase in TypeScript.
  - Public copy is REFUSED, never masked: SQLSTATE 22023 with a '<field>: <sentence>' message,
    which the service turns into a 422 naming the field (the FeedbackBackendService.ts:103-117 /
    contact-rpc.ts:87-121 / catalogue-refusals.ts pattern).
  - No private-zone content reaches a SaaS (EPI §3.5 rule 2). A hosted classifier receives Glass
    Front material only; a link-reputation provider receives a URL only.
  - No payload is kept: no message text, image or file bytes in logs, errors, ServiceResults,
    analytics, automated ops.reports evidence or the refusal counter. Store ids, categories and
    scores.
  - Fail directions are EPI §3.2's: the publication gate and the malware scan fail closed (503;
    nothing published or promoted unscreened); Tier 3 fails open (Tier 2 holds); link reputation
    fails safe.
  - No automated finding penalises anyone until a reviewer confirms it. Every actioned outcome is
    a mandatory notification; nothing restricts a person silently (Decision #147 (d)). A penalty
    expires or is reversed; it is never deleted.
  - A ⚖️ item is built behind a flag that defaults off. Never switch one on.
  - A new provider is a sub-processor: rows in EPI §1.1, §3.4 and §10, a disclosure in
    SYSTEM_ARCHITECTURE.md §Security, a line in the privacy notice
    (apps/web/features/legal/core/content/privacy.ts), and data-processing terms a human signs
    before its gate is switched on.
  - Gates are booleans that default to false; an XXXX-XXXX or ill-shaped secret counts as absent;
    a Proposed env key enters .env.example, packages/backend/core/env.ts and the SA Environment
    Variable Contract only in the change that reads it (EPI §3.2, §10).
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE (supabase/migrations/vvvvtooo_type_purpose.sql).
    Never append ALTER TABLE ADD COLUMN / ALTER TYPE ADD VALUE patches or create a "fix" file.
    Each statement goes in its category file: 0 enums/tables · 1 functions/triggers ·
    2 policies/grants · 3 views · 4 indexes · 5 seeds (00005060 = scheduled jobs).
  - A schema or RPC-contract change lands with its Zod schema (packages/types/<schema>/*), the
    backend mapper and documentation/database/<schema>/* in the SAME change. A lifecycle change
    also updates documentation/PRODUCT_MANAGEMENT.md; a business rule, PRODUCT_SPEC.md. A prompt
    that builds a rule removes its "**Not built yet** (Decision #340, ruling X)" or "**Planned**"
    marker in the same change.
  - Definers: SECURITY DEFINER, SET search_path = '', schema-qualified names. comms, editorial,
    community and public are deny-by-default in 00002510: a new client door is granted by name;
    anything else is service_role only. RLS stays on; no client writes a moderation table.
  - Thin routes (HTTP parse + Zod + auth guard) over fat services returning ServiceResult<T>
    (Decision #10). Islands never import Supabase or @server/*.
  - Never drop columns/FKs of escrows, wallets or stages without asking me. Nothing is
    hard-deleted (archive / active=false / a status).
  - Path aliases only; folders components/ islands/ styles/ hooks/ wrappers/ types/ core/; no src/.
    JSDoc on exports; // #region [Name] … // #endregion; no meta-comments.
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3), when a prompt touches UI
  - Token-only pure CSS + strict BEM; no inline style=; no card in a card; static content unboxed;
    non-actionable metadata is inline --text-secondary text, never a tag.
  - A control that renders must do something (§3.11). Press = transform: scale(), removed under
    BOTH reduced-motion channels. Text contrast ≥ 4.5:1 in light, dark and data-contrast="high".
  - One filled button per decision region (§B.8). A new or changed component updates the
    DESIGN_SYSTEM.md §C.1 roster in the same change.
  Product
  - Every new simulatable axis gets its Dev Context Switcher control in the same change:
    DevOverrides + DEV_DEFAULTS, the DevOption list, the DevContextPanel control, reflect() set AND
    delete (apps/web/features/devtools/, seam apps/web/utils/dev-seam.ts). EPI §3.6 names
    pj.dev.moderation and pj.dev.malware.
  - A NEW contradiction between source docs: do not pick a side. Add a decision row (newest
    documentation/reference/decisions/decisions-*.md + README index line) and ask me.

Verification: reproduce the defect first (a SQL probe under supabase/probes/ inside BEGIN …
ROLLBACK, or a Deno unit test), then fix. SQL prompts: at most TWO SQL sessions at once across all
tracks, on disjoint migration files (FOUNDER_QUESTIONNAIRE.md Part B §B.0); announce every
`deno task db:reset` to the other sessions before you run it; run `deno task test:probes` after
each reset; finish with your own clean `deno task test:probes:fresh`. Then `deno task check`,
`deno task lint`, `deno task test:unit`, and `deno fmt` on the files you touched only (never a
directory). Four theme-engine.test.ts failures are pre-existing (Decision #96(a)). UI prompts:
`deno task dev`, sign in as the seeded personas (documentation/database/Seed.md), and capture
screenshots at 1440, 900 and 390 px in light, dark, data-contrast="high" and data-motion="reduced".
Safety-node prompts: run the node from its own repo, Projective-Safety (`docker compose up`, the
gateway bound to 127.0.0.1), with SAFETY_NODE_URL=http://127.0.0.1:8443.
Commit on the branch you were given with a clear message; do not push or open a PR unless I ask.
```

---

## 2. Phase 0 — The last P0

### E8 — Storage write policies, SVG and the dead search definers (Q0.2 (a), (f))

```text
PROMPT E8: Only the service role writes the six buckets; SVG and the dead search definers go

ROLE: Postgres security engineer. SEC E8/G10, AV-1, Z3, P-1 (the policy half), E5/G11 (deletion),
#340 (l); Decision #148 flag (b) (Decision #340, Q0.2 (a) and (f): owner-approved Additive
exceptions).

FILES:
  - supabase/migrations/00002017_policies_storage.sql: "Project participants can upload project
    files", "… can update project files", "Project uploaders can delete their project files",
    "DM participants can upload message attachments", "DM uploaders can delete their message
    attachments", "Users manage own personal files" (FOR ALL), "Entity members can upload
    workspace files", "… can update workspace files", "Workspace uploaders can delete their
    workspace files", "Owners can write their public assets" (FOR ALL), "Sellers can write their
    catalogue media" (FOR ALL); the file header
  - supabase/migrations/00005040_seed_storage_buckets.sql (:130 image/svg+xml; the :20-21 comment)
  - supabase/migrations/00001400_functions_search.sql (fn_search_entities, fn_search_global)
  - supabase/migrations/00002510_permissions_function_grants.sql (:256-273)
  - packages/types/files/storage.ts (:125; BUCKETS / bucketMeta() mirror the seed field for field)
  - supabase/probes/trust_p0.sql (the E5 region; a new E8 region)
  - documentation/database/files/Storage.md, documentation/database/search/{Functions,Tables}.md,
    EPI §9.2, SYSTEM_ARCHITECTURE.md §Storage Lifecycle where it mentions client writes

STEPS:
  1. Reproduce as `authenticated` (set request.jwt.claims before SET ROLE): INSERT a
     storage.objects row under your own prefix in public_assets and in catalogue, and UPDATE
     another participant's object under a shared project prefix. All three succeed today. Write
     trust_p0.sql's E8 region to assert they are refused after the fix.
  2. Prove nothing live depends on these policies: grep packages/ and apps/ for storage.from( and
     confirm every upload, update, move and remove on these six buckets runs on the service
     client (the signed quarantine upload stays). If a user-JWT writer exists, STOP and report it.
  3. 00002017: drop every policy listed above. Keep every SELECT policy. The personal bucket's
     only policy is FOR ALL, so replace it with a SELECT-only policy on the same predicate
     (segment 1 'users', segment 2 = auth.uid()). Add no broad read: permissive SELECT policies
     OR-combine (Storage.md's workspace warning). Rewrite the header to say the service role is
     the only writer outside quarantine.
  4. 00005040: drop image/svg+xml from public_assets (re-hosted favicons are raster only,
     link-favicon.ts). Correct the :20-21 comment (#340 (l)): the service role promotes in process
     (live-uploads.ts, media/library.ts, contact/live-attachments.ts) and nothing writes
     target_path. The seed is ON CONFLICT DO NOTHING: if a hosted project already exists, say in
     the commit message that its bucket needs the same change by hand; keep the conflict clause.
  5. storage.ts: drop svg from the public_assets mirror, so the registry still matches the seed.
  6. Delete search.fn_search_entities and search.fn_search_global from 00001400 and their lines
     from 00002510 (nothing calls them; RED D-29). In trust_p0.sql, replace the E5
     has_function_privilege check (it raises on a missing function) with
     to_regprocedure('search.fn_search_entities(text,text,jsonb,text,integer,integer,uuid,vector)')
     IS NULL and the same for fn_search_global(text,uuid,integer).
  7. Docs: Storage.md (each affected bucket's policy sentence; §Security Enforcement's anchor
     bullet becomes a read-anchor bullet and the "two public buckets accept direct client writes"
     warning goes), search/Functions.md (:10-13, :71), search/Tables.md:82, EPI §9.2 (the
     "Direct client writes flagged" note goes), SA §Storage Lifecycle.

ACCEPTANCE:
  - trust_p0.sql prints PASS for E8 (an authenticated write to each of the six buckets is refused;
    reads are unchanged) and for E5 (both functions absent); every other probe still passes.
  - SELECT allowed_mime_types FROM storage.buckets WHERE id = 'public_assets' has no svg.
  - grep -rn "fn_search_entities\|fn_search_global" supabase/migrations → no hits.
  - Under `deno task dev`: a library upload, an avatar cut, a contact attachment and a link
    favicon all still work.
SAME CHANGE: the storage.ts mirror, Storage.md and the search docs with the SQL (root CLAUDE.md
§1; documentation/database/CLAUDE.md).
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
CROSS-TRACK: tell the comms (SR1) and optimisation sessions that the definers are gone.
```

---

## 3. Any time — Provider endpoints

### W1 — Link reputation on Web Risk; embeddings pinned to Voyage (T5)

```text
PROMPT W1: Link reputation runs on Google Web Risk; embeddings call Voyage, not Atlas

ROLE: Integration engineer. EPI §6.5 and flag (c); #340 (j); #339 (d) (Decision #340, ruling T5;
= Decision #335 (c)).

FILES:
  - packages/backend/services/files/link-reputation.ts (+ the verdict cache in link-scan.ts)
  - packages/backend/services/files/link-scan.test.ts,
    packages/backend/services/links/LinkPreviewBackendService.test.ts
  - packages/backend/services/search/voyage-client.ts (the default base, :26-37)
  - apps/web/features/legal/core/content/privacy.ts (:167 Safe Browsing; the embeddings processor)
  - EPI §1.1 rows 4 and 9, §2.2, §3.4, §5, §6.5, §11 step 5; SYSTEM_ARCHITECTURE.md :1158-1161 and
    its Voyage / MongoDB disclosure; the .env.example comments for LINK_SAFETY_API_KEY and
    VOYAGE_API_BASE

STEPS:
  1. link-reputation.ts: replace the Safe Browsing v4 POST with Web Risk
     GET https://webrisk.googleapis.com/v1/uris:search?uri=<encoded>&threatTypes=MALWARE
     &threatTypes=SOCIAL_ENGINEERING&threatTypes=UNWANTED_SOFTWARE, the key in the x-goog-api-key
     header and never in the URL. {} is clean; { threat: { threatTypes, expireTime } } is listed.
     Keep the 2.5 s timeout → unavailable, the LINK_SAFETY_API_KEY name and the placeholder rule.
  2. Carry expireTime out of the module and cap the flagged-verdict cache TTL at it.
  3. The offline path (FILES_BACKEND_LIVE=false) is unchanged: the Safe Browsing test host stays
     blocked (EPI §11 step 5). Update the docblock and the tests.
  4. voyage-client.ts: default to https://api.voyageai.com whatever the key looks like; an Atlas
     key no longer reroutes to ai.mongodb.com (#339 (d)). EMBEDDINGS_ENABLED stays false.
  5. Docs and the privacy notice name Google Web Risk and Voyage AI; remove SA's "not built yet"
     note on Web Risk.

🧑 DECISION (an action, not a code stop): Voyage's written no-training and retention terms must be
in hand before anyone sets EMBEDDINGS_ENABLED=true (ruling T5). Leave it false; say so in the
commit message.

ACCEPTANCE:
  - Unit tests with a stubbed fetch: clean → clean; listed → the threat label and a TTL capped at
    expireTime; a non-2xx or a 2.5 s stall → unavailable; the key never appears in a URL.
  - link-scan.test.ts passes; the test host is still blocked offline.
  - grep -rn "safebrowsing.googleapis.com\|ai.mongodb.com" packages apps → no hits.
SAME CHANGE: EPI, SA and the privacy notice with the code (the sub-processor rule).
CROSS-TRACK: voyage-client.ts belongs to the search track; do not run beside COMMS SR1-SR4.
```

---

## 4. Phase 1 — The leakage pipeline

### P1d — Tier 1 pre-filter, the Tier 2 categories it refuses, and refusal counts

```text
PROMPT P1d: Tier 1 refuses at the send door; Tier 2 masks every category Tier 1 refuses

ROLE: Trust & safety engineer (TypeScript + Postgres). SEC §2.3 (SEC-P1d), L8, L9, #340 (k);
Decision #147 (b), (e) (Decision #340, ruling T2; ruling T4: refusals counted, never stored).
WAITS: ⏳ M·MS2 (soft). MS2 builds the one send door MessagingBackendService.sendMessage(actor,
ref, input). If this prompt runs first, call the detector from both send doors and leave a
`shortcut:` comment naming MS2.

FILES:
  - packages/types/comms/pii-detect.ts (new) + test; packages/types/comms/pii.fixtures.ts (new,
    the one corpus); pii.ts, pii.test.ts, pii.contract.test.ts; the PII category enum
  - packages/types/links/links.ts (reuse segmentLinks / normalizeLink to extract URLs and bare
    domains; add linkify-it, named in ruling T2.1, only if they miss paypal.me/x or wa.me/123)
  - supabase/migrations/00001300_functions_comms_channels.sql (mask_pii; a shared categoriser;
    the protected-phase door for the send services)
  - supabase/migrations/00001320_functions_editorial_community.sql (fn_feedback_idea_screen)
  - supabase/migrations/00000013_tables_ops.sql (ops.refusal_counts) and the new
    00001660_functions_ops_moderation.sql (its writer); 00002019 (RLS); 00002510 (grants)
  - the send doors: services/messaging/MessagingBackendService.ts + live-writes.ts (or MS2's
    door), services/projects/live-writes.ts (the room send), services/messaging/live-requests.ts
    (comms.send_request_message's caller)
  - the composers' existing error slot: apps/web/features/projects/islands/ChatComposer.island.tsx
    and the /messages composer (grep MessagingService.sendMessage)
  - packages/types/ops/* (refusal counts); supabase/probes/pii_corpus.sql (generated, step 6)
  - documentation/database/{comms,ops}/*, PRODUCT_SPEC.md §Messaging 1.A, SA §Contact & financial
    leakage prevention

STEPS:
  1. Reproduce with fixtures: full-width digits, "me＠example.com", "name at gmail dot com", a
     Luhn-valid card, an IBAN, a BTC address, "wa.me/447700900123" and "@name on instagram" are
     stored unmasked by comms.mask_pii today, and "2026-10-29" is masked as a phone (#147 (e)).
  2. pii-detect.ts, pure and isomorphic: NFKC → strip \p{Cf} → fold a vendored confusables
     subset (Latin, Cyrillic, Greek, full-width and Arabic-Indic digits) → collapse at/dot
     spellings → extract URLs and bare domains → match the payment / messaging host list → Luhn
     on 13-19 digit runs → mod-97 on IBAN-shaped runs → crypto address shapes → an @handle next to
     a social platform's name. Returns { refused, categories }. Registrable domains via tldts
     (named in ruling T2.1), pinned to an exact version.
  3. Tier 2 in the same change: factor comms.fn_pii_categories(p_text) out of mask_pii and extend
     both with every category step 2 refuses: normalize(p_text, NFKC) and zero-width stripping
     first, full-width @ and digits, at/dot spellings, card (Luhn in plpgsql), iban (mod-97),
     crypto, social handles; the phone pass needs ≥ 9 digits once separators are stripped (ISO
     dates clear); "paypal" / "zelle" mask only in a handle or link shape. New placeholders
     follow the [x hidden] pattern. Mark both STABLE, not IMMUTABLE (L9).
  4. L9: make community.fn_feedback_idea_screen SECURITY DEFINER (search_path is '' already; it
     reads no table), then revoke comms.mask_pii from authenticated: no client keeps an oracle.
  5. The phase: comms.fn_send_is_protected(p_kind text, p_container uuid, p_project uuid DEFAULT
     NULL) RETURNS boolean, a definer granted to authenticated that answers only when auth.uid()
     is a member of the room or thread, and otherwise returns exactly what the two mask triggers
     read (projects.is_protected_phase / comms.fn_dm_protected_project). P2b widens those
     predicates; no caller changes then.
  6. One corpus: pii.fixtures.ts drives pii-detect.test.ts, the maskPii test, and a generated
     supabase/probes/pii_corpus.sql (a `deno task pii:probe` writer). pii.contract.test.ts fails
     when the committed probe differs from the generator's output; that replaces today's
     pattern-string pin (L9). The probe asserts Tier 2 masks every case Tier 1 refuses and leaves
     every negative case alone.
  7. The send doors: when fn_send_is_protected holds, run pii-detect before the insert; a refusal
     is a 422 naming the categories and stores nothing. The same in comms.send_request_message's
     caller.
  8. Refusal counts (ruling T4): ops.refusal_counts (user_id, day, surface, category, refusals;
     primary key on the first four), written only by ops.fn_count_refusal(p_surface,
     p_categories), a definer that counts for auth.uid(). No text, ever. RLS: the person reads own
     rows; security.is_admin() reads all.
  9. Each composer shows the 422 inline in its existing error slot, naming the category in plain
     words ("Phone numbers can't be shared until the project is complete"). No new component.

ACCEPTANCE:
  - pii_corpus.sql passes; the Deno corpus tests pass for pii-detect.ts and maskPii.
  - A protected DM with each step-1 fixture → 422, nothing stored, one refusal_counts increment;
    the same text outside the phase → stored as written.
  - A direct PostgREST insert of each fixture into a protected room → stored masked.
  - "Delivered 2026-10-29" is stored unmasked; has_function_privilege('authenticated',
    'comms.mask_pii(text)', 'EXECUTE') is false; the feedback board still masks and refuses.
SAME CHANGE: the PII category enum, documentation/database/comms/Functions.md and ops/* with the
SQL; PRODUCT_SPEC §1.A (Tier 1 row → Shipped, the placeholder list) and SA's "Not built yet
(Decision #340, ruling T2)" marker on Tier 1 removed in this change.
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
ERASURE: ops.refusal_counts is personal data. Hand its erasure arm to identity's chain on
00001060; do not edit 00001060 here.
```

### P2a — Public copy refused at the database floor (T2 (a))

```text
PROMPT P2a: Public copy is refused at the database floor

ROLE: Postgres engineer. SEC §2.5, P-5 (the leakage half), Z6 (the leakage half); #340 (c);
Decision #147 §1.B (Decision #340, ruling T2 (a)).
DEPENDS: P1d (comms.fn_pii_categories). WAITS: ⏳ P·WP4 (projects.projects and its trigger file).

🧑 DECISION — STOP before touching these three surfaces; the ruled ones below proceed. Decision
#147 flag (a) is still open (PRODUCT_SPEC §Messaging 1.B, last paragraph):
  Option A (recommended): org.profile_links and a business's website are structured links: refuse
  only a host on the payment / messaging list (paypal.me, wa.me, t.me …), allow a portfolio site.
  Article bodies follow the free-text rule below.
  Option B: refuse every external link in those fields.
  Option C: leave them unchecked and record the gap.

FILES:
  - supabase/migrations/00001001_functions_security_context.sql
    (security.tg_refuse_public_pii(), a generic trigger function taking its columns in TG_ARGV)
  - the CREATE TRIGGER lines in each table's own trigger file (grep "ON catalogue\.",
    "ON marketplace\.", "ON projects\.projects" under supabase/migrations/018*)
  - supabase/migrations/00001040_functions_org_profiles.sql (org.save_profile)
  - the write services that turn 22023 into a field-named 422: services/catalogue/
    catalogue-refusals.ts (it maps 22023 to invalid; make it carry the field), the profile writer
    (services/profile/live-profile-writes.ts), the service-blueprint and project-setup writers
  - supabase/probes/public_copy_refusal.sql (new); any seed that now refuses
  - documentation/database/{catalogue,marketplace,projects,org}/Functions.md, PRODUCT_SPEC.md
    §Messaging 1.B, SYSTEM_ARCHITECTURE.md §Public surfaces (:1173-1178)

STEPS:
  1. Reproduce: as a seller, a direct PostgREST UPDATE setting catalogue.listings.description to
     "WhatsApp me on +44 7700 900123" succeeds today; so does the same text in a blueprint's
     stage_template and in a project brief.
  2. security.tg_refuse_public_pii(): for each named column run comms.fn_pii_categories; on any
     hit RAISE '<column>: Public text can''t include <category in words>.' USING ERRCODE =
     '22023'. Never mask; ignore handover_unlocked_at. BEFORE INSERT OR UPDATE OF those columns on
     catalogue.products (title, description), catalogue.listings (title, description),
     marketplace.service_blueprints (its copy, including every string leaf of stage_template and
     team_roles via jsonb_path_query(col, 'strict $.**')) and projects.projects (title,
     description). Check every write, drafts and private briefs included: an invitee reads a brief
     before any engagement, and a draft is one click from public.
  3. org.save_profile refuses headline and bio the same way (org.users_public has no client write
     policy, so the door is the floor there; ruling T2 (a)).
  4. Each owning service maps 22023 to a 422 whose field is the column the message names, so the
     form marks the right control.
  5. Run `deno task db:reset` first: every seed must still load. Fix any seed that now refuses.

ACCEPTANCE:
  - public_copy_refusal.sql: each surface refuses each corpus category with 22023 naming the
    column, by direct write as the owner and through the door; clean copy saves; an email in a
    jsonb leaf is refused naming its column; save_profile refuses an IBAN in bio.
  - The listing editor shows the refusal on the description field (screenshot at 390 px).
SAME CHANGE: a documentation/database/* entry for every trigger; PRODUCT_SPEC §1.B's "**Not yet
enforced**" marker removed; SA :1173-1178 rewritten (a trigger is the floor, the doors translate).
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
```

### P2b — The protected phase: marketplace window and cooling-off (T1)

```text
PROMPT P2b: Marketplace conversations and ended engagements stay protected for their windows

ROLE: Postgres + messaging engineer. SEC L4 (b), (d), §2.6; #340 (b) (Decision #340, ruling T1;
PRODUCT_SPEC §Messaging 1 "The Protected Phase").
DEPENDS: P1d (comms.fn_send_is_protected). WAITS: ⏳ M·MS1 (comms.dm_threads is in its schema
window), ⏳ M·MS2 (the openers behind the one door), ⏳ P·WP4 (project cancellation).

🧑 DECISION — STOP and put both to me before step 2:
  (1) The cooling-off length is not ruled.
      Option A (recommended): 30 days, its own platform_params dial beside the 30-day marketplace
      window, so one sentence explains both.
      Option B: 90 days: longer cover where a declined applicant is most tempted to go around.
  (2) Ruling T1 covers threads opened on a marketplace surface and profile DMs between connected
      people. It is silent on a cold DM to a profile reached through Explore.
      Option A (recommended): a thread whose people were not connected when it opened (no mutual
      follow older than the thread, no shared active team / business / enterprise, no shared
      completed project) is protected like a marketplace thread. Otherwise the window is skipped
      by clicking through to the profile, or by calling the client RPC
      comms.get_or_create_dm_thread directly.
      Option B: protect only threads opened from the four named surfaces. That needs a
      service-role-only opener for those surfaces, because an origin a client passes is a hint
      it can forge.

FILES:
  - supabase/migrations/00000016_tables_comms.sql (comms.dm_threads.marketplace_window_until)
  - supabase/migrations/00001300_functions_comms_channels.sql (the opener definers:
    get_or_create_dm_thread, create_group_thread, send_request_message and MS2's door;
    fn_dm_protected_project or one successor predicate, which fn_send_is_protected reads)
  - supabase/migrations/00001100_functions_projects_read_access.sql (fn_engaged_projects: the
    cooling-off arms)
  - supabase/migrations/00005001_seed_platform_params.sql (protected_marketplace_window_days = 30;
    protected_cooling_off_days per the ruling)
  - packages/types/comms (the dm_threads row schema); supabase/probes/protected_scope.sql (new)
  - documentation/database/{comms,projects}/*, PRODUCT_SPEC.md §Messaging 1, PRODUCT_MANAGEMENT.md
    (wherever it says when a conversation is protected), SA §Tier 2

STEPS:
  1. Reproduce: a service inquiry carrying a phone number is stored unmasked, and so is a declined
     applicant's DM to the project owner (L4 (b)).
  2. The marketplace window: each opener definer stamps marketplace_window_until = now() + the
     dial when it creates a service_inquiry thread or, per decision (2), a thread whose people
     were not connected at that moment. The database decides from facts it holds, never from a
     client-supplied origin. Clients cannot write the column (dm_threads has no client write
     policy; add the derived-column guard anyway).
  3. The window closes early at the parties' first escrow funding: the predicate looks for a
     funded escrow on a project both are party to, funded after the thread was created. Do not
     edit the funding doors (00001240 / 00001150 belong to other tracks). From funding on, the
     engagement's own phase holds until the Unlock, so the Unlock still lifts everything.
  4. The cooling-off ("ends without the work going ahead"): fn_engaged_projects, or a sibling the
     DM predicate reads, gains arms for invitations and applications declined, withdrawn or
     expired within the dial, and a cancelled project's DMs stay protected for the dial after
     cancellation, then lift. This replaces Wave 0's indefinite hold on a cancelled project
     (L4 (c)) with ruling T1's window. Read each decision instant from its own row; add a
     decided_at in place (Zod + docs) only where a table has none, after checking what P·WP4
     shipped.
  5. One predicate: the DM mask trigger, fn_send_is_protected (Tier 1) and later Tier 3's enqueue
     all read the same function. A stage room's phase is unchanged.

ACCEPTANCE:
  - protected_scope.sql (backdating created_at and decision times inside the transaction): an
    inquiry is masked on day 0 and not on day 31; it is masked until the pair's first funding,
    then by the engagement until the Unlock, then not at all; a DM between long-standing mutual
    followers is not masked; the cold DM follows decision (2); a declined applicant is masked
    inside the cooling-off and not after it; a cancelled project's DM lifts after the cooling-off.
  - Tier 1 refuses on exactly the threads Tier 2 masks (one probe row each way).
SAME CHANGE: Zod + documentation/database/comms/* with 00000016; PRODUCT_SPEC §1's "**Not built
yet** for the marketplace-conversation window and the cooling-off period" marker removed and both
lengths stated; PRODUCT_MANAGEMENT.md if it describes the protected phase.
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
```

### P2c — Counterparty-visible text masked inside the phase (L7)

```text
PROMPT P2c: Every counterparty-visible text in the protected phase is masked

ROLE: Postgres engineer. SEC L7 (Decision #340, ruling T2; Decision #147). Reactions are out of
scope: COMMS MS5 pins comms.message_reactions to one emoji set. org.profile_links is a public
surface and waits on P2a's decision.
DEPENDS: P2b. WAITS: ⏳ P·WP4 (ticket and submission text), ⏳ C·WP10 (event text).

FILES:
  - supabase/migrations/00001300_functions_comms_channels.sql (comms.fn_mask_protected)
  - supabase/migrations/00001840_triggers_comms.sql (group and channel title / topic / emoji);
    00001820 or 00001850 (stage_submissions notes / description / feedback;
    stage_revision_requests.reason; ticket title / description / tasks); 00001860 (scheduling
    event titles)
  - the attachment-name projection a counterparty reads (comms.message_file_details and the
    attachment source, services/messaging/live-attachment-source.ts)
  - each surface's write service (Tier 1 before the write, as in P1d; ops.fn_count_refusal)
  - supabase/probes/protected_surfaces.sql (new)
  - documentation/database/{comms,projects,scheduling}/Functions.md

STEPS:
  1. Reproduce inside a protected engagement: a group title with an email, a submission note
     "send the source to me@x.com" and a ticket task with a wa.me link are stored as written.
  2. comms.fn_mask_protected(p_project uuid, p_thread uuid, p_actor uuid, p_text text) RETURNS
     text: masks with comms.mask_pii when P2b's one predicate holds for the project or thread, and
     otherwise returns the text unchanged.
  3. One BEFORE INSERT OR UPDATE OF <column> trigger per surface calls it: dm_threads title /
     topic / emoji (not entity channels: a team's own room is no engagement);
     stage_submissions notes / description / feedback; stage_revision_requests.reason; ticket
     title / description / every string in tasks; scheduling event titles.
  4. Attachment names: mask in the projection a counterparty reads, never in the owner's own
     library row.
  5. Tier 1 in each surface's write service: pii-detect, a 422 naming the field, one counted
     refusal.

ACCEPTANCE:
  - protected_surfaces.sql: every step-1 write is stored masked inside the phase and as written
    after the Unlock; an entity channel's title is never masked; the owner's library still shows
    the original attachment name.
SAME CHANGE: a documentation/database/* entry for every trigger; PRODUCT_SPEC §1 if it lists the
masked surfaces; Zod only if a shape changes.
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
```

### P2d — The remaining comms and search grant gaps (G5, G6, G13, G14, G18)

```text
PROMPT P2d: Archived rooms, message size and rate, query logs and search definers

ROLE: Postgres security engineer. SEC G5, G6, G13, G14, G18 (the sync-trigger half). COMMS SR1
pins search_path on fn_nearest / fn_nearest_to_entity; skip those two. Re-check
COMMS_BUILD_PROMPTS.md on main and skip anything it has since claimed.

FILES:
  - supabase/migrations/00002012_policies_comms.sql (send_messages_if_member)
  - supabase/migrations/00000016_tables_comms.sql (body length CHECKs; an unlogged rate table)
  - supabase/migrations/00001300 + 00001840 (the per-sender rate trigger function and triggers)
  - supabase/migrations/00002520_permissions_table_grants.sql (search.query_logs INSERT, :16)
  - supabase/migrations/00002510 (search.is_admin(uuid)); 00001400 (the sync triggers'
    search_path: :90, :111, :173, :193, :281)
  - supabase/migrations/00005001 (message_rate_per_minute = 60)
  - supabase/probes/trust_p2_grants.sql (new); documentation/database/{comms,search}/*

STEPS:
  1. G5: the room INSERT policy also requires the channel's archived_at IS NULL.
  2. G6: CHECK (char_length(body) <= 8000) on both message tables (confirm the app's own limit and
     that no seed exceeds it), and a per-sender BEFORE INSERT rate trigger (a token bucket in an
     unlogged table, refusing PR429 past the dial) so a direct PostgREST flood is bounded too.
  3. G13: revoke INSERT on search.query_logs from anon and authenticated; the app writes through
     fn_log_query only (check its caller).
  4. G14: revoke EXECUTE on search.is_admin(uuid) from PUBLIC and anon.
  5. G18: pin search_path = '' on the sync trigger functions and qualify every name.

ACCEPTANCE: trust_p2_grants.sql: a post to an archived room → refused; a 9,000-character body →
23514; the 61st message in a minute → PR429; anon INSERT into query_logs → 42501; anon
search.is_admin → 42501; the search index still syncs on a profile edit.
SAME CHANGE: documentation/database/{comms,search}/{Tables,Policies,Functions}.md.
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
```

---

## 5. Phase 2 — The moderation loop

### R1 — `ops.reports`, the one review sink (T4)

```text
PROMPT R1: ops.reports — one review sink for people's reports and automated findings

ROLE: Postgres + backend engineer. SEC R1/G19, §3.3; Decision #148 (a), (g); EPI flag (g)
(Decision #340, ruling T4: the source column; ruling T2: evasion_fragmentation).

🧑 DECISION — STOP before step 1 and put the reason vocabulary to me. Decision #148 flag (g) left
it undesigned; only evasion_fragmentation is ruled. Recommended closed list, each with a
person-readable label: contact_leakage · evasion_fragmentation · harassment · hate ·
sexual_content · violence · illegal_content · spam_or_scam · impersonation ·
intellectual_property · other. The list is the Zod SSOT and the SQL CHECK; R2's form shows the
labels.

FILES:
  - supabase/migrations/00000013_tables_ops.sql (ops.reports)
  - supabase/migrations/00001660_functions_ops_moderation.sql (P1d created it; the doors)
  - supabase/migrations/00002019_policies_security_ops.sql (RLS); 00002510 (grants)
  - supabase/migrations/00005040_seed_storage_buckets.sql (an `evidence` bucket: private, no
    client policy, like `verification`)
  - packages/types/ops/reports.ts (the row, the vocabulary, one evidence schema per subject type)
  - packages/backend/services/moderation/ReportsBackendService.ts (new) + test
  - supabase/probes/reports_sink.sql (new)
  - documentation/database/ops/{Tables,Policies,Functions}.md, documentation/database/files/
    Storage.md (the evidence bucket), SA §Content moderation (the "Proposed ops.reports shape"
    becomes the migrated one), EPI §9.2

STEPS:
  1. ops.reports per SA's proposed shape, plus: source text NOT NULL CHECK (source IN ('user',
     'automated')); reporter_user_id NULL only when source = 'automated' (a CHECK); detector text
     (nudenet · ocr · sightengine · presidio · fragmentation), set exactly when automated;
     reported_user_id (the author, whom R4 penalises). reporter_user_id ON DELETE SET NULL: a
     report outlives its reporter. Indexes on (status, created_at) and (reported_user_id).
  2. Immutable: a BEFORE UPDATE trigger refuses any change to evidence_snapshot, reporter,
     subject, source, detector and reason; status moves only pending → dismissed | actioned,
     through R3's door. No DELETE grant to anyone but the erasure chain.
  3. RLS: a reporter reads their own rows; security.is_admin() reads all; the reported person
     reads nothing, so the reporter is never projected to them. No client INSERT or UPDATE.
  4. Doors, service_role only: ops.file_report(p_reporter, p_subject_type, p_subject_id,
     p_reason, p_reported_user, p_snapshot) — one pending report per reporter and subject, a
     per-reporter daily cap (PR429) — and ops.file_automated_finding(p_detector, p_subject_type,
     p_subject_id, p_reported_user, p_reason, p_evidence), whose evidence is ids, categories and
     scores only.
  5. ReportsBackendService.fileReport(actor, input): read the subject with the REPORTER's client
     (the read is the permission check, SA:1228-1232); build the snapshot server-side from the
     stored row (body, author, room or thread, timestamps; for a file its id, content_hash and a
     copy of the bytes at evidence/{report_id}/{file_id}); then call the door.
     fileAutomatedFinding serves the detectors. Both return ServiceResult<T>.

ACCEPTANCE:
  - reports_sink.sql: a filed user report is pending; its reporter reads it; the reported person
    and a stranger read nothing; a client INSERT / UPDATE / DELETE → 42501; a snapshot change is
    refused even as service_role; an automated row with a null reporter is accepted, a user row
    with one is not; a second pending report on one subject by one reporter is refused.
  - A unit test: a subject the reporter cannot read → 404 and nothing filed.
SAME CHANGE: Zod + documentation/database/ops/* + SA §Content moderation + Storage.md and EPI §9.2
for the bucket, in one change; PRODUCT_MANAGEMENT.md for the report states pending · dismissed ·
actioned.
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
ERASURE: reporter_user_id and the evidence copies are personal data. Hand the arm to identity's
erasure chain (00001060); the I1 retention table decides how long evidence stays.
```

### R4 — The content-penalty writer

```text
PROMPT R4: An actioned report writes a penalty, from a content source that now exists

ROLE: Postgres engineer. SEC R4; Decision #148 (d) (Decision #340, ruling T4: content-report
penalties land on the one Standing penalty term).
DEPENDS: R1.

FILES:
  - supabase/migrations/00000012_tables_security.sql (security.penalties source_type CHECK, :92)
  - supabase/migrations/00001001_functions_security_context.sql (the writer and the reversal)
  - supabase/migrations/00005001_seed_platform_params.sql (moderation_penalty_defaults,
    moderation_penalty_max); 00002510 (no client grant; state it)
  - the Zod schema that mirrors security.penalties (grep penalty_type in packages/types)
  - supabase/probes/content_penalty.sql (new); documentation/database/security/{Tables,Functions}.md

STEPS:
  1. source_type gains 'content_report', edited into the CHECK in place, with the Zod enum.
  2. security.fn_issue_content_penalty(p_report uuid, p_severity numeric, p_days integer):
     a definer with no client grant, called only from R3's resolve door. One row per actioned
     report: subject 'user' = the report's reported_user_id; penalty_type 'trust_score';
     source_id = the report; source_type 'pii_violation' for contact_leakage and
     evasion_fragmentation, 'content_report' for every other reason; expires_at = now() + p_days
     (NULL never expires).
  3. Defaults per reason in moderation_penalty_defaults ({ reason: { severity, days } }); the
     reviewer may change them up to moderation_penalty_max. They are tunable configuration.
  4. security.fn_reverse_penalty(p_penalty uuid, p_note text): admin only; status 'reversed',
     reversed_at set; never a DELETE.

ACCEPTANCE: content_penalty.sql: issuing writes one row with the mapped source_type; issuing twice
for one report is refused; a client cannot call either function; a reversal keeps the row.
SAME CHANGE: Zod + documentation/database/security/* with 00000012.
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
CROSS-TRACK: 00000012 also carries identity's Q0.2 (b) drops; never run beside that prompt.
```

### R5 — Penalties move Standing; the discovery penalty stays server-side

```text
PROMPT R5: Penalties move Standing; the discovery penalty is read server-side only

ROLE: Postgres engineer. SEC R5, G15; Decision #148 (c); #340 (i) (Decision #340, ruling T4).
DEPENDS: R4.

FILES:
  - supabase/migrations/00001001_functions_security_context.sql (fn_recalc_penalty_aggregates)
  - supabase/migrations/00001030_functions_org_standing.sql (fn_recompute_standing reads
    penalty_severity at :78; nothing writes it)
  - supabase/migrations/00002520_permissions_table_grants.sql (:166, discovery_penalty in the anon
    and authenticated column grant on search.profiles_index)
  - packages/backend/services/explore/live-catalog.ts (:718 reads discovery_penalty with the anon
    client) and ranking.ts
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (penalty-expiry, a sql job)
  - supabase/probes/penalty_standing.sql (new)
  - documentation/database/{security,org,search}/*, PRODUCT_SPEC.md §Messaging 1.C

STEPS:
  1. Reproduce: an active trust_score penalty on a freelancer leaves
     org.entity_standing.penalty_severity at 0 and the rung unchanged; anon can SELECT
     discovery_penalty from search.profiles_index.
  2. fn_recalc_penalty_aggregates also writes penalty_severity := the active trust_score sum for
     'user', 'freelancer' and 'team' subjects (org.standing_subject), then calls
     org.fn_recompute_standing; a business keeps system_penalty_score. A demotion records
     'demoted' as today.
  3. Expiry: a daily penalty-expiry sql job flips active penalties past expires_at to 'expired';
     the existing trigger then recomputes. (00005060 has one writer at a time, after jobs-sql.)
  4. G15: drop discovery_penalty from the anon / authenticated column grant. live-catalog.ts reads
     it with the service client inside the fat service; it never reaches a client payload.

ACCEPTANCE: penalty_standing.sql: a 30-severity penalty lowers a seeded score above 30 by 30 and
demotes when it crosses a rung; expiry (backdated, through the job's function) and reversal
restore it; anon or authenticated SELECT of discovery_penalty → 42501; /explore's order for a
seeded penalised profile is unchanged.
SAME CHANGE: the database docs; PRODUCT_SPEC §1.C's "**Not built yet:** today a guest can read
the discovery penalty" marker removed; PRODUCT_MANAGEMENT.md if it lists penalty states (the
expiry transition now has a writer).
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
CROSS-TRACK: live-catalog.ts is also the optimisation track's read-path file; 00002520 and
00005060 are shared.
```

### R3 — The reviewer desk, `/admin/reports`

```text
PROMPT R3: The reviewer desk — /admin/reports

ROLE: Full-stack engineer. SEC R3; SA §Content moderation steps 3-4 (Decision #340, ruling T4;
PRODUCT_SPEC §Messaging 1.C "Reporting" and "Consequences tie into Standing").
DEPENDS: R1, R4, R5.

FILES:
  - supabase/migrations/00001660_functions_ops_moderation.sql: ops.list_reports_for_review (admin
    only; the read is the gate) and ops.resolve_report(p_report, p_outcome, p_notes, p_severity,
    p_days); 00002510 (grants)
  - supabase/migrations/00005010_seed_notification_catalog.sql (a mandatory moderation outcome
    type)
  - apps/web/routes/(dashboard)/admin/reports.tsx → apps/web/features/admin/routes/
    ReportsDeskScreen.tsx, beside the dispute desk in features/admin/{core,islands,components,
    styles}
  - apps/web/routes/api/admin/reports/* (thin) → services/moderation/ReportsBackendService.ts
  - apps/web/features/devtools/* + apps/web/utils/dev-seam.ts (a reportsDesk axis)
  - documentation/architecture/ROUTING.md, DESIGN_SYSTEM.md §C.1 (if a component is added),
    PRODUCT_MANAGEMENT.md (the report lifecycle), documentation/database/ops/Functions.md

STEPS:
  1. ops.resolve_report: admin only; pending → dismissed | actioned, resolution_notes required;
     actioned calls security.fn_issue_content_penalty (R4), which recomputes Standing (R5);
     resolved_by and resolved_at are set together, in one transaction.
  2. The outcome is a mandatory notification to the reported person (fn_notify, the new type):
     what was actioned and the penalty's effect, never who reported. A dismissal tells only the
     reporter that their report was reviewed.
  3. /admin/reports follows /admin/disputes (DisputeDeskScreen, DESK_TABS; the queue read is the
     gate: no session, a non-operator or no live database → 404). Tabs pending · actioned ·
     dismissed; a filter by source and detector. An item shows its snapshot (automated: ids,
     categories and scores, opening the referenced rows through an admin read), the author's
     refusal counts (ops.refusal_counts) and prior penalties.
  4. The reportsDesk axis (auto · samples · empty, cookie pj.dev.reports), shaped like
     operatorDesk (features/admin/core/operator-preview.ts): DevOverrides + DEV_DEFAULTS, the
     DevOption list, the DevContextPanel control, reflect() set and delete; honoured only when
     DENO_ENV is development.

ACCEPTANCE:
  - A probe: a non-admin calling either door → 42501; actioning writes the penalty, demotes when
    the score crosses a rung, and writes one notification; resolving without notes is refused.
  - Desk screenshots at 1440 / 900 / 390 in light, dark, high contrast and reduced motion; the
    dispute desk is unchanged.
SAME CHANGE: the ROUTING.md row; the Dev Context Switcher axis; DESIGN_SYSTEM §C.1 for any new
component; PRODUCT_MANAGEMENT.md for pending → dismissed | actioned; the database docs.
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
```

### R2 — The report route and the entry points

```text
PROMPT R2: People can report — the route and the entry points

ROLE: Full-stack engineer. SEC R2; Decision #140 (the removed stub); root CLAUDE.md §3.11
(Decision #340, ruling T4).
DEPENDS: R3: the button never renders before a reviewer can act on it. WAITS: ⏳ M·MS2, M·MS3
(the message menus live in the islands they rework).

FILES:
  - apps/web/routes/api/reports/index.ts (thin: Zod + auth) → ReportsBackendService.fileReport
  - one shared report dialog (@projective/ui Dialog; a bottom sheet on mobile) in the nearest
    shared feature folder, and its entry points: the message menu in /messages and in project
    rooms, stage submissions, the file inspector and the hub's row menu, profile, listing,
    service and project pages
  - documentation/architecture/ROUTING.md, DESIGN_SYSTEM.md §C.1, PRODUCT_SPEC.md §1.C (the
    "Reporting planned" status)

STEPS:
  1. POST /api/reports { subjectType, subjectId, reason, note? } → 201; 404 when the reporter
     cannot read the subject; 409 when already reported; 429; 503.
  2. The dialog lists R1's reason labels, an optional bounded note and a filed state, with one
     filled button. Nothing tells the reported person who reported.
  3. An entry point renders only where the viewer can read the subject, and never on their own
     content.

ACCEPTANCE: report a seeded DM message and it appears pending in /admin/reports with its snapshot;
dialog screenshots at three widths in the four themes; axe reports zero serious or critical issues
on the dialog.
SAME CHANGE: ROUTING.md; the §C.1 roster; PRODUCT_SPEC §1.C status.
```

---

## 6. Phase 3 — The safety node

### SN1 — The node, and ClamAV before every promote

```text
PROMPT SN1: The safety node runs, and ClamAV scans every upload before it is promoted

ROLE: Infrastructure + backend engineer. EPI §6.1, §6.4, §6.6; SEC §4, AV-1 to AV-3, AV-5 (the
node's half); #340 (h) (Decision #340, ruling T5: the node, 4 vCPU / 8 GB).
DEPENDS: E8 (AV-1). May start as soon as E8 merges (SEC §6 step 2).

FILES:
  - NOT the node: it lives in its own repo, Projective-Safety (§0.5), where node prompt N2
    (SAFETY_NODE_SETUP_AND_BUILD_PROMPTS.md §4) builds clamd and POST /scan/file on the
    committed contract (contract/openapi.yaml). Run N1 and N2 there first; this prompt is the app
    half, and its Zod copies that contract.
  - packages/backend/core/safety-node.ts (new: URL, bearer, timeouts, the placeholder rule)
  - packages/backend/core/env.ts, .env.example, SA's Environment Variable Contract:
    MALWARE_SCAN_LIVE, SAFETY_NODE_URL, SAFETY_NODE_TOKEN, FILES_CRON_SECRET (also a Vault secret)
  - the three hook points SN2 later folds into one: services/files/live-uploads.ts
    (completeUpload), services/media/library.ts, services/contact/live-attachments.ts
  - packages/types/files/metadata.ts (metadata.av, Zod)
  - apps/web/routes/api/files/cron/av-rescan.ts; 00005060 (files-av-rescan, http);
    00005001 (av_rescan_days); a deno task for the one-off backfill
  - apps/web/features/devtools/* + apps/web/utils/dev-seam.ts (pj.dev.malware)
  - EPI §1.1 row 7, §6.1, §6.4, §6.6, §10; SA §Storage Lifecycle (the :2365 marker) and SA §Tier 3
    (:1151, "2 GB RAM VPS" → the ruled node); files/Storage.md §Deferred; PRODUCT_SPEC.md
    :3567-3570 (the malware half of its marker)

STEPS:
  1. Reproduce: upload the EICAR test string through /files and through the media picker. Both
     are admitted today.
  2. Bring the node up from Projective-Safety with N2 merged there (`docker compose up`, the
     gateway on 127.0.0.1:8443, the bearer SAFETY_NODE_TOKEN).
  3. Read N2's POST /scan/file in the node's contract: clean · infected · error, with engine,
     db_version and db_time; a macro Office file comes back clean with flags ['macros'] (AV-5).
     Copy its schema as Zod; never re-implement the scan here.
  4. App: at each hook, after the sniff and before the promote, scan the bytes already in memory.
     clean → continue; infected → refuse(row, hostile = true) (the object deleted, the row
     quarantined, a person-readable reason); error or unreachable with MALWARE_SCAN_LIVE=true →
     the row back to pending_upload and a 503; gate off → skip, one log line in development.
  5. AV-2: files.items.metadata.av = { engine, db_version, verdict, signature?, flags?, at }.
  6. Staleness: a db_time older than 24 h writes an ops.log_entries warn row, scope
     files.malware_scan.
  7. AV-3: files-av-rescan (http, daily) rescans originals scanned under an older db_version in the
     last av_rescan_days; a hit is handled as at admission and logged. A deno task backfills
     objects admitted before this change.
  8. pj.dev.malware (auto · clean · infected · unavailable): EPI §3.6, all five switcher parts.

ACCEPTANCE:
  - With the node up: EICAR → quarantined and its object deleted; a clean PDF → uploaded with
    metadata.av; a .docm with a macro → uploaded with flags ['macros']; the node stopped → 503
    and the row is pending_upload; a retry after a restart completes.
  - With the gate off nothing changes, and the dev axis drives each branch without the node.
  - A request to the gateway without the bearer → 404; from another host → no route.
SAME CHANGE: the env contract, .env.example and core/env.ts with their reader; EPI status marks;
the dev axis; Zod for metadata.av; the PRODUCT_SPEC and SA malware-scan markers removed.
SQL SESSION (the job and the dial): at most two SQL sessions at once, on disjoint migration files;
announce each `deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`. 00005060 has one writer at a time, after jobs-sql.
🧑 (an action, not a decision): a human provisions the VM and the private link. Nothing here
deploys.
```

### SN2 — One admission contract (CAS §6.4)

```text
PROMPT SN2: One admission contract for every upload

ROLE: Backend engineer. CAS §6.4, F15; SEC V3, V5, V6, AV-4, AV-5 (the policy half); #339 (m)
(Decision #340, ruling T5: Office files with macros are admitted privately and never published).
DEPENDS: SN1.

FILES:
  - packages/backend/services/files/upload-acceptance.ts (Wave 0's acceptUpload) → one
    AdmissionPolicy per purpose: library_any, library_media, contact
  - services/files/live-uploads.ts, services/media/library.ts, services/contact/
    live-attachments.ts (each calls the one sequence)
  - packages/types/files/sniff.ts + test (PDF, ZIP, OOXML via [Content_Types].xml and
    vbaProject.bin, OLE2)
  - services/media/pipeline.ts and image-codec.ts (V5)
  - services/files/live-uploads.ts initUpload (V6) + apps/web/routes/api/files/cron/
    upload-sweep.ts + 00005060 (files-upload-sweep, http) + 00005001 (its dials)
  - every step that makes a file Public: the visibility route, the rendition cut, catalogue
    media, the attach-to-a-public-entity elevation (PRODUCT_SPEC §Storage, "Public")
  - documentation/database/files/{Storage,Functions}.md, SA §Storage Lifecycle (#339 (m)),
    PRODUCT_SPEC.md :3567-3570 (the macro half of its marker)

STEPS:
  1. One sequence: claim → sniff → scan (SN1) → decode (media only) → [H1's hash-match hook, off]
     → promote. Each policy names the families it admits and its size cap; the three call sites
     keep only their purpose-specific steps. A failure at any step leaves nothing half-written,
     as today.
  2. V3: the sniff identifies PDF, ZIP, OOXML and OLE2, so a policy branches on the real family.
  3. AV-5: a file the node flags 'macros', or an OOXML file carrying vbaProject.bin, is admitted
     with metadata.macros = true. Private and Link-only sharing are allowed; every step that makes
     it Public refuses with a 422 ("files with macros stay private").
  4. V5: a bounded decode queue answers 503 when full; a queued job has a deadline; a header peek
     that returns null is refused.
  5. V6 (= CAS F15): files-upload-sweep (http, hourly) marks pending_upload rows older than the
     dial, and scanning rows stuck past a deadline, as error (which releases the quota
     reservation) and deletes their quarantine objects. initUpload caps outstanding declarations
     per user and refuses sizeBytes = 0.

ACCEPTANCE:
  - Unit tests per policy and per refusal. A macro .xlsm uploads, attaches in a project channel,
    and is refused when made Public; a PDF+ZIP polyglot is classified by its real family; a full
    decode queue answers 503; after the sweep (backdated rows) no pending_upload row is older than
    the dial and no quarantine object is orphaned.
  - grep shows one call site each for the scan and the decode.
SAME CHANGE: SA and Storage.md describe the per-purpose policy (#339 (m)); the PRODUCT_SPEC macro
marker removed; Zod for metadata.macros.
SQL SESSION (the job and its dials): at most two SQL sessions at once, on disjoint migration
files; announce each `deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`. 00005060 has one writer at a time, after jobs-sql.
```

### SN3 — The publication gate: NudeNet and OCR (T3 (a), (b))

```text
PROMPT SN3: Nothing reaches the Glass Front unscreened — the NudeNet and OCR gate

ROLE: Backend + infrastructure engineer. EPI §6.3; SEC §3.1-3.2, Z1, Z3, Z4, Z5, P-1, P-3, P-4;
#340 (e), (f); Decision #148 (Decision #340, rulings T3 (a), T3 (b) and T2's frame density).
DEPENDS: SN2, R1 (automated findings).

🧑 DECISION — STOP before step 5. Ruling T3 (a) says a library file made public is served as "a
screened, metadata-stripped copy, the original private", and is silent on files that are not
images or videos:
  Option A (recommended): only images, and videos once SN5 lands, may be made Public; any other
  kind stays Private or Link-only, and /api/files/visibility refuses Public for it with a 422.
  Option B: also allow PDFs as a flattened, re-rendered copy screened page by page; refuse the
  rest.
  Option C: allow any kind, ClamAV-scanned only, as its original bytes. This contradicts T3 (a);
  not advised.

FILES:
  - NOT the node: node prompt N3 (Projective-Safety) builds POST /screen/image and
    POST /screen/video (NudeNet 320n + Presidio Image Redactor + Tesseract; frames sampled on the
    node per ruling T2). Run N3 there first; this prompt calls those routes.
  - packages/backend/services/media/* (the one publish step; showcase-rendition.ts),
    services/messaging/live-group-photo.ts (T3 (b)), services/catalogue/live-catalogue-writes.ts
    (P-1: catalogue media through cutShowcaseRendition), services/files/live-objects.ts and the
    visibility route (T3 (a)), every public_assets writer except re-hosted favicons
  - supabase/migrations/00000010_tables_files.sql (files.publication_screenings) + its RLS file;
    00001160_functions_files.sql (files.fn_can_read's public arm serves the copy, not the
    original); 00005001 (moderation_image_thresholds; moderation_frame_sampling = { every_s: 2,
    max: 30, first_last: true }); 00005010 (the correction-notice type)
  - packages/types/files/* (the screening row; scores jsonb)
  - env: MODERATION_BACKEND_LIVE; devtools + dev-seam (pj.dev.moderation)
  - documentation/database/files/*, EPI §6.3 (frames ≤ 30, not 16), §6.6, §1.1 row 6;
    SA §Content moderation; PRODUCT_SPEC.md :773-774, :1209-1210 and §1.C's status row

STEPS:
  1. Reproduce: an avatar cut from an explicit fixture publishes; a library image made Public is
     served as its original, EXIF included; a group photo publishes unscreened.
  2. The gate runs once, in the publish step, on the decoded still (longest edge ≤ 1280 px) before
     any tier is cut. Hook points: the avatar and showcase rendition cut; catalogue media (only
     through the pipeline since E8); public_assets writes except re-hosted favicons; the group
     photo (T3 (b)); a library row made Public (T3 (a)).
  3. Policy per EPI §6.3: NudeNet's exposed labels and OCR contact entities against
     moderation_image_thresholds. clean → cut, write, attach. flagged → no public object; a 422
     with the category; the correction notice; the original stays uploaded and private; an
     automated finding through R1 (detector nudenet or ocr; ids and scores only). unavailable →
     503.
  4. Frames (ruling T2): an animated image is screened one frame every 2 s, at most 30, always
     including the first and the last, from the dial sent with each request; every thumbnail cut
     from a frame is screened as its own image. Video stays refused until SN5.
  5. T3 (a), per the decision: a Public library row is served as a fresh, re-encoded,
     metadata-stripped copy the pipeline cut (a rendition), never the original; fn_can_read's
     public arm and live-objects.ts (:70-75) serve the copy.
  6. files.publication_screenings keeps every verdict (item_id, purpose, verdict, scores,
     model_versions, decided_at, actor_user_id).
  7. pj.dev.moderation (auto · clean · flagged · unavailable): all five switcher parts.

ACCEPTANCE:
  - With the node up: a flagged fixture → 422, no object in the public bucket, one screening row,
    one automated report, one notice; a clean image publishes with its tiers; the node down → 503
    and nothing written; a 40-frame GIF sends at most 30 frames, the first and last included.
  - A Public library image's served bytes carry no EXIF and differ from the original's.
  - grep: every write to avatars, showcase, catalogue and public_assets passes the gate (favicons
    excepted).
SAME CHANGE: Zod + documentation/database/files/* with the table; the dev axis; the env contract;
the PRODUCT_SPEC T3 (a) and T3 (b) markers removed; EPI's frame contract.
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
```

### SN4 — Sightengine for violence, hate symbols and toxic public text (T2 (b), (c))

```text
PROMPT SN4: Sightengine screens violence, hate symbols and toxic public text — Glass Front only

ROLE: Integration engineer. SEC P-5 (the text half), Z6, §3.2 "open beyond EPI"; EPI §3.4
(Decision #340, ruling T2 (b), (c) and T2.3: Sightengine, a registered sub-processor sent Glass
Front material only).
DEPENDS: SN3 (the gate and the frame set), P2a (the public-copy doors), R1.

🧑 DECISION 1 — NEW CONTRADICTION; stop before step 4. PRODUCT_SPEC §Messaging 1.C screens public
text before publication and exempts nothing, and ruling T2 (b) makes the text classifier hosted.
A hosted HTTP call cannot run inside a trigger, yet clients hold direct write grants on
catalogue.listings / catalogue.products (00002520), marketplace.service_blueprints (00002018
:35-37) and projects.projects (00002011 :193), so a direct PostgREST write publishes unscreened
text. P2a's leakage trigger still holds; the gap is toxicity and hate only.
  Option A (recommended): revoke the client write grants and policies on those public-copy
  columns so the fat doors are the only writers, and screen in the doors. Removing a policy
  changes behaviour, so it needs an approval like Q0.2 (a).
  Option B: a screened-state column the trigger resets on every copy change; public reads show
  only screened copy; the service stamps it after Sightengine answers.
  Option C: screen in the doors only and record the direct-write gap.
  Record the ruling as a decision row before building (root CLAUDE.md §8).

🧑 DECISION 2 (an action): a human signs Sightengine's data-processing terms and sets its
retention and no-training options. HOSTED_MODERATION_LIVE stays false until then.

FILES:
  - packages/backend/services/moderation/sightengine.ts (new: an image check with the violence and
    offensive / hate-symbol models, and text moderation; read the current API docs)
  - the publish step from SN3 (one verdict = NudeNet ∪ OCR ∪ Sightengine)
  - the public-copy write services from P2a (the text screen, a 422 naming the field)
  - supabase/migrations/00005001 (moderation_hosted_thresholds)
  - env: SIGHTENGINE_API_USER, SIGHTENGINE_API_SECRET, HOSTED_MODERATION_LIVE
  - EPI §1.1 (a new row), §2.2 egress (api.sightengine.com), §3.4 (a new sub-processor row), §6.3
    ("hosted fallback, off by default" becomes the ruled stack), §10; SA §Content moderation
    (:1219-1222) and §Security; privacy.ts; PRODUCT_SPEC §1.C's status row

STEPS:
  1. The client accepts only a Glass Front publish (a typed purpose from SN3's public purposes);
     a unit test proves a private-zone call cannot be built.
  2. Images and frames (SN3's frame set): above threshold → the same 422, notice and automated
     finding (detector sightengine). Never send a private file, and never use Sightengine as
     NudeNet's fallback: nudity stays on the node.
  3. Unavailable, or the gate off in production → 503 for the publish, never clean. Development
     follows pj.dev.moderation.
  4. Text, per decision 1: headline, bio, listing, product and service copy and project briefs
     are screened for toxicity and hate; flagged → a 422 naming the field.
  5. Register the sub-processor everywhere the header's sub-processor rule names.

ACCEPTANCE: stubbed-fetch tests for clean, flagged and timeout on images and on text; a
private-zone publish cannot reach the client; EPI §3.4, SA and the privacy notice list Sightengine.
SAME CHANGE: the sub-processor rule; the env contract; PRODUCT_SPEC §1.C status.
SQL SESSION (dials only): at most two SQL sessions at once, on disjoint migration files; announce
each `deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
```

### SN5 — Videos published again: remuxed and screened

```text
PROMPT SN5: Videos publish again — remuxed, screened and metadata-stripped

ROLE: Media engineer. SEC Z2, P-2 (the remux branch); CAS F13; #339 (l) (Decision #340, ruling
T2: one frame every 2 s, at most 30, the first and last always, and every derived thumbnail).
DEPENDS: SN3, SN4.

FILES:
  - NOT the node: node prompt N3 adds POST /remux/video (ffmpeg -map_metadata -1
    -map_chapters -1 -c copy, faststart; the output re-sniffed) beside /screen/video's sampling
  - services/media/showcase-rendition.ts (lift Wave 0's video MediaRejectedError),
    services/media/library.ts (poster and tiers), apps/web/features/files/components/media-crop/
    MediaCropPicker.tsx (offer videos again where the target takes them)
  - PRODUCT_SPEC.md :757-759, documentation/database/files/Storage.md (the showcase section),
    EPI §6.3

STEPS:
  1. Publishing a video: remux on the node → re-sniff (a body that is not video is refused) →
     sample frames per the dial → screen the frames and the poster (NudeNet, OCR, Sightengine) →
     write the remuxed bytes and their tiers to showcase. The original stays private.
  2. Every thumbnail derived from a frame is screened as its own image.
  3. Slot 1 still takes a still only (PRODUCT_SPEC); the other slots take videos again.

ACCEPTANCE: a phone MP4 with GPS atoms publishes with none (ffprobe shows no location or creation
tags); a text file renamed .mp4 is refused; one flagged frame refuses the whole video; the node
down → 503.
SAME CHANGE: the PRODUCT_SPEC :757-759 marker and the Storage.md showcase text.
```

### SN6 — Presidio Tier 3 and the fragmentation window (T2.2)

```text
PROMPT SN6: Tier 3 scores obfuscated and split contact details — Presidio and the fragmentation
window

ROLE: Backend + Postgres engineer. EPI §6.2; SEC §2.4, T3-1 to T3-4 (Decision #340, ruling T2
with T2.2 and T2.3: a rolling window, protected phase only, no payload kept, an
evasion_fragmentation report, a penalty only after review; ruling T4: one sink).
DEPENDS: node prompt N4 (Presidio), R1, R3, P2b (the one predicate), P1d (the
normaliser and the corpus).

FILES:
  - supabase/migrations/00000013_tables_ops.sql (ops.moderation_queue); 00001660 (lease and drain
    doors); 00001300 + 00001840 (the enqueue trigger functions and triggers); 00005060
    (moderation-drain, every minute, http); 00005001 (moderation_tier3_review_threshold 0.65,
    moderation_tier3_category_weights, moderation_fragment_window = { minutes: 5,
    max_messages: 8 })
  - apps/web/routes/api/ops/cron/moderation.ts (bearer MODERATION_CRON_SECRET, also a Vault
    secret) → packages/backend/services/moderation/ModerationBackendService.ts (drainQueue)
  - packages/types/comms/pii-recognizers.ts (the ad_hoc_recognizers, versioned next to
    pii-detect.ts); packages/types/ops/* (the queue row)
  - env: MODERATION_BACKEND_LIVE (SN3), MODERATION_CRON_SECRET
  - supabase/probes/tier3_queue.sql (new); documentation/database/{ops,comms}/*; SA §Tier 3;
    EPI §6.2 and §1.1 row 5; PRODUCT_SPEC §1.A (the Tier 3 row and its "Planned with Tier 3"
    sentence)

STEPS:
  1. Enqueue AFTER INSERT OR UPDATE OF body (T3-1) on both message tables and on P2c's text
     surfaces (T3-3), only where the one protected predicate holds: PRODUCT_SPEC's whole protected
     phase (Decision #340's clarification), the marketplace window and the cooling-off included.
     reason 'unmasked' or 'near_miss'; a row Tier 2 masked is enqueued only as a near-miss (T3-4).
  2. drainQueue: lease with FOR UPDATE SKIP LOCKED (leased_until = now() + 2 min); read the stored
     row through the service client; normalise as P1d does, keeping an offset map; POST the
     analyzer with the recognisers; leakage = max(score × category weight); over the threshold →
     R1's fileAutomatedFinding (detector presidio; categories and scores, never span text); then
     delete the queue row, or record the attempt and back off.
  3. The fragmentation window (T2.2): for the sender and the thread or room, read their protected
     messages inside the window from the stored rows at drain time, so no second copy exists. If a
     buffer is ever needed, Deno KV with a TTL equal to the window, and nothing else. Join after
     stripping whitespace, zero-width characters, line breaks and punctuation, then re-score the
     join: a digit-run collector (Luhn; E.164 and national phone shapes through Presidio's
     PHONE_NUMBER) plus the custom recognisers for split emails and handles. Over the suspicion
     threshold → one automated finding, reason evasion_fragmentation, evidence = the message ids,
     categories and score; never the joined text.
  4. A penalty follows only when a reviewer actions the report in /admin/reports (R3). Nothing
     restricts or tells the sender before then.
  5. Fail open: with the node down, rows wait and back off while Tier 2 holds. Staging runs in
     shadow mode (reports created, nobody notified), EPI §6.6.
  6. Record the known gap in SA: the analyzer is English only, and other languages are scored by
     the pattern recognisers alone.

ACCEPTANCE:
  - tier3_queue.sql: a protected message enqueues; an unprotected one does not; an edit
    re-enqueues; a masked row enqueues only as a near-miss.
  - With the node up: "my number is" / "07700" / "900" / "123" from one sender inside the window
    → one evasion_fragmentation report whose evidence holds ids only; a price and an order
    number in one message → no report; after the Unlock → nothing enqueued.
  - The send route's latency is unchanged (measure before and after).
SAME CHANGE: Zod + documentation/database/ops/* with the queue table; the env contract
(MODERATION_CRON_SECRET and its Vault secret); PRODUCT_SPEC §1.A's Tier 3 row and its "Planned
with Tier 3" marker; SA §Tier 3.
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`. 00005060 has one writer at a time, after jobs-sql.
```

### H1 — ⚖️ Known-image hash matching, built and switched off

```text
PROMPT H1: ⚖️ Known illegal imagery is hash-matched in both zones — built, switched off

ROLE: Backend engineer. SEC §3.4; #340 (g) (Decision #340, ruling T5: yes, pending counsel;
PRODUCT_SPEC §Messaging 1.C "Known illegal imagery is matched in both zones").
DEPENDS: SN2 (the admission sequence's hook).

🧑 DECISION (⚖️) — never switch it on. Before anyone does, counsel names: the provider (PhotoDNA
Cloud Service or an equivalent hash list); the reporting body per jurisdiction (NCMEC, IWF / NCA,
…); the preservation period and who may access held material; and whether the provider becomes a
sub-processor (it receives images or hashes of private files: EPI §3.4, SA, the privacy notice).

FILES:
  - packages/backend/services/files/known-image-match.ts (new: the KnownImageMatcher interface and
    a `none` matcher, the only one wired)
  - SN2's admission sequence: every image, in both zones, before the promote
  - env: HASH_MATCH_LIVE (default false)
  - EPI (a Proposed provider row), SA §Content moderation, PRODUCT_SPEC.md :1099-1102 ("Planned"
    becomes "built behind an off switch, pending counsel")

STEPS:
  1. With HASH_MATCH_LIVE=false nothing changes, and no image or hash leaves the platform.
  2. The match path, exercised only by tests with a fake matcher: no promote; the quarantine
     object is retained, not deleted (preservation may be a legal duty); the row becomes
     quarantined with reason known_hash_match; an ops.log_entries error row (scope
     files.hash_match) alerts operators; the uploader sees the generic refusal only.
  3. No Dev Context Switcher axis: the flag is off everywhere, so there is nothing to simulate.

ACCEPTANCE: unit tests: flag off → the matcher is never called; a fake match → the hold path above
and nothing promoted; grep shows the matcher has one call site.
SAME CHANGE: the env contract entry with its reader; the PRODUCT_SPEC status sentence.
```

---

## 7. Last — Docs

### Z1 — Trust & safety docs sweep and audit status

```text
PROMPT Z1: Trust & safety documentation sweep

ROLE: Documentation steward. Runs after every prompt above has merged.

FILES: architecture/SECURITY_MODERATION_AND_AI_GAPS.md (a Status column on §1, §2.2, §3.1, §3.3,
§4.2, §4.3 and §5: Fixed by <prompt> / Open), architecture/COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md
§3 (F3, F5, F6, F12, F13, F15), api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md (every
Proposed mark now built; §11 rows 5-7; §12 flags (c), (d), (g)), business/PRODUCT_SPEC.md
§Messaging 1 and §Storage, architecture/SYSTEM_ARCHITECTURE.md (§Contact & financial leakage,
§Content moderation, §Storage Lifecycle, the env contract), architecture/ROUTING.md,
PRODUCT_MANAGEMENT.md, database/{comms,files,ops,security,search,org}/*,
design-system/DESIGN_SYSTEM.md §C.1, and the #340, #147 and #148 decision rows (mark each flag
resolved with its ruling or prompt).

SPEC: rollup, not restatement (documentation/CLAUDE.md rule 2). Every #340 flag (a)-(m) and every
ruling T1-T5 ends Resolved (prompt) or Open (owner). No "**Not built yet** (Decision #340" marker
survives for anything built.

ACCEPTANCE: grep -rn "Not built yet\*\* (Decision #340" documentation/ lists only unbuilt rules;
the SEC status column has no blank cell; every function, table, trigger, job and route the prompts
added appears in documentation/database/* or ROUTING.md.
```
