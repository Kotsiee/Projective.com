# Database Documentation

## Hierarchy

`brain2.md` (in `../business/brain2.md`) is authoritative for the **conventions**: migration
numbering ranges (0000–0499), the `pgvector`/Triggered Search Table pattern, the storage quarantine
lifecycle, Edge Function/webhook standards, and general RLS principles.

This folder documents the **actual per-domain schema** — real table/column lists, RLS policy
definitions, and RPC/function signatures — which `brain2.md` deliberately does not enumerate.
[Schemas.md](Schemas.md) is the top-level ERD-adjacent reference: the `CREATE SCHEMA` statements and
every custom enum type with its literal values.

> ⚠️ **Flagged drift (surface, do not silently resolve).** [Schemas.md](Schemas.md) has always
> listed **11** schemas, but `0001_init_schemas.sql` actually creates **12** — it also creates
> `reviews`, which the doc's table and its "Initialization SQL" block both omit, and for which there
> is no folder here. `scheduling` (migration `20260724100000`) was added to both the table and the
> SQL block on 2026-07-24, so the documented set is now 12 of the 13 real schemas. Reconciling
> `reviews` — document it, or confirm it is dead and remove it from the init migration — needs a
> human (root `CLAUDE.md` §8).

## Structure

Each domain below gets its own folder with up to four files: `Tables.md`, `Policies.md`,
`Functions.md`, and (for `files/` only) `Storage.md`.

| Domain         | Tables | Policies | Functions | Notes                                                                                              |
| :------------- | :----: | :------: | :-------: | :------------------------------------------------------------------------------------------------- |
| `analytics`    |   ✅   |    ✅    |    ✅     | Event substrate + daily rollups (`fn_emit`), 2026-07-24                                            |
| `comms`        |   ✅   |    ✅    |    ✅     | Messaging + the 2026-07-24 Notification Engine                                                     |
| `files`        |   ✅   |    ✅    |    ✅     | Asset management, 2026-08-04. Plus [Storage.md](files/Storage.md) (10-bucket storage architecture) |
| `finance`      |   ✅   |    ✅    |    ✅     | Wallets/escrow/ledger + the 2026-07-23 Wallet & Finance foundation                                 |
| `integrations` |   ✅   |    ✅    |    ✅     | Connector + plugin substrate (token vault, sync/webhooks, plugin ecosystem), redesigned 2026-07-25 |
| `marketplace`  |   —    |    —     |     —     | Not yet documented                                                                                 |
| `ops`          |   —    |    —     |     —     | Not yet documented                                                                                 |
| `org`          |   ✅   |    ✅    |    ✅     | Identity/teams/orgs + the 2026-07-24 Standing & progression ladder                                 |
| `projects`     |   ✅   |    —     |     —     |                                                                                                    |
| `scheduling`   |   ✅   |    ✅    |    ✅     | Availability, calendar events & discovery calls, 2026-07-24                                        |
| `search`       |   —    |    —     |     —     | Not yet documented                                                                                 |
| `security`     |   ✅   |    —     |     —     |                                                                                                    |

✅ = populated with real schema detail. `—` = stub file stamped `_Not yet documented._` — this is an
intentional placeholder, not a deletion or accident. `comms/`, `files/`, `finance/`, `integrations/`
and `scheduling/` have populated `Functions.md` (the notification engine; the asset hub's read
predicate, quota gate, usage rollup and share resolver; the escrow engine + the Wallet & Finance
foundation; the OAuth capability predicates; the discovery-call booking gate); the remaining
`Functions.md` files are still stubs — populate them as RPCs are implemented.

> **A `—` in the Policies column is a documentation gap, not a statement that the schema is
> unpoliced — and the two were recently shown to diverge.** `files/Policies.md` was a stub while
> `files.items` carried a live `USING (true)` `SELECT` policy and `files.folders` had no RLS at all
> (both now closed, both written up in that file). Treat a stub Policies column as _unknown_, and
> read the migration before assuming a table is safe. `projects/` and `security/` are the two
> remaining stubs.

## For Future Agents

- Do not delete a stub file because it looks empty — it marks a domain that's scaffolded but not yet
  written. Replace the `_Not yet documented._` stub content when you add real schema detail.
- When you add a migration, update the corresponding domain's `Tables.md`/`Policies.md`/
  `Functions.md` in the same change, and make sure the Zod schema in `@projective/types` matches
  (per `brain2.md`'s SSOT rule) — do not let this folder, the migrations, and the types package
  drift from each other.
- See [../CLAUDE.md](../CLAUDE.md) and [CLAUDE.md](CLAUDE.md) for the full guardrails.
