# Safety Node: Setup Runbook & Build Prompts

> **Status: WORK ORDERS, not binding.** This document covers building and hosting the content-safety
> node: ClamAV, NudeNet plus OCR and Microsoft Presidio, behind one authenticated gateway, in its
> own repository, `Projective-Safety`.
>
> The design is already specified. This file does not restate it; it links to:
>
> - `documentation/api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md` §6 (EPI, Decision
>   #335, Proposed);
> - `SECURITY_MODERATION_AND_AI_GAPS.md` §2–§6 (SEC, #340).
>
> **Reconciled 2026-10-30 with [`TRUST_SAFETY_BUILD_PROMPTS.md`](TRUST_SAFETY_BUILD_PROMPTS.md)**
> (Decision #345). This file owns the node: the human setup (H1–H5) and the node prompts (N0–N5).
> Every change in this repo is a TRUST prompt (§5 maps them), the rulings this work waited for are
> made (§2), and N6 is withdrawn because the app calls Sightengine itself (TRUST SN4).

## 0. What already exists and what does not

| Piece                                                          | State today                                                                                                                                                                    | Where it is built                  |
| :------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------- |
| Magic-byte sniffing and image decoders                         | **Built.** It refuses markup, undecodable images and video renditions, and falls back to octet-stream (Wave 0, SEC V1/V2/V4/Z2). V3 (the PDF/ZIP/OOXML sniffer) is still open. | This repo, TRUST SN2               |
| Tier 1 in-process pre-filter (regex PII, IBAN, crypto, phones) | Not built. SEC-P1d.                                                                                                                                                            | This repo, TRUST P1d               |
| Tier 2 `comms.mask_pii` (SQL floor)                            | Built. L8's new categories are open.                                                                                                                                           | This repo, TRUST P1d               |
| Google Safe Browsing v4                                        | **Wired, gated off** (`services/files/link-reputation.ts`). The v4 licence is **non-commercial**; ruling T5 moves it to Google Web Risk.                                       | This repo, TRUST W1                |
| ClamAV, NudeNet + OCR, Presidio (Tier 3)                       | **Not built.** N0 (the scaffold and the HTTP contract) is committed in `Projective-Safety`.                                                                                    | `Projective-Safety`, prompts N1–N5 |
| Sightengine (hosted toxicity, violence and hate-symbol checks) | Not built. Ruling T2 makes it the hosted check for Glass Front media and text only.                                                                                            | This repo, TRUST SN4               |
| App-side client, gates, queue, review sink                     | Not built. `MALWARE_SCAN_LIVE`, `MODERATION_BACKEND_LIVE`, `SAFETY_NODE_URL`, `SAFETY_NODE_TOKEN`, `MODERATION_CRON_SECRET`.                                                   | This repo, TRUST SN1–SN6           |

## 1. Repo decision

**Decided: a separate repository.** The owner created it as `Projective-Safety`, beside this repo,
and committed N0 there. The app-side client stays here, and TRUST SN1's in-repo `infra/safety-node/`
is withdrawn.

Why a separate repo:

- **Different language.** The node is Python (FastAPI, NudeNet, Presidio, Tesseract, ffmpeg); this
  repo is a Deno workspace whose root rules allow only `apps/` and `packages/`.
- **Different deploy lifecycle.** The node is a private Zone-D box with pinned image digests and
  model downloads. It must not ship with the web app.
- **One small seam.** The only shared surface is an HTTP contract plus one bearer token. The
  contract is `Projective-Safety/contract/openapi.yaml`; this repo copies its schema as Zod and
  shares no code. Its route names (`GET /healthz`, `POST /scan/file`, `POST /screen/image`,
  `POST /screen/video`, `POST /presidio/analyzer/analyze`) win over EPI §6's `/v1/…` examples.

## 2. Rulings (all made 2026-10-30, Decision #340)

| Ruling               | What it settles here                                                                                                                                   |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T5**               | EPI §6's self-hosted node is approved: one node, 4 vCPU / 8 GB (this also settles EPI flag (g)).                                                       |
| **Q0.2 (a)**         | The client storage write policies go (TRUST E8). ClamAV at admission is pointless before that, so TRUST SN1 waits for E8.                              |
| **T2 (b), (c)**      | Sightengine is the hosted check for toxicity, violence and hate symbols, on Glass Front media and text only, called by the app (TRUST SN4).            |
| **T2 (frames)**      | One frame every 2 s, at most 30, always the first and last, and every thumbnail cut from a frame is screened too (N3).                                 |
| **T3**               | (a) A public library file is served as a screened, metadata-stripped copy; (b) group photos are screened. These are the publish paths TRUST SN3 gates. |
| **T4**               | The review sink is `ops.reports.source`, where Presidio findings land (TRUST R1, SN6).                                                                 |
| **T5 (link safety)** | Google Web Risk (TRUST W1); a Safe Browsing v4 key only for local development.                                                                         |
| **T5 ⚖️ (PhotoDNA)** | Ruled, pending counsel. TRUST H1 builds hash matching behind a flag that stays off; it is a separate vendor agreement, not part of these prompts.      |

## 3. Human setup (in order)

### H1. Accounts and keys

Put every value in a password manager, then in `.env.safety` on the node or `.env.local` in the app.
Never commit them.

1. **Google Cloud** (Web Risk, ruling T5):
   - create a project, enable the **Web Risk API**, and create an API key restricted to that API;
   - for local dev only, a Safe Browsing v4 key is acceptable.
2. **Sightengine** (ruling T2; TRUST SN4): create an account under data-processing terms, then note
   the `api_user` and `api_secret`. Start on the free tier and turn on only the models T2 named.
3. **Container registry**: GitHub Container Registry on `Projective-Safety` is enough.
4. **Secrets**: generate `SAFETY_NODE_TOKEN` and `MODERATION_CRON_SECRET` with
   `openssl rand -hex 32`. Also put `MODERATION_CRON_SECRET` into Supabase Vault (EPI §9.3).

### H2. The repo

Done: the repository is `Projective-Safety`, cloned beside this repo, with N0 committed. Run N1–N5
(§4) in sessions opened in that folder.

### H3. Provision the host (after N5 passes locally)

- **Size:** one VM with 4 vCPU, 8 GB RAM and 40 GB disk (ruling T5; Presidio's spaCy model is about
  2 GB, and so is the NudeNet/Tesseract image). Any provider works (Hetzner, DO, AWS).
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
   - `SAFETY_NODE_URL` (the private https origin; `http://127.0.0.1:8443` locally);
   - `SAFETY_NODE_TOKEN`;
   - `MODERATION_CRON_SECRET`;
   - `WEB_RISK_API_KEY` (TRUST W1).
2. Run the app-side prompts in **this** repo: `TRUST_SAFETY_BUILD_PROMPTS.md`'s SN1–SN6, W1 and P1d
   (§5 maps them, and says which node prompt each waits for).
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
- Sub-processor disclosure: Google Web Risk and Sightengine in SA §Security and the privacy page
  (#340 (j)); TRUST W1 and SN4 make that change.

## 4. Node prompts: run in `Projective-Safety`

Paste the **node header** above every N prompt, each in a fresh session.

```text
NODE HEADER — You are building `Projective-Safety`, the private content-safety service for the
Projective platform. The binding design is the Projective repo's
`documentation/api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md` §6 (6.1 topology and
compose, 6.2 Presidio, 6.3 NudeNet+OCR, 6.4 ClamAV, 6.6 dev/prod) and
`documentation/architecture/SECURITY_MODERATION_AND_AI_GAPS.md` §3–§6. Read them from
`../Projective.com/` before you write anything. The route contract is this repo's
`contract/openapi.yaml`; where EPI's examples say `/v1/…`, the contract wins. Rules:
- No payload persists after scoring: no volumes for uploads, no logging of content or PII; log only
  request id, verdict, latency, model version.
- Every route is behind the Caddy gateway; Bearer `SAFETY_NODE_TOKEN` (constant-time compare);
  clamd and Presidio ports never exposed.
- Pin every image by digest and every Python package with `==`; models are fetched at BUILD time.
- Python 3.12, FastAPI, pytest; ruff for lint. Secrets only via `.env.safety` (commit
  `.env.safety.example` with XXXX-XXXX placeholders).
- Each verdict response carries `{verdict, scores, model, version, ms}`; errors are typed, never 200.
- A route added or changed lands in `contract/openapi.yaml` in the same change.
- Finish each prompt with tests passing and a commit; do not push unless asked.
```

### N0: Scaffold and the contract — ✅ done (`f6c46b8`)

- The layout (`gateway/`, `safety-api/`, `clamav/`, `compose.yaml`, `.env.safety.example`,
  `contract/openapi.yaml`, `tests/`) and the contract's routes: `POST /scan/file`,
  `POST /screen/image`, `POST /screen/video`, `POST /presidio/analyzer/analyze` and `GET /healthz`.

### N1: Gateway and auth

- Caddy enforces the bearer token, body-size limits per route and request timeouts.
- `/healthz` is unauthenticated but reveals nothing beyond `{ok}`.
- Tests: missing or wrong token gets 401; an oversized body gets 413; clamd and Presidio are
  unreachable from the host network.

### N2: ClamAV (`/scan/file`) — TRUST SN1 waits for it

- Stream the bytes to clamd over INSTREAM on the internal network. Return
  `clean | infected | error`, the signature name, and the engine, `db_version` and `db_time` (TRUST
  SN1 stores them on the file row).
- clamd.conf per EPI §6.4: StreamMaxLength and MaxFileSize 64M, MaxScanSize 256M, MaxRecursion 16,
  ConcurrentDatabaseReload no, AlertEncrypted no.
- `AlertOLE2Macros yes` (ruling AV-5): `Heuristics.OLE2.ContainsMacros` maps to
  `{ verdict: 'clean', flags: ['macros'] }`, never infected; the app admits such a file privately
  and never publishes it.
- Run freshclam in the container, and expose the signature age in `/healthz` details behind the
  token.
- Tests: the EICAR string → infected; a clean PDF → clean; a macro `.docm` → clean with
  `['macros']`; clamd down → a typed 503 (the app fails closed).

### N3: NudeNet + OCR (`/screen/image`, `/screen/video`), and the video remux — TRUST SN3 and SN5 wait for it

- NudeNet v3 with thresholds read from env, defaulting to the EPI §6.3 values. Tesseract OCR text is
  returned for the app's Tier 1/2 text checks.
- Re-decode every image with Pillow, and refuse decompression bombs: set a max-pixels limit and
  refuse anything over it.
- Video and GIF: ffmpeg samples one frame every 2 s, at most 30, always the first and last (ruling
  T2), with the verdict as the max over frames. Every thumbnail the app cuts from a frame is
  screened through `/screen/image` as well.
- Add `POST /remux/video` to the contract: ffmpeg `-map_metadata -1 -map_chapters -1 -c copy`,
  faststart, and the output re-sniffed. TRUST SN5 publishes videos through it.
- Tests use small committed fixtures: a safe image, a synthetic explicit-label stub (mock the model
  in unit tests; one real-model integration test), a GIF, a video carrying GPS metadata (gone after
  the remux), and a decompression bomb.

### N4: Presidio (Tier 3) — TRUST SN6 waits for it

- Analyzer and anonymizer images from EPI §6.2, plus custom recognizers for the platform's leak
  patterns: IBAN, crypto wallets, phone numbers with ≥ 9 digits, and "contact me on…" handles. The
  `pii.fixtures.ts` corpus in the main repo (TRUST P1d writes it) defines them; port it to a JSON
  fixture here.
- `/presidio/analyzer/analyze` returns entity types and scores, **never** the matched text.
- Tests: every corpus case scores as expected; the response contains no substring of the input.

### N5: Smoke test, CI and the deploy script

- `tests/smoke.sh <url> <token>` hits every route with EICAR, a safe image, a PII sentence and a bad
  token.
- GitHub Actions: lint, unit tests, image build, digest pinning check (fail on any `:latest`), and
  push to GHCR on tag.
- `deploy/README.md`: the H3 steps as commands.

### N6: withdrawn

Ruling T2 makes Sightengine the hosted check for public media and public text, which the app's write
services already hold, so TRUST SN4 calls it from the app
(`packages/backend/services/moderation/sightengine.ts`). The node keeps no Sightengine code, and
nudity never falls back to it.

## 5. App prompts: they live in `TRUST_SAFETY_BUILD_PROMPTS.md`

The work in this repo is written once, as TRUST prompts run under that file's §1 standard header.
The A-prompts this file first drafted map onto them:

| Drafted here                           | Now                                          | Waits for, in `Projective-Safety` |
| :------------------------------------- | :------------------------------------------- | :-------------------------------- |
| A1 sniffers (SEC V3, V5, V6; CAS F15)  | TRUST SN2                                    | —                                 |
| A2 Tier 1 and the L8 categories        | TRUST P1d                                    | —                                 |
| A3 safety client and malware admission | TRUST SN1, then SN2's one admission contract | N1, N2                            |
| A4 publication gate                    | TRUST SN3 (and SN5 for video)                | N3                                |
| A5 link safety (Web Risk)              | TRUST W1                                     | —                                 |
| A6 Presidio Tier 3 queue and review    | TRUST SN6                                    | N4                                |

## 6. Order at a glance

1. **Rulings:** made (§2).
2. **This repo, now:** TRUST E8 first; P1d, SN2 and W1 need no node.
3. **`Projective-Safety`:** N1 → N2 → N3 → N4 → N5 (N0 is done). N2, N3 and N4 can run in parallel
   sessions once N1 lands; they touch separate modules, but serialise any edits to `compose.yaml`
   and `contract/openapi.yaml`.
4. **Host:** H1 → H3 after N5 passes locally.
5. **This repo, as each node route lands:** TRUST SN1 (after N2), SN3 and SN5 (after N3), SN6 (after
   N4); then turn the gates on per H4.
