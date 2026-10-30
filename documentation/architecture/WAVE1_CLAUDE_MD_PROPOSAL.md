# Wave 1 — proposed root `CLAUDE.md` diff (for the owner to apply)

> **Status: APPLIED 2026-10-30** by the owner (commit `f1f10e31`); kept as the record of Q0.5.
> Agents may not edit guardrail files. This is the diff that `FOUNDER_QUESTIONNAIRE.md` Q0.5 asks
> for. The owner rulings behind it are recorded on Decision #341 (flag (a), ADC Q1) and Decision
> #337 (X4, ruling M1). The questionnaire's Q0.5 also gave permission to edit `CLAUDE.md` directly.
> The Wave 1 brief said to draft only, and that instruction was kept. Apply the hunks by hand, or
> tell an agent in chat to apply this file.

## Why

- **Hard counts drift (ADC Q1, option B).** Parallel sessions write decisions every day. The root
  file says "135 logged decisions", but the index runs past #343. It says "Four
  `theme-engine.test.ts` failures", and Wave 1's brief already counts six known theme/CSS failures.
  A wrong number in the highest-precedence file teaches every agent to distrust the rest of it.
  Guardrail files should hold rules and pointers, not inventory.
- **The fee wording is a business rule, and it is wrong (#337 X4, ruling M1).** Persona row 3 says
  the stage-completion fee is "adjusted by Standing". `finance-model.md` §16.4 and
  `finance.fn_effective_platform_fee_bp` say the fee never tapers. Ruling M1 puts the Standing taper
  on the marketplace commission that sellers pay on product sales. The stage fee stays a flat 5 % on
  every plan. A contract may agree a different rate through `finance.negotiated_rates`, but no plan
  buys a lower fee (#252, S2 follow-up).

## The diff

```diff
@@ Strategic Partner & Systems Consultant Persona — §2 source-of-truth table, row 3 @@
-| 3 | `documentation/business/investor-summary.md` + `market-analysis.md` | **Commercial viability.** Proposals serve the pitch: structured, stage-based collaborative teams (micro-agencies) replacing fragmented, low-trust task gigs. They protect the unit economics: the stage-completion fee (5% base, per `finance-model.md`, adjusted by Standing), SaaS tiers, the asset marketplace, and escrow TVL. |
+| 3 | `documentation/business/investor-summary.md` + `market-analysis.md` | **Commercial viability.** Proposals serve the pitch: structured, stage-based collaborative teams (micro-agencies) replacing fragmented, low-trust task gigs. They protect the unit economics: the stage-completion fee (a flat 5% per `finance-model.md`; it never tapers, and no plan buys a lower one), the marketplace commission on product sales (tapered by the seller's Standing), SaaS tiers, the asset marketplace, and escrow TVL. |

@@ Key Commands — the db:reset paragraph @@
-anything created by hand locally is lost; tell concurrent sessions when you run it. Four `theme-engine.test.ts` failures are pre-existing (Decision #96(a)).
+anything created by hand locally is lost; tell concurrent sessions when you run it. Some `deno task test:unit` failures are pre-existing (theme engine: Decisions #96 (a) and #157 (m)); compare with `main` before treating one as yours.

@@ §8 Resolved decisions & new-conflict rule @@
-- 135 logged decisions: index in `documentation/reference/decisions/README.md`. Before touching a
-  surface, grep the index for it and read the matching decision file.
+- The decision log's index is `documentation/reference/decisions/README.md`: one line per decision,
+  each naming the `decisions-*.md` file that holds its row. Before touching a surface, grep the
+  index for it and read the matching decision file.

@@ Reference Index @@
-- Full guardrail text (§0–§7 with rationale, category table, all 12 UI gates) →
+- Full guardrail text (§0–§7 with rationale, category table, every UI gate) →
   `documentation/reference/guardrails.md`
```

## Not proposed

- No other guardrail file carries a count that drifts. `documentation/CLAUDE.md`'s "four founding
  conflicts" is a fixed historical fact, and `documentation/business/CLAUDE.md` already says the fee
  is 5 % flat.
- The new `**Not built yet**` / `**Planned**` markers that Wave 1.1 used in PRODUCT_SPEC,
  `finance-model.md` and PRODUCT_MANAGEMENT are doc conventions, not merge gates, so they are not
  added to the root file.
