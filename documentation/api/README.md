# API Documentation

Home for **per-route API tables**, endpoint contracts, integration blueprints, and the environment
contract. This folder expands the flat sitemap in
[`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §Sitemap into concrete
`routes/api/...` handler documentation as those handlers are implemented.

## Authority & pointers

- **Route list (SSOT):** the sitemap table in
  [`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §"Sitemap and Route Overview".
- **Integration blueprints (Stripe, Conferencing):** currently authoritative in
  [`../architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md)
  §"Integration Blueprints". Expand provider-specific flows here as they are built.
- **Environment variable contract:**
  [`../architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md)
  §"Environment Variable Contract". Use `XXXX-XXXX` placeholders everywhere.

## Conventions (from `SYSTEM_ARCHITECTURE.md` §2)

- **Thin routes, fat services.** Each documented endpoint states: method + path, Zod request/response
  schema (`@projective/types`), auth guard, the Service it delegates to, and RLS assumptions.
- **Route groups:** `routes/(public)/`, `routes/(dashboard)/`, and the wildcard profile namespace
  (`routes/[handle]/` — see the `[handle]`/`[profile]` conflict in root
  [`CLAUDE.md`](../../CLAUDE.md) §8, unresolved).

## Status

Scaffolded. Per-route API tables are populated as handlers land, each in the **same change** as the
route + its Zod schema (Zod SSOT rule).
