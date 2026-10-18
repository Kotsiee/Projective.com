# Database Documentation

## Hierarchy

`brain2.md` (in `../business/brain2.md`) is authoritative for the **conventions**: migration
numbering ranges (0000–0499), the `pgvector`/Triggered Search Table pattern, the storage quarantine
lifecycle, Edge Function/webhook standards, and general RLS principles.

This folder documents the **actual per-domain schema** — real table/column lists, RLS policy
definitions, and RPC/function signatures — which `brain2.md` deliberately does not enumerate.
[Schemas.md](Schemas.md) is the top-level ERD-adjacent reference: the `CREATE SCHEMA` statements and
every custom enum type with its literal values.

> **Resolved drift (2026-09-23).** `reviews` — created by the init migration but never documented
> (Decision #56(e)) — is live: the discovery surfaces read it, so it now has a folder here, as does
> `catalogue` (the seller publication layer, `00000023`). Both are listed in [Schemas.md](Schemas.md).

> **Two schemas for the public surfaces (2026-10-17, Decision #274).** `editorial` (`00000024`) holds
> what the platform authors — the help centre, the changelog, Projective's articles — and
> `community` (`00000025`) what people do around it — the newsletter (moved from `comms`), helpfulness
> votes, the feedback board. Every shared SQL file those surfaces add to carries one named region per
> surface (`-- #region [community.feedback]` …) so their work orders merge without touching each
> other's lines; each folder's files have one heading per surface for the same reason.

## Development seed

[Seed.md](Seed.md) documents the generated development world that `supabase db reset` loads —
seventeen sign-in-able personas (`<username>@projective.dev` / `password123`), teams, businesses,
projects, money, messages, notifications and the storage-backed images — and how to regenerate it
from `supabase/seeds/gen/world.ts`.

## Structure

Each domain below gets its own folder with up to four files: `Tables.md`, `Policies.md`,
`Functions.md`, and (for `files/` only) `Storage.md`.

| Domain         | Tables | Policies | Functions | Notes                                                                                              |
| :------------- | :----: | :------: | :-------: | :------------------------------------------------------------------------------------------------- |
| `analytics`    |   ✅   |    ✅    |    ✅     | Event substrate + daily rollups (`fn_emit`), 2026-07-24                                            |
| `catalogue`    |   ✅   |    ✅    |    ✅     | Seller publication layer (products, articles, listings); read live by discovery and the seller console, written through the console doors (`00001170`), 2026-09-23 |
| `comms`        |   ✅   |    ✅    |    ✅     | Messaging + the 2026-07-24 Notification Engine                                                     |
| `community`    |   ◐    |    ◐     |    ◐      | What people do around the platform (Decision #274, 2026-10-17): the newsletter opt-in (moved from `comms`, with topics) and the help centre's helpfulness votes (P2) are documented; the feedback board (P7) is a per-surface stub |
| `editorial`    |   ✅   |    ✅    |    ✅     | Platform-authored content (Decision #274, 2026-10-17): the help centre (P2), the changelog's releases (P5, Decision #278) and Projective's articles with their authors (P6, Decision #271) are documented; all seeded by generated category-5 migrations |
| `files`        |   ✅   |    ✅    |    ✅     | Asset management, 2026-08-04; the media pipeline, renditions + WebP tiers (`item_variants`), 2026-09-23. Plus [Storage.md](files/Storage.md) |
| `finance`      |   ✅   |    ✅    |    ✅     | Wallets/escrow/ledger + the 2026-07-23 Wallet & Finance foundation                                 |
| `integrations` |   ✅   |    ✅    |    ✅     | Connector + plugin substrate (token vault, sync/webhooks, plugin ecosystem), redesigned 2026-07-25 |
| `marketplace`  |   ◐    |    ◐     |    ◐     | Blueprints (address, intake, stage template), paid placements, quote requests — partial; Functions: service instantiation (`00001175`, Decision #209), 2026-10-13 |
| `ops`          |   ◐    |    ◐     |     ◐     | Log ingestion (`log_entries`), the job registry (`scheduled_jobs`, `http_job_dispatches`, Decision #203) and the `/contact` intake (`contact_requests`, `contact_request_attachments`, Decision #276); `admin_users` not yet documented |
| `org`          |   ✅   |    ✅    |    ✅     | Identity/teams/enterprises, the 2026-07-24 Standing ladder, the live public profile (showcase, settings, certifications, definer read/write door), 2026-09-23, and the Teams & Businesses console (roles, members, invitations, the permission twin + vault projection), 2026-09-28 |
| `projects`     |   ✅   |    —     |     —     |                                                                                                    |
| `reviews`      |   ✅   |    ✅    |    ✅     | One table, two reputation tracks; no client write path yet, 2026-09-23                             |
| `scheduling`   |   ✅   |    ✅    |    ✅     | Availability, calendar events & discovery calls, 2026-07-24                                        |
| `search`       |   ◐    |    —     |     —     | `platform_stats` documented; the index tables are not yet                                          |
| `security`     |   ✅   |    ◐     |     ◐     | `session_context` (one-slot CHECK, SELECT-only to clients, switch RPCs) and the access-token hook, 2026-09-28; column guards; route slugs |

✅ = populated with real schema detail. ◐ = the sections a recent change touched are documented, the rest is not. `—` = stub file stamped `_Not yet documented._` — this is an
intentional placeholder, not a deletion or accident. `comms/`, `files/`, `finance/`, `integrations/`
and `scheduling/` have populated `Functions.md` (the notification engine; the asset hub's read
predicate, quota gate, usage rollup and share resolver; the escrow engine + the Wallet & Finance
foundation; the OAuth capability predicates; the discovery-call booking gate); the remaining
`Functions.md` files are still stubs — populate them as RPCs are implemented.

> **A `—` in the Policies column is a documentation gap, not a statement that the schema is
> unpoliced — and the two were recently shown to diverge.** `files/Policies.md` was a stub while
> `files.items` carried a live `USING (true)` `SELECT` policy and `files.folders` had no RLS at all
> (both now closed, both written up in that file). Treat a stub Policies column as _unknown_, and
> read the migration before assuming a table is safe. `projects/` is the remaining stub;
> `security/Policies.md` documents `session_context` only.

## For Future Agents

- Do not delete a stub file because it looks empty — it marks a domain that's scaffolded but not yet
  written. Replace the `_Not yet documented._` stub content when you add real schema detail.
- When you add a migration, update the corresponding domain's `Tables.md`/`Policies.md`/
  `Functions.md` in the same change, and make sure the Zod schema in `@projective/types` matches
  (per `brain2.md`'s SSOT rule) — do not let this folder, the migrations, and the types package
  drift from each other.
- See [../CLAUDE.md](../CLAUDE.md) and [CLAUDE.md](CLAUDE.md) for the full guardrails.
