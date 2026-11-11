# External Providers & Infrastructure Specification

> **Status: operational specification. Binding only where it repeats a source of truth.** This is a
> satellite of [`SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) (the technical
> authority) and [`PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) (the business authority). A
> statement about what is **built** is a description: if it drifts from the code or a
> source-of-truth doc, the code and the source of truth win. A statement marked **Proposed** is a
> recommendation and binds nothing until a human rules on it in **Decision #335**
> ([`decisions-122-126.md`](../reference/decisions/decisions-122-126.md)). Written 2026-10-29
> against `main` @ `a1017c09`.

**Scope.** This document covers every external API, SaaS provider, self-hosted microservice and
platform primitive that Projective's MVP and Growth phases depend on. For each one it gives the
provider's role, its wiring in the monorepo, its data contract, the setup runbook, and how it
behaves in development and production. Business rules are linked, never restated (documentation
`CLAUDE.md` rule 2).

**Status legend.** Every provider and every proposal carries one of these marks.

| Mark                  | Meaning                                                                                                    |
| :-------------------- | :--------------------------------------------------------------------------------------------------------- |
| **Shipped**           | A live code path that has been verified by a test, a probe or the smoke test.                              |
| **Wired · gated off** | The code exists behind a `*_BACKEND_LIVE` gate or a feature flag that defaults to off.                     |
| **Stub**              | A seam exists, but it refuses, mocks or logs. It makes no provider call.                                   |
| **Planned (SSOT)**    | Designed in `SYSTEM_ARCHITECTURE.md` or `PRODUCT_SPEC.md`, with no code yet.                               |
| **Proposed**          | First specified here. It needs a ruling (Decision #335) before it lands in the env contract or the schema. |

## Contents

1. [Executive summary](#1-executive-summary)
2. [Topology, trust zones and the network edge](#2-topology-trust-zones-and-the-network-edge)
3. [Cross-cutting contracts](#3-cross-cutting-contracts)
4. [Financial and identity rails: Stripe](#4-financial-and-identity-rails-stripe)
5. [AI and search: Voyage AI](#5-ai-and-search-voyage-ai)
6. [Content moderation and upload safety: the safety node](#6-content-moderation-and-upload-safety-the-safety-node)
7. [Third-party connectors: calendar, conferencing and storage](#7-third-party-connectors-calendar-conferencing-and-storage)
8. [Outbound messaging](#8-outbound-messaging)
9. [Security, storage and edge compute](#9-security-storage-and-edge-compute)
10. [Environment variable register](#10-environment-variable-register)
11. [Rollout sequence and go-live checklist](#11-rollout-sequence-and-go-live-checklist)
12. [Open decisions (Decision #335)](#12-open-decisions-decision-335)

---

## 1. Executive summary

Projective follows one provider rule, implicit in the source of truth and made explicit here: **rent
SaaS where the data is money or already public, and self-host where the data is private
collaboration.**

- Stripe holds the fiat rails and the identity verdicts.
- Voyage sees only public catalogue text.
- Google sees only the URLs a person chose to post.
- Message bodies, private files and dispute evidence never leave Projective's own infrastructure. A
  self-hosted **safety node** (Presidio, NudeNet, ClamAV) screens them.

This split carries the commercial argument as well as the technical one. The trust claim ("your
client work is never shipped to a third-party classifier") survives due diligence. Moderation cost
stays flat as message volume grows (Decision #147, "Why self-hosted"). Neither is true of a Fiverr-
or Upwork-style platform that pipes every message through a hosted trust-and-safety API.

### 1.1 Provider register

| #  | Provider                                                | Category               | Phase                | Status                                                       | Gate / switch                                                     | Fat seam (under `packages/backend/`)                                                         |
| :- | :------------------------------------------------------ | :--------------------- | :------------------- | :----------------------------------------------------------- | :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| 1  | Stripe Payments + Connect Express (Accounts v2)         | Financial rails        | MVP                  | **Shipped** in test mode; live mode never exercised          | `FINANCE_BACKEND_LIVE`                                            | `core/stripe.ts` · `services/finance/{PaymentBackendService,stripe-rails,stripe-webhook}.ts` |
| 2  | Stripe Identity (Level 2 KYC)                           | Identity               | MVP                  | **Shipped** (test)                                           | same + `security.platform_params.identity_sessions_per_day`       | `PaymentBackendService.createIdentitySession`                                                |
| 3  | Stripe Connect onboarding as KYB (Level 3)              | Identity               | MVP                  | **Shipped** (test)                                           | same                                                              | `PaymentBackendService.startKybOnboarding`                                                   |
| 4  | Voyage AI `voyage-4` (`api.voyageai.com` only, T5)      | AI / embeddings        | MVP (off by default) | **Wired · gated off**                                        | `EMBEDDINGS_ENABLED` (+ `pj.dev.embeddings` in development)       | `services/search/{EmbeddingBackendService,voyage-client,embedding-sync}.ts`                  |
| 5  | Microsoft Presidio Analyzer + Anonymizer                | Content safety         | MVP (Tier 3)         | **Planned (SSOT)**                                           | **Proposed** `MODERATION_BACKEND_LIVE`                            | **Proposed** `services/moderation/`                                                          |
| 6  | NudeNet + Presidio Image Redactor                       | Content safety         | MVP (public media)   | **Planned (SSOT)**                                           | same                                                              | `services/media/MediaBackendService.ts` (publish step)                                       |
| 7  | ClamAV                                                  | Upload hygiene         | MVP                  | **Stub**: magic-byte sniff only                              | **Proposed** `MALWARE_SCAN_LIVE`                                  | `services/files/live-uploads.ts` · `services/contact/live-attachments.ts`                    |
| 8  | VirusTotal                                              | Upload hygiene         | Growth, optional     | **Stub**: an unused key in a defective Edge Function         | none                                                              | none (see §6.4)                                                                              |
| 9  | Google Web Risk (§6.5; replaced Safe Browsing v4, T5)   | Link safety            | MVP                  | **Wired · gated off**                                        | `FILES_BACKEND_LIVE`                                              | `services/files/link-reputation.ts`                                                          |
| 10 | Google Calendar + Meet                                  | Connector              | MVP                  | **Wired · gated off**: consent and refresh; no room or sync  | `INTEGRATIONS_BACKEND_LIVE` + `integrations.providers.is_enabled` | `services/integrations/IntegrationsBackendService.ts`                                        |
| 11 | Google Drive                                            | Connector              | Growth               | **Wired · gated off**: consent, listing and the tree (#394)  | same                                                              | `services/integrations/adapters/GoogleDriveAdapter.ts`                                       |
| 12 | Microsoft Graph (Outlook, Teams, OneDrive / SharePoint) | Connector              | MVP / Growth         | **Wired · gated off**: consent and refresh; no room or sync  | same                                                              | `IntegrationsBackendService.ts` · `adapters/OneDriveAdapter.ts`                              |
| 13 | Zoom (OAuth + presence webhooks)                        | Conferencing           | MVP                  | Presence webhook **Shipped**; OAuth **Wired · gated off**    | `ZOOM_WEBHOOK_SECRET` present                                     | `services/sessions/presence/zoom.ts`                                                         |
| 14 | Web Push (VAPID)                                        | Outbound               | MVP                  | **Planned (SSOT)**; `comms.device_tokens` shipped            | `security.feature_flags['comms.dispatch_webhook']`                | dispatch Edge Function (not built)                                                           |
| 15 | Apple Push Notification service                         | Outbound               | Growth (native app)  | **Planned (SSOT)**                                           | same                                                              | same                                                                                         |
| 16 | Firebase Cloud Messaging (HTTP v1)                      | Outbound               | Growth (native app)  | **Planned (SSOT)**                                           | same                                                              | same                                                                                         |
| 17 | Transactional email                                     | Outbound               | **MVP blocker**      | GoTrue → Mailpit locally; the app's transport is built (Resend, Decision #391) and has no key in any environment yet | none                                                              | `services/mail/transport.ts` `configuredTransport()`                               |
| 18 | Twilio SMS                                              | Outbound / Level 1 KYC | Growth               | Config scaffold only (`[auth.sms.twilio]`)                   | GoTrue config                                                     | none                                                                                         |
| 19 | Cloudflare Turnstile                                    | Bot mitigation         | MVP                  | Table + dumb UI mount only                                   | none                                                              | `security.turnstile_verifications` · `@projective/ui` `Captcha`                              |
| 20 | Supabase Storage (12 buckets)                           | Storage                | MVP                  | **Shipped**                                                  | `FILES_BACKEND_LIVE` for the hub                                  | `core/storage-*.ts` · `services/files/*` · `services/media/*`                                |
| 21 | Supabase Vault                                          | Secrets                | MVP                  | **Shipped**; secrets provisioned nowhere yet (#203 (b))      | none                                                              | `ops.fn_dispatch_http_job`                                                                   |
| 22 | The `ENCRYPTION_KEY` token vault                        | Key management         | Growth               | **Built**: the envelope (§9.4, ruling C4 (c))                | `INTEGRATIONS_BACKEND_LIVE`                                       | `services/integrations/token-vault.ts`                                                       |
| 23 | AWS STS (S3 platform principal)                         | Connector infra        | Growth               | **Wired · gated off**                                        | `INTEGRATIONS_BACKEND_LIVE`                                       | `adapters/{aws,sigv4,S3Adapter}.ts`                                                          |
| 24 | Supabase Edge Functions                                 | Compute                | MVP                  | `scan-file` is a legacy mock (**defect**, §9.5)              | per function                                                      | `supabase/functions/`                                                                        |
| 25 | An edge: Cloudflare CDN + Workers, or equivalent        | Edge                   | Marketplace launch   | **Proposed** (Decision #393): the storage edge host and the sandbox origin | **Proposed** `ASSET_SANDBOX_ORIGIN`                               | Stateless; the app is its origin (`ASSET_DELIVERY_ARCHITECTURE.md` §7)                |
| 26 | Protection worker (self-hosted, Zone D)                 | Asset protection       | Marketplace launch   | **Proposed** (Decision #393): rendering, signatures, extraction | **Proposed** `PROTECTION_BACKEND_LIVE`                            | `services/protection/` (`ANTI_PIRACY_ENGINE.md` §6.1)                                 |
| 27 | Reverse image search: Google Cloud Vision Web Detection; TinEye and others to assess | Asset protection       | Growth               | **Proposed** (Decision #393): public previews only, never private content | same                                                              | `services/protection/` (`ANTI_PIRACY_ENGINE.md` §7.4)                                 |

### 1.2 What blocks an MVP go-live

In order of risk:

1. **Transactional email.** The transport is built, and until it has a key, in production
   `services/mail/transport.ts` reports
   `delivery:
   "unavailable"`. GoTrue's auth mail also needs a production SMTP block, because the
   built-in sender is rate-limited and is not meant for production. No account can be confirmed
   reliably without it. See §8.5.
2. **Malware scanning.** The Storage Lifecycle promises a scan between quarantine and promotion
   (`SYSTEM_ARCHITECTURE.md` §Storage Lifecycle). The only check today is a magic-byte sniff. See
   §6.4.
3. **The publication gate.** Decision #148 makes automated screening **required** before anything
   reaches a public bucket. Today avatars, showcase and catalogue media publish unscreened. See
   §6.3.
4. **CAPTCHA on GoTrue.** The anon key is public by design, so `/auth/v1/signup` is reachable
   without going through the app at all. See §9.1.
5. **Stripe live configuration.** The event destinations, the restricted key, Identity activation
   and the Connect platform profile are not set up, and the manual test-mode run is still
   outstanding (`SYSTEM_ARCHITECTURE.md` §1.3: hosted onboarding, the 3-D Secure UI and live
   `stripe listen` were "not exercised"). See §4.
6. **Link safety.** The Safe Browsing Lookup API v4 is licensed for non-commercial use, so
   `link-reputation.ts` calls Google Web Risk (ruling T5). Each environment still needs a Google
   Cloud project and a key restricted to Web Risk. See §6.5.
7. **Presidio Tier 3.** This is desirable but can trail the others. Tier 2 (`comms.mask_pii`) is the
   guarantee. Tier 3 supplies evidence for the Consequences ladder. See §6.2.

Connectors (§7) and the token vault (§9.4) **do not** block the MVP. No connector is enabled, and a
NULL `fn_conferencing_provider` is a normal answer: the session falls back to a manual link
(`SYSTEM_ARCHITECTURE.md` §3.2).

### 1.3 Cost drivers and controls

This section lists what drives each provider's cost and the control that bounds it. Unit prices
change and belong in the finance model, not here.

| Provider                  | Cost driver                                            | Control that already exists or is proposed                                                                            |
| :------------------------ | :----------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| Stripe Identity           | One billed check per started session                   | `identity_sessions_per_day` (5) in `security.platform_params`, enforced by `finance.begin_identity_verification`      |
| Stripe Connect            | Active connected accounts and payout volume            | Accounts are created only at onboarding; withdrawals have a `min_withdrawal_minor` floor (Decision #202)              |
| Voyage                    | Tokens per query and per document                      | A two-level query cache (LRU + Deno KV), a token bucket, a circuit breaker, and skip-on-unchanged-hash re-embeds (§5) |
| Safety node               | One VM, flat cost                                      | CPU only. The proactive screen is spent only on the public zone (Decision #148)                                       |
| Web Risk                  | Lookups per month, beyond a free tier                  | A per-URL verdict cache (safe 1 h, flagged 24 h); lookups happen only for posted links, never on page loads           |
| Email                     | Messages per month                                     | The digest cadence and the collapse rules in `comms.notification_types`                                               |
| Turnstile                 | Free tier                                              | n/a                                                                                                                   |
| Push (VAPID / APNs / FCM) | Free at the gateway                                    | Revoke dead devices on 404/410 (`fn_reap_dead_devices`)                                                               |

---

## 2. Topology, trust zones and the network edge

```text
                     ┌─────────────────────────── Zone A: public internet ───────────────────────────┐
Browser / PWA ──────►│ Fresh app (Deno)  thin routes → fat services (@server/services/*)              │
 Stripe.js ◄────────►│   │                                                                            │
 Turnstile widget    │   ├── Zone C: Supabase ── Postgres (RLS) · GoTrue · Storage · Realtime          │
                     │   │        │  pg_cron + pg_net ──(bearer from Vault)──► /api/*/cron/* (Zone B)    │
                     │   │        │  comms trigger ──pg_net──► Edge Function comms-dispatch (Zone C)     │
                     │   │        └─ Vault (cron + dispatch secrets)                                    │
                     │   │                                                                            │
                     │   ├── Zone D: safety node (private link only) ── Presidio · NudeNet/OCR · ClamAV  │
                     │   │                                                                            │
                     │   └── Zone E: SaaS ── Stripe · Voyage · Web Risk · Turnstile siteverify ·        │
                     │                      Google / Microsoft / Zoom APIs · email · push gateways ·   │
                     │                      AWS STS                                                    │
                     └────────────────────────────────────────────────────────────────────────────────┘
Inbound webhooks: Stripe ─► /api/finance/webhooks/* · Zoom, Google, Graph ─► /api/integrations/webhooks/* ·
                  (Proposed) email ─► /api/comms/webhooks/*
```

| Zone           | What runs there                                              | Holds credentials for                                                                        | Never holds                                      |
| :------------- | :----------------------------------------------------------- | :------------------------------------------------------------------------------------------- | :----------------------------------------------- |
| A: browser     | Islands, Stripe.js, the Turnstile widget, the service worker | Publishable or site keys only, each delivered by a server response                           | Any secret or env value (islands never read env) |
| B: app (Deno)  | Thin routes, fat services, the media worker pool             | The Stripe secret, Voyage, Web Risk, OAuth clients, cron bearers, STS, the vault key         | Plaintext DEKs beyond one request                |
| C: Supabase    | Postgres, GoTrue, Storage, Edge Functions, Vault             | Vault cron and dispatch secrets, Edge secrets (VAPID, APNs, FCM, email), GoTrue SMTP/captcha | OAuth tokens in clear (envelope only)            |
| D: safety node | Presidio, NudeNet/OCR, ClamAV, a gateway                     | One inbound bearer or mTLS identity                                                          | Any payload after scoring (no volumes)           |
| E: SaaS        | Third parties                                                | n/a                                                                                          | Private-zone content (§3.5)                      |

### 2.1 Inbound endpoints

Every inbound endpoint follows the webhook standard in §3.3. A new route lands in
[`ROUTING.md`](../architecture/ROUTING.md) in the same change as its handler.

| Endpoint                                             | Caller                                            | Verification                                                                                                   | Secret                                                    | Idempotency                                                             | Status                    |
| :--------------------------------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------- | :---------------------------------------------------------------------- | :------------------------ |
| `POST /api/finance/webhooks/stripe`                  | Stripe, from the account and Connect destinations | `Stripe-Signature` (HMAC-SHA256 over the raw body, 300 s tolerance, Web Crypto), checked against either secret | `STRIPE_WEBHOOK_SECRET` · `STRIPE_CONNECT_WEBHOOK_SECRET` | `finance.idempotency_keys` `stripe:<evt>`, claimed with the effects     | **Shipped**               |
| `POST /api/finance/webhooks/stripe-v2`               | Stripe thin events (Accounts v2)                  | same                                                                                                           | `STRIPE_THIN_WEBHOOK_SECRET`                              | Re-reads the account; `sync_payout_account` is idempotent               | **Shipped**               |
| `POST /api/integrations/webhooks/zoom`               | Zoom Event Subscription                           | `x-zm-signature` `v0` HMAC, 300 s; the URL-validation challenge is answered only after verification            | `ZOOM_WEBHOOK_SECRET`                                     | `integrations.webhook_deliveries (provider_slug, external_delivery_id)` | **Shipped**; `/api/sessions/webhooks/zoom` re-exports it until the app is re-pointed |
| `GET /api/integrations/callback`                     | OAuth providers, via a browser redirect           | `integrations.consent_states.state` (≥ 22 chars, single use, ~10 min) + PKCE verifier                          | per-provider client secret                                | `consent_states.consumed_at`                                            | **Shipped**; no provider enabled |
| `POST /api/integrations/webhooks/[provider]`         | Google channels, Graph subscriptions              | `X-Goog-Channel-Token` / Graph `clientState` against `webhook_subscriptions.verification_token`                | per channel                                               | `integrations.webhook_deliveries (provider_slug, external_delivery_id)` | **Shipped**; pushes are acknowledged until calendar sync lands |
| `POST /api/comms/webhooks/[provider]`                | The email provider (Svix), Twilio                 | Svix `svix-signature` / `X-Twilio-Signature`                                                                   | `RESEND_WEBHOOK_SECRET` · the Twilio auth token           | `comms.delivery_events (provider, provider_event_id)`                   | **Proposed**              |
| `POST {SUPABASE_URL}/functions/v1/comms-dispatch`    | pg_net, from `comms.notification_deliveries`      | A bearer read from Vault (**Proposed**; today the trigger sends none, flag (e))                                | `COMMS_DISPATCH_SECRET`                                   | The notification id plus per-delivery status                            | **Planned (SSOT)**        |
| `POST {SUPABASE_URL}/functions/v1/scan-file`         | Anyone (`verify_jwt = false`)                     | **None**                                                                                                       | none                                                      | none                                                                    | **Defect** (§9.5)         |
| `POST /api/{finance,user,scheduling,contact,integrations}/cron/*` | pg_net (`ops.fn_dispatch_http_job`)               | A bearer of ≥ 32 chars; anything else gets 404                                                                 | `*_CRON_SECRET`                                           | Per job (`SYSTEM_ARCHITECTURE.md` §Scheduled jobs)                      | **Shipped**               |

### 2.2 Outbound egress

These are the hosts each runtime must reach. The table feeds the production firewall and the Deno
`--allow-net` manifest (`SYSTEM_ARCHITECTURE.md` §Runtime: "never `--allow-all` in production").

| Runtime        | Hosts                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App (Zone B)   | `api.stripe.com` · `api.voyageai.com` · `webrisk.googleapis.com` · `challenges.cloudflare.com` · `oauth2.googleapis.com` · `www.googleapis.com` · `login.microsoftonline.com` · `graph.microsoft.com` · `zoom.us` · `api.zoom.us` · `api.resend.com` · `api.dropboxapi.com` · `content.dropboxapi.com` · `sts.{region}.amazonaws.com` · `kms.{region}.amazonaws.com` · the email API host · the safety node's private address · the Supabase origin |
| App, exception | **Arbitrary hosts.** The link scanner (`link-fetch.ts`) and custom S3-compatible endpoints connect to a host a person chose, through a pinned, guarded socket. The app's `--allow-net` therefore cannot be a closed list while those paths are live. The guards (§6.5) are the control, not the permission flag.                                                                                                                 |
| Edge Functions | `api.push.apple.com` · `fcm.googleapis.com` · `oauth2.googleapis.com` · the email API host · **arbitrary Web Push endpoints** (each browser vendor's push service). This is one reason dispatch runs in Zone C rather than in the app.                                                                                                                                                                                           |
| Safety node    | `database.clamav.net` (freshclam) only. Everything else is denied. Models are baked into the images at build time.                                                                                                                                                                                                                                                                                                               |
| Monitor (**Proposed**, Decision #393) | **Arbitrary hosts**, through guarded sockets, plus the search providers. It cannot live on the safety node, whose egress is closed, so it runs apart and holds no seeds, originals or storage credentials (`ANTI_PIRACY_ENGINE.md` §7.4). |

---

## 3. Cross-cutting contracts

### 3.1 Where each secret lives

| Store                                                                   | Holds                                                                                                                                                         | Read by                                       | Provisioned by                                                       | Rotation                               |
| :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------- | :------------------------------------------------------------------- | :------------------------------------- |
| App env (`.env.local` locally; the host's secret manager when deployed) | Stripe, Voyage, link safety, OAuth clients, cron bearers, the S3 principal, the vault key, and (**Proposed**) Turnstile, email and the safety-node bearer | `packages/backend/core/env.ts` → fat services | Operator, per environment                                            | Redeploy                               |
| Supabase Vault (`vault.secrets`)                                        | `CRON_APP_URL`, `*_CRON_SECRET`, and (**Proposed**) `COMMS_DISPATCH_SECRET`                                                                                   | pg_net dispatchers inside Postgres            | `SELECT vault.create_secret('<value>', '<NAME>')` per environment    | `vault.update_secret(id, '<value>')`   |
| Edge Function secrets                                                   | (**Proposed**) VAPID private key, APNs `.p8`, FCM service account, the email API key, `COMMS_DISPATCH_SECRET`                                                 | Edge Functions (`Deno.env.get`)               | `supabase secrets set`                                               | Set again with `supabase secrets set`  |
| Enveloped rows (`integrations.connection_secrets`)                      | Per-user OAuth access and refresh tokens; S3-compatible key pairs                                                                                             | `token-vault.ts`, service role only           | The consent callback                                                 | No rewrap yet: reconnect (§9.4)        |
| GoTrue configuration                                                    | The Google **sign-in** client, SMTP credentials, the captcha secret, Twilio                                                                                   | GoTrue                                        | `supabase/config.toml` `env(...)` locally; the dashboard when hosted | Dashboard / CLI                        |
| Browser-visible, served by a route                                      | The Stripe publishable key, the Turnstile site key, the VAPID public key                                                                                      | Islands, through `/api/*` responses           | App env                                                              | With their secret pair                 |

> **Terminology flag (Decision #335 (k)).** `SYSTEM_ARCHITECTURE.md` §Runtime & API Security says
> sensitive keys "are stored in **Supabase Vault** and accessed via environment variables in Edge
> Functions". Supabase Vault (`vault.secrets`, read by SQL) and Edge Function secrets
> (`supabase secrets set`, read by `Deno.env`) are two different stores. The app reads the Stripe
> key from its own env, not from either of them. The table above is what the code does. The sentence
> needs a human-approved rewording.

### 3.2 Gate and placeholder semantics

These rules come from the Environment Variable Contract and are summarised here only so each
provider section can refer to them:

- A secret whose value is `XXXX-XXXX` or the wrong shape **counts as absent** at its reader (for
  example `core/stripe.ts` key-shape validation, `linkSafetyKey()`, `usableSecret()`).
- Every `*_BACKEND_LIVE` gate is a boolean that defaults to the literal `false`.
- A provider is **on** only when its gate is true **and** its key is well formed. A connector also
  needs its `integrations.providers.is_enabled` row, which ships on for Google, Microsoft and Zoom
  (Decision #386), so credentials are what offer one. Production never honours a `pj.dev.*` cookie.

Each provider fails in a fixed direction:

| Provider         | When it is unavailable                                                                             | Direction                   |
| :--------------- | :------------------------------------------------------------------------------------------------- | :-------------------------- |
| Stripe           | 503, "not connected here"; no money moves                                                          | Fail closed                 |
| Voyage           | Heuristic ranking for that request, plus one `[embeddings]` log line                               | Fail open (harmless)        |
| Link reputation  | `unavailable`; the guards still run; the link stays `pending` behind `/exit`                       | Fail safe                   |
| Publication gate | 503, retryable; nothing is published unscreened (Decision #148)                                    | Fail closed                 |
| Malware scan     | **Proposed**: 503 and the row returns to `pending_upload` so the client can retry                  | Fail closed                 |
| Presidio Tier 3  | The queue backs up; Tier 2 still masks                                                             | Fail open (the floor holds) |
| Turnstile        | **Proposed**: production refuses the protected write; development with no secret skips it and logs | Fail closed (prod)          |
| Email            | `logged` in development; `unavailable` in production, and the UI says no mail went out             | Surfaced                    |
| Push             | Deliveries stay pending: `fn_process_queue` runs (`00005060`), no push transport yet               | Deferred                    |
| Connectors       | 409 / 503 refusal in words; a manual link is the fallback                                          | Fail closed                 |

### 3.3 The webhook standard

The Stripe and Zoom handlers set the house pattern. Every new inbound endpoint copies it:

1. **Read the raw body with a cap** (Zoom: 256 KiB, checked on `Content-Length` and again on the
   bytes read). A signature covers bytes, so never parse before verifying.
2. **Verify the signature with a timing-safe comparison**, with a 300 s tolerance on the signed
   timestamp. Answer any challenge or handshake only **after** verification. An unsigned challenge
   answer is a signing oracle (`presence/zoom.ts`). Two providers cannot meet this as written
   (Decision #383 (e)). Graph's `validationToken` handshake is unsigned by design: it is echoed back
   as `text/plain` and signs nothing, so it is no oracle. A Google Calendar push has no signature:
   the credential is the per-channel `X-Goog-Channel-Token`, compared in constant time with the
   stored row, so the adapter looks its secret up per channel.
3. **Claim an idempotency key in the same transaction as the effects.** The keys are `stripe:<evt>`
   in `finance.idempotency_keys`, `comms.delivery_events (provider, provider_event_id)` and
   `integrations.webhook_deliveries (provider_slug, external_delivery_id)`. A calendar push claims
   none: its one effect is to mark a calendar due, so a replay changes nothing and a ledger row per
   push would only grow.
4. **Status codes:** 2xx for handled, replayed **and** ignored events. 400 for a forged or stale
   delivery. 5xx **only** to ask for a redelivery, for example when a settlement has no ledger row
   yet (`requireLedgerRow`, Decision #200).
5. **Log the event id and type only**, never the payload.
6. **Thin events carry ids, not state.** Re-read the object from the provider before acting
   (Accounts v2; Graph change notifications without resource data).

### 3.4 Sub-processor and GDPR register

| Provider                                          | Personal data it receives                                                                                                        | Zone             | Basis                                | Before go-live                                                                                          |
| :------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------- | :--------------- | :----------------------------------- | :------------------------------------------------------------------------------------------------------ |
| Stripe (Payments, Connect, Identity)              | Collected **by Stripe directly**: card, bank, legal name, date of birth, ID document, selfie. Projective stores opaque ids only. | Money            | Contract; legal obligation (KYC/AML) | Stripe DPA; Identity data-retention settings; list Stripe in the privacy notice                         |
| Voyage AI (`api.voyageai.com` only, T5)           | Public catalogue text, plus **search queries**, which can contain whatever a person types                                        | Public           | Legitimate interest                  | DPA. Confirm no-training and retention terms in writing, and keep `EMBEDDINGS_ENABLED=false` until then |
| Google Web Risk                                   | Full URLs posted in messages and attachments                                                                                     | Private metadata | Legitimate interest (security)       | Google Cloud DPA. Disclosed in Decision #128                                                            |
| Cloudflare Turnstile                              | IP address and browser signals                                                                                                   | Public           | Legitimate interest                  | Cloudflare DPA. Projective also stores `ip` + `token_prefix` and must purge them (§9.1)                 |
| Email provider                                    | Recipient address and name, a guest's with no account included; message content (links, notification text)                                                           | Account          | Contract                             | DPA, EU region if offered, provider log retention configured                                            |
| Push gateways (Apple, Google, Mozilla, Microsoft) | Device endpoint or token; payload (end-to-end encrypted for Web Push, readable by the gateway for APNs/FCM)                      | Account          | Contract                             | The payload-minimisation rule (§3.5, rule 4)                                                            |
| Google / Microsoft / Zoom                         | The connection owner's account id and email; the meeting metadata Projective creates                                             | Private          | Contract (user-initiated)            | The attendee rule (§3.5, rule 5); revoke on disconnect and on erasure                                   |
| Twilio                                            | Phone number, OTP                                                                                                                | Account          | Contract                             | DPA; SMS-pumping geo permissions                                                                        |
| AWS STS                                           | None                                                                                                                             | n/a              | n/a                                  | CloudTrail on                                                                                           |
| Safety node (self-hosted)                         | Message text, images and file bytes, **inside Projective's own infrastructure**                                                  | Private          | Legitimate interest                  | Not a sub-processor. No volumes, no payload logging (§6.1)                                              |
| VirusTotal (if ever enabled)                      | **SHA-256 hashes only**                                                                                                          | Private metadata | Legitimate interest                  | A Premium licence. Never upload bytes (§6.4)                                                            |

### 3.5 PII exclusion rules

These rules are normative for every integration in this document:

1. **KYC and KYB: opaque references only.** Never store names, dates of birth, document numbers,
   selfies or bank numbers. Store `vs_…`, `acct_…`, `pm_…` and their statuses
   (`SYSTEM_ARCHITECTURE.md` §1).
2. **No private-zone content goes to any SaaS.** That means message bodies, private files, stage
   submissions and dispute evidence. Never send them to Voyage, never to a hosted moderation
   fallback, and never upload them to VirusTotal. The only external call a private item may cause is
   a reputation lookup of a **URL** someone posted.
3. **Credentials never appear in logs, errors, `ServiceResult`s or analytics.** An adapter error
   names the provider and the HTTP status only (`StorageAdapterError` sets the precedent). A token
   is unsealed for one request and never returned.
4. **Push and email previews carry no protected content.** A push payload holds a title, a deep link
   and a notification id. The body is fetched in-app after authentication. A protected-phase message
   never appears in a push or email preview, masked or not.
5. **Calendar attendees are the connection owner only.** An event Projective creates in someone's
   Google, Outlook or Zoom account carries the session title and a Projective link. A counterpart's
   email address is added as an attendee only if that counterpart opted in. Otherwise the room link
   reaches them through Projective.
6. **Minors never reach a provider through discovery.** A minor's profile cannot be `public`
   (`trg_users_public_minor_visibility`), and only public rows are embedded, so a minor's text never
   reaches Voyage. A minor cannot publish hours or accept calls, so no connector creates an event
   for one (Decision #208).
7. **Raw search text is never a cache key.** The embeddings KV key is `sha256Hex(normalised)`.
8. **Erasure reaches the providers (Proposed).** `AccountLifecycleBackendService.sweepDue` also:
   - revokes every OAuth grant at the provider (Google `revoke`, Microsoft and Zoom deauthorize),
     then deletes `connection_secrets`;
   - deletes `comms.device_tokens`;
   - asks the email provider to delete the contact, keeping only the suppression entry the law
     requires.

   Stripe keeps its KYC records under its own legal-retention duty. That is disclosed, not erased.

### 3.6 Dev Context Switcher obligations

Root `CLAUDE.md` §5: every new simulatable axis gets its switcher control in the **same change**
(`DevOverrides` + `DEV_DEFAULTS`, the `DevOption` list, the `DevContextPanel` control, and
`reflect()` set **and** delete, in `apps/web/features/devtools/` and `apps/web/utils/dev-seam.ts`).
Existing provider axes: `pj.dev.embeddings` (semantic ranking), `pj.dev.payout` (the earning gate,
with `POST /api/finance/verify/force`).

These **Proposed** axes land with their providers. Each is a cookie honoured only under
`DENO_ENV=development` and forwarded by routes only under `IS_DEV`, following `pj.dev.embeddings`:

| Cookie              | Values                                        | Drives                                                                                          |
| :------------------ | :-------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| `pj.dev.moderation` | `auto` · `clean` · `flagged` · `unavailable`  | The publication gate's verdict without the safety node (§6.3)                                   |
| `pj.dev.malware`    | `auto` · `clean` · `infected` · `unavailable` | The upload scan's verdict without ClamAV (§6.4)                                                 |
| `pj.dev.captcha`    | `auto` · `pass` · `fail` · `interactive`      | Which of Cloudflare's documented dummy site/secret key pairs the widget and verifier use (§9.1) |

---

## 4. Financial and identity rails: Stripe

**Authority:** `SYSTEM_ARCHITECTURE.md` §Integration Blueprints 1, 1.1, 1.2 and 1.3; Decisions #125,
#126, #186, #191, #200 and #202; [`finance-model.md`](../business/finance-model.md) for fees and
thresholds. This section covers operations. It does not restate the money rules.

### 4.1 Architectural role and wiring

Stripe is the fiat rail. **Projective is the ledger of record** (`finance.transactions`, append-only
for every role). The pattern is **Separate Charges & Transfers** on an **Accounts v2** platform:
connected accounts are `dashboard: "express"` with the **recipient** configuration, and the platform
is the fees and losses collector.

| Concern                                                                              | File                                                                                                                                                     |
| :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lazy client, key-shape validation, live-key boot guard, signature check              | `packages/backend/core/stripe.ts` (`STRIPE_API_VERSION = "2026-08-26.dahlia"`, `npm:stripe@22`, `assertStripeKeyAllowed` called from `apps/web/main.ts`) |
| Object builders (PaymentIntent, Transfer, v2 Account, AccountLink, Identity session) | `packages/backend/services/finance/stripe-rails.ts`                                                                                                      |
| Orchestration                                                                        | `services/finance/PaymentBackendService.ts` · `live-payments.ts`                                                                                         |
| Webhooks                                                                             | `services/finance/stripe-webhook.ts` ← `apps/web/routes/api/finance/webhooks/{stripe,stripe-v2}.ts`                                                      |
| Sweeps                                                                               | `payout-sweep.ts` · `scheduled-deposits.ts` ← `/api/finance/cron/{payouts,deposits}`                                                                     |
| Browser                                                                              | `apps/web/features/payments/core/stripe-js.ts` (Stripe.js loaded on demand) · CSP in `apps/web/utils/csp.ts`                                             |
| Zod SSOT                                                                             | `@projective/types/finance` (`payments.ts`)                                                                                                              |
| Database doors                                                                       | `00001230`, `00001240` → [`database/finance/Functions.md`](../database/finance/Functions.md)                                                             |
| Proof                                                                                | `deno task smoke:stripe` · `supabase/probes/{ledger_immutability,pending_window,identity_payout_doors}.sql`                                              |

### 4.2 Data contract

Projective stores **only opaque processor references**. Every money-moving call is keyed twice: by a
`finance.idempotency_keys` row, and by Stripe's own `Idempotency-Key`, which is derived from that
row.

| Table · column                                                  | Holds                                                    | Shape               |
| :-------------------------------------------------------------- | :------------------------------------------------------- | :------------------ |
| `finance.inbound_payments.provider_ref`                         | PaymentIntent id                                         | `pi_XXXX-XXXX`      |
| `finance.processor_customers.customer_ref`                      | Customer id                                              | `cus_XXXX-XXXX`     |
| `finance.saved_cards.stripe_payment_method_id`                  | PaymentMethod id (never a PAN, expiry or CVC)            | `pm_XXXX-XXXX`      |
| `finance.payment_methods.external_ref`                          | Funding PaymentMethod, or Connect external account id    | `pm_…` / `ba_…`     |
| `finance.verification_cases.provider_ref`                       | Identity VerificationSession id, or a Connect account id | `vs_…` / `acct_…`   |
| `finance.payouts.provider_ref` · `bank_payout_ref`              | Transfer id · the connected account's Payout id          | `tr_…` · `po_…`     |
| `finance.chargebacks.provider_ref`                              | Dispute id                                               | `du_…` / `dp_…`     |
| `finance.idempotency_keys`                                      | `stripe:<evt>` event claims and request keys             | text                |
| `org.freelancer_profiles.kyc_*` · `org.business_profiles.kyb_*` | Verdict **caches**, written only by processor doors      | status + timestamps |

**Encryption.** None of these columns is a secret, so none is enveloped. Their protection is RLS
plus processor-only write doors (`apply_identity_event`, `sync_payout_account`, …). **Excluded by
rule:** any card data (PCI scope stays with Stripe Elements), any identity document or biometric,
and any bank number.

### 4.3 Setup runbook

**A. Environments.**

- Use one **Stripe sandbox** per non-production environment (`stripe sandbox create`) and live mode
  for production only.
- Never share a sandbox between staging and a developer machine: webhook destinations are
  per-account.
- Store test keys only in `.env.local` (Decision #125 (i)).

**B. Connect platform profile** (Dashboard → Connect → Settings):

1. Platform profile: **marketplace**, funds flow **Separate charges and transfers**, connected
   account type **Express**. Accounts v2 are created by API with `dashboard: "express"`,
   `configuration.recipient` requesting `stripe_balance.stripe_transfers`, and
   `defaults.responsibilities.{fees_collector,losses_collector} = "application"`. Never use the v1
   `type: "express"`.
2. Branding (name, icon, brand colour) for hosted onboarding and the Express dashboard.
3. Connected-account payouts: **automatic**. The bank-payout reconciliation reads balance
   transactions with the `payout` filter, which covers automatic payouts only (Decision #202).
4. Supported countries, matching `finance-model.md`'s launch markets.
5. The support email, phone and statement descriptor that Express onboarding shows.

**C. Identity** (Dashboard → Identity): activate it (an application review). Configure the session
builder (`identitySessionParams` in `stripe-rails.ts`) for **document + matching selfie with live
capture** (Level 2 liveness, `PRODUCT_SPEC.md` §Identity Verification). Set the shortest
verification-data retention that compliance allows. Stripe holds the images and Projective never
does.

**D. A restricted API key** (`rk_…`; Dashboard → Developers → API keys → Create restricted key). The
permissions below are derived from the SDK calls in `services/finance/*`. Grant nothing else.

| Resource                            | Access                                      | Used by                                                                    |
| :---------------------------------- | :------------------------------------------ | :------------------------------------------------------------------------- |
| PaymentIntents                      | Write                                       | `paymentIntents.create` / `retrieve` (escrow, top-up, checkout, recurring) |
| SetupIntents                        | Write                                       | `setupIntents.create` / `retrieve` (save a card)                           |
| Customers                           | Write                                       | `customers.create`                                                         |
| PaymentMethods                      | Read                                        | `paymentMethods.retrieve`                                                  |
| Transfers                           | Write                                       | `transfers.create` / `list` (payouts, the stale sweep)                     |
| Balance transactions                | Read                                        | `balanceTransactions.list` with `Stripe-Account` (bank payout resolution)  |
| Identity verification sessions      | Write                                       | `identity.verificationSessions.create`                                     |
| Accounts (v2) and Account Links     | Write                                       | `v2.core.accounts.create` / `retrieve` · `v2.core.accountLinks.create`     |
| Connect (act on connected accounts) | As required by the balance-transaction read | `Stripe-Account` header calls                                              |

**E. Event destinations.** Three destinations, each pinned to API version `2026-08-26.dahlia`:

| #  | Destination       | Events from        | URL                                              | Events                                                                                                                                                                                                                                                                                                               | Secret → env                    |
| :- | :---------------- | :----------------- | :----------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------ |
| 1  | Snapshot: account | Your account       | `{APP_URL}/api/finance/webhooks/stripe`          | `payment_intent.succeeded` · `payment_intent.payment_failed` · `payment_intent.canceled` · `identity.verification_session.verified` · `.requires_input` · `.canceled` · `transfer.created` · `transfer.reversed` · `charge.dispute.created` · `charge.dispute.closed` · `account.updated` · `setup_intent.succeeded` | `STRIPE_WEBHOOK_SECRET`         |
| 2  | Snapshot: Connect | Connected accounts | the same URL (it verifies against either secret) | `account.updated` · `payout.paid` · `payout.failed`                                                                                                                                                                                                                                                                  | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| 3  | Thin events (v2)  | Your account       | `{APP_URL}/api/finance/webhooks/stripe-v2`       | `v2.core.account[configuration.recipient].capability_status_updated` · `v2.core.account.updated`                                                                                                                                                                                                                     | `STRIPE_THIN_WEBHOOK_SECRET`    |

**F. Payment method domains** (Settings → Payment method domains). Register every production and
staging origin for the Express Checkout Element (Apple Pay, Google Pay, PayPal). Apple Pay may also
need Stripe's domain-association file served at
`/.well-known/apple-developer-merchantid-domain-association`. Follow the Dashboard prompt, and add
the static route if it asks for one.

**G. Platform balance.** Transfers need **available** platform balance (`SYSTEM_ARCHITECTURE.md`
§1.3, step 5). Set the platform's own payout schedule so retained fees are swept without starving
transfers: manual, or a delay longer than the pending window (Decision #191).

**H. Runtime.**

1. Set `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, the three webhook secrets and
   `FINANCE_BACKEND_LIVE=true`.
2. Set `DENO_ENV=production` before a live key. The server refuses to boot otherwise.
3. Provision the Vault secrets `CRON_APP_URL` and `FINANCE_CRON_SECRET`, so that
   `finance-sweep-stale-payouts` and `finance-recurring-deposits` run (§9.3).

**I. Verification.**

1. Run the manual checklist in `SYSTEM_ARCHITECTURE.md` §1.3 against the sandbox.
2. In live mode, run one end-to-end path: a team-owned card funds a stage, a team member's real
   connected account approves and withdraws, then refund it. Record the run in the decision log.

### 4.4 Identity (Level 2) and KYB (Level 3)

- **Level 2.** `POST /api/finance/identity/session` → `begin_identity_verification` (refused after
  `identity_sessions_per_day`) → a Stripe VerificationSession → the client secret goes to Stripe.js
  → the webhook runs `apply_identity_event` → the `kyc_status` / `kyc_verified_at` / `payout_ready`
  cache. A verified case never regresses.
- **Level 3.** `POST /api/finance/verify/kyb` → `startKybOnboarding` → Connect onboarding for the
  business → `account.updated` → `org.business_profiles.kyb_*`. KYB gates **spending** from a
  Business Wallet, never top-ups (Decision #248 (k)).
- **Sanctions screening (PRODUCT_SPEC §AML).** Stripe Identity verifies a document and a face. **It
  is not a sanctions screen.** Screening happens in Stripe's **Connect** onboarding. The
  payout-ready gate (`finance.fn_freelancer_payout_ready`) requires **both** a verified Identity
  case **and** a verified payout account, so every earner and every KYB'd business passes Stripe's
  Connect screening. Individual clients are exempt by rule. This control belongs to Stripe. If
  enterprise buyers need Projective-side screening evidence, a dedicated screening vendor is a
  Growth decision.

### 4.5 Development and production fallbacks

| Condition                                                           | Behaviour                                                                                                                                                                                                |
| :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FINANCE_BACKEND_LIVE=false`                                        | `/wallet` answers deterministic fixtures and an in-module store. Nothing calls Stripe                                                                                                                    |
| Gate on, key absent, malformed or `XXXX-XXXX`                       | 503, "payments are not connected here"                                                                                                                                                                   |
| A live key (`sk_live_` / `rk_live_`) with `DENO_ENV` ≠ `production` | The server refuses to boot                                                                                                                                                                               |
| `STRIPE_API_BASE` set, a **test** key, not production               | Requests go to **stripe-mock**. stripe-mock has no `/v2/core/accounts`, so the smoke records Connect through the database doors                                                                          |
| `stripe listen`                                                     | One `whsec_` per session. Put the same value in `STRIPE_WEBHOOK_SECRET` and `STRIPE_THIN_WEBHOOK_SECRET`                                                                                                 |
| Development earning gate                                            | Dev Context Switcher → Money → Earning gate → `POST /api/finance/verify/force` (404 unless `DENO_ENV=development`). It writes synthetic `vs_dev_…` / `evt_dev_…` / `acct_DEV…`, which withdrawals refuse |
| A test-mode event on a live deployment, or the reverse              | Acknowledged and ignored                                                                                                                                                                                 |

```bash
docker run -d --name stripe-mock -p 12111:12111 stripe/stripe-mock
deno task smoke:stripe
stripe listen --forward-to localhost:3000/api/finance/webhooks/stripe --forward-thin-to localhost:3000/api/finance/webhooks/stripe-v2 --thin-events "v2.core.account[configuration.recipient].capability_status_updated,v2.core.account.updated"
```

---

## 5. AI and search: Voyage AI

**Authority:** `SYSTEM_ARCHITECTURE.md` §Discovery (Explore) services → "Semantic ranking" and
§Searching & Recommender System; Decision #179.

### 5.1 Architectural role and wiring

Voyage `voyage-4` produces 1024-dimension, unit-length vectors. Discovery blends them into its
heuristic ranking (`SEMANTIC_BLEND_WEIGHT`) and serves the `/view` "Similar" rail from them.

| Concern                         | File                                                                                                      |
| :------------------------------ | :-------------------------------------------------------------------------------------------------------- |
| The single switch               | `isEmbeddingsLive(req?)` in `packages/backend/core/supabase.ts` (gate logic in `core/embeddings-gate.ts`) |
| HTTP client (Voyage only, T5)   | `services/search/voyage-client.ts` (`VOYAGE_PLATFORM_EMBEDDINGS_URL`)                                     |
| Query embedding, cache, breaker | `services/search/EmbeddingBackendService.ts`                                                              |
| Text to embed                   | `packages/backend/core/embedding-text.ts`                                                                 |
| Post-commit re-embed            | `services/search/embedding-sync.ts` (30 s settle, `REEMBED_SETTLE_MS`)                                    |
| Backfill                        | `scripts/embeddings-backfill.ts` (`deno task embeddings:backfill`)                                        |
| Re-rank                         | `services/explore/semantic.ts` · `similarity-cache.ts`                                                    |

### 5.2 Data contract

- **Sent to the provider:**
  - for documents: the public projection only (`embedding-text.ts`): type label · title · category ·
    skills · tags · summary · search description, capped at 2,000 characters;
  - for queries: the normalised search text. A query shorter than 3 characters, or with no letter,
    is never sent.
  - Every call sends `model: "voyage-4"`, `input_type: "query" | "document"` and
    `output_dimension: 1024`.
- **Stored:** `embedding vector(1024)`, `embedding_model`, `embedding_hash` (the SHA-256 of the
  text) and `embedded_at`, in `search.profiles_index`, `projects_index`, `services_index` and
  `catalogue_index`.
- **Indexes:** HNSW `vector_ip_ops` on all four (`00004004_indexes_search.sql`). Inner product ranks
  as cosine because the vectors are unit length.
- **Doors:**
  - writes go through `search.fn_set_embedding`, service role only;
  - reads go through `search.fn_nearest` and `fn_nearest_to_entity`, which return ids and scores
    over public rows;
  - `anon` and `authenticated` cannot select a vector column.
- **Cache:** a per-isolate LRU (512 entries, 6 h), then Deno KV (7 days), under
  `["cache","embeddings",model,dims,"query",sha256(normalised)]`.
- **Excluded by rule:** private projects, messages and any non-public row. Minors are excluded
  structurally (§3.5).

### 5.3 Setup runbook

1. **The host is Voyage AI.** Every call goes to `https://api.voyageai.com` with a Voyage platform
   key (`pa-…`), whatever the key looks like (Decision #340, ruling T5; #339 (d)). MongoDB Atlas is
   not a processor. Set `VOYAGE_API_BASE` only to point the client at a mock.
2. Put `VOYAGE_API_KEY` in the host's secret store. It is server-only and never logged.
3. Run `deno task db:reset` (local) or apply the migrations (hosted) so that pgvector and the HNSW
   indexes exist.
4. Run **`deno task embeddings:backfill`**: once per environment, and again after every `db:reset`,
   which empties every vector.
5. Optional: run the server with `--unstable-kv` to share the query cache across isolates. Without
   it, `openSharedKv` answers `null` and only the memory layer runs.
6. Once Voyage's written no-training and retention terms are on file (ruling T5), set
   `EMBEDDINGS_ENABLED=true`.
7. Verify. In development, responses carry `x-discovery-ranking: semantic`, and
   `GET /api/explore/ranking` shows the effective state (404 in production).

**HNSW tuning.**

- The indexes use pgvector's default build parameters.
- If filtered searches return too few neighbours, raise `hnsw.ef_search` per transaction inside
  `search.fn_nearest` before rebuilding anything. HNSW post-filters, so a narrow category starves
  the candidate list.
- If the Supabase image ships pgvector 0.8 or later, `hnsw.iterative_scan` is the cleaner fix.
- Measure recall with the `/view` "Similar" rail before and after any change.

**Changing the model or the width.** Change `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS`, edit the
`vector(n)` columns in place, then reset and backfill. The KV namespace includes the model and
width, so stale cached vectors are never read.

### 5.4 Resilience

The full behaviour is in the SSOT. In outline:

- a timeout and a deadline;
- up to two retries on 5xx or network errors, and on 429 for documents only;
- a 429 on a query is returned at once with its `Retry-After`;
- a circuit breaker opens after 3 transient failures for 30 s (up to 5 min after a 429);
- a token bucket allows a burst of 20 and refills at 5 per second;
- an open breaker or an empty bucket refuses without touching the network, and the search ranks
  heuristically.

### 5.5 Development and production fallbacks

| Condition                                                   | Behaviour                                                                |
| :---------------------------------------------------------- | :----------------------------------------------------------------------- |
| `EMBEDDINGS_ENABLED=false`, or the key absent / placeholder | Byte-for-byte heuristic ranking. Nothing calls Voyage                    |
| Development, with `pj.dev.embeddings=on` / `off`            | Overrides the gate per browser. Production ignores the cookie            |
| `USE_MOCKS=true`                                            | Never live                                                               |
| Any Voyage or database failure                              | Heuristic ranking for that request, plus one `[embeddings]` log line     |
| Missing vectors (after `db:reset`)                          | The heuristic "Similar" rail; search ranks heuristically for those items |

---

## 6. Content moderation and upload safety: the safety node

> **As built (2026-10-30; Decision #345).** The node is its own repository, `Projective-Safety`
> ([`TRUST_SAFETY_BUILD_PROMPTS.md`](../architecture/TRUST_SAFETY_BUILD_PROMPTS.md) §8).
> Its route contract is that repo's `contract/openapi.yaml`: `GET /healthz`, `POST /scan/file`,
> `POST /screen/image`, `POST /screen/video`, `POST /presidio/analyzer/analyze`, and the
> `POST /remux/video` its N3 adds. Where this section's reference configuration and examples say
> `/v1/…`, the contract wins. Every verdict carries `{verdict, scores, model, version, ms}`; an
> engine failure is a typed `503` and a missing or wrong bearer a typed `401`, never a verdict. That
> repo's `compose.yaml`, `gateway/Caddyfile` and `clamav/clamd.conf` supersede §6.1's reference
> configuration. The app side is `TRUST_SAFETY_BUILD_PROMPTS.md` (Decision #340).

**Authority:** `SYSTEM_ARCHITECTURE.md` §Contact & financial leakage prevention (Decision #147),
§Content moderation: the Two-Zone model (Decision #148) and §Storage Lifecycle; `PRODUCT_SPEC.md`
§Messaging 1.A–1.C. Both decisions say the queue, the review table, the worker and the env keys are
**not yet designed**. Everything in §6 below is therefore **Proposed** unless it is marked
otherwise.

### 6.1 Topology, sizing and the compose file

**Proposal: one private VM** that runs every self-hosted classifier behind **one authenticated
internal endpoint**, as Decision #148 asks. No inference container is reachable from the internet,
and none keeps a payload after it answers.

| Service               | Image                                                                              | RAM (steady)                                                                         | CPU  | Internal port | Egress                 |
| :-------------------- | :--------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- | :--- | :------------ | :--------------------- |
| `gateway`             | `caddy:2`, pinned by digest                                                        | < 100 MB                                                                             | 0.25 | 8443          | none                   |
| `presidio-analyzer`   | `mcr.microsoft.com/presidio-analyzer`, pinned by digest                            | ~1.5–2 GB (spaCy `en_core_web_lg`)                                                   | 1–2  | 3000          | none                   |
| `presidio-anonymizer` | `mcr.microsoft.com/presidio-anonymizer`, pinned by digest                          | ~200 MB                                                                              | 0.5  | 3000          | none                   |
| `safety-api`          | Projective-built: FastAPI + NudeNet + Presidio Image Redactor + Tesseract + ffmpeg | ~1–1.5 GB                                                                            | 1–2  | 8080          | none (models baked in) |
| `clamav`              | `clamav/clamav:stable`, pinned by digest                                           | ~1.2 GB; about double during a signature reload unless `ConcurrentDatabaseReload no` | 1    | 3310          | `database.clamav.net`  |

**Sizing: 4 vCPU and 8 GB RAM.** The SSOT budget ("a 2 GB RAM VPS, ~$10–15/month") was set for
Presidio alone. Adding image screening, OCR and ClamAV does not fit in it. That is a cost-line
change for a human (flag (g)). The alternative is two nodes: text (Presidio) and media (safety-api

- ClamAV).

**Network and authentication.**

- The app reaches the node over a private link only: the cloud VPC, or WireGuard / Tailscale when
  the app runs elsewhere.
- The gateway binds the private interface, never `0.0.0.0`.
- Every request needs `Authorization: Bearer ${SAFETY_NODE_TOKEN}`. **mTLS is preferred** wherever
  the app's host can present a client certificate.
- clamd's TCP port is **not** exposed. Only `safety-api` reaches it, on the internal Docker network,
  so the node offers one HTTP surface.

```yaml
# Reference configuration. Pin every image by digest and fill each XXXX-XXXX before deploying.
# Run: docker compose --env-file .env.safety up -d   (.env.safety is never committed)
name: projective-safety

x-defaults: &defaults
  restart: unless-stopped
  security_opt: ["no-new-privileges:true"]
  logging:
    driver: json-file
    options: { max-size: "10m", max-file: "3" }

services:
  gateway:
    <<: *defaults
    image: caddy:2@sha256:XXXX-XXXX
    ports:
      - "${SAFETY_NODE_BIND_IP}:8443:8443" # the private interface; 127.0.0.1 in development
    environment:
      SAFETY_NODE_TOKEN: ${SAFETY_NODE_TOKEN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./tls:/etc/caddy/tls:ro # production only: the node certificate and key
    networks: [safety_internal]
    depends_on: [presidio-analyzer, presidio-anonymizer, safety-api]

  presidio-analyzer:
    <<: *defaults
    image: mcr.microsoft.com/presidio-analyzer@sha256:XXXX-XXXX
    environment:
      PORT: "3000"
    mem_limit: 2560m
    networks: [safety_internal]
    healthcheck:
      test: [
        "CMD",
        "python",
        "-c",
        "import urllib.request; urllib.request.urlopen('http://localhost:3000/health')",
      ]
      interval: 30s
      timeout: 5s
      retries: 3

  presidio-anonymizer:
    <<: *defaults
    image: mcr.microsoft.com/presidio-anonymizer@sha256:XXXX-XXXX
    environment:
      PORT: "3000"
    mem_limit: 512m
    networks: [safety_internal]

  safety-api:
    <<: *defaults
    build: ./safety-api
    image: projective/safety-api:XXXX-XXXX
    read_only: true
    tmpfs: ["/tmp:size=256m"]
    environment:
      CLAMD_HOST: clamav
      CLAMD_PORT: "3310"
      MAX_UPLOAD_BYTES: "67108864" # 64 MiB: above the largest bucket limit (50 MiB)
    mem_limit: 2048m
    networks: [safety_internal]
    depends_on: [clamav]

  clamav:
    <<: *defaults
    image: clamav/clamav:stable@sha256:XXXX-XXXX
    volumes:
      - ./clamd.conf:/etc/clamav/clamd.conf:ro
      - clamav_db:/var/lib/clamav # signatures only; never scanned content
    mem_limit: 3072m
    networks: [safety_internal, updates] # `updates` exists only so freshclam can reach the mirror

networks:
  safety_internal:
    internal: true # no route to the internet
  updates: {}

volumes:
  clamav_db: {}
```

```caddyfile
# Caddyfile. Development serves plain HTTP on 127.0.0.1. Production adds the tls line.
{
	auto_https off
}

:8443 {
	# tls /etc/caddy/tls/node.crt /etc/caddy/tls/node.key   # production
	@unauthorised not header Authorization "Bearer {$SAFETY_NODE_TOKEN}"

	route {
		respond @unauthorised 404
		request_body {
			max_size 64MB
		}
		handle_path /presidio/analyzer/* {
			reverse_proxy presidio-analyzer:3000
		}
		handle_path /presidio/anonymizer/* {
			reverse_proxy presidio-anonymizer:3000
		}
		handle /v1/* {
			reverse_proxy safety-api:8080
		}
		respond 404
	}
}
```

`route` keeps the directives in the order they are written. Without it, Caddy would sort `handle`
ahead of the `respond` that rejects an unauthenticated request. Validate the file with
`caddy validate` before each deploy.

```dockerfile
# safety-api/Dockerfile (reference). Pin every package to an exact version in requirements.txt.
FROM python:3.12-slim@sha256:XXXX-XXXX
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr ffmpeg libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 safety
WORKDIR /app
COPY requirements.txt .
# requirements.txt: fastapi, uvicorn, python-multipart, pillow, nudenet (v3), presidio-analyzer,
# presidio-image-redactor, all pinned with ==.
RUN pip install --no-cache-dir -r requirements.txt \
 && python -m spacy download en_core_web_lg \
 && python -c "from nudenet import NudeDetector; NudeDetector()"   # fetch the model at build time
COPY app/ ./app/
USER safety
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2", "--no-access-log"]
```

**Data-handling rules for the node.**

- No volume holds content. `clamav_db` holds signatures only.
- uvicorn's access log is off, and Presidio's log level stays at `WARNING`, so request text never
  reaches a log.
- `safety-api` writes temporary frames to `tmpfs` and deletes them before it answers.
- Images are rebuilt monthly for spaCy, NudeNet and Tesseract updates. A model upgrade is a deploy,
  not a runtime download.

### 6.2 Presidio: Tier 3 leakage scoring (asynchronous, review-only)

**Role.** Score obfuscated contact and payment intent that the regular expressions in Tier 2 miss:
spelled-out numerals, "name at domain dot com", split handles, payment handles, and confusables.
Tier 3 **never edits, deletes or delays a message**. Its output is evidence for the Consequences
ladder (`PRODUCT_SPEC.md` §Messaging 1).

**Wiring (Proposed).** This reuses the one scheduler, so no new runtime is added (Decision #203):

```text
comms.project_messages / comms.dm_messages
  └─ AFTER INSERT trigger (protected phase only: same predicate as Tier 2)
       └─ INSERT ops.moderation_queue (message_kind, message_id, reason: 'unmasked' | 'near_miss')
pg_cron ── ops.scheduled_jobs 'moderation-drain' (every minute, http)
  └─ POST /api/ops/cron/moderation?limit=100   Authorization: Bearer MODERATION_CRON_SECRET
       └─ ModerationBackendService.drainQueue()        (services/moderation/, service role)
            1. lease rows: FOR UPDATE SKIP LOCKED, leased_until = now() + 2 min
            2. read the stored body (already Tier-2 masked) through the service client
            3. normalise: NFKC → strip zero-width → fold confusables (Unicode TR39 confusables.txt),
               keeping an offset map back to the original text
            4. POST {SAFETY_NODE_URL}/presidio/analyzer/analyze
            5. score (below) → over threshold: one review row (source 'automated') + evidence
            6. delete the queue row, or record the attempt and back off on failure
```

**Schema it needs.** Each lands with its migration (edited in place), its Zod schema and its
`documentation/database/ops/*` entry in one change:

- `ops.moderation_queue`: `id`, `message_kind`, `message_id`, `reason`, `enqueued_at`, `attempts`,
  `leased_until`, `last_error`.
- **The review sink.** The proposed `ops.reports` shape (`SYSTEM_ARCHITECTURE.md` §Content
  moderation) has `reporter_user_id` as an FK to a person. An automated finding has no reporter.
  Either add `source text CHECK (source IN ('user','automated'))` and make `reporter_user_id`
  nullable only when `source = 'automated'`, or keep a separate `ops.moderation_findings` table.
  This is a schema decision for a human (flag (g)).

**The analyzer request contract.** Projective's recognisers travel per request as
`ad_hoc_recognizers`. They are version-controlled in TypeScript next to `comms.mask_pii`'s patterns,
and no custom analyzer image is needed.

```json
{
	"text": "<normalised message body>",
	"language": "en",
	"score_threshold": 0.35,
	"entities": [
		"EMAIL_ADDRESS",
		"PHONE_NUMBER",
		"URL",
		"CREDIT_CARD",
		"IBAN_CODE",
		"CRYPTO",
		"PJ_OBFUSCATED_EMAIL",
		"PJ_SPELLED_NUMBER",
		"PJ_PAYMENT_HANDLE"
	],
	"ad_hoc_recognizers": [
		{
			"name": "pj_obfuscated_email",
			"supported_language": "en",
			"supported_entity": "PJ_OBFUSCATED_EMAIL",
			"patterns": [{
				"name": "at-dot",
				"regex": "\\b[\\w.+-]{2,}\\s*[\\[(]?\\s*(?:at|@)\\s*[\\])]?\\s*[\\w-]{2,}\\s*[\\[(]?\\s*(?:dot|\\.)\\s*[\\])]?\\s*[a-z]{2,}\\b",
				"score": 0.6
			}],
			"context": ["email", "mail", "reach", "contact", "write"]
		},
		{
			"name": "pj_spelled_number",
			"supported_language": "en",
			"supported_entity": "PJ_SPELLED_NUMBER",
			"patterns": [{
				"name": "seven-plus-words",
				"regex": "\\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)[\\s,.-]*){7,}\\b",
				"score": 0.55
			}],
			"context": ["call", "text", "whatsapp", "phone", "number", "signal", "telegram"]
		},
		{
			"name": "pj_payment_handle",
			"supported_language": "en",
			"supported_entity": "PJ_PAYMENT_HANDLE",
			"patterns": [
				{ "name": "cashtag", "regex": "(?<![\\w$])\\$[A-Za-z][A-Za-z0-9_]{2,19}\\b", "score": 0.5 },
				{
					"name": "pay-link",
					"regex": "\\b(?:paypal\\.me|venmo\\.com|cash\\.app|wise\\.com/pay|revolut\\.me|ko-fi\\.com)/\\S+",
					"score": 0.85
				}
			],
			"context": ["pay", "send", "transfer", "invoice", "outside", "direct"]
		}
	]
}
```

The response is an array of `{ entity_type, start, end, score }`. The worker maps each span back
through the offset map and stores the **category and score**, not the span text. The evidence
snapshot is built server-side from the stored row (the SSOT reporting workflow).

**Scoring.** `leakage = max over findings of (score × category_weight)`. A row goes to review when
`leakage ≥ moderation_tier3_review_threshold`. Thresholds and weights live in
`security.platform_params` (**Proposed** keys: `moderation_tier3_review_threshold`, starting at
`0.65`, and `moderation_tier3_category_weights`). They are tunable configuration, not code (Decision
#148).

**Languages.** The official analyzer image is English only. Projective supports RTL locales and
global currencies. Before launching a non-English market:

- build a derived analyzer image with an NLP config that adds a spaCy model per launch language (or
  a multilingual model);
- send the sender's locale (`org.user_preferences`) as the `language` hint.

Until then, a non-English message is scored by the pattern recognisers only. Record that as a known
gap.

**The Anonymizer's role** is narrow and optional. It produces a **redacted excerpt** wherever a
flagged message is shown to someone who is not a trust-and-safety operator: the "your message was
flagged" notice, and any sample exported for threshold tuning. Operators see the server-built
evidence snapshot, never the anonymised one.

```json
{
	"text": "<excerpt>",
	"analyzer_results": [
		{ "entity_type": "PJ_OBFUSCATED_EMAIL", "start": 14, "end": 39, "score": 0.82 }
	],
	"anonymizers": { "DEFAULT": { "type": "replace", "new_value": "[contact hidden]" } }
}
```

### 6.3 NudeNet and image OCR: the publication gate

**Role.** Screen every object **before** it is written to a public bucket (`avatars`, `showcase`,
`catalogue`, `public_assets`). Screening happens at publication, never in quarantine, so the private
zone stays exempt (Decision #148).

**Hook points:**

- `MediaBackendService`'s rendition cut into `avatars` / `showcase` (`services/media/`);
- the catalogue media writes (`/api/catalogue/media*`) once they move behind the pipeline (Decision
  #148 flag (b));
- every `public_assets` write except re-hosted favicons, which are already image-sniffed and capped
  at 64 KiB.

The gate runs on the **decoded** still from `image-worker.ts`. For a video it runs on the poster
plus sampled frames.

**The contract (`safety-api`).**

```http
POST /screen/image HTTP/1.1
Authorization: Bearer XXXX-XXXX
Content-Type: multipart/form-data; boundary=…

image=<decoded PNG/WebP of the original, longest edge ≤ 1280 px>
purpose=avatar|showcase|catalogue|public_asset
moderation_image_thresholds=<optional JSON: the platform_params value; absent → the node's env defaults>
```

A video or GIF goes to `POST /screen/video` (`video`, `purpose`, the same optional
`moderation_image_thresholds`) instead; the node samples its frames per ruling T2 (Decision #340).
Both answer the same envelope:

```json
{
	"verdict": "flagged",
	"scores": {
		"frames": 1,
		"categories": [{ "label": "FEMALE_BREAST_EXPOSED", "score": 0.81, "frame": 0 }],
		"text_entities": [{ "entity_type": "PHONE_NUMBER", "score": 0.74, "frame": 0 }]
	},
	"model": "nudenet+ocr",
	"version": { "nudenet": "3.x / 320n", "ocr": "presidio-image-redactor x.y + tesseract z" },
	"ms": 412
}
```

**Policy.** Thresholds live in `security.platform_params` `moderation_image_thresholds`
(**Proposed**). The app sends them with each request, and the node decides with them; the node's env
holds the table below as the fallback when the field is absent (Decision #345 (e)). A starting
point:

| Signal                                                                                                       | Default threshold | Verdict                                                     |
| :----------------------------------------------------------------------------------------------------------- | :---------------- | :---------------------------------------------------------- |
| `FEMALE_GENITALIA_EXPOSED` · `MALE_GENITALIA_EXPOSED` · `ANUS_EXPOSED`                                       | 0.45              | `flagged`                                                   |
| `FEMALE_BREAST_EXPOSED` · `BUTTOCKS_EXPOSED`                                                                 | 0.60              | `flagged`                                                   |
| Any covered or face label                                                                                    | n/a               | ignored                                                     |
| OCR text entity `EMAIL_ADDRESS` · `PHONE_NUMBER` · `URL` · `CREDIT_CARD` · `IBAN_CODE` · `PJ_PAYMENT_HANDLE` | 0.60              | `flagged` (the public-copy contact ban, Decision #147 §1.B) |

**Outcomes** follow `SYSTEM_ARCHITECTURE.md` §Content moderation, steps 1–4:

- **clean:** cut the tiers, write the object, attach it;
- **flagged:** write no public object, answer 422 with the category, send a correction notice (a
  `comms.fn_notify` type added to the catalog seed), and leave the library original `uploaded`;
- **unavailable:** answer 503, retryable. Nothing publishes unscreened.

**Verdict record (Proposed).** `files.publication_screenings`: `id`, `item_id`, `purpose`,
`verdict`, `scores jsonb` (Zod-typed; the response's `scores`), `model_versions jsonb` (its
`version`), `decided_at`, `actor_user_id`. Every verdict is kept so that a disputed refusal can be
audited (Decision #148). It lands with its migration, Zod schema and
`documentation/database/files/*` entry.

**Hosted fallback.** OpenAI moderation or Sightengine stays **off by default**, per the SSOT. If it
is ever enabled, it receives public-bound images only and becomes a listed sub-processor (§3.4).

### 6.4 ClamAV (and VirusTotal): upload hygiene

**Role.** Run a real anti-virus scan between the magic-byte sniff and promotion out of quarantine.
`documentation/database/files/Storage.md` §Deferred already names this as the gap.

**Hook points (Proposed):**

- `services/files/live-uploads.ts` `completeUpload`: after `sniffBytes(...)` refuses executables and
  before the promote;
- `services/contact/live-attachments.ts`: after `classifyContactBytes`;
- `services/media/library.ts` (library originals).

The bytes are already in memory (`downloadObject("quarantine", …)`), so the scan adds one internal
request and no extra storage read.

**The contract.**

```http
POST /scan/file HTTP/1.1
Authorization: Bearer XXXX-XXXX
Content-Type: application/octet-stream
X-Content-SHA256: <hex>
Content-Length: <n>

<file bytes>
```

```json
{
	"verdict": "infected",
	"signature": "Eicar-Test-Signature",
	"flags": [],
	"scores": {},
	"model": "clamav",
	"version": { "clamav": "1.x", "db_version": "27xxx", "db_time": "2026-10-29T03:12:00Z" },
	"ms": 38
}
```

`safety-api` streams the body to clamd with the `zINSTREAM` command: 4-byte big-endian
length-prefixed chunks, ended by a zero-length chunk. It maps `stream: OK` to `clean` and `… FOUND`
to `infected`. `INSTREAM size limit exceeded` answers a typed `413` and a socket error a typed
`503`; neither is a verdict (Decision #345).

**Status mapping.** Use the existing helpers and the real enum (`files.file_status`:
`pending_upload` · `scanning` · `uploaded` · `error` · `quarantined`):

| Verdict                                       | Action                                                                                                                             |
| :-------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `clean`                                       | Continue to the promote                                                                                                            |
| `infected`                                    | `refuse(row, hostile = true, …)`: the quarantine object is deleted and the row becomes `quarantined` with a person-readable reason |
| `503` / unreachable, `MALWARE_SCAN_LIVE=true` | `markRow(id, "pending_upload")` and answer 503. The client retries `uploadComplete`                                                |
| `MALWARE_SCAN_LIVE=false`                     | Skip, as today, and log one line per upload in development                                                                         |

**`clamd.conf` essentials.**

- `StreamMaxLength 64M` and `MaxFileSize 64M`: at or above the largest bucket limit.
- `MaxScanSize 256M` and `MaxRecursion 16`: archive bombs.
- `ConcurrentDatabaseReload no`, to halve peak memory at the cost of a short pause.
- `AlertEncrypted no`. Password-protected archives are a normal creative deliverable. Record them,
  don't refuse them. A human can tighten this.
- freshclam runs inside the image. Alert when `db_time` is older than 48 h: the app writes an
  `ops.log_entries` `warn` row with `scope = 'files.malware_scan'`. Not 24 h: the daily database is
  published about once a day, so a healthy node's `db_time` is already past 24 h just before the
  next release (Decision #345).

**VirusTotal: hash lookups only, and only under a Premium licence.**

- The public VirusTotal API is licensed for non-commercial use and rate-limited.
- **Uploading** a file shares it with VirusTotal's community, which would publish a client's private
  file. Never call `POST /files`.
- If a second opinion is ever wanted, call `GET https://www.virustotal.com/api/v3/files/{sha256}`
  with `x-apikey`, which sends a hash only, and only under a Premium agreement. Recommendation:
  **leave it off for the MVP.** `VIRUSTOTAL_API_KEY` stays out of the env contract.

**Development.** Upload the EICAR test file and expect `quarantined`. Set `pj.dev.malware` to
exercise each branch without the node.

### 6.5 Link safety: Google Web Risk

**Built (Decision #128, #314):**

- `link-guards.ts`: refuses IP literals, credentials in the URL, look-alike hosts, non-standard
  ports, and loopback, link-local (including `169.254.169.254`), private, CGNAT, unique-local,
  multicast, reserved and unspecified ranges, including mapped, NAT64, 6to4 and Teredo forms.
- `link-fetch.ts`: `https:` only. Resolves DNS first and refuses the whole host if **any** answer is
  forbidden (the DNS-rebinding guard). Then connects to the **pinned, checked address** with
  `Deno.connect` + `Deno.startTls`, so SNI and certificate checks still name the host. Re-validates
  every redirect (2 at most), has a 5 s deadline and a stream-enforced 512 KiB cap.
- `link-favicon.ts`: **re-hosts** the favicon into `public_assets` (the same guarded fetch, an image
  sniff, 64 KiB) so viewers' IP addresses never reach the link author's host.
- Verdict cache: safe 1 h · flagged 24 h, never past the listing's `expireTime` · unscannable 10
  min. A link stays `pending` behind `/exit` until the service role writes `safe`.

**Why Web Risk (flag (c), ruling T5).** Google licenses the Safe Browsing APIs for
**non-commercial** use and points commercial users to the **Web Risk API**. Projective is
commercial, so `services/files/link-reputation.ts` calls Web Risk. The env name
`LINK_SAFETY_API_KEY` is provider-neutral and stayed.

| Item     | Before (Safe Browsing v4)                                        | Built (Web Risk)                                                                                                                               |
| :------- | :--------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint | `POST https://safebrowsing.googleapis.com/v4/threatMatches:find` | `GET https://webrisk.googleapis.com/v1/uris:search?uri=<enc>&threatTypes=MALWARE&threatTypes=SOCIAL_ENGINEERING&threatTypes=UNWANTED_SOFTWARE` |
| Auth     | `?key=` query                                                    | `x-goog-api-key` header (keeps the key out of URL logs)                                                                                        |
| Clean    | `{}`                                                             | `{}`                                                                                                                                           |
| Listed   | `{ matches: [{ threatType }] }`                                  | `{ threat: { threatTypes: [...], expireTime } }`; the flagged-verdict TTL is capped at it                                                      |
| Timeout  | 2.5 s → `unavailable`                                            | unchanged                                                                                                                                      |

**Setup.**

1. Create a Google Cloud project per environment and enable billing (Web Risk has a free monthly
   tier; check current pricing).
2. Enable the **Web Risk API**.
3. Create an API key **restricted to the Web Risk API** and to the app's egress IPs. Store it in
   `LINK_SAFETY_API_KEY`.
4. Set `FILES_BACKEND_LIVE=true` for the live fetch path.

**Development.** With `FILES_BACKEND_LIVE=false` the scan is offline: the Safe Browsing test host is
`blocked`, a suspicious shape is `suspicious`, `http:` is `unscannable`, and anything else is
`safe`. No network is touched.

### 6.6 Development and production summary for the safety node

| Environment            | Presidio Tier 3                                              | Publication gate                            | Malware scan                            |
| :--------------------- | :----------------------------------------------------------- | :------------------------------------------ | :-------------------------------------- |
| `dev:mock` / gates off | No queue drained                                             | `pj.dev.moderation` decides; `auto` = clean | `pj.dev.malware` decides; `auto` = skip |
| `dev` + local node     | `docker compose up`; `SAFETY_NODE_URL=http://127.0.0.1:8443` | Real verdicts                               | Real clamd, EICAR test                  |
| Staging                | Real node, shadow mode (reviews created, nobody notified)    | Enforced                                    | Enforced                                |
| Production             | Enforced                                                     | Enforced, fail closed                       | Enforced, fail closed                   |

---

## 7. Third-party connectors: calendar, conferencing and storage

**Authority:** `SYSTEM_ARCHITECTURE.md` §Integration Blueprints 2 and 3 (the substrate, the
four-system boundary, deferred Edge parts), §Asset Management → the connector adapter interface and
the token vault; Decisions #59, #313 and #314;
[`database/integrations/`](../database/integrations/Tables.md).

### 7.1 The consent handshake

`IntegrationsBackendService.startConnection` / `completeConnection`, with the provider's half in
`services/integrations/oauth.ts` and everything a provider differs on in `providers.auth_config`:

```text
1. POST /api/integrations/start { providerSlug, kinds[], returnTo }
     → refuse unless INTEGRATIONS_BACKEND_LIVE, providers.is_enabled, and the client id/secret are well formed
       (the catalogue read applies the same test, so a provider that would refuse is never offered)
     → state = base64url(32 random bytes); verifier = base64url(32 random bytes); challenge = S256(verifier)
     → integrations.fn_open_consent(state, provider_slug, code_verifier, requested_kinds, return_to)
          under the caller's JWT, so the row binds to auth.uid(); it sets expires_at = now() + 10 min
     → 200 { authorizeUrl, state, expiresAt }
2. The provider's consent screen → GET /api/integrations/callback?code=…&state=…
3. completeConnection
     a. UPDATE consent_states SET consumed_at = now()
          WHERE state = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING *   -- single use
        and refuse unless this browser is signed in as consent_states.user_id           -- state binds no browser
     b. exchange the code (+ verifier) at the token endpoint                            -- network, before any DB write
     c. read the account identity (external_account_id, email) and the GRANTED scopes; record a narrowed consent
     d. token-vault.seal(...) the row's tokens                                          -- §9.4
     e. integrations.fn_store_connection: one transaction, user_connections (status 'active')
        + connection_secrets + connection_audit 'connected'
     f. if (c), (d) or (e) fails: revoke the just-issued grant at the provider (best effort) so no orphan grant outlives us
4. 302 → consent_states.return_to (CHECK-constrained same-origin path), else /settings, with ?connect=connected|failed
```

Each ciphertext's AAD names the connection, so its id must exist before the seal. Step (d) seals under
a new id, and when the account is already linked `fn_store_connection` writes nothing and answers the
row's id, for one more pass under it. A fresh consent therefore reopens an `expired` or `revoked` row.

**The redirect URI** registered at every provider is `{APP_URL}/api/integrations/callback`. There is
one URI for every provider, because the `state` row identifies the provider. Locally that is
`http://localhost:3000/api/integrations/callback`. Zoom may insist on an HTTPS redirect. If it does,
use a tunnel (`cloudflared tunnel` or similar) for local Zoom consent.

### 7.2 Calendar strategy: direct (ruled, Decision #383 R1)

The provider seed (`00005050_seed_reference_data.sql`) set `broker = 'nylas'` for `google`,
`outlook` and `apple`, and `SYSTEM_ARCHITECTURE.md` §3.2 said "Calendar → a unified API (Nylas)".
This brief asked for **direct** Google Calendar / Meet, Microsoft Graph and Zoom integrations.

| Option                           | For                                                                                                                                                                                    | Against                                                                                                                                                                                                             |
| :------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Direct** (Google, Graph, Zoom) | No extra sub-processor holding every connected calendar. No per-connected-account fee. MVP scope is small: read-only inbound free/busy + create one meeting. Zoom is direct regardless | Google push-channel and Graph subscription renewal, recurrence and timezone edge cases, and app verification at two vendors are owned in-house                                                                      |
| **Nylas** (seeded today)         | One API for Google, Microsoft, iCloud (the only practical route for Apple CalDAV), with recurrence and renewal solved                                                                  | A per-account cost that scales with sellers. Every connected calendar's tokens are held by a third party, which weakens the "tokens are KMS-enveloped" trust claim. A broker for meeting creation is still optional |

**Ruled: direct (Decision #383, ruling R1).** Sync is two one-way flows (ruling R3), so the
recurrence and conflict work that would pay for a broker never arises. Apple (`app_password`,
CalDAV) stays deferred, and keeps its seeded `nylas`. `google` and `outlook` are `direct`; a later
switch is per-provider data with no schema change.

### 7.3 Google (Calendar, Meet, Drive)

**Setup.**

1. Create a dedicated Google Cloud project, `projective-integrations-<env>`. It is **separate from
   the sign-in client** (`GOOGLE_CLIENT_ID`), because sign-in and integrations never share a client
   or a token store (SSOT §3.1).
2. Enable the **Google Calendar API**, the **Google Meet REST API** and the **Google Drive API**, and
   the **Google Picker API** in the Growth phase. Without the Meet API a connection works and every
   Meet room fails. Without the Drive API a connection works and every read of it answers 403
   `accessNotConfigured`, which the hub words as browsing not being available here yet.
3. OAuth consent screen: External; the app name, logo, support email, authorised domains, and
   privacy policy and terms URLs; the scopes below.
4. Credentials → OAuth client ID → Web application. Add one redirect URI per environment. Store the
   pair in `GOOGLE_INTEGRATION_CLIENT_ID` / `GOOGLE_INTEGRATION_CLIENT_SECRET`.
5. **Verification:**
   - `calendar.events.owned.readonly` is a **sensitive** scope. It needs brand and scope verification
     before the consent screen leaves testing.
   - `drive.readonly`, which is seeded today, is a **restricted** scope. It needs an annual
     third-party security assessment (CASA).
   - **Recommendation (flag (i)):** use `drive.file` with the **Google Picker**, so a person grants
     the specific files they pick. That avoids the restricted tier entirely and fits the hub's "find
     and attach what you already have" purpose (Decision #313). It cannot list a person's folders, so
     the `/files` tree (Decision #394) ships on `drive.readonly` until the owner rules (flag (b)).
6. **While the consent screen is in Testing**, refresh tokens expire after 7 days and only listed
   test users can consent. Plan development around that.

**Scopes** (Decisions #383, #387): `openid` and `email` (to set `external_account_id`),
`calendar.events.owned.readonly` to read busy time and each entry's details from the calendars a
person owns, `calendar.app.created` to write the separate
Projective calendar, `meetings.space.created` to mint rooms, and `meetings.space.readonly` if
reading attendance needs it. Request `access_type=offline` and
`prompt=consent` on the first connection so a refresh token is issued. Add
`include_granted_scopes=true` so a later Drive consent adds to the grant instead of replacing it.

**Meet rooms** (Decision #383, rulings R3 and R5; Decision #392). Call
`POST https://meet.googleapis.com/v2/spaces` with `config.accessType = OPEN` on a free room, so an
attendee can enter without the host, and `RESTRICTED` on a paid one: only invitees skip the knock and
Projective adds none, so everyone knocks and the host admits them. A paid room reads `guarded` only
if the `config` in Google's answer says `RESTRICTED`. This writes nothing to
the host's calendar, so nothing comes back through inbound sync. No idempotency key is documented:
store `name` and `meetingUri` as soon as they return, and treat a stray duplicate space as harmless,
because only the stored one is ever used. Store the join link in `scheduling.events.meeting_url`,
which the column grants withhold from every client role; parties read it through
`scheduling.get_event_rooms`. How `OPEN`, `RESTRICTED` and conference records behave on a personal
Gmail account is not documented, so test it before promising it.

**Push and sync.**

1. `events.watch` → a `webhook_subscriptions` row: `external_channel_id`, `external_resource_id`,
   `verification_token` = 32 random bytes, and `expires_at` from the response's `expiration`. The
   sync job opens one for a calendar that has none. A plain http `APP_URL` opens none, and that
   calendar is read hourly.
2. An inbound `X-Goog-Channel-Token` must equal the stored token.
3. A verified push marks the calendar due, and the job makes an incremental `events.list` with the
   `syncToken` kept in `connection_sync_state`. A `410 Gone` runs a full read, which replaces
   everything it does not see. `fields` asks for the title, location, description, meeting link
   (`hangoutLink`, else the video entry of `conferenceData`, which is where an add-on such as Zoom
   writes it) and `recurringEventId`, and leaves attendees off the wire. `singleEvents=true` brings recurring series
   expanded, so an occurrence does not carry its `recurrence`, and `events.get` reads it once per
   series from the master (at most 100 a read; a miss costs that sentence, never the read).
4. `timeMin`/`timeMax` cannot go with a `syncToken`, so only a full read has a window: a day back and
   372 ahead, which passes the longest `max_advance_days`. A full read comes round weekly, because an
   old event enters the window with no change to report.

**The Projective calendar** (ruling R3). `calendars.insert` makes it under `calendar.app.created`, a
scope that reaches only calendars the app created, so deleting it on disconnect cannot touch anything
else. That scope cannot list calendars, so a lost response leaves one stray empty calendar. The event
id is the mirror row's uuid without its hyphens (hex is inside Google's base32hex alphabet), so a
retried `events.insert` answers `409` and becomes an update, and a person's deletion answers `404` on
the next update and becomes an insert.

**Tokens.**

- Refresh with `grant_type=refresh_token`.
- `invalid_grant` sets the connection to `expired` and raises a reconnect notification.
- Revoke with `POST https://oauth2.googleapis.com/revoke?token=…` on disconnect and on erasure. A
  revoke ends the person's whole grant to the client, so disconnecting `google` or `google_drive`
  skips it while the other stands (`sharesGoogleGrant`, Decision #394).

### 7.4 Microsoft Graph (Outlook calendar, Teams, OneDrive / SharePoint)

**Setup.**

1. Microsoft Entra admin centre → App registrations → New registration: "Projective Integrations
   (<env>)". Supported account types: **any organisational directory and personal Microsoft
   accounts** (authority `common`).
2. Add a Web redirect URI per environment.
3. Credentials: prefer a **certificate**. Otherwise create a client secret and put a calendar
   reminder before it expires (24 months at most). Store them in `MICROSOFT_INTEGRATION_CLIENT_ID` /
   `MICROSOFT_INTEGRATION_CLIENT_SECRET`.
4. Delegated API permissions: `User.Read`, `offline_access`, `Calendars.ReadBasic` (busy time, titles,
   locations, `onlineMeeting` and `seriesMasterId`; a body is outside it, and a series states no
   pattern yet),
   `Calendars.ReadWrite` (the Projective calendar), `OnlineMeetings.ReadWrite`,
   `OnlineMeetingArtifact.Read.All` (attendance reports), and `Files.Read.All` (OneDrive, Growth).
   Without `offline_access` no refresh token is issued.
5. Complete **Publisher verification** (a Microsoft Partner ID). Many tenants block user consent to
   unverified multi-tenant apps.
6. Admin consent: if a tenant requires it, surface `consent_required` / `AADSTS65001` as "ask your
   IT admin", with the tenant admin-consent URL.

**Graph specifics.**

- **Refresh tokens rotate on every refresh.** Persist the new token in the same transaction that
  reads the old one, or a concurrent refresh strands the connection (SSOT §3.3).
- **Teams rooms** (Decision #383, rulings R3 and R4; Decision #392).
  `POST /me/onlineMeetings/createOrGet` with `externalId` set to the room id: a retry returns the same
  meeting, and the meeting does not appear on the host's calendar. `createOrGet` takes no lobby
  setting, so a `PATCH` then sets `lobbyBypassSettings`. A free room gets `scope: everyone` so an
  attendee can enter without the host (ruling R5). A paid room gets `scope: organizer` with
  `isDialInBypassEnabled: false`, because dial-in would otherwise skip the lobby. A tenant may forbid
  the `PATCH`, which leaves the room working and the attendee's join click as their evidence, and a
  paid room then does not read `guarded`. Work and school accounts only: a personal account gets no
  Teams room, and the picker says so.
- **Teams attendance.** After the meeting, read `attendanceReports` as the organizer
  (`OnlineMeetingArtifact.Read.All`). Personal accounts are not supported and there is no live feed,
  so Teams evidence arrives only after the meeting (Decision #383 (c)).
- **Subscriptions.**
  1. `POST /subscriptions` on `/me/events` with `clientState` (32 random bytes, stored as
     `verification_token`), a `notificationUrl` and a `lifecycleNotificationUrl`. Graph documents no
     narrower path for events, so a write to the Projective calendar can push too: it only marks a
     read of the primary calendar due, and that finds nothing. Subscribing wants `Calendars.Read` or
     better, so a grant of `Calendars.ReadBasic` alone stays on the hourly read.
  2. Answer the `validationToken` handshake by echoing it as `text/plain` within Graph's deadline.
  3. Renew by `PATCH`ing `expirationDateTime` before `expires_at`. Graph caps the lifetime per
     resource type, so store whatever it returns. A `404` means Graph dropped it, so a new one opens
     on the same row.
  4. A delivery may batch several subscriptions, each with its own `clientState`, so it is judged per
     subscription. `reauthorizationRequired` and `subscriptionRemoved` bring the renewal forward, and
     `missed` only marks the calendar due, like any push.
- **Busy time.** `GET /me/calendarView/delta` on the primary calendar, the window fixed by the first
  call, with `@odata.deltaLink` kept in `connection_sync_state` and followed only to Graph's origin.
  It takes no `$select`, so a title does arrive here, and goes no further than the adapter's mapping
  (`graphChange`). `isCancelled`, `@removed` and a `showAs` of `free` or `workingElsewhere` remove the
  row. A `410` runs a full read.
- **The Projective calendar** (ruling R3). `POST /me/calendars`. A name already taken makes a
  `Projective events` calendar instead: a person's own calendar is never adopted, because disconnect
  deletes the calendar it holds. `transactionId` on the create makes a retry land on the same event,
  and `changeKey` is stored as the version. A copy deleted at the provider answers `404` on the next
  `PATCH` and is made again under a new `transactionId`.
- **OneDrive.** The adapter exists. A cursor is the `@odata.nextLink` **path**, followed only
  against Graph's fixed origin (Decision #313).

### 7.5 Zoom

**Setup.**

1. Zoom App Marketplace → Develop → Build App → **General app** (OAuth), user-managed.
2. Add the OAuth redirect URL and the allow list. Store the credentials in `ZOOM_CLIENT_ID` /
   `ZOOM_CLIENT_SECRET`.
3. **Scopes.** Add Zoom's granular `meeting:write:meeting`, `meeting:read:meeting`,
   `meeting:update:meeting`, `meeting:delete:meeting`, `meeting:write:registrant`,
   `meeting:write:batch_registrants`, `meeting:read:list_past_participants` and `user:read:user` to
   the Marketplace app. Zoom takes scopes from the app and answers "Invalid scope" to any in the
   authorize URL, so the seed sets `send_scopes: false`. Only `meeting:write:meeting` is required to
   connect: without the others a room still works, with a best-effort sync, the shared link, and
   sittings held for review. Without `meeting:write:batch_registrants`, which also means any connection
   made before the app gained it until its host reconnects, a paid room on a licensed host gets a
   waiting room instead of approved registrants.
4. **Event Subscriptions**:
   - endpoint: `{APP_URL}/api/integrations/webhooks/zoom`. The old
     `{APP_URL}/api/sessions/webhooks/zoom` re-exports the same handler until the app is re-pointed;
   - events: `meeting.participant_joined`, `meeting.participant_left`,
     `meeting.participant_jbh_waiting` (Pro or above) and
     `meeting.participant_joined_waiting_room`, plus `app_deauthorized`
     (revokes the connection and deletes its secrets, which Marketplace review requires);
   - copy the Secret Token into `ZOOM_WEBHOOK_SECRET` and run the URL validation. The handler
     answers the challenge only after a verified signature.
5. **Before external users can install:** submit for Marketplace review (privacy policy, data
   retention, deauthorisation handling, a security questionnaire).

**Rooms and presence.**

- `POST https://api.zoom.us/v2/users/me/meetings` with
  `{ topic, type: 2, start_time, duration, timezone, settings }`. What `settings` holds depends on
  whether money turns on the room (`scheduling.fn_room_facts`) and on the host:

  | Room                                                 | `approval_type` | `join_before_host` | `waiting_room` | A copied plain link            |
  | :--------------------------------------------------- | :-------------- | :----------------- | :------------- | :----------------------------- |
  | Free, licensed host                                  | `0`             | `true`             | `false`        | Gets in                        |
  | Free, Basic host                                     | `2`             | `true`             | `false`        | Gets in                        |
  | Paid, licensed host, batch scope granted             | `1`             | `true`             | `false`        | A form nobody approves         |
  | Paid, Basic host, or a licensed host without the scope | `2`           | `false`            | `true`         | The waiting room, then the host |

  A free room lets an attendee in without the host (Decision #383, ruling R5). A paid room keeps out
  whoever merely holds its link (Decision #392). Zoom documents that an enabled waiting room disables
  `join_before_host`, so nobody enters that room until the host does. An approving room also sets
  `allow_multiple_devices: false`, so a personal link passed on is in the room on one device at a
  time. A room reads `guarded` only if the `settings` in Zoom's answer confirm it, because an account's
  own locks can overrule a request.
- **Approving a registrant.** At a person's first join, `POST /meetings/{id}/batch_registrants` with
  `{ auto_approve: true, registrants_confirmation_email: false, registrants: [{ email, first_name }] }`.
  `POST /meetings/{id}/registrants` takes `auto_approve` too, but its answer leaves out `join_url` on
  a manual-approval meeting, so the batch endpoint is the one call that approves and gives the link.
  It needs a licensed host and a scheduled meeting, and its rate-limit label is `HEAVY`. If no personal
  link can be made, `/meet` answers try again rather than the room's plain link (`link_required`); the
  press of join is already on record by then.
- **Reading attendance after a meeting.** `GET /past_meetings/{id}/participants` needs Pro or above.
  Basic answers `400` with code `200`, a failed read, so a Basic host's room is never stamped as read
  and a no-show there holds for review (ruling R5; Decision #392). `404` with code `3001` is a meeting
  that never ran. `GET /past_meetings/{id}/instances` lists no plan limit but is no way round this:
  Zoom's staff report that it omits one-person meetings, so a host alone would read as absent. The
  participants call also omits one-person meetings by default (Decision #392, flag (j)).
- Store the `join_url` and the passcode in `scheduling.events.meeting_url` / `meeting_passcode`.
  Never store `start_url`: it is a host credential that expires two hours after creation. Read a
  fresh one when the host clicks join.
- Presence events are attributed by **meeting id** (`p_meeting_id` in
  `SessionBackendService.handlePresenceWebhook`), so the room record must keep the Zoom meeting id.
- Zoom refresh tokens are **single-use**. Persist the new one atomically, as with Graph.

### 7.6 Scheduled work for connectors

These rows are in `00005060_seed_scheduled_jobs.sql`, with the cadence held only in the registry row
(Decision #203).

| Job                           | Cadence (UTC) | Runs                                                                                  | Secret                     | Idempotency                                                                                                                                                                                                                                                                                                                                    |
| :---------------------------- | :------------ | :------------------------------------------------------------------------------------ | :------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integrations-refresh-tokens` | every 10 min  | `POST /api/integrations/cron/refresh?limit=100`                                       | `INTEGRATIONS_CRON_SECRET` | Claims `active`/`degraded` connections whose access token expires within 15 min **and** that synced or connected in the last 7 days (a use writes `last_synced_at`), plus a **keep-alive** for any connection not refreshed in 30 days. That keep-alive defeats Google's ~6-month idle lapse and finds revoked grants early. `SKIP LOCKED` and a 5-minute lease; one refresh per connection per run |
| `integrations-renew-channels` | hourly :35    | `POST /api/integrations/cron/channels?limit=100`                                      | `INTEGRATIONS_CRON_SECRET` | Renews `webhook_subscriptions` whose `expires_at < now() + 24 h`. A failed renewal increments `failure_count`; at 3 the connection becomes `degraded`                                                                                                                                                                                          |
| `integrations-calendar-sync`  | every 5 min   | `POST /api/integrations/cron/sync?limit=50`                                           | `INTEGRATIONS_CRON_SECRET` | Claims each calendar a push marked due or an hour unread, under a 10-minute lease (`SKIP LOCKED`). A read lands in one SQL call, only while its claim is held. It opens a push channel where there is none. Three failed reads degrade the connection, and a good one heals it |
| `integrations-outbound-sync`  | every 5 min, :02 | `POST /api/integrations/cron/sync?task=outbound&limit=100`                         | `INTEGRATIONS_CRON_SECRET` | Claims each dirty copy under a 10-minute lease (`SKIP LOCKED`), so no copy goes out twice at once, and writes it idempotently (Decision #383, ruling R3). A refusal backs off from 5 minutes, doubling, and the eighth stops until the event next changes |
| `integrations-consent-sweep`  | daily 03:25   | `integrations.fn_sweep_consent_states()`                                              | none                       | Deletes only spent or expired CSRF bindings. The DDL comment already says "a spent row is swept"                                                                                                                                                                                                                                               |

A refresh that fails with `invalid_grant` sets the connection to `expired` and emits
`integration.reconnect_required`, a `comms.notification_types` row (category Account, not
mandatory). The settings UI's **reconnect** action follows (SSOT §3.2).

A rotated refresh token cannot be persisted in the transaction that read the old one, because the
exchange between them is a network call. The claim's lease keeps a second run off the token, and
`fn_commit_refresh` lands only over the token that run read (`database/integrations/Functions.md`).

### 7.7 Development and production fallbacks

| Condition                         | Behaviour                                                                                                                                                                                      |
| :-------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTEGRATIONS_BACKEND_LIVE=false` | The catalogue and the caller's connections are read live (`v_my_connections`). `startConnection` refuses (409 or 503). `seal()`/`unseal()` refuse. **No fixture corpus, ever** (Decision #313) |
| Gate on, provider row disabled    | 409, "<Provider> isn't available to connect yet."                                                                                                                                              |
| Gate on, no `ENCRYPTION_KEY`      | The server refuses to boot, in production too. A placeholder or short key counts as none (§9.4)                                                                                                |
| Local consent                     | Per-developer test OAuth clients: Google in Testing (7-day refresh tokens), a personal Microsoft account, Zoom in development mode (usable by the app owner's account)                         |
| Local vault key                   | `openssl rand -hex 32` into `.env.local`. Never share one between environments (§9.4)                                                                                                          |
| Zoom presence locally             | Point a tunnel at `/api/integrations/webhooks/zoom` and set `ZOOM_WEBHOOK_SECRET` to the dev app's Secret Token                                                                                |

---

## 8. Outbound messaging

**Authority:** `SYSTEM_ARCHITECTURE.md` §The Notification Engine; Decision #57 (f);
`PRODUCT_SPEC.md` §Notifications; [`database/comms/`](../database/comms/Tables.md).

### 8.1 The dispatch pipeline

```text
comms.fn_notify ─► comms.notifications (in-app; the inbox polls /api/notifications/summary)
               └─► comms.notification_deliveries (per channel / device)
                     └─ AFTER INSERT trigger (00001310): runs only when
                        security.feature_flags['comms.dispatch_webhook'] is on
                        AND security.platform_params['comms_dispatch_url'] ≠ 'XXXX-XXXX'
                          └─ pg_net POST {notification_id, user_id, type} ─► Edge Function comms-dispatch
                                ├─ web  → Web Push (§8.2)
                                ├─ ios  → APNs (§8.3)
                                ├─ android → FCM (§8.4)
                                ├─ email → the email API (§8.5)
                                └─ sms  → Twilio (§8.6)
                              outcomes → comms.notification_deliveries · comms.delivery_events
```

**The authentication gap (flag (e)).** The trigger posts with only `Content-Type`. An Edge Function
that trusts that request can be driven by anyone who learns its URL. It would read notifications
with the service role and send push and email as Projective. **Proposed:**

1. Store `COMMS_DISPATCH_SECRET` (≥ 32 chars) in Vault.
2. Edit `00001310` in place so the trigger reads the secret from Vault exactly as
   `ops.fn_dispatch_http_job` does, and sends `Authorization: Bearer …`.
3. Deploy the function with `--no-verify-jwt` and its own constant-time bearer check. It answers 404
   otherwise, like the cron routes.

**One function, not two.** The SSOT names `dispatch-push` and `send-email`. `comms_dispatch_url` is
a single URL, so one `comms-dispatch` entry point fans out to shared modules
(`_shared/{webpush,apns,fcm,mail,sms}.ts`). The two SSOT names become modules of it. This is an
implementation choice, not a contract change.

**Retries and housekeeping.** These depend on the comms sweeps that no migration has scheduled yet:
`fn_process_queue`, `fn_reap_dead_devices` and `fn_compact_delivery_events` (Decision #203 flag
(a)). Register them in the same change that turns `comms.dispatch_webhook` on.

### 8.2 Web Push (VAPID)

**Setup.**

1. Generate a P-256 keypair, for example with `npx web-push generate-vapid-keys` or a Web Crypto
   script that exports the raw public key and the PKCS#8 private key as base64url.
2. `VAPID_PRIVATE_KEY` → Edge Function secret. `VAPID_PUBLIC_KEY` → app env, served to the browser
   by **Proposed** `GET /api/notifications/push/config`. `VAPID_SUBJECT` = `mailto:` an operator
   mailbox.
3. Never rotate the keypair casually. Every existing subscription is bound to the public key, so a
   rotation means re-subscribing every device.

**Browser flow.**

1. Ask for permission only from an explicit control in **Settings → Notifications**, never on page
   load.
2. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
3. **Proposed** `POST /api/notifications/devices` writes `comms.device_tokens` through a definer
   door: `platform 'web'`, `endpoint`, `p256dh`, `auth_key`, `label`, `user_agent`.
4. `apps/web/static/sw.js` gains a `push` handler (`showNotification` with the title, a generic
   body, `tag` = collapse key, `data.url`) and a `notificationclick` handler that opens **only a
   same-origin relative path**, so a crafted payload cannot open a redirect.

**Sending.**

- VAPID JWT: ES256, `aud` = the endpoint's origin, `exp` ≤ 24 h, `sub` = `VAPID_SUBJECT`.
- Payload: `aes128gcm` (RFC 8291), ≤ 4 KB.
- Headers: `TTL`, `Urgency` (mapped from `comms.notification_urgency`), and `Topic` as the collapse
  key.

| Answer    | Action                                                      |
| :-------- | :---------------------------------------------------------- |
| 201       | Delivered                                                   |
| 404 / 410 | Set `revoked_at` and `revoked_reason = 'gone'`; never retry |
| 413       | A payload-construction bug; log it                          |
| 429 / 5xx | Back off by `Retry-After`; increment `failure_count`        |

**iOS.** Safari supports Web Push only for a web app that has been added to the Home Screen (iOS
16.4 and later), and only with a valid web app manifest. Tell the person so in Settings rather than
showing a dead switch (root `CLAUDE.md` §3.11).

### 8.3 Apple Push Notification service (Growth: native iOS app)

**Setup.**

1. Apple Developer → Certificates, IDs & Profiles → Keys → create a key with **APNs** enabled. You
   get a `.p8` file and its Key ID.
2. Note the Team ID. Give the App ID (the bundle id) the Push Notifications capability.
3. Use **token-based authentication**. A token key does not expire, serves every app on the team and
   can be revoked. Prefer it over certificates.
4. Edge secrets: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY` (the `.p8` PEM)
   and `APNS_ENVIRONMENT` (`sandbox` | `production`).

**Sending.**

- HTTP/2 `POST https://api.push.apple.com/3/device/<token>` (`api.sandbox.push.apple.com` for
  development builds).
- Headers: `authorization: bearer <JWT ES256 { iss: team, iat }, header kid>`, `apns-topic`,
  `apns-push-type: alert`, `apns-priority: 10` (`5` for low urgency), `apns-expiration` and
  `apns-collapse-id`.
- Reuse the JWT for 20–60 minutes. Apple rejects tokens that are refreshed too often or are too old.

| Answer                                    | Action             |
| :---------------------------------------- | :----------------- |
| 410 `Unregistered` · 400 `BadDeviceToken` | Revoke the device  |
| 403 (credentials)                         | Raise an ops alarm |

**Runtime check.** APNs requires HTTP/2. Confirm that the Supabase Edge Runtime's `fetch` negotiates
HTTP/2 to `api.push.apple.com` before you commit to it. If it does not, the APNs leg runs from the
app server.

### 8.4 Firebase Cloud Messaging, HTTP v1 (Growth: native Android app)

**Setup.**

1. Create a Firebase project and add the Android app (the package name).
2. Create a service account with the **Firebase Cloud Messaging API Admin** role. Prefer Workload
   Identity Federation over a JSON key wherever the host supports it.
3. Edge secrets: `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_JSON`.
4. Use the **HTTP v1 API only**. The legacy server-key API has been shut down.

**Sending.**

1. Mint an access token: sign a JWT with RS256 using the service-account key, then call
   `POST https://oauth2.googleapis.com/token` with
   `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` and the scope
   `https://www.googleapis.com/auth/firebase.messaging`. Cache the token for its lifetime.
2. Call `POST https://fcm.googleapis.com/v1/projects/{FCM_PROJECT_ID}/messages:send` with
   `{ message: { token, notification: { title, body }, data: { url, id }, android: { priority,
   collapse_key, ttl } } }`.

| Answer                                 | Action              |
| :------------------------------------- | :------------------ |
| 404 `UNREGISTERED` · 400 invalid token | Revoke the device   |
| 429 / 503                              | Exponential backoff |

### 8.5 Transactional email

**Two senders, one domain reputation.**

- GoTrue sends the auth mail: confirmation, recovery, email change. Its branded templates are in
  `supabase/templates/`.
- The app sends secondary-email verification (`verification-mailer.ts`) and notification email
  (`comms-dispatch`).

Both must use **one provider** and **one sending subdomain**.

**Provider choice (flag (f)).**

| Criterion                             | Resend                                                                                      | Postmark                       | Amazon SES                                                |
| :------------------------------------ | :------------------------------------------------------------------------------------------ | :----------------------------- | :-------------------------------------------------------- |
| Transactional deliverability          | Good                                                                                        | Excellent (its whole business) | Good once warmed; you own the reputation                  |
| Transactional vs marketing separation | Separate domains / API keys                                                                 | Native **message streams**     | Configuration sets                                        |
| SMTP for GoTrue                       | Yes                                                                                         | Yes                            | Yes                                                       |
| Signed webhooks                       | Svix (`svix-*` headers)                                                                     | Basic auth / IP allow-list     | SNS (signed messages)                                     |
| Already in Projective's vocabulary    | **Yes**: the `NotificationDelivery.provider` JSDoc names `resend` (the column is free text) | No                             | No                                                        |
| Operational burden                    | Low                                                                                         | Low                            | Higher: leave the sandbox, SNS plumbing, suppression list |

**Recommendation: Resend for the MVP.** The documented `comms` gateway vocabulary already names it.
The `provider` column is free text, so this is about consistency, not a migration. Its HTTP API and
SMTP cover both senders. Svix gives signed, replayable webhooks that match the house standard. SES
is the cost path at scale, behind the same `MailTransport`. The commented SendGrid block in
`config.toml` is scaffolding; replace it.

**Setup.**

1. **Domains.** Send transactional mail from `notify.<domain>`. Keep marketing and newsletter mail
   on a different subdomain later (`news.<domain>`), so a marketing complaint cannot hurt a password
   reset.
2. **DNS.**
   - SPF (the provider's include);
   - DKIM (the provider's records);
   - a custom Return-Path / MAIL FROM;
   - DMARC at `v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>`, then `p=reject` after 30 clean
     days.
3. **An API key** scoped to sending, restricted to the domain → `RESEND_API_KEY` (app env **and**
   Edge secret). `MAIL_FROM` = `Projective <no-reply@notify.<domain>>`.
4. **GoTrue SMTP** (`supabase/config.toml` locally; Dashboard → Auth → SMTP when hosted):

   ```toml
   [auth.email.smtp]
   enabled = true
   host = "smtp.resend.com"
   port = 465
   user = "resend"
   pass = "env(SUPABASE_AUTH_SMTP_PASS)"
   admin_email = "no-reply@notify.example.com"
   sender_name = "Projective"
   ```

   Raise `[auth.rate_limit] email_sent` to match the provider plan. Re-check
   `enable_confirmations = true` on every non-local deployment, as the `config.toml` comment asks.
5. **App transport.** Built (Decision #391): `configuredTransport()` returns a Resend HTTP transport
   when `RESEND_API_KEY` is well formed (`re_…`; the placeholder counts as absent) and `MAIL_FROM` is
   an address. A guest's message sends no `Idempotency-Key`, because each retry carries a new link,
   and Resend refuses a reused key with a different body. A timed-out send can therefore arrive
   twice, which is harmless: both links work.
6. **Webhooks (Proposed `POST /api/comms/webhooks/resend`).**
   - Events: `email.delivered`, `email.bounced`, `email.complained` and `email.delivery_delayed`.
   - Verify the Svix headers: an HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${body}`, with the
     base64 secret after `whsec_` and a 5-minute tolerance.
   - Write `comms.delivery_events` with `provider = 'resend'` and `provider_event_id = svix-id`.
7. **Suppression follows PRODUCT_SPEC §Notifications rule 3.** A bounce or a complaint suppresses
   the address **for Marketing only**, and transactional and security mail still goes out.
   Commercial note: repeatedly sending to a hard-bounced address hurts sender reputation. If the
   bounce rate ever threatens deliverability, raise it as a business-rule change. Do not quietly
   suppress transactional mail.

**Development and production.**

| Environment             | GoTrue mail                                                                                                                            | App mail                                                                             |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| Local                   | **Mailpit** at `http://127.0.0.1:54324`. If a `kong reload` drops the template server, run `docker restart supabase_kong_<project_id>` | `delivery: "logged"`: the verify link prints as `[dev mail] …` in the server console |
| Staging                 | The provider, on a staging subdomain                                                                                                   | The provider                                                                         |
| Production, no provider | GoTrue's built-in sender: rate-limited, **not acceptable**                                                                             | `delivery: "unavailable"`; the address is saved unverified. **A go-live blocker**    |

### 8.6 SMS: Twilio (Growth; Level 1 phone verification)

- **Phone OTP through GoTrue.** `[auth.sms.twilio]` (`account_sid`, `message_service_sid`,
  `auth_token = "env(SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN)"`) is already scaffolded. Level 1 phone
  verification (`PRODUCT_SPEC.md` §Identity) uses it.
- **The notification SMS channel** goes through `comms-dispatch` → the Messaging Service. Status
  callbacks are verified with `X-Twilio-Signature` and written to `comms.delivery_events`.
- **Fraud.** Restrict SMS geo-permissions to launch markets, and consider Twilio Verify's
  SMS-pumping protection for OTP.

---

## 9. Security, storage and edge compute

### 9.1 Cloudflare Turnstile

**Role.** Turnstile works in two layers.

1. **GoTrue's native CAPTCHA** protects the auth API that the public anon key exposes. Without it, a
   bot can call `/auth/v1/signup` directly and bypass every app-side control.
2. **App-verified Turnstile** protects the anonymous write routes the app owns.

| Surface                                                                        | Layer  | Status                                                                                                                                                      |
| :----------------------------------------------------------------------------- | :----- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/join` (sign-up), `/login` (password), `/forgot-password`, `/verify` resend   | GoTrue | **Proposed**                                                                                                                                                |
| Newsletter opt-in (`POST /api/newsletter/subscribe`)                           | App    | **Proposed**                                                                                                                                                |
| Feedback board and help-vote writes (`community`, open to signed-out visitors) | App    | **Proposed**                                                                                                                                                |
| `/contact`                                                                     | none   | **Excluded.** PUBLIC_ROUTES P3 rules "No CAPTCHA dependency" (honeypot + per-IP and per-email ceilings, Decision #276). Revisit only by a ruling (flag (h)) |

**Setup.**

1. Cloudflare dashboard → Turnstile → Add widget, one per environment.
   - Hostnames: the production and staging domains. Development uses the dummy keys.
   - Mode: **Managed**. Pre-clearance: off.
2. Copy the **site key** (public) and the **secret key**.
3. **GoTrue**, locally:

   ```toml
   [auth.captcha]
   enabled = true
   provider = "turnstile"
   secret = "env(SUPABASE_AUTH_CAPTCHA_SECRET)"
   ```

   When hosted: Dashboard → Authentication → Bot and Abuse Protection.

   **The same change** must:
   - add `captchaToken` to the auth Zod schemas (`@projective/types/auth`: `JoinSchema`,
     `LoginSchema`, and the recovery and resend inputs);
   - make `AuthBackendService` forward it as `options.captchaToken` on `signUp`,
     `signInWithPassword`, `resetPasswordForEmail`, `resend` and `signInWithOtp`.

   Turning GoTrue's CAPTCHA on without forwarding the token breaks every sign-in.
4. **App verification (Proposed `packages/backend/core/turnstile.ts`).**
   - `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`, form-encoded: `secret`,
     `response`, `remoteip` (from `clientKey`), and `idempotency_key` (a uuid). Timeout: 3 s.
   - Accept only when `success` is true, `hostname` is in the allowed list, `action` matches the
     surface (`join`, `login`, `newsletter`, `feedback`), and `challenge_ts` is within 300 s.
   - Write one `security.turnstile_verifications` row (`user_id`, `ip`, `token_prefix` = the first 8
     characters, `success`).
5. **The widget.**
   - `@projective/ui` `Captcha` stays a dumb mount.
   - An app island loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` on
     demand, the same way `stripe-js.ts` loads Stripe.js.
   - It calls
     `turnstile.render(mount, { sitekey, action, theme: "auto", appearance:
     "interaction-only", callback })`.
     The site key comes from a server response.
   - **CSP:** add `https://challenges.cloudflare.com` to `script-src` and `frame-src` in
     `apps/web/utils/csp.ts`.
6. **Privacy.** `security.turnstile_verifications.ip` is personal data. Purge rows after 30 days
   with a **Proposed** `security-turnstile-purge` sql job (daily 04:25), or store a truncated prefix
   (/24 for IPv4, /48 for IPv6).

**Development.** Cloudflare publishes dummy site and secret key pairs that always pass, always fail,
or force an interactive challenge. `pj.dev.captcha` picks one. With no secret configured under
`DENO_ENV=development`, app verification is skipped with one log line. In production, a missing
secret refuses the protected write (503). Keep GoTrue's `[auth.captcha]` disabled locally unless you
are testing it.

### 9.2 Supabase Storage: the bucket matrix

**Authority:** [`database/files/Storage.md`](../database/files/Storage.md) (paths, policies, the
upload pipeline) and `00005040_seed_storage_buckets.sql`. All twelve buckets are listed, including
`workspace`, `contact` and `showcase`, which the brief did not name.

| Bucket          | Visibility                 | Size limit | Written by                                              | AV scan (**Proposed**, §6.4) | Publication gate (§6.3)         | Notes                                                                                            |
| :-------------- | :------------------------- | :--------- | :------------------------------------------------------ | :--------------------------- | :------------------------------ | :----------------------------------------------------------------------------------------------- |
| `quarantine`    | Private                    | 50 MiB     | The uploader, by a signed upload URL under `{user_id}/` | Runs on the claim            | n/a                             | Objects leave on promote or refuse. **Abandoned uploads are never swept** (Storage.md §Deferred) |
| `personal`      | Private                    | 50 MiB     | The service role (promote)                              | Yes                          | Private zone: none              | Library originals + WebP tiers                                                                   |
| `workspace`     | Private                    | 50 MiB     | The service role (promote)                              | Yes                          | none                            | Team / business libraries                                                                        |
| `project`       | Private                    | 50 MiB     | The service role (promote)                              | Yes                          | none                            | Stage files and submissions                                                                      |
| `messages`      | Private                    | 50 MiB     | The service role (promote)                              | Yes                          | none                            | Chat attachments                                                                                 |
| `contact`       | Private; operator read     | 10 MiB     | The contact pipeline only                               | Yes                          | none                            | Swept hourly when unsent (`contact-attachment-sweep`)                                            |
| `invoices`      | Private                    | 20 MiB     | Service-generated                                       | n/a                          | n/a                             | PDFs are rendered per request today; stored PDFs are not built                                   |
| `verification`  | Private, service role only | 20 MiB     | The service role                                        | Yes                          | n/a                             | **Never** Stripe Identity images: Stripe holds those                                             |
| `avatars`       | **Public**                 | 5 MiB      | `MediaBackendService` rendition cut                     | Upstream (library)           | **Required**                    | Served from `SUPABASE_PUBLIC_URL`                                                                |
| `showcase`      | **Public**                 | 50 MiB     | The rendition cut                                       | Upstream                     | **Required** (frames for video) |                                                                                                  |
| `catalogue`     | **Public**                 | 10 MiB     | The service role (catalogue media writes)               | Upstream                     | **Required**                    |                                                                                                  |
| `public_assets` | **Public**                 | 10 MiB     | The service role (favicons, platform assets)            | Upstream                     | **Required** (except favicons)  |                                                                                                  |

**Operations.**

- Database point-in-time recovery does **not** cover Storage objects. The private buckets need their
  own backup and retention policy before any client deliverable is entrusted to them.
- The streaming proxy (`/api/media/proxy/[fileId]`) has no CDN in front of it (Storage.md
  §Deferred).

### 9.3 Supabase Vault: the secret registry

Vault holds the secrets that **Postgres itself** must present (pg_net). It is not a store for OAuth
tokens (those go in `connection_secrets`, §9.4) or for the app's env.

| Vault name                 | Value                                                                                         | Consumer                          | Status                                          |
| :------------------------- | :-------------------------------------------------------------------------------------------- | :-------------------------------- | :---------------------------------------------- |
| `CRON_APP_URL`             | The origin the **database** reaches the app on (`http://host.docker.internal:<PORT>` locally) | `ops.fn_dispatch_http_job`        | **Shipped**; provisioned nowhere yet (#203 (b)) |
| `FINANCE_CRON_SECRET`      | The same value as the app env key                                                             | finance http jobs                 | same                                            |
| `ACCOUNT_CRON_SECRET`      | same                                                                                          | `account-erasures`                | same                                            |
| `SCHEDULING_CRON_SECRET`   | same                                                                                          | `scheduling-availability-horizon` | same                                            |
| `CONTACT_CRON_SECRET`      | same                                                                                          | `contact-attachment-sweep`        | same                                            |
| `COMMS_DISPATCH_SECRET`    | ≥ 32 chars; also an Edge secret                                                               | the comms dispatch trigger        | **Proposed** (flag (e))                         |
| `INTEGRATIONS_CRON_SECRET` | ≥ 32 chars; also app env                                                                      | the §7.6 jobs                     | **Shipped**; provisioned nowhere yet            |
| `MODERATION_CRON_SECRET`   | ≥ 32 chars; also app env                                                                      | `moderation-drain`                | **Proposed**                                    |

```sql
-- Per environment, by an operator. Never in a migration or a seed.
SELECT vault.create_secret('https://app.example.com', 'CRON_APP_URL');
SELECT vault.create_secret('XXXX-XXXX', 'FINANCE_CRON_SECRET');
-- Rotate: update Vault and the app env in one change window, because the route compares the two.
SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'FINANCE_CRON_SECRET'), 'XXXX-XXXX');
```

Verify the registry with `deno task cron:run --list`. Until the secrets exist, each http job skips
and writes an `ops.log_entries` row (`secret_missing` / `app_url_missing`).

### 9.4 Envelope encryption: the `ENCRYPTION_KEY` token vault (`token-vault.ts`)

**The ruling (Decision #343, ruling C4 (c), which resolves Decision #59).** The vault's key is the
`ENCRYPTION_KEY` env, not a KMS. That overrides Decision #335 (b)'s proposal to make it a
development-only key that production refuses. #335 (b)'s envelope columns stand.

**The schema (`00000020_tables_integrations.sql`, built):**

```sql
-- integrations.connection_secrets: the envelope columns
key_id               text  NOT NULL,  -- env: + the first 8 hex of sha256(the key)
wrapped_dek          bytea NOT NULL,  -- the DEK under the KEK, GCM tag included
wrapped_dek_nonce    bytea NOT NULL,
access_token_cipher  bytea,
nonce                bytea,           -- the ACCESS token's nonce
refresh_token_cipher bytea,
refresh_token_nonce  bytea,
api_secret_cipher    bytea,           -- S3-compatible secret access key / API key
api_secret_nonce     bytea,
CONSTRAINT ck_secret_nonces CHECK (
    (access_token_cipher  IS NULL OR nonce               IS NOT NULL)
AND (refresh_token_cipher IS NULL OR refresh_token_nonce IS NOT NULL)
AND (api_secret_cipher    IS NULL OR api_secret_nonce    IS NOT NULL))
```

**The algorithm (normative for `seal` / `unseal`):**

1. **The key:** 32 bytes as 64 hex characters. `key_id` = `env:` + the first 8 hex of sha256(the raw
   key).
2. **DEK:** each write of a row mints a fresh 256-bit DEK, wrapped by the key with AES-256-GCM under
   its own 96-bit nonce. A refresh rewrites the whole row under a new DEK.
3. **Encrypt each secret:** Web Crypto AES-256-GCM under the DEK with a fresh 96-bit random nonce per
   ciphertext and AAD = `utf8("<connection_id>|<kind>|<key_id>")`, where `kind` is `access_token`,
   `refresh_token` or `api_secret`. A ciphertext moved to another row or column fails its tag. Web
   Crypto appends the 16-byte tag to the ciphertext, so no tag column exists.
4. **Zero the DEK** (`fill(0)`) once the call ends. Never log it, return it or cache it.
5. **Unseal:** refuse a row whose `key_id` is not the current key's, before any decryption. Unwrap the
   DEK and open with the nonce and AAD. A tag failure is a tamper signal and fails loudly.

**Boot.** `assertVaultKeyAllowed()` (called from `apps/web/main.ts`, the same pattern as
`assertStripeKeyAllowed`) refuses to start with a missing, placeholder or short key whenever
`INTEGRATIONS_BACKEND_LIVE` is on, in production too.

**Generating and keeping a key.** `openssl rand -hex 32`, once per environment, in the host's secret
manager and never in a file that is committed. Environments never share a key.

**Rotation is not built.** There is no rewrap: a changed key strands every sealed row, each refresh
fails on its row until the connection is `degraded`, and its owner has to reconnect. `key_id` finds
the rows when a rewrap is built, which it must be before the first rotation.

### 9.5 Edge Functions

| Function                                                | Status                               | `verify_jwt`             | Secrets                                                                                      | Invoked by                    |
| :------------------------------------------------------ | :----------------------------------- | :----------------------- | :------------------------------------------------------------------------------------------- | :---------------------------- |
| `scan-file`                                             | **Legacy mock; a defect (flag (d))** | `false`                  | `VIRUSTOTAL_API_KEY` (read, unused)                                                          | Nothing in the codebase       |
| `comms-dispatch` (SSOT: `dispatch-push` + `send-email`) | **Planned (SSOT)**                   | `false` + its own bearer | `COMMS_DISPATCH_SECRET`, `VAPID_*`, `APNS_*`, `FCM_*`, `RESEND_API_KEY`, `MAIL_FROM`, Twilio | pg_net from the comms trigger |

**The `scan-file` defect.** `supabase/functions/scan-file/index.ts`:

- is enabled in `config.toml` with `verify_jwt = false` and CORS `*`;
- runs with the **service role**;
- accepts any `fileId`;
- "scans" with a mock;
- streams the quarantine object to `target_bucket/target_path` with `x-upsert: true`;
- deletes the quarantine copy;
- then writes `status = 'clean'` / `'infected'` and `scan_notes`, values and a column that do not
  exist (`files.file_status` has no `clean` or `infected`).

The only writer of `target_bucket` is the contact pipeline (`'contact'`, with no `target_path`). So
a caller holding a contact attachment's id could push its unsniffed bytes to `contact/null` and
delete the quarantined original, before the function fails. Locally the function is always served.
When hosted, it is reachable only if it was deployed.

**Remediation (needs a go-ahead):** set `[functions.scan-file] enabled = false`, delete the function
from every hosted project, and remove the directory once ClamAV (§6.4) lands in the in-process
pipeline. That pipeline is the promoter now.

```bash
supabase link --project-ref XXXX-XXXX
supabase secrets set --env-file supabase/functions/.env.production
supabase functions deploy comms-dispatch --no-verify-jwt
supabase functions delete scan-file
supabase functions serve --env-file supabase/functions/.env.local
```

`supabase/functions/.env.*` files are git-ignored. Only `.env.example` is committed (Decision #125
(i)).

### 9.6 AWS STS for S3 connections (built, Decision #314)

The platform principal (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`) only ever assumes a customer's
role. Its whole policy:

```json
{
	"Version": "2012-10-17",
	"Statement": [{ "Effect": "Allow", "Action": "sts:AssumeRole", "Resource": "*" }]
}
```

The customer's role trusts Projective's account only with the derived, immutable external id (the
confused-deputy guard):

```json
{
	"Version": "2012-10-17",
	"Statement": [{
		"Effect": "Allow",
		"Principal": { "AWS": "arn:aws:iam::XXXX-XXXX:root" },
		"Action": "sts:AssumeRole",
		"Condition": { "StringEquals": { "sts:ExternalId": "projective-<user_connection_id>" } }
	}]
}
```

---

## 10. Environment variable register

**In contract** keys are in `SYSTEM_ARCHITECTURE.md` §Environment Variable Contract and
`.env.example`. **Proposed** keys are **not** added to `.env.example` or `core/env.ts` until their
code lands. That is the same-change rule: a contract key with no reader is the drift Decision #11
removed.

| Key                                                                                                            | Status                            | Read by                                                       | Kind                   |
| :------------------------------------------------------------------------------------------------------------- | :-------------------------------- | :------------------------------------------------------------ | :--------------------- |
| `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `STRIPE_THIN_WEBHOOK_SECRET` · `STRIPE_CONNECT_WEBHOOK_SECRET` | In contract                       | `core/stripe.ts`                                              | secret                 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`                                                                           | In contract                       | served by `GET /api/finance/cards/setup`                      | public                 |
| `STRIPE_API_BASE`                                                                                              | In contract (dev)                 | `core/stripe.ts`                                              | config                 |
| `EMBEDDINGS_ENABLED` · `VOYAGE_API_KEY` · `VOYAGE_API_BASE`                                                    | In contract                       | `isEmbeddingsLive`, `voyage-client.ts`                        | gate · secret · config |
| `LINK_SAFETY_API_KEY`                                                                                          | In contract                       | `link-reputation.ts`                                          | secret                 |
| `GOOGLE_INTEGRATION_*` · `MICROSOFT_INTEGRATION_*` · `ZOOM_CLIENT_*` · `DROPBOX_*` · `FRAMEIO_*`               | In contract                       | `integrations/oauth.ts`                                       | secret                 |
| `ZOOM_WEBHOOK_SECRET`                                                                                          | In contract                       | `presence/zoom.ts`                                            | secret                 |
| `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY`                                                                    | In contract                       | `adapters/aws.ts`                                             | secret                 |
| `ENCRYPTION_KEY`                                                                                               | In contract                       | `token-vault.ts`                                              | secret                 |
| `*_CRON_SECRET` (finance, account, scheduling, contact, integrations)                                          | In contract                       | cron routes                                                   | secret                 |
| `INTEGRATIONS_BACKEND_LIVE` · `FILES_BACKEND_LIVE` · `FINANCE_BACKEND_LIVE` · …                                | In contract                       | `core/supabase.ts`                                            | gate                   |
| `MODERATION_BACKEND_LIVE` · `MALWARE_SCAN_LIVE`                                                                | **Proposed**                      | the moderation and upload services                            | gate                   |
| `SAFETY_NODE_URL` · `SAFETY_NODE_TOKEN`                                                                        | **Proposed**                      | `services/moderation/`, upload scan                           | config · secret        |
| `MODERATION_CRON_SECRET`                                                                                       | **Proposed**                      | cron routes + Vault                                           | secret                 |
| `TURNSTILE_SITE_KEY` · `TURNSTILE_SECRET_KEY`                                                                  | **Proposed**                      | `core/turnstile.ts`; site key served by a route               | public · secret        |
| `SUPABASE_AUTH_CAPTCHA_SECRET` · `SUPABASE_AUTH_SMTP_PASS`                                                     | **Proposed**                      | `supabase/config.toml` `env(...)`                             | secret                 |
| `RESEND_API_KEY` · `MAIL_FROM` (built) · `RESEND_WEBHOOK_SECRET` (proposed)                                    | **Built, no key yet**             | `services/mail/transport.ts`, `comms-dispatch`, the webhook route | secret · config        |
| `VAPID_PUBLIC_KEY`                                                                                             | **Proposed**                      | app (served)                                                  | public                 |
| `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT`                                                                          | **Proposed**                      | Edge secret                                                   | secret · config        |
| `APNS_KEY_ID` · `APNS_TEAM_ID` · `APNS_BUNDLE_ID` · `APNS_PRIVATE_KEY` · `APNS_ENVIRONMENT`                    | **Proposed** (Growth)             | Edge secret                                                   | secret · config        |
| `FCM_PROJECT_ID` · `FCM_SERVICE_ACCOUNT_JSON`                                                                  | **Proposed** (Growth)             | Edge secret                                                   | config · secret        |
| `MICROSOFT_INTEGRATION_TENANT`                                                                                 | In contract                       | the Microsoft identity URLs (`common` by default)             | config                 |

```env
# PROPOSED additions. Not in .env.example until their code lands (same-change rule, Decision #335).

# Safety node (§6). The gates are booleans that default to false; the secrets are placeholders.
MODERATION_BACKEND_LIVE=false
MALWARE_SCAN_LIVE=false
SAFETY_NODE_URL=XXXX-XXXX               # e.g. the node's private https origin; http://127.0.0.1:8443 locally
SAFETY_NODE_TOKEN=XXXX-XXXX             # ≥ 32 chars; the gateway's bearer
MODERATION_CRON_SECRET=XXXX-XXXX        # ≥ 32 chars; also a Vault secret

# Bot mitigation (§9.1)
TURNSTILE_SITE_KEY=XXXX-XXXX
TURNSTILE_SECRET_KEY=XXXX-XXXX
SUPABASE_AUTH_CAPTCHA_SECRET=XXXX-XXXX  # the same value as TURNSTILE_SECRET_KEY; read by supabase/config.toml

# Transactional email (§8.5)
RESEND_API_KEY=XXXX-XXXX
RESEND_WEBHOOK_SECRET=XXXX-XXXX
MAIL_FROM=XXXX-XXXX                     # Projective <no-reply@notify.<domain>>
SUPABASE_AUTH_SMTP_PASS=XXXX-XXXX       # the same value as RESEND_API_KEY; read by supabase/config.toml

# Web Push (§8.2). The public key is served to browsers; the private key is an Edge secret only.
VAPID_PUBLIC_KEY=XXXX-XXXX
```

---

## 11. Rollout sequence and go-live checklist

Each step lands as its own change, with its code, migration, Zod schema, docs and Dev Context
Switcher control together.

| Phase               | Step                                                                         | Depends on                           | Proven by                                                                                              |
| :------------------ | :--------------------------------------------------------------------------- | :----------------------------------- | :----------------------------------------------------------------------------------------------------- |
| **MVP-0: blockers** | 1. Disable and delete `scan-file` (flag (d))                                 | A go-ahead                           | `config.toml` diff; `supabase functions list` on every project                                         |
|                     | 2. Email: domain + DNS + GoTrue SMTP + the app transport (§8.5)              | Flag (f) ruling                      | A confirmation from `/join` arrives with DKIM pass; `/settings` secondary email verifies               |
|                     | 3. Turnstile on GoTrue + the auth schemas (§9.1)                             | Keys                                 | A bot sign-up via `/auth/v1/signup` without a token is refused; the dummy "fail" key refuses in the UI |
|                     | 4. Stripe live configuration (§4.3) + the Vault cron secrets (§9.3)          | Stripe account review                | SSOT §1.3 manual checklist in the sandbox; one live end-to-end, refunded                               |
|                     | 5. Web Risk in `link-reputation.ts` (§6.5): built (ruling T5)                | A GCP project, a restricted key      | `link-scan.test.ts` against a stubbed Web Risk; the Safe Browsing test host still `blocked` offline    |
|                     | 6. Safety node: ClamAV + the publication gate (§6.1, §6.3, §6.4)             | Flag (g) sizing, a VM                | EICAR → `quarantined`; a flagged fixture image → 422; node down → 503                                  |
| **MVP-1: trust**    | 7. Presidio Tier 3: queue, worker, review sink (§6.2)                        | Flag (g) schema ruling               | A seeded obfuscated message produces one automated review row; latency on send unchanged               |
|                     | 8. Web Push + the dispatch bearer + the comms sweeps registered (§8.1, §8.2) | Flag (e)                             | An unauthenticated POST to `comms-dispatch` → 404; a 410 revokes the device                            |
|                     | 9. Voyage on (§5)                                                            | DPA + written no-training terms (T5) | `x-discovery-ranking: semantic`; breaker test; backfill idempotent                                     |
| **Growth**          | 10. The `ENCRYPTION_KEY` envelope + the schema fix (§9.4): built             | Decision #343, ruling C4 (c)         | `token-vault.test.ts`; `integrations_runtime.sql`; the boot refuses a missing or short key             |
|                     | 11. Connectors: Google, then Microsoft, then Zoom OAuth (§7)                 | Step 10, flag (a), flag (i)          | Consent → callback → `v_my_connections` active; refresh job; channel renewal; erasure revokes          |
|                     | 12. APNs / FCM with the native apps (§8.3, §8.4)                             | Native apps                          | Device registration → delivery → revocation on `Unregistered` / `UNREGISTERED`                         |
|                     | 13. SMS / Level 1 phone verification (§8.6)                                  | Twilio account                       | GoTrue phone OTP; geo-permissions limited                                                              |

**The go-live gate:** every MVP-0 row is proven, every `*_BACKEND_LIVE` gate in production is set
deliberately (none is left at its default by accident), and the §3.4 register is reflected in the
privacy notice.

---

## 12. Open decisions (Decision #335)

These are logged in [`decisions-122-126.md`](../reference/decisions/decisions-122-126.md) as
**#335**. Each needs a human. This document recommends; it does not choose.

| Flag | Contradiction or gap                                                                                                                                                                                      | Recommendation                                                                                                                                                  |
| :--- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)  | Calendar strategy: the seed + SSOT §3.2 say Nylas; this brief says direct Google / Graph / Zoom                                                                                                           | **Ruled: direct** (Decision #383, ruling R1; §7.2)                                                            |
| (b)  | `connection_secrets` cannot store an envelope: no wrapped-DEK column, one nonce for two ciphertexts, no S3 key-pair column                                                                                | **Built:** the columns + CHECK in §9.4. **Ruled** against a dev-only `ENCRYPTION_KEY`: it is the vault's key everywhere (Decision #343, ruling C4 (c))           |
| (c)  | Decision #128 names the Safe Browsing Lookup API v4, which Google licenses for non-commercial use                                                                                                         | Move `link-reputation.ts` to Web Risk `uris:search`; keep the env name (§6.5)                                                                                   |
| (d)  | `scan-file` is public (`verify_jwt = false`), service-role, writes non-existent statuses and a column, and bypasses the in-process pipeline                                                               | Disable and delete it now; ClamAV goes into `completeUpload` (§6.4, §9.5)                                                                                       |
| (e)  | The comms dispatch trigger calls its Edge Function with no authentication                                                                                                                                 | A Vault-held `COMMS_DISPATCH_SECRET` bearer, read like `ops.fn_dispatch_http_job` (§8.1)                                                                        |
| (f)  | No email provider is chosen; `config.toml` sketches SendGrid while the documented `comms` gateway vocabulary names Resend                                                                                 | Resend for the MVP; SES as the cost path behind the same transport (§8.5)                                                                                       |
| (g)  | Safety-node sizing (SSOT: one 2 GB box for Presidio) and the automated-finding sink (`ops.reports.reporter_user_id` is a person)                                                                          | One 4 vCPU / 8 GB node (or two nodes); a `source` column with a nullable reporter for `automated` rows, or a separate findings table (§6.1, §6.2)               |
| (h)  | Turnstile on `/contact` vs PUBLIC_ROUTES P3 "No CAPTCHA dependency"; `security.turnstile_verifications.ip` has no retention                                                                               | Keep `/contact` CAPTCHA-free; protect GoTrue, the newsletter and community writes; a 30-day purge (§9.1)                                                        |
| (i)  | Seeded scopes: Google `drive.readonly` is restricted (an annual CASA assessment); Zoom `meeting:write` may be a classic scope; the Outlook row lacks `offline_access` / `User.Read`                       | **Done** for Zoom and Outlook (Decision #383, rulings applied in SCH-WP4a). **Open** for Drive: `drive.file` + Picker (§7.3)                                    |
| (j)  | PRODUCT_SPEC §AML says users are sanctions-screened "during Level 2 and Level 3"; Stripe Identity does not screen                                                                                         | Record that the screen is Stripe Connect's, reached through the payout-ready gate's account half; a dedicated screening vendor only on enterprise demand (§4.4) |
| (k)  | SYSTEM_ARCHITECTURE §Runtime says keys "are stored in Supabase Vault and accessed via environment variables in Edge Functions", conflating Vault with Edge secrets; the app reads Stripe from its own env | Reword that sentence to the §3.1 table                                                                                                                          |

---

_Change log: 2026-10-29. Created from the external-providers brief: a register of 24 providers, the
safety-node reference configuration, the connector handshake, the dispatch pipeline, the KMS
envelope, the env register, and Decision #335 flags (a)–(k)._
