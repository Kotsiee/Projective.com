# Safety & Moderation Build Prompts — closing PRODUCTION_READINESS §D

> **Status: WORK ORDERS, not binding.** The path that takes
> [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) §D (Trust, safety & moderation, 25% at
> 2026-11-18) to 100%. Written 2026-11-18 against `main` @ `c6d7a7fa`. All 11 open rows were
> re-checked in code that day and are still open. Nothing that
> [`TRUST_SAFETY_BUILD_PROMPTS.md`](../architecture/TRUST_SAFETY_BUILD_PROMPTS.md) (T&S) names after
> E8 and W1 exists in the tree yet.
>
> **Rollup, not restatement.** T&S already holds a work order for ten of the eleven open rows. This
> file links to them and adds only what has changed since T&S was last verified (2026-11-12): a
> readiness delta per prompt (§2), the run order across this repo, the safety-node repo and the
> people who must act (§0), and one new prompt, **LK1**, for the row nobody owned (§3).

---

## 0. Map, critical path, run order and stops

### 0.1 Row → work order

| Row     | Gate | Crit     | Work order                        | The row flips when                                                                                                              |
| :------ | :--- | :------- | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| PRD-D3  | UAT  | Critical | SN1 (⏳ node N1 + N2)             | 🟡 when SN1 merges and passes against a local node; ✅ when the target environment's node answers with `MALWARE_SCAN_LIVE=true` |
| PRD-D4  | UAT  | High     | **LK1**                           | ✅ when no path answers `safe` without a clean reputation lookup                                                                |
| PRD-D5  | PROD | Normal   | W1 (done) + LK1 + you             | ✅ when each hosted environment has a Web Risk key and a recorded live lookup of the test threat URL                            |
| PRD-D7  | PROD | High     | P1d                               | ✅ on P1d                                                                                                                       |
| PRD-D8  | PROD | High     | P2a → P2b → P2c                   | 🟡 on P2a (public copy); ✅ on P2c. P2d is not needed for this row (§2)                                                         |
| PRD-D9  | PROD | Critical | R1 → R4 → R5 → R3 → R2            | 🟡 on R3 (a reviewer can act); ✅ on R2 (people can report)                                                                     |
| PRD-D10 | PROD | Critical | SN2 → SN3 (⏳ node N3)            | ✅ on SN3                                                                                                                       |
| PRD-D11 | PROD | High     | SN4 (⏳ P2a, a decision row, DPA) | ✅ on SN4                                                                                                                       |
| PRD-D12 | PROD | Normal   | SN5 (⏳ node N3)                  | ✅ on SN5                                                                                                                       |
| PRD-D13 | PROD | Normal   | SN6 (⏳ R3, P2b, node N4)         | ✅ on SN6                                                                                                                       |
| PRD-D14 | PROD | Critical | H1 (⚖️, ⏳ SN2)                   | 🟡 when H1 lands with its flag off; ✅ only after counsel, a signed provider agreement and the flag on in production            |

**What UAT needs from §D:** only D3 and D4. LK1 can run today. D3 is the UAT critical path's first
step, and it waits on infrastructure outside this repo (§0.2).

### 0.2 The critical path: D3 waits on the safety node

