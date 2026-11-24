# Build Prompts — the Lifecycle Rule and the Registry

> **Work orders, not binding.** A `*_BUILD_PROMPTS.md` file is a queue of self-contained Claude Code
> prompts. Source documents still win (root `CLAUDE.md` §0): a prompt that contradicts one is wrong,
> whatever it says. This page holds the rule that keeps every prompts file current (§2), the index
> of the live files (§3) and the files that have been retired or merged (§4).

---

## 1. What a prompts file holds

- **Open work only.** A prompt that has landed leaves its file. A one-line row in the file's §0
  **Done ledger** names what landed, the commit, and the commit where the prompt's full text can
  still be read (`git show <text-at>:<path>`).
- **One file per domain.** The architecture rule "one audit and at most one build-prompts file per
  domain" ([`architecture/README.md`](../architecture/README.md), "Keeping the set free of
  duplicates") holds for the readiness files too. A readiness section's row map, run order and new
  prompts go in the domain's file. They do not go in a second file that patches the first. A
  readiness section that spans domains keeps one file for the prompts no domain owns, and links to
  the rest. Those files are PROJECTS (PJ), MARKETPLACE (MK), OPERATIONS (§B, §G and §H) and
  LEGAL_COMPLIANCE (§M).
- **Every file has the same shape:**
  1. A header block with the scope, one `Verified` line and the lifecycle line.
  2. §0: the Done ledger, then the run order, waits and 🧑 stops for the open prompts.
  3. §1: the standard header to paste. It ends with the closing duty (§2 below).
  4. The open prompts.
  5. A map of old sections, if other files were merged in.
- **One status line per prompt.** Each run replaces it; nothing is appended:
  `> **Status YYYY-MM-DD:** steps 1–3 landed in <sha>; steps 4–6 are open.` Do not stack
  "re-verified at …" paragraphs.
- **Step numbers never change.** A landed step is removed and the status line names it, so a
  citation such as "SCH-WP7 step 6" still resolves.

## 2. The closing duty — every session that runs a prompt

Land these edits in the same commit as the work. If the work was committed earlier, land them in the
docs commit that follows it.

1. **Done.** Delete the prompt's whole section. Add its row to §0's Done ledger:
   `| ID | what landed | <commit> | <commit>^ |`. Take its ID out of the run-order table, and mark
   every other prompt's wait on it as met.
2. **Partly done.** Delete the steps that landed and rewrite the prompt's status line to name what
   remains. Keep the remaining step numbers.
3. **A 🧑 stop was ruled.** Replace the stop's options and recommendation with the ruled step and
   its decision number.
4. **A premise was stale.** Correct the line in place. Do not add a "stale premise" note beside it.
5. **You built a step of another prompt.** Apply 1–4 to that prompt, in whichever file holds it.
6. **References.** Run `git grep -n "<ID>" documentation/` and update every place that still calls
   the prompt open: the Track cell in
   [`PRODUCTION_READINESS.md`](../readiness/PRODUCTION_READINESS.md) and
   [`USER_FLOWS.md`](../readiness/USER_FLOWS.md), the audit's Status column (`Fixed (<ID>, <sha>)`),
   and other prompts' waits.
7. **The file is empty.** When the last prompt leaves, delete the file and add a row to §4. Then
   repoint its links (`git grep -l <FILE>`). Decision rows keep the old name, as history.
8. **The registry.** Update the file's row in §3.

The standard header (§1) of every prompts file ends with a short form of this list. It names that
file, because a fresh session sees only the text it was pasted.

## 3. Registry — the live prompts files

Verified against code on 2026-11-23 at `f2e25929`. Each file's §0 has the evidence.

"Open" counts prompts with no step landed; "Partly" counts prompts with some steps landed. "Runnable
now" lists the prompts whose waits are all met. Two SQL sessions at most run at once, across every
file, on disjoint migration files.

