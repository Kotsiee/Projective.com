# Database Documentation

## Hierarchy

`brain2.md` (in `../business/brain2.md`) is authoritative for the **conventions**: migration
numbering ranges (0000–0499), the `pgvector`/Triggered Search Table pattern, the storage quarantine
lifecycle, Edge Function/webhook standards, and general RLS principles.

This folder documents the **actual per-domain schema** — real table/column lists, RLS policy
definitions, and RPC/function signatures — which `brain2.md` deliberately does not enumerate.
[Schemas.md](Schemas.md) is the top-level ERD-adjacent reference: the 11 `CREATE SCHEMA` statements
and every custom enum type with its literal values.

## Structure

Each domain below gets its own folder with up to four files: `Tables.md`, `Policies.md`,
`Functions.md`, and (for `files/` only) `Storage.md`.

| Domain         | Tables | Policies | Functions | Notes                                                      |
| :------------- | :----: | :------: | :-------: | :--------------------------------------------------------- |
| `analytics`    |   —    |    —     |     —     | Not yet documented                                         |
| `comms`        |   ✅   |    —     |     —     |                                                            |
| `files`        |   ✅   |    —     |     —     | Plus [Storage.md](files/Storage.md) (quarantine lifecycle) |
| `finance`      |   —    |    —     |     —     | Not yet documented                                         |
| `integrations` |   —    |    —     |     —     | Not yet documented                                         |
| `marketplace`  |   —    |    —     |     —     | Not yet documented                                         |
| `ops`          |   —    |    —     |     —     | Not yet documented                                         |
| `org`          |   ✅   |    ✅    |     —     |                                                            |
| `projects`     |   ✅   |    —     |     —     |                                                            |
| `search`       |   —    |    —     |     —     | Not yet documented                                         |
| `security`     |   ✅   |    —     |     —     |                                                            |

✅ = populated with real schema detail. `—` = stub file stamped `_Not yet documented._` — this is an
intentional placeholder, not a deletion or accident. Every `Functions.md` across all 11 domains is
currently a stub; populate them as RPCs are implemented.

## For Future Agents

- Do not delete a stub file because it looks empty — it marks a domain that's scaffolded but not yet
  written. Replace the `_Not yet documented._` stub content when you add real schema detail.
- When you add a migration, update the corresponding domain's `Tables.md`/`Policies.md`/
  `Functions.md` in the same change, and make sure the Zod schema in `@projective/types` matches
  (per `brain2.md`'s SSOT rule) — do not let this folder, the migrations, and the types package
  drift from each other.
- See [../CLAUDE.md](../CLAUDE.md) and [CLAUDE.md](CLAUDE.md) for the full guardrails.
