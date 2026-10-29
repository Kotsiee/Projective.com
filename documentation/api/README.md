# API Documentation

Home for **per-route API tables**, endpoint contracts, integration blueprints, and the environment
contract. This folder expands the flat sitemap in
[`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §Sitemap into concrete `routes/api/...`
handler documentation as those handlers are implemented.

## Authority & pointers

- **Route list (SSOT):** the sitemap table in
  [`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §"Sitemap and Route Overview".
- **Integration blueprints (Stripe, Conferencing):** currently authoritative in
  [`../architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) §"Integration
  Blueprints". Expand provider-specific flows here as they are built. The operational runbook for
  every external provider (setup, data contracts, dev/prod fallbacks) is
  [`EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md`](EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md).
- **Environment variable contract:**
  [`../architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) §"Environment
  Variable Contract". Use `XXXX-XXXX` placeholders everywhere.

## Conventions (from `SYSTEM_ARCHITECTURE.md` §2)

- **Thin routes, fat services.** Each documented endpoint states: method + path, Zod
  request/response schema (`@projective/types`), auth guard, the Service it delegates to, and RLS
  assumptions.
- **Route groups:** `routes/(public)/`, `routes/(dashboard)/`, and the wildcard profile namespace
  `routes/[handle]/` (canonical — resolved 2026-07-12; see root [`CLAUDE.md`](../../CLAUDE.md) §8).

## Status

Scaffolded. Per-route API tables are populated as handlers land, each in the **same change** as the
route + its Zod schema (Zod SSOT rule).

- [`projects-settlement.md`](projects-settlement.md): submission review, stage approval and Fair
  Exit cancellation.
- [`EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md`](EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md):
  the provider register (Stripe, Voyage, the self-hosted safety node, connectors, push and email,
  Turnstile, Storage, Vault, KMS), each with its wiring, data contract, setup runbook and dev/prod
  fallbacks. Binding only where it repeats a source of truth; its proposals wait on Decision #335.
