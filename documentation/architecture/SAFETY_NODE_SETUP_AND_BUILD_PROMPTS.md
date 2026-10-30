# Safety Node: Setup Runbook & Build Prompts

> **Status: WORK ORDERS, not binding.** This document covers building and hosting the content-safety
> stack: ClamAV, NudeNet plus OCR, Microsoft Presidio, the SightEngine fallback, Google Safe Browsing
> v4 / Web Risk, MIME and magic-byte sniffing with image decoders, and the text-moderation and
> PII-leakage pipeline.
>
> The design is already specified. This file does not restate it; it links to:
> - `documentation/api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md` §6 (EPI, Decision
>   #335, Proposed);
> - `SECURITY_MODERATION_AND_AI_GAPS.md` §2–§6 (SEC, #340).
>
> What this file adds: the human setup steps, a repo decision, and paste-ready prompts.

## 0. What already exists and what does not

| Piece | State today | Where it is built |
| :-- | :-- | :-- |
| Magic-byte sniffing and image decoders | **Built.** It refuses markup, undecodable images and video renditions, and falls back to octet-stream (Wave 0, SEC V1/V2/V4/Z2). V3 (the PDF/ZIP/OOXML sniffer) is still open. | This repo, prompt A1 |
| Tier 1 in-process pre-filter (regex PII, IBAN, crypto, phones) | Not built. SEC-P1d. | This repo, prompt A2 |
| Tier 2 `comms.mask_pii` (SQL floor) | Built. L8's new categories are open. | This repo, prompt A2 |
| Google Safe Browsing v4 | **Wired, gated off** (`services/files/link-reputation.ts`). The v4 licence is **non-commercial**. | This repo, prompt A5 |
| ClamAV, NudeNet + OCR, Presidio (Tier 3) | **Not built.** The spec gives a reference compose file, Caddyfile and Dockerfile only (EPI §6.1). | **New repo**, prompts N1–N5 |
| SightEngine (hosted image/video/text fallback) | Not built. EPI §6.3 says off by default. | New repo, prompt N6 |
| App-side client, gates, queue, review sink | Not built. Proposed: `MODERATION_BACKEND_LIVE`, `MALWARE_SCAN_LIVE`, `SAFETY_NODE_URL`, `SAFETY_NODE_TOKEN`, `MODERATION_CRON_SECRET`. | This repo, prompts A3–A6 |

## 1. Repo decision

**Recommendation: a separate repository, `projective-safety-node`.** The app-side client stays here.

Why a separate repo:
- **Different language.** The node is Python (FastAPI, NudeNet, Presidio, Tesseract, ffmpeg); this
  repo is a Deno workspace whose root rules allow only `apps/` and `packages/`.
- **Different deploy lifecycle.** The node is a private Zone-D box with pinned image digests and
  model downloads. It must not ship with the web app.
- **One small seam.** The only shared surface is an HTTP contract plus one bearer token. Copy the
  contract's JSON schema into this repo as Zod; do not share code.

The alternative is a `services/safety-node/` folder here. It is workable, but it adds a non-Deno
member to the workspace, and the root `CLAUDE.md` would need a ruling. If you choose it, set
`<NODE_DIR>` below to `services/safety-node` and log the decision first.

## 2. Rulings needed first (from `FOUNDER_QUESTIONNAIRE.md`)

| Ruling | Why it gates this work |
| :-- | :-- |
| **T5**: approve EPI §6 (the self-hosted node) | Without it, none of the N prompts should run |
| **Q0.2a**: remove the client storage write policies (E8) | ClamAV at admission is pointless while clients can write bucket objects directly. A3 depends on it. |
| **T2 (b)/(c)**: text classifier; categories NudeNet misses | Decides whether N6 (SightEngine) is a fallback or the primary for violence and hate symbols |
| **T3**: public library originals; group photos | Decides which publish paths call the NudeNet gate (A4) |
| **T4**: review sink = `ops.reports.source` | Where Presidio findings land (A6) |
| **T5 sub**: Safe Browsing → Web Risk | Prompt A5 |
| **T5 ⚖️**: PhotoDNA hash matching | Separate vendor agreement; not in these prompts |
| EPI flag (g): one 4 vCPU / 8 GB node, or two nodes (text + media) | Sizing in step H3 |

## 3. Human setup (in order)

### H1. Accounts and keys
Put every value in a password manager, then in `.env.safety` on the node or `.env.local` in the
app. Never commit them.

1. **Google Cloud** (if T5 picked Web Risk):
   - create a project, enable the **Web Risk API**, and create an API key restricted to that API;
   - for local dev only, a Safe Browsing v4 key is acceptable.
2. **SightEngine** (if N6 runs): create an account, then note the `api_user` and `api_secret`.
   Start on the free tier and turn on only the models T2 named.
3. **Container registry**: GitHub Container Registry on the new repo is enough.
4. **Secrets**: generate `SAFETY_NODE_TOKEN` and `MODERATION_CRON_SECRET` with
   `openssl rand -hex 32`. Also put `MODERATION_CRON_SECRET` into Supabase Vault (EPI §9.3).

### H2. Create the repo
1. Create an empty private GitHub repository named `projective-safety-node`.
2. Clone it next to this repo, e.g. `C:\Users\ahmed\Documents\My Web Sites\Projective\projective-safety-node`.
3. Open a Claude Code session in that folder and run prompts N0–N6 (§4) in order.

### H3. Provision the host (after N5 passes locally)
- **Size:** one VM with 4 vCPU, 8 GB RAM and 40 GB disk (Presidio's spaCy model is about 2 GB, and
  so is the NudeNet/Tesseract image). If ruling (g) picks two nodes, use 2 vCPU / 4 GB for text
  (Presidio) and 2 vCPU / 4 GB for media (safety-api + ClamAV). Any provider works (Hetzner, DO,
  AWS).
- **Network:** a **private** link to the app only (VPC peering, a WireGuard/Tailscale tunnel, or a
  provider private network).
  - No public ingress except SSH from your IP.
  - The gateway binds to `SAFETY_NODE_BIND_IP` on the private interface.
- **OS:** Ubuntu LTS with Docker Engine and the compose plugin, unattended upgrades on, and the
  firewall default set to deny.
- **Deploy:** copy `.env.safety`, then run `docker compose --env-file .env.safety up -d`.
- **Test:** run the smoke test from N5 (EICAR, a nudity fixture, a PII string) against the private
  URL.

### H4. Wire the app
1. In this repo's `.env.local` (and production env), set:
   - `SAFETY_NODE_URL` (the private https origin);
   - `SAFETY_NODE_TOKEN`;
   - `MODERATION_CRON_SECRET`;
   - `WEB_RISK_API_KEY` (if A5 picked Web Risk).
2. Run prompts A1–A6 (§5) in **this** repo.
3. Turn the gates on, one at a time, in the EPI §6.6 order:
   - local first;
   - then staging in **shadow mode**;
   - then production:
     1. `MALWARE_SCAN_LIVE=true`;
     2. the publication gate;
     3. `MODERATION_BACKEND_LIVE=true` (Presidio Tier 3, which fails open).

### H5. Operate
- Update ClamAV signatures daily with freshclam (inside the container; check it in monitoring).
- Re-pin image digests monthly; rebuild and re-run N5's smoke test.
- Uptime check on the gateway's `/healthz` from the app network.
- Sub-processor disclosure: add Google Web Risk and SightEngine to SA §Security and the privacy
  page (#340 (j)).

## 4. Node prompts: run in `projective-safety-node`

Paste the **node header** above every N prompt, each in a fresh session.

```text
NODE HEADER — You are building `projective-safety-node`, the private content-safety service for the
Projective platform. The binding design is the Projective repo's
`documentation/api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md` §6 (6.1 topology and
compose, 6.2 Presidio, 6.3 NudeNet+OCR, 6.4 ClamAV, 6.6 dev/prod) and
`documentation/architecture/SECURITY_MODERATION_AND_AI_GAPS.md` §3–§6. Read them from
`../Projective.com/` before you write anything. Rules:
- No payload persists after scoring: no volumes for uploads, no logging of content or PII; log only
  request id, verdict, latency, model version.
- Every route is behind the Caddy gateway; Bearer `SAFETY_NODE_TOKEN` (constant-time compare);
  clamd and Presidio ports never exposed.
- Pin every image by digest and every Python package with `==`; models are fetched at BUILD time.
- Python 3.12, FastAPI, pytest; ruff for lint. Secrets only via `.env.safety` (commit
  `.env.safety.example` with XXXX-XXXX placeholders).
- Each verdict response carries `{verdict, scores, model, version, ms}`; errors are typed, never 200.
- Finish each prompt with tests passing and a commit; do not push unless asked.
```

### N0: Scaffold and the contract
- Repo layout: `gateway/` (Caddyfile), `safety-api/` (FastAPI app, Dockerfile, requirements.txt),
  `clamav/` (clamd.conf), `compose.yaml`, `.env.safety.example`, `contract/openapi.yaml`, `tests/`.
- Write `contract/openapi.yaml` for these routes:
  - `POST /scan/file` (ClamAV);
  - `POST /screen/image` (NudeNet + OCR);
  - `POST /screen/video` (sampled frames);
  - `POST /presidio/analyzer/analyze`, proxied to Presidio;
  - `GET /healthz`.
  Use the request and response shapes from EPI §6.2–§6.4.
- Write the compose file and Caddyfile from EPI §6.1. Write a README with local run steps.
- Done when `docker compose config` validates and the README explains every env var.

### N1: Gateway and auth
- Caddy enforces the bearer token, body-size limits per route and request timeouts.
- `/healthz` is unauthenticated but reveals nothing beyond `{ok}`.
- Tests: missing or wrong token gets 401; an oversized body gets 413; clamd and Presidio are
  unreachable from the host network.

### N2: ClamAV (`/scan/file`)
- Stream the bytes to clamd over INSTREAM on the internal network. Return
  `clean | infected | error` and the signature name.
- `AlertOLE2Macros` follows ruling AV-5: macro Office files are admitted privately and flagged,
  never published.
- Run freshclam in the container, and expose the signature age in `/healthz` details behind the
  token.
- Tests: the EICAR string → infected; a clean PDF → clean; clamd down → a typed 503 (the app fails
  closed).

### N3: NudeNet + OCR (`/screen/image`, `/screen/video`)
- NudeNet v3 with thresholds read from env, defaulting to the EPI §6.3 values. Tesseract OCR text is
  returned for the app's Tier 1/2 text checks.
- Re-decode every image with Pillow, and refuse decompression bombs: set a max-pixels limit and
  refuse anything over it.
- Video and GIF: ffmpeg samples frames at the T2 density (default 1 fps, max 60 frames), with the
  verdict as the max over frames.
- Tests use small committed fixtures: a safe image, a synthetic explicit-label stub (mock the model
  in unit tests; one real-model integration test), a GIF, and a decompression bomb.

### N4: Presidio (Tier 3)
- Analyzer and anonymizer images from EPI §6.2, plus custom recognizers for the platform's leak
  patterns: IBAN, crypto wallets, phone numbers with ≥ 9 digits, and "contact me on…" handles.
  The `pii.fixtures.ts` corpus in the main repo defines them; port it to a JSON fixture here.
- The safety-api `/screen/text` wraps the analyzer and returns entity types and scores, **never**
  the matched text.
- Tests: every corpus case scores as expected; the response contains no substring of the input.

### N5: Smoke test, CI and the deploy script
- `tests/smoke.sh <url> <token>` hits every route with EICAR, a safe image, a PII sentence and a
  bad token.
- GitHub Actions: lint, unit tests, image build, digest pinning check (fail on any `:latest`),
  and push to GHCR on tag.
- `deploy/README.md`: the H3 steps as commands.

### N6: SightEngine fallback (only if T2 enabled it)
- Add `/screen/image` and `/screen/video` fallback modes. Call SightEngine only for the categories
  T2 assigned to it (e.g. violence, hate symbols, weapons), or when NudeNet is unavailable, if the
  ruling allows.
- The app passes **public-zone media only**; private-zone bytes never leave the node (EPI §3.5).
  Enforce this with a required `zone=public` field, and refuse anything else.
- Keys: `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET`. Gate the fallback with
  `SIGHTENGINE_ENABLED=false` by default.
- Tests mock the HTTP API, and cover timeout → `error` (the app decides fail-closed).

## 5. App prompts: run in this repo (`Projective.com`)

Paste the standard header from `FINANCE_BUILD_PROMPTS.md` §1 above each, in a fresh session. The
order slots into Track T of `FOUNDER_QUESTIONNAIRE.md` §B.3: E8 → A2 → hardening → R1 → A3 → A4 → A6.

### A1: Finish the sniffers (SEC V3, V5, V6; CAS F15)
- PDF, ZIP and OOXML magic-byte sniffer. A declared type that disagrees with the sniffed type is
  refused.
- V5: a bounded media worker queue.
- V6: a files-upload-sweep job (registered by the jobs owner of `00005060`) and an `initUpload` cap.
- No ruling needed; it can run now.

### A2: Tier 1 pre-filter and Tier 2 categories (SEC-P1d, L8)
- `packages/types/comms/pii-detect.ts` with a fixture corpus `pii.fixtures.ts`. It is called by
  both send doors, `send_request_message`'s caller, and the L7 write services.
- L8: IBAN mod-97, crypto and ≥ 9-digit phones added to `comms.mask_pii` in `00001300`.
- Refusal telemetry: counts only (#147 (b)).
- If the unified send door (N1/#339 (f)) has landed, there is one insertion point; otherwise there
  are two. Say which in the PR.

### A3: Safety client and malware admission (EPI §6.4; requires Q0.2a done, node N2 deployed)
- `packages/backend/services/moderation/safety-client.ts`:
  - typed calls to the node contract;
  - Zod copied from `contract/openapi.yaml`;
  - bearer from env;
  - timeouts;
  - fail **closed** for malware and publication.
- Admission in `live-uploads.ts` and `contact/live-attachments.ts` scans before the object is
  committed, with the verdict stored in `files.items.metadata.av`. Add a rescan job.
- Gate `MALWARE_SCAN_LIVE`. Add the Dev Context Switcher axis `pj.dev.malware` (auto, clean,
  infected, error) per root §5.
- Add the env keys to `.env.example` and SA's env contract in the same change.

### A4: Publication gate (EPI §6.3, SEC §3; requires T3 and node N3)
- Every publish path T3 named (showcase renditions, public assets, catalogue media, group avatars)
  calls `/screen/image` or `/screen/video`, then runs the OCR text through Tier 1/2. Results go in
  `files.publication_screenings`, plus a correction notice to the owner.
- Fail closed. A Dev Context Switcher axis `pj.dev.moderation`. Thresholds in
  `security.platform_params`.

### A5: Link safety (EPI §6.5; requires the T5 sub-ruling)
- Swap `link-reputation.ts` to Google Web Risk `uris.search` (keep a v4 adapter for local dev only,
  refused under production).
- Cache verdicts (safe 1 h, flagged 24 h). Look up links only on post, never on page view.
- Update the SA §Security sub-processor disclosure.

### A6: Presidio Tier 3 queue and review (EPI §6.2; requires T4 and R1, node N4)
- `ops.moderation_queue`, a moderation-drain job (`MODERATION_CRON_SECRET` bearer), and a
  `ModerationBackendService` that calls `/screen/text`.
- Findings go to `ops.reports` with `source='presidio'`. Fail **open**: Tier 2 remains the floor.
- Gate `MODERATION_BACKEND_LIVE`. Staging runs in shadow mode (reviews are created, nobody is
  notified).

## 6. Order at a glance

1. **Rulings:** T5, Q0.2a, T2, T3, T4.
2. **This repo, now:** A1 and A2 (no node needed).
3. **New repo:** N0 → N1 → N2 → N3 → N4 → N5 → N6. N2, N3 and N4 can run in parallel sessions once
   N1 lands; they touch separate modules, but serialise any edits to `compose.yaml`.
4. **Host:** H1 → H3 after N5 passes locally.
5. **This repo, after the node is up:** A3 → A4 → A5 → A6, then turn the gates on per H4.
