# Business Documentation

## Hierarchy

- **[PRODUCT_SPEC.md](PRODUCT_SPEC.md)** (formerly `brain.md`) is the absolute source of truth for
  all **business** logic and workflows;
  **[../architecture/SYSTEM_ARCHITECTURE.md](../architecture/SYSTEM_ARCHITECTURE.md)** (formerly
  `brain2.md`) is authoritative for **architectural** rules. Every other file in this folder is
  supplementary — it either fills a gap those two leave abstract, or covers material (investor
  narrative, market data) they intentionally don't.
- For UI component APIs, design tokens, the theming engine, and the component taxonomy, see
  [../design-system/DESIGN_SYSTEM.md](../design-system/DESIGN_SYSTEM.md); for Deno/Fresh technical
  directives see [../architecture/SYSTEM_ARCHITECTURE.md](../architecture/SYSTEM_ARCHITECTURE.md) —
  not this folder.

## Files in This Folder

| File                                       | Purpose                                                                         | Relationship to brain.md                                                                                                                                                                                       |
| :----------------------------------------- | :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [finance-model.md](finance-model.md)       | Concrete fee percentages, payout state machine, wallet architecture, edge cases | Extends `brain.md`'s Escrow/Wallets section with numbers and mechanics it leaves unspecified. **Contains a flagged fee-percentage conflict with `investor-summary.md` — see the note at the top of the file.** |
| [features.md](features.md)                 | Phased feature rollout priority (MVP/Phase 2/Phase 3)                           | Everything else has been trimmed out; feature _definitions_ live in `brain.md`                                                                                                                                 |
| [vision.md](vision.md)                     | Problem framing, long-term strategic positioning, platform philosophy           | Narrative content `brain.md` doesn't cover; mechanics have been trimmed out                                                                                                                                    |
| [investor-summary.md](investor-summary.md) | Investor-facing pitch narrative, financial snapshot                             | Entirely absent from `brain.md` — pitch material, not a technical spec                                                                                                                                         |
| [market-analysis.md](market-analysis.md)   | Market sizing, competitive analysis (Fiverr/Upwork comparison)                  | Entirely absent from `brain.md` — external market data                                                                                                                                                         |

## For Future Agents

Before adding new business documentation here, check whether the content belongs in `brain.md`
instead (if it's a durable business rule) or is genuinely supplementary (market data, pitch
narrative, rollout sequencing). Don't let a new file restate what `brain.md` already says — link to
it instead. See [../CLAUDE.md](../CLAUDE.md) and [CLAUDE.md](CLAUDE.md) for the full guardrails.