| File                                                                                            | Scope                                                                                       | Open | Partly | Runnable now                                                                                   |
| :---------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :--- | :----- | :--------------------------------------------------------------------------------------------- |
| [`architecture/COMMS_BUILD_PROMPTS.md`](../architecture/COMMS_BUILD_PROMPTS.md)                 | Messaging, notifications, discovery search; the hosted delivery proof (readiness §E)        | 7    | 1      | MS3, MS4, NT5; SR3 up to its 🧑                                                                |
| [`architecture/FINANCE_BUILD_PROMPTS.md`](../architecture/FINANCE_BUILD_PROMPTS.md)             | Finance engine, Stripe rails, wallet and checkout (readiness §F; owns the finance SQL lane) | 16   | 7      | SQL lane, one at a time: DB14, SV8, DB13, DB20 · app: SV5, UI1, UI3                            |
| [`architecture/IDENTITY_BUILD_PROMPTS.md`](../architecture/IDENTITY_BUILD_PROMPTS.md)           | Identity, privacy, workspaces, erasure, MFA (readiness §C)                                  | 16   | 1      | HK1, SSO1, MFA1, MIN1, LOW1, X2 (its 🧑 ruled, #529)                                           |
| [`architecture/OPTIMIZATION_BUILD_PROMPTS.md`](../architecture/OPTIMIZATION_BUILD_PROMPTS.md)   | Read paths, caching, shared rules, design-system gates                                      | 17   | 0      | WP17, Q9, WP10b (steps 2–6), Q12, WP5a                                                         |
| [`architecture/PM_BUILD_PROMPTS.md`](../architecture/PM_BUILD_PROMPTS.md)                       | Track P: claim guards, money exits, workload, stage state, board authority                  | 8    | 5      | PM-D7a, PM-P6 (to its 🧑), PM-WP8 · PM-GH1 on its finance-lane turn                            |
| [`architecture/SCHEDULING_BUILD_PROMPTS.md`](../architecture/SCHEDULING_BUILD_PROMPTS.md)       | Session money windows, paid consultations, the docs sweep                                   | 1    | 2      | SCH-WP7 (stops at step 6)                                                                      |
| [`architecture/SUBSCRIPTIONS_BUILD_PROMPTS.md`](../architecture/SUBSCRIPTIONS_BUILD_PROMPTS.md) | Plan ladder, `/pricing`, the agency tier                                                    | 9    | 2      | S1, X1, X2                                                                                     |
| [`architecture/TRUST_SAFETY_BUILD_PROMPTS.md`](../architecture/TRUST_SAFETY_BUILD_PROMPTS.md)   | Leakage tiers, moderation loop, safety node, link scan (readiness §D)                       | 18   | 2      | LK1, P1d, P2d, R4, SN1 · node repo: N3's remux, N5                                             |
| [`readiness/LEGAL_COMPLIANCE_BUILD_PROMPTS.md`](../readiness/LEGAL_COMPLIANCE_BUILD_PROMPTS.md) | Readiness §M: legal library, chain of title, seller tax, AML                                | 4    | 2      | LG4; LG7's page check (its commit also closes LG1)                                             |
| [`readiness/MARKETPLACE_BUILD_PROMPTS.md`](../readiness/MARKETPLACE_BUILD_PROMPTS.md)           | USER_FLOWS MK: checkout and orders, reviews, seller catalogue                               | 7    | 4      | RV1, RV2, SC6, SC9 (phase 6), SC10, SC12, SC13                                                 |
| [`readiness/OPERATIONS_BUILD_PROMPTS.md`](../readiness/OPERATIONS_BUILD_PROMPTS.md)             | Readiness §B live data, §G jobs and deployment, §H secrets                                  | 3    | 2      | CFG1, CFG2, LD4                                                                                |
| [`readiness/PROJECTS_BUILD_PROMPTS.md`](../readiness/PROJECTS_BUILD_PROMPTS.md)                 | USER_FLOWS PJ: the row map, and the PJ prompts no domain owns                               | 16   | 0      | EX3, CH2, NO1–NO4, FL1–FL4                                                      |

## 4. Retired and merged prompts files

Read any of these with `git show <commit>:<path>`. Decision rows and old commit messages still cite
their old names, as history. Files retired before 2026-11-23 are listed in
[`architecture/README.md`](../architecture/README.md), "Retired and merged files".

| File                                                                                             | Went                                                                                                                                                                                | Commit to read it at |
| :----------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------- |
| `readiness/COMMS_DELIVERY_BUILD_PROMPTS.md`                                                      | Merged into `architecture/COMMS_BUILD_PROMPTS.md`: the §E row map, waves and stops in §0.1–§0.3, CD2 in §3, CD1 in the ledger; its map is at the end                                | `f2e25929`           |
| `readiness/MONEY_BUILD_PROMPTS.md`                                                               | Merged into `architecture/FINANCE_BUILD_PROMPTS.md`: the finance SQL lane in §0.1, the §F row map in §0.7, the open MR prompts in §3 and §7, the deltas folded into the FBP prompts | `f2e25929`           |
| `readiness/SAFETY_MODERATION_BUILD_PROMPTS.md`                                                   | Merged into `architecture/TRUST_SAFETY_BUILD_PROMPTS.md`: stops in §0.4, the §D row map in §0.6, LK1 in §3                                                                          | `f2e25929`           |
| `readiness/SECURITY_ACCESS_BUILD_PROMPTS.md`                                                     | Merged into `architecture/IDENTITY_BUILD_PROMPTS.md`: SAC1–SAC6 all landed (§0.0), the §C row map in §0.6, its map in §13                                                           | `f2e25929`           |
| `readiness/SECRETS_CONFIG_BUILD_PROMPTS.md` · `readiness/LIVE_DATA_BUILD_PROMPTS.md`             | Merged into `readiness/OPERATIONS_BUILD_PROMPTS.md`: the §B and §H row maps in §0.1, CFG1, CFG2 and LD4 in §2, LD1–LD3 in the ledger                                                | `f2e25929`           |
| `flows/CATALOGUE_REBUILD_BUILD_PROMPTS.md`                                                       | Deleted: C0–C17 all landed (`648e1b99`, `a5004e9d`, `5bff7663`, `d70c417a`); the plan is `flows/CATALOGUE_REBUILD.md`                                                               | `f2e25929`           |
| `flows/PUBLIC_ROUTES_BUILD_PROMPTS.md` · `flows/PUBLIC_ROUTES.md` (an earlier copy of its P0–P8) | Deleted: P0–P8 (`73550174`) and L0–L6 (`362e0655`) all landed, with L1–L4 partly superseded by #349. The `test:e2e` leftover went to SUBSCRIPTIONS S8                               | `f2e25929`           |
