# Trust & Safety Build Prompts — Claude Code Work Orders for the Leakage Pipeline, the Moderation Loop and the Safety Node

> **Status: WORK ORDERS, not binding.** This file builds Part B §B.3 track **T** of
> [`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md). It closes the open gaps in
> [`SECURITY_MODERATION_AND_AI_GAPS.md`](SECURITY_MODERATION_AND_AI_GAPS.md) (SEC) and every open
> row of [`PRODUCTION_READINESS.md`](../readiness/PRODUCTION_READINESS.md) §D (§0.6 maps them),
> under Decision #340's rulings (#345 for the safety node, §8).
>
> **Verified against code 2026-11-23 at `f2e25929`; R1 landed after it.** 18 open, 2 partly done, 7
> done (§0 ledger). Runnable now: LK1, P1d, P2d, R4, SN1 (🧑 to confirm at step 4); in
> `Projective-Safety`, N3's remux and N5.
>
> **This file holds open work only.** A session that runs a prompt prunes it here when it finishes
> (§1's closing duty; [`build-prompts.md`](../reference/build-prompts.md) §2).

**How to run these.** Paste each prompt into its **own fresh session**, after the standard header
(§1), in the §0 order. Every prompt cites its evidence by finding ID (SEC `E*`, `L*`, `Z*`, `P-*`,
`R*`, `V*`, `AV-*`, `T3-*`, `G*`; CAS `F*` from
[`COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`](COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md); EPI flags from
[`../api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md`](../api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md))
and its ruling as `(Decision #340, ruling X)`. Decision #340's OWNER RULINGS (2026-10-30) hold T1–T5
and Q0.2 (a) and (f); the questionnaire's Part C is the table.

- **🧑 DECISION** stops and puts the named question to a human, with options and a recommendation,
  before it changes behaviour there. **⚖️** means ruled pending counsel: build it behind a flag that
  stays off, and never switch it on.
- **Migrations are edited in place** (root `CLAUDE.md` §1). Every prompt names the category file to
  edit. The one new category-1 file, `00001665_functions_ops_moderation.sql` (R1 created it with the report doors;
  `00001660` is MR4's `ops_alerts`), is a new home, not a patch file.
- **IDs.** H1 is the hash-matching prompt (§6); §8.3's H1–H5 are human setup steps. N0–N5 are node
  prompts, run in `Projective-Safety` (§8.4). Section numbers are kept from earlier versions (§2
  held the done E8), so old citations still resolve.
- **Not in this track:** G16 (identity's erasure chain), G17 (#336), CAS F14 metering and CAS
  F20–F29 (proxy and inspector hardening). Decision #396 (`0de5438f`) replaced V1's markup refusal:
  markup is admitted as inert text and SVG is sanitised.

---

## 0. Run order & dependencies

### 0.0 Done

| ID | What landed                                                                                              | Commit                        | Text at    |
| :- | :------------------------------------------------------------------------------------------------------- | :---------------------------- | :--------- |
| E8 | Only the service role writes storage outside quarantine; no SVG in `public_assets`; search definers gone | `dd4206d3` (merge `ee0b004a`) | `f2e25929` |
| W1 | Link reputation on Google Web Risk; embeddings pinned to Voyage, `EMBEDDINGS_ENABLED` still false        | `bc805dff` (merge `f5955b7c`) | `f2e25929` |
| N0 | Node scaffold and `contract/openapi.yaml` (`Projective-Safety`)                                          | `f6c46b8`                     | `f2e25929` |
| N1 | Caddy gateway: bearer, per-route body caps and timeouts (`Projective-Safety`)                            | `fea1e02`                     | `f2e25929` |
| N2 | ClamAV `POST /scan/file`, the `macros` flag, signature age in `/healthz` (`Projective-Safety`)           | `d7e82a1`                     | `f2e25929` |
| N4 | Presidio analyzer and anonymizer routes and the Tier 3 corpus; the node holds no recognisers             | `30c8bda`, `a4ccec5`          | `f2e25929` |
| N6 | Withdrawn: the app calls Sightengine itself (SN4; Decision #345)                                         | —                             | `f2e25929` |
| R1 | `ops.reports`, the one review sink: `user` · `automated` · `notice` sources, the twelve-reason vocabulary (#533), `ops.file_report` and `ops.file_automated_finding`, `ReportsBackendService`, the `evidence` bucket | `00f8e1f9` | `de8ec700` |

| Phase                        | Prompts                                                         | Why this order                                                                                                                                                                                                                                                                                                                      |
| :--------------------------- | :-------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Any time**                 | LK1                                                             | App only (`services/files/link-scan.ts`). It closes PRD-D4, one of the two §D rows UAT needs.                                                                                                                                                                                                                                       |
| **1 — The leakage pipeline** | P1d → P2a → P2b → P2c; P2d                                      | P1d builds Tier 1 and, in the same change, every Tier 2 category Tier 1 refuses (L8; PRODUCT_SPEC §Messaging 1.A: the database tier is the floor). P2a reuses P1d's categoriser for public copy. P2b widens the protected phase (T1) before P2c masks new surfaces with it. P2d closes the SEC grant leftovers.                     |
| **2 — The moderation loop**  | R4 → R5 → R3 → R2                                               | SEC §3.3's order: the sink (R1, done), the penalty writer, Standing, the reviewer, then the report button last, so it never renders before a reviewer can act on it (root `CLAUDE.md` §3.11).                                                                                                                                                  |
| **3 — The safety node**      | SN1 → SN2 → SN3 → SN4 → SN5; SN6 after R3 and P2b; H1 after SN2 | ClamAV, then the one admission contract, then the publication gate (NudeNet + OCR), then Sightengine, then video. SN1 can start now: E8 has merged and the node's N1 and N2 are built. It is file-disjoint from phases 1–2 apart from `00005060`. SN6 (Presidio) needs the review sink, the reviewer and the final phase predicate. |
| **Last**                     | Z1                                                              | Docs sweep, the SEC status column and the decision rows.                                                                                                                                                                                                                                                                            |

**Across this repo, the node repo and the people who act.** SQL steps take the gaps in §0.3's serial
lanes. `00002510` has one writer at a time across all tracks, the identity erasure chain included.

| Wave    | This repo                                                                 | Node repo / you                                              | Waits for                                                                            |
| :------ | :------------------------------------------------------------------------ | :----------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| 1 (now) | LK1 · R4 → R5 → R3 (SQL, serial) · P1d (SQL) · P2d (SQL) · SN1 → SN2       | N3's remux, N5; §8.3 H1 keys                                 | —                                                                                    |
| 2       | R2 · SN3 · H1 · P2a → P2b → P2c                                           | Provision the UAT node (§8.3 H3); `MALWARE_SCAN_LIVE` in UAT | R3 and COMMS MS3 (R2); SN2 (SN3); SN2 (H1); PM-WP4b (P2a–P2c); SCH-WP10 (P2c)        |
| 3       | SN4 · SN5 · SN6                                                           | Sightengine's data-processing terms signed                   | P2a and a ruling on #344 (b) (SN4); SN4 and N3's remux (SN5); R3 and P2b (SN6)       |
| —       | —                                                                         | A Web Risk key per hosted environment; counsel on H1         | PRD-D5 and PRD-D14 close outside code                                                |

**SQL lane (Part B §B.0).** P1d, P2a, P2b, P2c, P2d, R4, R5, R3, SN1 (its job), SN2 (its job),
SN3, SN4 (dials) and SN6 run SQL, and LK1 does if it adds its dial. At most **two SQL sessions at
once** across all tracks, on disjoint migration files. Each announces its `deno task db:reset` to
the other sessions, runs `deno task test:probes` after each reset, and finishes with its own clean
`deno task test:probes:fresh`. R2, SN5 and H1 are app or node work only.

### 0.1 Cross-track waits (⏳)

Track and step names are Part B's; COMMS IDs (MS1–MS5, NT1–NT5, SR1–SR4) are
`COMMS_BUILD_PROMPTS.md`'s, PM-* are `PM_BUILD_PROMPTS.md`'s and SCH-* are
`SCHEDULING_BUILD_PROMPTS.md`'s. Met, and dropped from the prompts: jobs-sql (`817dbbd1`), M·MS1
(`44382c08`), M·MS2 (`4958c708`, #508), SAC1 (`36b25912`) and SAC2 (`67d9c9d2`).

| T prompt | Waits for                                               | Why                                                                                                                                                                                                                                                       |
| :------- | :------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2a      | ⏳ PM-WP4b                                              | `projects.projects` copy and its trigger file belong to the projects track while WP4b runs (WP4 split into WP4a → WP4b).                                                                                                                                  |
| P2b      | ⏳ PM-WP4b                                              | A cancelled project's cooling-off reads WP4b's lifecycle.                                                                                                                                                                                                 |
| P2c      | ⏳ PM-WP4b, SCH-WP10                                    | Ticket and submission text (`00000015`, `00001850`) and scheduling event text (`00001860`). SCH-WP10 is built as `8851d4dc` on `claude/sch-wp10-calendar`, which is not on main (SCHEDULING §0). Reactions are out: COMMS MS5 pins them to one emoji set. |
| P2d      | PROJECTS CH1 landed (#562)                          | CH1 removed the room UPDATE policy and every client UPDATE on the message tables; its doors refuse an archived room (PM423), so G5 is the INSERT gate only. COMMS SR1 pins `fn_nearest` / `fn_nearest_to_entity` (G18's function half), so P2d does only the sync triggers. |
| P1d      | I's erasure chain (coordinate)                          | `ops.refusal_counts` is personal data, as are R1's `ops.reports` and `evidence` copies (landed, so ERA1 adds their arm). The arm lives in `00001060` (identity's hot file) and is classified in identity ERA1's `account_erasure_scope.sql`: whichever lands second adds it. |
| R2       | ⏳ M·MS3                                                | The message menus live in the islands MS3 reworks.                                                                                                                                                                                                        |
| R4       | not beside identity HK1                                 | Both edit `00000012_tables_security.sql` (HK1 is identity's Q0.2 (b) drops).                                                                                                                                                                              |
| R5       | not beside O's read-path work                           | `services/explore/live-catalog.ts` and `00002520`.                                                                                                                                                                                                        |
| SN4      | ⏳ P2a and the owners of the public-copy write services | The text screen runs in the same doors.                                                                                                                                                                                                                   |

**Others wait on T:** MARKETPLACE SC8 waits for R2 (R1 has landed with the `notice` source;
Decision #496: a `notice` row is filed only by SC8's door), and PROJECTS EX4 builds its
workload-verdict appeal on R1's sink (landed), R3 and R4.

### 0.2 Hot files (Part B §B.0) and other shared files

| File                                                    | T writers                              | Other writers                                                     |
| :------------------------------------------------------ | :------------------------------------- | :---------------------------------------------------------------- |
| `00005060` (jobs)                                       | SN1, SN2, R5, SN6                      | F, M, P, C, OPS (one writer at a time; PROJECTS FL1 landed, #564) |
| `00001060` (erasure)                                    | none (R1's and P1d's arms go to I)     | I (ERA1), SEC G16                                                 |
| `00001300` (comms)                                      | P1d, P2b, P2c, P2d, SN6                | COMMS MS4, MS5; every CAS messaging step                     |
| `00002510` (grants)                                     | P1d, P2d, R3, R4, SN6                  | many                                                              |
| `00002012` (comms policies)                             | P2d                                    | —                                                                |
| `features/devtools` + `dev-seam.ts`                     | SN1, SN3, R3                           | identity SSO1, MFA1, MIN1; PROJECTS and PM (PROJECTS §0.2's list) |
| `00001400` (search functions)                           | P2d                                    | COMMS SR3, SR4 (SR1 and SR2 have landed)                          |
| `00002520` (table grants)                               | P2d, R5                                | many                                                              |
| `00000012` (security tables)                            | R4                                     | identity HK1 (Q0.2 (b) drops)                                     |
| `00000013` (ops tables), `00001665` (R1's)              | P1d, R3, SN6                           | —                                                                 |
| `00000016` (comms tables)                               | P2b, P2d                               | —                                                                 |
| `00001840` (comms triggers)                             | P2c, P2d, SN6                          | COMMS                                                             |
| `00005001` (platform params)                            | P2b, P2d, R4, SN1, SN2, SN3, SN4, SN6  | F (FX margin and dials)                                           |
| `00005010` (notification catalog)                       | R3, SN3                                | COMMS NT1–NT5                                                     |
| `MessagingBackendService.ts`, `projects/live-writes.ts` | P1d, R2                                | COMMS MS3, MS5; O D-06 / SC-9                  |
| `services/files/*`, `services/links/*`                  | LK1, SN1, SN2, SN3, H1                 | PROJECTS FL2, FL3 (FL4 landed, #570; FL1, #564)                  |

### 0.3 These cannot run in parallel inside T

- P1d / P2b / P2c / P2d / SN6 (`00001300`)
- P1d / P2d / R3 / R4 / SN6 (`00002510`)
- P1d / R3 / SN6 (`00000013`, `00001665`)
- SN1 / SN2 / R5 / SN6 (`00005060`)
- R3 / SN1 / SN3 (devtools + `dev-seam.ts`)
- SN2 / SN3 / SN5 / H1 (the upload and publish pipeline: `services/files/*`, `services/media/*`)
- LK1 / SN2 / SN3 (`services/files/*`)
- P2a / SN4 (the public-copy write services)
- P2c / P2d / SN6 (`00001840`)
- R3 / SN3 (`00005010`)

`00005001` is shared by eight T prompts, but each adds its own rows: two may overlap, and the second
rebases before it merges.

### 0.4 Open decisions and human actions the prompts stop at

H1 is the ⚖️ item. No other stop here is ruled; each prompt holds its options.

| Prompt    | Question                                                                                                                                                                                      | Recommendation                                                                                                                                                                                   | Kind                                      |
| :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------- |
| P2a       | Decision #147 flag (a): structured links (`org.profile_links`, a business's `website`) and article bodies                                                                                     | Structured links refuse only payment and messaging hosts; article bodies follow the free-text rule                                                                                               | Open since #147                           |
| P2b       | The cooling-off length (T1 names the window, not its length)                                                                                                                                  | 30 days, its own dial                                                                                                                                                                            | Unruled value                             |
| P2b       | A cold DM opened from a profile reached through Explore (T1 covers marketplace surfaces and connected people only)                                                                            | Protect a thread between people who were not connected when it opened                                                                                                                            | Gap in T1                                 |
| SN1       | In production, with `MALWARE_SCAN_LIVE` off or the node unreachable, what happens to an upload                                                                                                | Architect default: it stays in quarantine and the uploader sees a 503 (OPERATIONS LD4's rule); development skips the scan                                                                        | Confirm or override                       |
| SN3       | T3 (a) for a library file that is not an image or video                                                                                                                                       | Only images (and videos after SN5) may be made Public                                                                                                                                            | Gap in T3 (a)                             |
| SN4       | PRODUCT_SPEC §Messaging 1.C screens public text before publication and exempts nothing, but a hosted classifier cannot run in a trigger while clients hold direct write grants on public copy | Revoke the client write grants on public-copy columns (an approval like Q0.2 (a))                                                                                                                | Logged as Decision #344 flag (b), unruled |
| SN4       | Sightengine's data-processing terms                                                                                                                                                           | A human signs them before `HOSTED_MODERATION_LIVE` is set                                                                                                                                        | Action                                    |
| W1 (done) | Voyage's written no-training terms                                                                                                                                                            | A human obtains them before `EMBEDDINGS_ENABLED` is set (ruling T5)                                                                                                                              | Action                                    |
| SN1       | The node's VM and private link (4 vCPU / 8 GB, ruling T5; §8.3 H3)                                                                                                                            | A human provisions them; nothing here deploys. For UAT, provision once SN1 passes against a local node: don't wait for N5 or N3's remux, which deploy onto the same box later with no app change | Action; the timing is yours               |
| PRD-D5    | A Web Risk key for every hosted environment (§8.3 H1.1) and a recorded live lookup of the test threat URL                                                                                     | —                                                                                                                                                                                                | Action                                    |
| H1        | ⚖️ Known-image hash matching: provider, reporting body, preservation                                                                                                                          | Counsel decides; the flag stays off. PRD-D14 cannot reach ✅ without it                                                                                                                          | ⚖️                                        |

### 0.5 The safety node lives in its own repo

Recorded as Decision #345, with its open conflicts against EPI §6. The node's repository,
`Projective-Safety`, sits beside this repo with N0–N4 committed (§0.0; N3's remux is open). §8 holds
the node's human setup and node prompts. The rest of this file is the app side, and nothing here
creates `infra/safety-node/`.

- **The contract wins on route names.** The node's `contract/openapi.yaml` serves `GET /healthz`,
  `POST /scan/file`, `POST /screen/image`, `POST /screen/video`, `POST /presidio/analyzer/analyze`
  and `POST /presidio/anonymizer/anonymize`; N3's open remux adds `POST /remux/video`. EPI §6's
  `/v1/…` examples yield to it, and the app's Zod is copied from it.
- **Order across the two repos.** N1 and N2 are built, so SN1 can run. N3's screen routes are built
  (SN3); its remux is not (SN5). N4 is built (SN6).
- **The owner's #345 rulings (2026-10-30).** The route names stay, with a `/v1/` alias at the
  gateway if one is ever needed (a). Every verdict uses the contract's
  `{verdict, scores, model, version, ms}` envelope, and an engine failure is a typed `503`, never an
  `error` verdict (b). A missing or wrong bearer gets a typed `401` (c). Projective's recognisers
  travel per request from the app (EPI §6.2's `ad_hoc_recognizers`); the node stores none (d). The
  app sends `moderation_image_thresholds` with each `/screen/*` request as one optional JSON form
  field, and the node falls back to its env defaults without it (e).
- **Sightengine stays in the app.** SN4 calls it for public media and public text only (ruling T2).
  The node has no Sightengine code and nudity never falls back to it (N6 withdrawn).

### 0.6 Readiness rows → prompt (PRODUCTION_READINESS §D, USER_FLOWS PJ)

A row flips only as its last cell says, in the same change as the prompt that flips it (the standard
header's READINESS line).

| Row     | Gate · Crit     | Prompt                 | USER_FLOWS rows                          | The row flips when                                                                                                              |
| :------ | :-------------- | :--------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| PRD-D3  | UAT · Critical  | SN1                    | PJ-56, PJ-63 (their scan half, with SN2) | 🟡 when SN1 merges and passes against a local node; ✅ when the target environment's node answers with `MALWARE_SCAN_LIVE=true` |
| PRD-D4  | UAT · High      | LK1                    | PJ-54, PJ-64 → ✅                        | ✅ when no path answers `safe` without a clean reputation lookup                                                                |
| PRD-D5  | PROD · Normal   | LK1 + you (W1 done)    | —                                        | ✅ when each hosted environment has a Web Risk key and a recorded live lookup of the test threat URL                            |
| PRD-D7  | PROD · High     | P1d                    | PJ-57 (with P2a–P2c and SN6)             | ✅ on P1d                                                                                                                       |
| PRD-D8  | PROD · High     | P2a → P2b → P2c        | PJ-57                                    | 🟡 on P2a (public copy); ✅ on P2c                                                                                              |
| PRD-D9  | PROD · Critical | (R1 done) R4 → R5 → R3 → R2 | PJ-58 → ✅ on R2                         | 🟡 on R3 (a reviewer can act); ✅ on R2 (people can report)                                                                     |
| PRD-D10 | PROD · Critical | SN2 → SN3              | PJ-49 (SN3 screens the group photo)      | ✅ on SN3                                                                                                                       |
| PRD-D11 | PROD · High     | SN4                    | —                                        | ✅ on SN4                                                                                                                       |
| PRD-D12 | PROD · Normal   | SN5                    | —                                        | ✅ on SN5                                                                                                                       |
| PRD-D13 | PROD · Normal   | SN6                    | PJ-57 → ✅ once P1d–P2c have landed      | ✅ on SN6                                                                                                                       |
| PRD-D14 | PROD · Critical | H1                     | —                                        | 🟡 when H1 lands with its flag off; ✅ only after counsel, a signed provider agreement and the flag on in production            |
| —       | —               | P2d                    | PJ-47 (G5, G6)                           | No §D row: G5, G6 and G18 are comms hardening, not "public copy masked", so P2d does not gate PRD-D8                            |

**What UAT needs from §D:** only D3 and D4. LK1 can run today. D3's path: SN1 against a local node
(D3 → 🟡), then SN2; then a human does §8.3 H1 (secrets) and H3 (host and private link) and turns on
`MALWARE_SCAN_LIVE` in the UAT environment (D3 → ✅). Every other §D row is a PROD row.

---

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
directory). Theme-engine unit failures are pre-existing (Decisions #96 (a) and #157 (m)); compare
any red test with main before calling it yours. UI prompts:
`deno task dev`, sign in as the seeded personas (documentation/database/Seed.md), and capture
screenshots at 1440, 900 and 390 px in light, dark, data-contrast="high" and data-motion="reduced".
Safety-node prompts: run the node from its own repo, Projective-Safety (`docker compose up`, the
gateway bound to 127.0.0.1), with SAFETY_NODE_URL=http://127.0.0.1:8443.
Commit on the branch you were given with a clear message; do not push or open a PR unless I ask.

READINESS (Decision #444): in the same change, update documentation/readiness/
PRODUCTION_READINESS.md: the row(s) TRUST_SAFETY_BUILD_PROMPTS.md §0.6 names for your prompt —
status, and evidence naming your commit and decision; recompute §D's line and the three tier rows
of the Scoreboard (score = Σ weight × credit / Σ weight; ✅ 1 · 🟡 0.5 · ❌ 0; Critical 3 · High 2 ·
Normal 1; ⏸ rows excluded); add one line to §Score history. Update USER_FLOWS.md where §0.6 names
a PJ row, or where a flow's status changes. A gap you find and do not fix gets a new row at the end
of its area, never silence.

When you finish, do the closing duty (documentation/reference/build-prompts.md §2) in the same
commit as the work:
  - In documentation/architecture/TRUST_SAFETY_BUILD_PROMPTS.md: a done prompt leaves the file.
    Delete its section and add its row to §0's Done ledger (ID · what landed · commit · text at
    <commit>^). A partly done prompt keeps only its open steps, with their numbers unchanged, under
    one rewritten Status line. A ruled 🧑 stop becomes the ruled step, with its decision number.
  - Treat any step you built for another prompt the same way, in the file that holds it.
  - Run git grep -n "<ID>" documentation/ and update every place that still calls it open: the
    PRODUCTION_READINESS / USER_FLOWS Track cells, the audit's Status column, other prompts' waits,
    and this file's row in documentation/reference/build-prompts.md §3.
  - If the file has no prompts left, delete it, log it in build-prompts.md §4 and repoint its links.
```

---

## 3. Any time — Link safety

### LK1 — The link scan fails closed

Closes PRD-D4. It also does the code half of PRD-D5. (Was `SAFETY_MODERATION_BUILD_PROMPTS.md` §3.)

```text
PROMPT LK1: No check, no "safe": the link scan fails closed offline and without a reputation answer

ROLE: Backend engineer (files / link safety). App lane. Not beside SN2 or SN3 (services/files/*)
or another prompt that edits services/links/*.

CONTEXT (verified at f2e25929; re-check every line):
  - runScan (packages/backend/services/files/link-scan.ts:175-270): with FILES_BACKEND_LIVE off,
    any https URL that passes the face-value checks is `safe` (:203), titled from the URL. The
    module docblock's "The gate" section says so on purpose. FilesBackendService.attachLink
    (:278) stores that verdict in files.items.link_scan_status, and the chat preview
    (services/links/LinkPreviewBackendService.ts:221) shows the rich card for `safe`.
  - Live, checkReputation (link-reputation.ts:70-84) answers `unavailable` with no
    LINK_SAFETY_API_KEY or on any API error. runScan then ignores it: a page that answers is
    `safe` (:262) with no reputation lookup at all. That is PRD-D5's code half.
  - LinkScanStatus (packages/types/files/assets.ts:95-104; SQL enum 00000004:378-383) already has
    `unscannable` ("we could not check it"), and the UI already takes the cautious path for it
    (features/files/components/LinkCard.tsx:57, features/links/islands/ExitInterstitial.island.tsx
    :70). Failing closed needs no new state, no migration and no Zod change.
  - The rich fields (description, favicon, image) are already `safe`-only (link-scan.ts:311-313).
  - Google's test threat host stays `blocked` offline, so the warning path stays exercisable.

STEPS:
  1. Red: unit tests on runScan with injected deps: (a) offline, https://example.com → not
     `safe`; (b) live, reputation `unavailable`, the page answers 200 → not `safe`; (c) live,
     reputation `clean`, 200 → `safe` (unchanged); (d) offline, the test threat host → `blocked`
     (unchanged). (a) and (b) fail today.
  2. Offline: `unscannable`, with a person-readable reason that link checks are off in this
     environment. Keep the URL-derived title so the card still renders.
  3. Live: `safe` requires reputation `clean`. `unavailable` with a page that answers →
     `unscannable` ("We couldn't check this site's reputation"). A `listed` site stays `blocked`.
  4. Retry: find whether a stored `unscannable` verdict is ever rescanned (link_scanned_at, the
     preview cache). If it never is, add a rescan on the next read once a dial's minutes have passed
     (a platform param in 00005001, your own #region), so a passing Web Risk outage does not leave
     a link unscannable forever. If adding the dial is a SQL change you'd rather not make here, make
     it a constant with a TODO naming the dial, and say so in your report.
  5. Stored verdicts: no hosted data exists yet (PRD-G8). Check how the seed generator sets
     link_scan_status. Leave seeded rows as seed truth, but note in Seed.md that a seeded `safe`
     link was never scanned.
  6. Production: when LINK_SAFETY_API_KEY is missing in production, print one boot warning (and a
     line in OPERATIONS LD4's boot report, if that has landed). The links still work: they read as
     `unscannable`, never falsely `safe`.
  7. Copy and UI: read the new reasons in LinkCard and the exit interstitial; capture 1440 and
     390 px of an unscannable link card and the interstitial.

ACCEPTANCE: the step-1 tests are green. In `deno task dev` with FILES_BACKEND_LIVE=false, posting
https://example.com to /files and to a chat shows the "not checked" card, and the exit interstitial
asks before leaving. With FILES live and no key: the same. With a Web Risk key: example.com is
`safe` and the test threat URL is `blocked`. check, lint and test:unit are green.
SAME CHANGE: the link-scan.ts module docblock ("The gate"); SYSTEM_ARCHITECTURE.md's link-safety
paragraph; EPI's Web Risk status line; .env.example's LINK_SAFETY_API_KEY comment (no key means
links are unscannable, never safe).
```

---

## 4. Phase 1 — The leakage pipeline

### P1d — Tier 1 pre-filter, the Tier 2 categories it refuses, and refusal counts

```text
PROMPT P1d: Tier 1 refuses at the send door; Tier 2 masks every category Tier 1 refuses

ROLE: Trust & safety engineer (TypeScript + Postgres). SEC §2.3 (SEC-P1d), L8, L9, #340 (k);
Decision #147 (b), (e) (Decision #340, ruling T2; ruling T4: refusals counted, never stored).
WAITS: none. M·MS2 landed (4958c708, #508): MessagingBackendService.sendMessage(actor, ref,
input) is the one send door for both stores, and a comment there marks Tier 1's place, before
either store is written. Today Tier 2 runs (trg_mask_message_pii, 00001840) and Tier 1 is only
that comment.

FILES:
  - packages/types/comms/pii-detect.ts (new) + test; packages/types/comms/pii.fixtures.ts (new,
    the one corpus); pii.ts, pii.test.ts, pii.contract.test.ts; the PII category enum
  - packages/types/links/links.ts (reuse segmentLinks / normalizeLink to extract URLs and bare
    domains; add linkify-it, named in ruling T2.1, only if they miss paypal.me/x or wa.me/123)
  - supabase/migrations/00001300_functions_comms_channels.sql (mask_pii; a shared categoriser;
    the protected-phase door for the send services)
  - supabase/migrations/00001320_functions_editorial_community.sql (fn_feedback_idea_screen)
  - supabase/migrations/00000013_tables_ops.sql (ops.refusal_counts) and
    00001665_functions_ops_moderation.sql (its writer, beside R1's report doors);
    00002019 (RLS); 00002510 (grants)
  - the send doors: MessagingBackendService.sendMessage (the one door; check that
    services/projects/live-writes.ts inserts no room message outside it),
    services/messaging/live-requests.ts (comms.send_request_message's caller)
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
00001060 (classified in ERA1's account_erasure_scope.sql once ERA1 lands); do not edit 00001060
here.
```

### P2a — Public copy refused at the database floor (T2 (a))

```text
PROMPT P2a: Public copy is refused at the database floor

ROLE: Postgres engineer. SEC §2.5, P-5 (the leakage half), Z6 (the leakage half); #340 (c);
Decision #147 §1.B (Decision #340, ruling T2 (a)).
DEPENDS: P1d (comms.fn_pii_categories). WAITS: ⏳ PM-WP4b (projects.projects and its trigger
file).
ALSO PUBLIC COPY: reviews.entity_reviews.title, comment and reply_comment, written by MARKETPLACE
RV1's doors (00001670, #487). Refuse them at the floor like the surfaces below.

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
DEPENDS: P1d (comms.fn_send_is_protected). WAITS: ⏳ PM-WP4b (project cancellation). M·MS1 and
M·MS2 (the openers behind the one door) have landed.

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
     decided_at in place (Zod + docs) only where a table has none, after checking what PM-WP4b
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
DEPENDS: P2b. WAITS: ⏳ PM-WP4b (ticket and submission text), ⏳ SCH-WP10 (event text; built on
an unmerged branch, §0.1).

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

### P2d — The remaining comms and search grant gaps (G5, G6, G18)

> **Status 2026-11-23:** steps 3 and 4 landed (step 3, G13: SAC2 `67d9c9d2`, #462; step 4, G14: SAC1
> `36b25912`, #477, which made `search.is_admin(uuid)` service-role only); steps 1, 2 and 5 below
> are open.

```text
PROMPT P2d: Archived rooms, message size and rate, and the search sync triggers' search_path

ROLE: Postgres security engineer. SEC G5, G6, G18 (the sync-trigger half). COMMS SR1 pins
search_path on fn_nearest / fn_nearest_to_entity; skip those two. Re-check COMMS_BUILD_PROMPTS.md
and PROJECTS_BUILD_PROMPTS.md on main and skip anything they have since claimed (CH1 landed, #562).

FILES:
  - supabase/migrations/00002012_policies_comms.sql (send_messages_if_member :60-64,
    edit_own_messages :82-90)
  - supabase/migrations/00000016_tables_comms.sql (body length CHECKs; an unlogged rate table)
  - supabase/migrations/00001300 + 00001840 (the per-sender rate trigger function and triggers)
  - supabase/migrations/00001400 (the sync triggers' search_path: sync_team_to_index,
    sync_freelancer_to_index, sync_project_to_index, sync_user_to_index, sync_business_to_index,
    sync_service_to_index, sync_product_listing_to_index, sync_article_to_index)
  - supabase/migrations/00005001 (message_rate_per_minute = 60)
  - supabase/probes/trust_p2_grants.sql (new); documentation/database/{comms,search}/*

STEPS:
  1. G5: the room INSERT policy also requires the channel's archived_at IS NULL. Today it asks
     comms.has_channel_access (00001300:154-177), which ignores archived_at, so only a direct
     PostgREST insert passes: the app's send door already refuses (projects/live-writes.ts
     :2631-2637). The UPDATE half is done: PROJECTS CH1 (#562) removed that policy, and its doors
     refuse an archived room (PM423).
  2. G6: CHECK (char_length(body) <= 8000) on both message tables (confirm the app's own limit and
     that no seed exceeds it), and a per-sender BEFORE INSERT rate trigger (a token bucket in an
     unlogged table, refusing PR429 past the dial) so a direct PostgREST flood is bounded too. It
     is also the fix for #508 (h): the send door's 30-a-minute limit is per process
     (MessagingBackendService.ts MESSAGE_SEND_RULE).
  5. G18: pin search_path = '' on the sync trigger functions and qualify every name.

ACCEPTANCE: trust_p2_grants.sql: a post to, or an edit in, an archived room → refused; a
9,000-character body → 23514; the 61st message in a minute → PR429; the search index still syncs
on a profile edit. function_grants.sql and search_query_log_attribution.sql (steps 3 and 4) still
pass.
SAME CHANGE: documentation/database/{comms,search}/{Tables,Policies,Functions}.md.
SQL SESSION: at most two SQL sessions at once, on disjoint migration files; announce each
`deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`.
```

---

## 5. Phase 2 — The moderation loop

### R4 — The content-penalty writer

```text
PROMPT R4: An actioned report writes a penalty, from a content source that now exists

ROLE: Postgres engineer. SEC R4; Decision #148 (d) (Decision #340, ruling T4: content-report
penalties land on the one Standing penalty term).
DEPENDS: R1 (landed).

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
CROSS-TRACK: 00000012 also carries identity HK1's Q0.2 (b) drops; never run beside HK1.
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
  - supabase/migrations/00002520_permissions_table_grants.sql (:190, discovery_penalty in the anon
    and authenticated column grant on search.profiles_index)
  - packages/backend/services/explore/live-catalog.ts (:829 reads discovery_penalty with the anon
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
     the existing trigger then recomputes. (00005060 has one writer at a time.)
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
DEPENDS: R4, R5 (R1 landed).

FILES:
  - supabase/migrations/00001665_functions_ops_moderation.sql: ops.list_reports_for_review (admin
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
     dismissed; a filter by source and detector; child_safety reports head the pending queue
     (#533: reviewed first, escalated as the law requires). An item shows its snapshot (automated: ids,
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
DEPENDS: R3: the button never renders before a reviewer can act on it. WAITS: ⏳ M·MS3 (the
message menus live in the islands it reworks; MS2 has landed). MARKETPLACE SC8 waits for this
prompt (#496; R1 has landed).
ENTRY POINTS ADDED SINCE: the listing's entry point is USER_FLOWS MK-47's report half, and reviews
on /view and /:handle/reviews carry a Report action too (#487 (d)). hide_review needs R3's
operator UI.

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
  2. The dialog lists the person-readable reason labels (REPORT_REASON_LABELS over
     PERSON_REPORT_REASONS, #533), an optional bounded note and a filed state, with one filled button. Nothing tells the reported
     person who reported. ops.reports has no note column (SA: the client sends only the subject
     and a reason): a note needs its column, edited into 00000013 in place, or is dropped.
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
DEPENDS: met. E8 (AV-1) has merged, and the node's N1 (gateway, fea1e02) and N2 (ClamAV,
d7e82a1) are built in Projective-Safety.

🧑 DECISION — confirm or override the architect default in step 4 (§0.4): in production
(DENO_ENV=production, or unset), a gate that is off refuses the promote rather than skipping the
scan, following OPERATIONS LD4's rule. Development skips the scan as written.

FILES:
  - NOT the node: it lives in its own repo, Projective-Safety (§0.5), where N2 built clamd and
    POST /scan/file on the committed contract (contract/openapi.yaml). This prompt is the app
    half, and its Zod copies that contract.
  - packages/backend/core/safety-node.ts (new: URL, bearer, timeouts, the placeholder rule)
  - packages/backend/core/env.ts, .env.example, SA's Environment Variable Contract and
    packages/backend/core/env-manifest.ts (its planned("…", "T&S SN1") rows flip to live in the
    change that reads them): MALWARE_SCAN_LIVE, SAFETY_NODE_URL, SAFETY_NODE_TOKEN,
    FILES_CRON_SECRET (also a Vault secret). This narrows PRD-H5.
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
  2. Bring the node up from Projective-Safety (`docker compose up`, the gateway on
     127.0.0.1:8443, the bearer SAFETY_NODE_TOKEN).
  3. Read N2's POST /scan/file in the node's contract: the {verdict, scores, model, version, ms}
     envelope, verdict clean · infected with the signature beside it, and version's clamav,
     db_version and db_time (for step 6). The request carries X-Content-SHA256 (a mismatch is
     400). An engine failure is the contract's typed 503, never an error verdict (Decision #345
     (b)). A macro Office file comes back clean with flags ['macros'] (AV-5). Copy the schema as
     Zod; never re-implement the scan here.
  4. App: at each hook, after the sniff and before the promote, scan the bytes already in memory.
     clean → continue; infected → refuse(row, hostile = true) (the object deleted, the row
     quarantined, a person-readable reason); a typed 503 or no answer with MALWARE_SCAN_LIVE=true →
     the row back to pending_upload and a 503. Gate off: in production (DENO_ENV=production, or
     unset) the row stays in quarantine and the uploader sees a 503 (the architect default the
     🧑 above confirms); in development skip, with one log line.
  5. AV-2: files.items.metadata.av = { engine, db_version, verdict, signature?, flags?, at }.
  6. Staleness: a db_time older than 48 h writes an ops.log_entries warn row, scope
     files.malware_scan (not 24 h, which a healthy node crosses daily; Decision #345).
  7. AV-3: files-av-rescan (http, daily) rescans originals scanned under an older db_version in the
     last av_rescan_days; a hit is handled as at admission and logged. A deno task backfills
     objects admitted before this change.
  8. pj.dev.malware (auto · clean · infected · unavailable): EPI §3.6, all five switcher parts.

ACCEPTANCE:
  - With the node up: EICAR → quarantined and its object deleted; a clean PDF → uploaded with
    metadata.av; a .docm with a macro → uploaded with flags ['macros']; the node stopped → 503
    and the row is pending_upload; a retry after a restart completes.
  - With the gate off in development nothing changes, and the dev axis drives each branch without
    the node; with the gate off in production an upload answers 503 and stays in quarantine.
  - A request to the gateway without the bearer, or with a wrong one → a typed 401 (Decision
    #345 (c)); from another host → no route.
SAME CHANGE: the env contract, .env.example, core/env.ts and env-manifest.ts with their reader;
EPI status marks; the dev axis; Zod for metadata.av; the PRODUCT_SPEC and SA malware-scan markers
removed.
SQL SESSION (the job and the dial): at most two SQL sessions at once, on disjoint migration files;
announce each `deno task db:reset`; run `deno task test:probes`; finish with your own clean
`deno task test:probes:fresh`. 00005060 has one writer at a time.
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
`deno task test:probes:fresh`. 00005060 has one writer at a time. Step 5 sweeps only stale
pending_upload / scanning rows and their quarantine objects; PROJECTS FL1 covers soft-deleted
items (`files-soft-delete-purge`, #564). Remove a stale upload's quarantine object at once; the
purge later stamps its soft-deleted row, and removing an object already gone is not an error.
```

### SN3 — The publication gate: NudeNet and OCR (T3 (a), (b))

```text
PROMPT SN3: Nothing reaches the Glass Front unscreened — the NudeNet and OCR gate

ROLE: Backend + infrastructure engineer. EPI §6.3; SEC §3.1-3.2, Z1, Z3, Z4, Z5, P-1, P-3, P-4;
#340 (e), (f); Decision #148 (Decision #340, rulings T3 (a), T3 (b) and T2's frame density).
DEPENDS: SN2 (R1, the automated-finding door, has landed). MARKETPLACE SC4 has landed (#535):
only the door publishes a listing, so this gate holds for every publish.

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
  - NOT the node: N3 built POST /screen/image and POST /screen/video in Projective-Safety
    (4a86356, 38e52ec: NudeNet 320n + Tesseract, the OCR text scored by Presidio's built-in
    entities and any ad_hoc_recognizers sent; frames sampled on the node per ruling T2; ocr_text
    returned for Tier 1/2). This prompt calls those routes.
  - packages/backend/services/media/* (the one publish step; showcase-rendition.ts),
    services/messaging/live-group-photo.ts (T3 (b): today writeRendition → comms.set_group_photo,
    :12-20 and :118, with no screening), services/catalogue/live-catalogue-writes.ts
    (P-1: catalogue media through cutShowcaseRendition), services/files/live-objects.ts and the
    visibility route (T3 (a)), every public_assets writer except re-hosted favicons
  - supabase/migrations/00000010_tables_files.sql (files.publication_screenings) + its RLS file;
    00001160_functions_files.sql (files.fn_can_read's public arm serves the copy, not the
    original); 00005001 (moderation_image_thresholds; no sampling dial: the node samples from its
    own env, FRAME_EVERY_S and MAX_FRAMES, and the contract takes no sampling field);
    00005010 (the correction-notice type)
  - packages/types/files/* (the screening row; scores jsonb)
  - env: MODERATION_BACKEND_LIVE (its env-manifest.ts row flips from planned to live);
    devtools + dev-seam (pj.dev.moderation)
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
     moderation_image_thresholds, sent with each /screen/* request (Decision #345 (e), ruled).
     clean → cut, write, attach. flagged → no public object; a 422
     with the category; the correction notice; the original stays uploaded and private; an
     automated finding through ReportsBackendService.fileAutomatedFinding (detector nudenet or ocr; ids and scores only). unavailable →
     503.
  4. Frames (ruling T2): an animated image goes to /screen/video (/screen/image answers 415 for
     one), which the node screens one frame every 2 s, at most 30, always including the first and
     the last; every thumbnail cut from a frame is screened as its own image through /screen/image.
     Video stays refused until SN5.
  5. T3 (a), per the decision: a Public library row is served as a fresh, re-encoded,
     metadata-stripped copy the pipeline cut (a rendition), never the original; fn_can_read's
     public arm and live-objects.ts (:70-75) serve the copy.
  6. files.publication_screenings keeps every verdict (item_id, purpose, verdict, scores,
     model_versions, decided_at, actor_user_id).
  7. pj.dev.moderation (auto · clean · flagged · unavailable): all five switcher parts.

ACCEPTANCE:
  - With the node up: a flagged fixture → 422, no object in the public bucket, one screening row,
    one automated report, one notice; a clean image publishes with its tiers; the node down → 503
    and nothing written; a long animated GIF is screened on at most 30 frames, the first and last
    included (the verdict's frames count).
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
DEPENDS: SN3 (the gate and the frame set), P2a (the public-copy doors); R1 has landed.

🧑 DECISION 1 — Decision #344 flag (b), unruled; stop before step 4. PRODUCT_SPEC §Messaging 1.C screens public
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
  Record the ruling on #344 (b) before building (root CLAUDE.md §8).

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
DEPENDS: SN3, SN4, and N3's open remux bullet (§8.4) in Projective-Safety.

FILES:
  - NOT the node: N3's remux adds POST /remux/video (ffmpeg -map_metadata -1 -map_chapters -1
    -c copy, faststart; the output re-sniffed) beside /screen/video's sampling, which is built
  - services/media/showcase-rendition.ts (lift Wave 0's video MediaRejectedError),
    services/media/library.ts (poster and tiers), apps/web/features/files/components/media-crop/
    MediaCropPicker.tsx (offer videos again where the target takes them)
  - PRODUCT_SPEC.md :757-759, documentation/database/files/Storage.md (the showcase section),
    EPI §6.3

STEPS:
  1. Publishing a video: remux on the node → re-sniff (a body that is not video is refused) →
     /screen/video samples and screens the frames on the node → screen the poster and the frames
     with Sightengine (SN4) →
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
DEPENDS: R3, P2b (the one predicate), P1d (the normaliser and the corpus). N4 (Presidio) is
built in Projective-Safety (30c8bda, a4ccec5): its tests/fixtures/pii_corpus.json holds six
recognisers tuned against presidio-analyzer 2.2.362, ported from pii.test.ts; port them here. Its
README's tuning notes apply: a phone number scores 0.4 without a context word and the corpus runs
at 0.35, so check the 0.65 review threshold against them; an uncompilable pattern is an HTTP 500,
so compile each pattern at the analyzer's regex version before sending.

FILES:
  - supabase/migrations/00000013_tables_ops.sql (ops.moderation_queue); 00001665 (lease and drain
    doors); 00001300 + 00001840 (the enqueue trigger functions and triggers); 00005060
    (moderation-drain, every minute, http); 00005001 (moderation_tier3_review_threshold 0.65,
    moderation_tier3_category_weights, moderation_fragment_window = { minutes: 5,
    max_messages: 8 })
  - apps/web/routes/api/ops/cron/moderation.ts (bearer MODERATION_CRON_SECRET, also a Vault
    secret) → packages/backend/services/moderation/ModerationBackendService.ts (drainQueue)
  - packages/types/comms/pii-recognizers.ts (the ad_hoc_recognizers, versioned next to
    pii-detect.ts); packages/types/ops/* (the queue row)
  - env: MODERATION_BACKEND_LIVE (SN3), MODERATION_CRON_SECRET (its env-manifest.ts row flips
    from planned to live)
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
     ReportsBackendService.fileAutomatedFinding (detector presidio; categories and scores, never span text); then
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
`deno task test:probes:fresh`. 00005060 has one writer at a time.
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

---

## 8. The safety node: setup runbook and node prompts (was `SAFETY_NODE_SETUP_AND_BUILD_PROMPTS.md`)

This part covers building and hosting the content-safety node: ClamAV, NudeNet plus OCR and
Microsoft Presidio, behind one authenticated gateway, in its own repository, `Projective-Safety`
(Decision #345). It does not restate the design; it links to
`documentation/api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md` §6 (EPI, Decision #335,
Proposed) and `SECURITY_MODERATION_AND_AI_GAPS.md` §2–§6 (SEC, #340). It owns the human setup (§8.3
H1–H5) and the node prompts (§8.4); every app-side change is a prompt in §3–§7.

### 8.0 What already exists and what does not

| Piece                                                          | State today                                                                                                                                                                  | Where it is built                   |
| :------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------- |
| Magic-byte sniffing and image decoders                         | **Built** (Wave 0). It refuses programs, undecodable images and video renditions; markup is admitted inert and SVG sanitised (#396, `0de5438f`). V3 (PDF/ZIP/OOXML) is open. | This repo, SN2                      |
| Tier 1 in-process pre-filter (regex PII, IBAN, crypto, phones) | Not built. SEC-P1d.                                                                                                                                                          | This repo, P1d                      |
| Tier 2 `comms.mask_pii` (SQL floor)                            | Built. L8's new categories are open.                                                                                                                                         | This repo, P1d                      |
| Google Web Risk (link reputation)                              | **Wired** (`services/files/link-reputation.ts`, W1); it answers once `LINK_SAFETY_API_KEY` holds a real key. Without one, links read `safe` until LK1 lands.                 | This repo, LK1                      |
| ClamAV, NudeNet + OCR, Presidio (Tier 3)                       | **Built** in `Projective-Safety`: the gateway (N1), ClamAV (N2), the `/screen/*` routes (N3) and Presidio (N4); §0.0. The video remux (N3) and N5 are open.                  | `Projective-Safety`, N3's remux, N5 |
| Sightengine (hosted toxicity, violence and hate-symbol checks) | Not built. Ruling T2 makes it the hosted check for Glass Front media and text only.                                                                                          | This repo, SN4                      |
| App-side client, gates, queue, review sink                     | Not built. `MALWARE_SCAN_LIVE`, `MODERATION_BACKEND_LIVE`, `SAFETY_NODE_URL`, `SAFETY_NODE_TOKEN`, `MODERATION_CRON_SECRET` are `planned` rows in `core/env-manifest.ts`.    | This repo, SN1–SN6                  |

### 8.1 Repo decision

**Decided: a separate repository.** The owner created it as `Projective-Safety`, beside this repo,
where N0–N4 are committed. The app-side client stays here, and nothing here creates
`infra/safety-node/`.

Why a separate repo:

- **Different language.** The node is Python (FastAPI, NudeNet, Presidio, Tesseract, ffmpeg); this
  repo is a Deno workspace whose root rules allow only `apps/` and `packages/`.
- **Different deploy lifecycle.** The node is a private Zone-D box with pinned image digests and
  model downloads. It must not ship with the web app.
- **One small seam.** The only shared surface is an HTTP contract plus one bearer token. The
  contract is `Projective-Safety/contract/openapi.yaml`; this repo copies its schema as Zod and
  shares no code. Its route names (§0.5) win over EPI §6's `/v1/…` examples.

### 8.2 Rulings (all made 2026-10-30, Decision #340)

| Ruling               | What it settles here                                                                                                                                   |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T5**               | EPI §6's self-hosted node is approved: one node, 4 vCPU / 8 GB (this also settles EPI flag (g)).                                                       |
| **Q0.2 (a)**         | The client storage write policies go (E8, done). ClamAV at admission was pointless before that, so SN1 waited for E8.                                  |
| **T2 (b), (c)**      | Sightengine is the hosted check for toxicity, violence and hate symbols, on Glass Front media and text only, called by the app (TRUST SN4).            |
| **T2 (frames)**      | One frame every 2 s, at most 30, always the first and last, and every thumbnail cut from a frame is screened too (N3).                                 |
| **T3**               | (a) A public library file is served as a screened, metadata-stripped copy; (b) group photos are screened. These are the publish paths TRUST SN3 gates. |
| **T4**               | The review sink is `ops.reports.source`, where Presidio findings land (TRUST R1, SN6).                                                                 |
| **T5 (link safety)** | Google Web Risk (W1, done). W1 calls Web Risk in development too, so the ruling's Safe Browsing v4 development key is no longer used.                  |
| **T5 ⚖️ (PhotoDNA)** | Ruled, pending counsel. TRUST H1 builds hash matching behind a flag that stays off; it is a separate vendor agreement, not part of these prompts.      |

### 8.3 Human setup (in order)

#### H1. Accounts and keys

Put every value in a password manager, then in `.env.safety` on the node or `.env.local` in the app.
Never commit them.

1. **Google Cloud** (Web Risk, ruling T5):
   - create a project, enable the **Web Risk API**, and create an API key restricted to that API;
   - the app calls Web Risk only (TRUST W1, `bc805dff`), so local development needs a Web Risk key
     too; a Safe Browsing v4 key no longer works.
2. **Sightengine** (ruling T2; TRUST SN4): create an account under data-processing terms, then note
   the `api_user` and `api_secret`. Start on the free tier and turn on only the models T2 named.
3. **Container registry**: GitHub Container Registry on `Projective-Safety` is enough.
4. **Secrets**: generate `SAFETY_NODE_TOKEN` and `MODERATION_CRON_SECRET` with
   `openssl rand -hex 32`. Also put `MODERATION_CRON_SECRET` into Supabase Vault (EPI §9.3).

#### H2. The repo

Done: `Projective-Safety` is cloned beside this repo, with N0–N4 committed. Run N3's remux and N5
(§8.4) in sessions opened in that folder.

#### H3. Provision the host (after N5 passes locally)

For UAT you may provision sooner, once SN1 passes against a local node, and smoke-test by hand with
EICAR (§0.4: the timing is yours). The contract is the same either way.

- **Size:** one VM with 4 vCPU, 8 GB RAM and 40 GB disk (ruling T5; Presidio's spaCy model is about
  2 GB, and so is the NudeNet/Tesseract image). Any provider works (Hetzner, DO, AWS).
- **Network:** a **private** link to the app only (VPC peering, a WireGuard/Tailscale tunnel, or a
  provider private network).
  - No public ingress except SSH from your IP.
  - The gateway binds to `SAFETY_NODE_BIND_IP` on the private interface.
- **OS:** Ubuntu LTS with Docker Engine and the compose plugin, unattended upgrades on, and the
  firewall default set to deny.
- **Deploy:** copy `.env.safety`, then run `docker compose --env-file .env.safety up -d`.
- **Test:** run the smoke test from N5 (EICAR, a nudity fixture, a PII string) against the private
  URL.

#### H4. Wire the app

1. In this repo's `.env.local` (and production env), set:
   - `SAFETY_NODE_URL` (the private https origin; `http://127.0.0.1:8443` locally);
   - `SAFETY_NODE_TOKEN`;
   - `MODERATION_CRON_SECRET`;
   - `LINK_SAFETY_API_KEY`, the Web Risk key (TRUST W1 kept this name).
2. Run the app-side prompts in **this** repo: this file's SN1–SN6 and P1d (§0.5 says which node
   route each uses).
3. Turn the gates on, one at a time, in the EPI §6.6 order:
   - local first;
   - then staging in **shadow mode**;
   - then production:
     1. `MALWARE_SCAN_LIVE=true`;
     2. the publication gate;
     3. `MODERATION_BACKEND_LIVE=true` (Presidio Tier 3, which fails open).

#### H5. Operate

- Update ClamAV signatures daily with freshclam (inside the container; check it in monitoring).
- Re-pin image digests monthly; rebuild and re-run N5's smoke test.
- Uptime check on the gateway's `/healthz` from the app network.
- Sub-processor disclosure: Google Web Risk and Sightengine in SA §Security and the privacy page
  (#340 (j)); W1 made Web Risk's, and SN4 makes Sightengine's.

### 8.4 Node prompts: run in `Projective-Safety`

Paste the **node header** above every N prompt, each in a fresh session.

```text
NODE HEADER — You are building `Projective-Safety`, the private content-safety service for the
Projective platform. The binding design is the Projective repo's
`documentation/api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md` §6 (6.1 topology and
compose, 6.2 Presidio, 6.3 NudeNet+OCR, 6.4 ClamAV, 6.6 dev/prod) and
`documentation/architecture/SECURITY_MODERATION_AND_AI_GAPS.md` §3–§6. Read them from
`../Projective.com/` before you write anything. The route contract is this repo's
`contract/openapi.yaml`; where EPI's examples say `/v1/…`, the contract wins. Rules:
- No payload persists after scoring: no volumes for uploads, no logging of content or PII; log only
  request id, verdict, latency, model version.
- Every route is behind the Caddy gateway; Bearer `SAFETY_NODE_TOKEN` (constant-time compare);
  clamd and Presidio ports never exposed.
- Pin every image by digest and every Python package with `==`; models are fetched at BUILD time.
- Python 3.12, FastAPI, pytest; ruff for lint. Secrets only via `.env.safety` (commit
  `.env.safety.example` with XXXX-XXXX placeholders).
- Each verdict response carries `{verdict, scores, model, version, ms}`; errors are typed, never 200.
- A route added or changed lands in `contract/openapi.yaml` in the same change.
- Finish each prompt with tests passing and a commit; do not push unless asked.

When you finish, do the closing duty (../Projective.com/documentation/reference/build-prompts.md
§2) as a docs commit in ../Projective.com, after your node commit:
  - In documentation/architecture/TRUST_SAFETY_BUILD_PROMPTS.md §8.4: a done node prompt leaves
    the file. Delete its section and add its row to §0's Done ledger (ID · what landed · the node
    commit · text at the Projective.com commit before your edit). A partly done one keeps only its
    open bullets, under one rewritten Status line.
  - Run git grep -n "<ID>" documentation/ there and mark every wait on it as met (§0.5, §8.6 and
    the SN prompts' DEPENDS lines); update the file's row in build-prompts.md §3.
```

#### N3: The video remux (`/remux/video`) — SN5 waits for it

> **Status 2026-11-23:** NudeNet + OCR on `/screen/image` and `/screen/video` landed in `4a86356`
> (Pillow re-decode, the decompression-bomb guard, frame sampling per ruling T2, the
> `moderation_image_thresholds` field), and `38e52ec` added `ad_hoc_recognizers`; the remux below is
> open.

- Add `POST /remux/video` to the contract: ffmpeg `-map_metadata -1 -map_chapters -1 -c copy`,
  faststart, and the output re-sniffed. SN5 publishes videos through it.
- Tests: a small committed video carrying GPS metadata, gone after the remux.

#### N5: Smoke test, CI and the deploy script

- `tests/smoke.sh <url> <token>` hits every route with EICAR, a safe image, a PII sentence and a bad
  token.
- GitHub Actions: lint, unit tests, image build, digest pinning check (fail on any `:latest`), and
  push to GHCR on tag.
- `deploy/README.md`: the H3 steps as commands.

### 8.6 Order at a glance

1. **Rulings:** made (§8.2).
2. **This repo, now:** LK1, P1d, P2d, R4 and SN1 (§0). SN2 follows SN1: it folds SN1's three hook
   points into one.
3. **`Projective-Safety`:** N3's remux and N5 (N0–N2 and N4 are done). They may run in parallel
   sessions, but serialise any edits to `compose.yaml` and `contract/openapi.yaml`.
4. **Host:** H1 → H3, after N5 passes locally (for UAT, once SN1 passes against a local node).
5. **This repo, as each node route lands:** SN1 (N2 is built), SN3 (N3's screen routes are built),
   SN5 (after N3's remux), SN6 (N4 is built); then turn the gates on per H4.

---

## Map of merged files

| Old file and section                                                     | Where it went                                                                             |
| :----------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `readiness/SAFETY_MODERATION_BUILD_PROMPTS.md` §0.1 (row → work order)   | §0.6                                                                                      |
| SAFETY_MODERATION §0.2 (D3's critical path, the UAT node recommendation) | §0.6 "What UAT needs"; the recommendation in §0.4 and §8.3 H3. Its clone step is done     |
| SAFETY_MODERATION §0.3 (run order; the §D score projection)              | §0's wave table and §0.3. The projection is dropped: the readiness Scoreboard computes it |
| SAFETY_MODERATION §0.4 (human stops and actions)                         | §0.4                                                                                      |
| SAFETY_MODERATION §1 (headers; the §1.2 readiness addendum)              | §1's READINESS line; LK1 now takes §1 too                                                 |
| SAFETY_MODERATION §2 (per-prompt deltas)                                 | Folded into each prompt's text, §0.1–§0.3 and §0.6's rows                                 |
| SAFETY_MODERATION §3 (LK1)                                               | §3                                                                                        |
| This file §2 (E8), §3 (W1)                                               | Done, §0.0                                                                                |
| This file §8.4 N0, N1, N2, N4, N6; §8.5 (the drafted A1–A6 map)          | Done or withdrawn, §0.0. A1–A6 became SN2, P1d, SN1, SN3 and SN5, W1, SN6                 |
