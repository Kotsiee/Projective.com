# brain2.md — Moved (Redirect Stub)

> **This file has been renamed and now lives at
> [`../architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md).**
>
> `brain2.md` was the platform's technical/architecture single source of truth (System Directives,
> Islands boundary, Packages, Database conventions, Security, Caching, Integration Blueprints,
> Testing, Env contract). During the July 2026 documentation restructure it was moved verbatim to
> **`documentation/architecture/SYSTEM_ARCHITECTURE.md`** and updated in two places to reflect
> governance decisions (see that file's "Restructure Change Log" at the bottom).
>
> This stub is intentionally left in place so existing links and agent references to `brain2.md`
> keep resolving. **Do not add content here.** Edit
> [`SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) instead.

## Where things went

| Section                                                                                                 | New canonical home                                                                            |
| :------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------- |
| System Directives, Islands boundary, SOLID, Packages, WASM, Security, Caching, State Hydration, Testing | [`documentation/architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) |
| Database conventions (migration ranges, pgvector, storage lifecycle, Edge Functions)                    | mirrored in [`documentation/database/`](../database/README.md) (already the per-domain SSOT)  |
| Integration Blueprints (Stripe, Conferencing) + Environment Variable Contract                           | [`documentation/api/README.md`](../api/README.md)                                             |

The technical directives remain **absolutely binding**. The rename did not relax them — see the root
[`CLAUDE.md`](../../CLAUDE.md) and [`documentation/CLAUDE.md`](../CLAUDE.md).