`Projective-Safety` (Decision #345) is **not on this machine** (checked 2026-11-18). T&S §8.3 H2
records it as "cloned beside this repo, with N0 committed", but it isn't there now. SN1's app half
copies its Zod from that repo's `contract/openapi.yaml`, so SN1 cannot start until the repo is back.

The path, in order (the steps live in T&S §8.3–§8.6; this is the order only):

1. **You:** clone `Projective-Safety` beside this repo, or say if N0 was never pushed. Then a fresh
   session there confirms N0 (`f6c46b8`) still matches its contract.
2. **Node sessions, in that folder:** N1 (gateway and bearer), then N2 (ClamAV, `POST /scan/file`).
3. **This repo:** SN1 against the local node (D3 → 🟡), then SN2.
4. **You:** T&S §8.3 H1 (secrets) and H3 (host and private link), then turn on `MALWARE_SCAN_LIVE`
   in the UAT environment (D3 → ✅).
5. N3 and N4 (NudeNet + OCR, Presidio), and the app prompts that wait on them, are PROD rows only.

**Recommendation (🧑, yours to take):** for UAT, deploy the node with N1 + N2 and an EICAR-only
smoke test. Don't wait for N3–N5. T&S §8.3 H3 says to provision "after N5 passes locally", which
puts every PROD model on the UAT critical path. The node's contract is the same either way, so N3
and N4 deploy onto the same box later with no change in this repo.

### 0.3 Run order

Inside T&S, one SQL session at a time for `00000013`, `00001660` and `00002510` (T&S §0.3). Across
all tracks, `00002510` has one writer at a time: SAC1 holds it first (Security file §0.2), then the
identity erasure chain. Take T&S's SQL steps in the gaps.

| Wave | This repo                                                        | Node repo / you                                  | Waits for                                                                      |
| :--- | :--------------------------------------------------------------- | :----------------------------------------------- | :----------------------------------------------------------------------------- |
| 1    | **LK1** (app) · R1 → R4 → R5 → R3 (SQL, serial) · then P1d (SQL) | Clone the repo; N1 → N2; T&S H1 keys             | Nothing. P1d soft-waits COMMS MS2 and, if it goes first, wires both send doors |
| 2    | SN1 → SN2 · R2                                                   | Provision the UAT node (H3); `MALWARE_SCAN_LIVE` | N1 + N2. R2 also waits COMMS MS2 + MS3 (the message menus)                     |
| 3    | SN3 · SN5 · H1 (after SN2) · P2a → P2b → P2c                     | N3                                               | N3; PM-WP4b (P2a–P2c); C·WP10 (P2c)                                            |
| 4    | SN4 · SN6                                                        | N4; Sightengine DPA signed                       | P2a; a decision row for SN4's contradiction; R3 and P2b (SN6)                  |
| —    | —                                                                | Web Risk key per environment; counsel on H1      | D5 and D14 close outside code                                                  |

**§D score projection** (weights: Critical 3 · High 2 · Normal 1; total 30):

| After                   | Score | Rows that flip         |
| :---------------------- | ----: | :--------------------- |
| Today                   |   25% | —                      |
| Wave 1                  |   43% | D4, D7; D9 → 🟡        |
| Wave 2 (local node)     |   53% | D9; D3 → 🟡            |
| UAT node live           |   58% | D3                     |
| Wave 3                  |   83% | D8, D10, D12; D14 → 🟡 |
| Wave 4                  |   93% | D11, D13               |
| Web Risk keys + counsel |  100% | D5, D14                |

### 0.4 Human stops and actions on this path

**Decisions** (T&S §0.4 has the options and recommendations for each):

1. **R1:** the report reason vocabulary (Decision #148 flag (g)). It blocks the whole D9 chain, so
   settle it first.
2. **P2a:** structured links and article bodies (Decision #147 flag (a)).
3. **P2b:** the cooling-off length (T1 names the window, not its length), and the cold-DM gap.
4. **SN3:** whether a library file that is not an image or video may be made Public.
5. **SN4:** a **new contradiction that is still unlogged.** PRODUCT_SPEC screens all public text
   before publication, but clients hold direct write grants on public-copy columns. SN4 must add the
   decision row and get your answer before it builds.
6. **SN1, architect default (confirm or override):** in production, with `MALWARE_SCAN_LIVE` off or
   the node unreachable, an upload stays in quarantine and the uploader sees a 503. SN1 as written
   skips the scan when the gate is off, in every environment (§2).

**Actions:**

- Clone `Projective-Safety` (§0.2 step 1).
- Provision the node VM and its private link (T&S §8.3 H3). Nothing here deploys.
- A Google Cloud Web Risk key for every environment (T&S §8.3 H1.1). Closes D5.
- A Sightengine account under signed data-processing terms, before `HOSTED_MODERATION_LIVE` (SN4).
- **⚖️ counsel on H1:** the hash-matching provider (PhotoDNA), the reporting body and preservation.
  The flag stays off until then. D14 cannot reach ✅ without it.

---

## 1. Headers

- **T&S prompts:** paste T&S's own §1 standard header, then the prompt, then
  [SECURITY_ACCESS_BUILD_PROMPTS.md](SECURITY_ACCESS_BUILD_PROMPTS.md) §1.2 with the rows in §2
  below. T&S's header predates Decision #444, so the readiness add-on is needed.
- **LK1:** paste SECURITY_ACCESS_BUILD_PROMPTS.md §1.1 above it, and §1.2 after it.
- **Node prompts (N1–N4):** run them in `Projective-Safety` with T&S §8.4's node header. They change
  no row here directly.

---

## 2. Existing work orders — what changed since 2026-11-12

| Prompt | `<ROWS>` for §1.2           | Delta (re-verified 2026-11-18 at `c6d7a7fa`)                                                                                                                                                                                                                                                                                                  |
| :----- | :-------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1d    | PRD-D7                      | Nothing built: no `00001660`, no Tier 1 module. COMMS MS2 has not started (PRD-E2 ❌; its address question was ruled today, #444 (a)), so P1d wires both send doors and leaves its `shortcut:` comment. It edits `00002510`: not beside SAC1 or the identity erasure chain.                                                                   |
| P2a    | PRD-D8 → 🟡                 | ⏳ PM-WP4b (the projects track split WP4 into WP4a → WP4b). Its 🧑 (#147 flag (a)) is still open.                                                                                                                                                                                                                                             |
| P2b    | (D8 stays 🟡)               | ⏳ COMMS MS2 and PM-WP4b. Both 🧑s are still open.                                                                                                                                                                                                                                                                                            |
| P2c    | PRD-D8 → ✅                 | ⏳ PM-WP4b and C·WP10.                                                                                                                                                                                                                                                                                                                        |
| P2d    | none in §D                  | Step 3 (G13) is done by SAC2 (Decision #462), and step 4 (G14) is SAC1's, so verify both. What's left (G5 archived rooms, G6 message size and rate, G18's sync triggers) is comms hardening, not "public copy masked", so it no longer gates D8. Run it any time after SAC1, and log its rows wherever the readiness owner places them.       |
| R1     | (D9 stays ❌)               | Its 🧑 (the reason vocabulary) is still open, and it blocks R4, R5, R3 and R2. The erasure arm: `reporter_user_id` and the evidence copies must be classified in identity ERA1's `account_erasure_scope.sql`. Whichever of R1 and ERA1 lands second adds that.                                                                                |
| R4     | —                           | Not beside identity HK1 (`00000012_tables_security.sql`).                                                                                                                                                                                                                                                                                     |
| R5     | —                           | Not beside a read-path prompt on `services/explore/live-catalog.ts` or `00002520` (SAC2 just edited `00002520`; rebase on it).                                                                                                                                                                                                                |
| R3     | PRD-D9 → 🟡                 | It edits the Dev Context Switcher (`features/devtools`, `dev-seam.ts`), as do identity SSO1, MFA1 and MIN1 and LIVE_DATA LD3 (if it touches a flag). One writer at a time.                                                                                                                                                                    |
| R2     | PRD-D9 → ✅                 | ⏳ COMMS MS2 and MS3 (MS3 is partly done). The report button must not render before R3's desk can act (root `CLAUDE.md` §3.11).                                                                                                                                                                                                               |
| SN1    | PRD-D3 → 🟡, then ✅ (§0.1) | ⏳ `Projective-Safety` back on this machine, then N1 + N2 (§0.2). Add the architect default from §0.4 item 6: in production (DENO_ENV=production, or unset), a gate that is off refuses the promote rather than skipping the scan. This follows LIVE_DATA LD4's rule. It also adds `SAFETY_NODE_*` to the env contract, which narrows PRD-H5. |
| SN2    | —                           | After SN1. T&S §8.6 says SN2 needs no node, but it folds SN1's three hook points into one, so keep the T&S §0 order.                                                                                                                                                                                                                          |
| SN3    | PRD-D10                     | ⏳ N3. Its 🧑 (non-image library files) is still open.                                                                                                                                                                                                                                                                                        |
| SN4    | PRD-D11                     | ⏳ P2a. Before building, log the public-copy write-grant contradiction as a decision row (re-check the next free number; several sessions are claiming numbers today) and get an answer. A human signs Sightengine's terms before `HOSTED_MODERATION_LIVE`.                                                                                   |
| SN5    | PRD-D12                     | ⏳ N3 (the video remux).                                                                                                                                                                                                                                                                                                                      |
| SN6    | PRD-D13                     | ⏳ R3, P2b and N4.                                                                                                                                                                                                                                                                                                                            |
| H1     | PRD-D14 → 🟡                | ⚖️: the flag ships off. The ✅ needs counsel, a provider agreement and a human turning the flag on in production. No prompt does that.                                                                                                                                                                                                        |
| Z1     | —                           | Last, as T&S says. It also updates SECURITY_MODERATION_AND_AI_GAPS.md's status column, which another session edited today (SAC2).                                                                                                                                                                                                             |

---

## 3. New prompt

### LK1 — The link scan fails closed

Closes PRD-D4. It also does the code half of PRD-D5.

```text
PROMPT LK1: No check, no "safe": the link scan fails closed offline and without a reputation answer

ROLE: Backend engineer (files / link safety). App lane. Not beside T&S SN2 or SN3
(services/files/*) or another prompt that edits services/links/*.

CONTEXT (verified at c6d7a7fa; re-check every line):
  - runScan (packages/backend/services/files/link-scan.ts:174-205): with FILES_BACKEND_LIVE off,
    any https URL that passes the face-value checks is `safe` (:203), titled from the URL. The
    module docblock's "The gate" section says so on purpose. FilesBackendService.attachLink
    (:274) stores that verdict in files.items.link_scan_status, and the chat preview
    (services/links/LinkPreviewBackendService.ts:221) shows the rich card for `safe`.
  - Live, checkReputation (link-reputation.ts:72-84) answers `unavailable` with no
    LINK_SAFETY_API_KEY or on any API error. runScan then ignores it: a page that answers is
    `safe` with no reputation lookup at all. That is PRD-D5's code half.
  - LinkScanStatus (packages/types/files/assets.ts:99; SQL enum 00000004:382) already has
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
     line in LIVE_DATA LD4's boot report, if that has landed). The links still work: they read as
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

§1.2 rows: **PRD-D4**. PRD-D5 then flips to ✅ per hosted environment once it has its Web Risk key
and a recorded live lookup of the test threat URL.
