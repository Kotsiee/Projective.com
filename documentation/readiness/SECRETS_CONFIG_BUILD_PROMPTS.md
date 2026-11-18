# Secrets & Configuration Build Prompts — closing PRODUCTION_READINESS §H

> **Status: WORK ORDERS, not binding.** Claude Code prompts that take
> [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) §H (Secrets & configuration, 61% at 2026-11-18)
> to 100%. Written 2026-11-18 against `main` @ `b7280787`. All three open rows were re-checked in
> code that day; the env keys were diffed by script across `SYSTEM_ARCHITECTURE.md`'s contract,
> `.env.example`, `packages/backend/core/env.ts`, `supabase/config.toml` and every direct read.
>
> **No row here has a work order yet**, so both prompts are new: **CFG1** closes PRD-H4 and PRD-H5
> (one env manifest, kept honest by a contract test). **CFG2** closes PRD-H2 (a two-key ring, a
> lease-safe re-seal sweep and the rotation runbook). None of the three open rows gates UAT; all
> three are PROD.
>
> **Shared with the other readiness files.** The planned providers' keys (PRD-H5) are added by the
> prompts that build those providers. CFG1 names them as **planned** and does not build them:
>
> - COMMS NT2–NT5 ([COMMS_DELIVERY_BUILD_PROMPTS.md](COMMS_DELIVERY_BUILD_PROMPTS.md));
> - T&S SN1 ([TRUST_SAFETY_BUILD_PROMPTS.md](../architecture/TRUST_SAFETY_BUILD_PROMPTS.md));
> - OPS5 ([OPERATIONS_BUILD_PROMPTS.md](OPERATIONS_BUILD_PROMPTS.md));
> - SAC6 ([SECURITY_ACCESS_BUILD_PROMPTS.md](SECURITY_ACCESS_BUILD_PROMPTS.md)).
>
> CFG1's manifest is also the "one exported list" that OPS6's `deploy:check` reads.

---

## 0. Map, run order and stops

### 0.1 Row → work order

| Row    | Gate | Crit     | Work order                    | The row flips to ✅ when                                                                                                      |
| :----- | :--- | :------- | :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| PRD-H1 | UAT  | Critical | — (already ✅, #343)          | —                                                                                                                             |
| PRD-H2 | PROD | High     | **CFG2**                      | The rotation drill ends with every row re-sealed under the new key, the old one removed, and every row opening                |
| PRD-H3 | UAT  | High     | — (already ✅)                | —                                                                                                                             |
| PRD-H4 | PROD | Normal   | **CFG1**                      | `env-contract.contract.test.ts` is green, and no code under `apps/` or `packages/` reads the env outside `env.ts`             |
| PRD-H5 | PROD | Normal   | **CFG1** (names them planned) | Every planned provider key is in the manifest, the contract and `.env.example`, each naming the work order that makes it live |

**PRD-H4's evidence is partly stale.** It says SA's contract lacks `RESEND_API_KEY` and `MAIL_FROM`.
Both are there now. What the diff still finds:

- `USE_MOCKS` and `PORT` are missing from the contract.
- `env.ts` keeps a dead `VITE_USE_MOCKS` alias, which nothing sets.
- `.env.example` carries seven keys that only `supabase/config.toml` reads. The contract names them
  by category only.
- No tooling variable is listed anywhere.
- Four direct reads bypass `env.ts`: `routes/api/_middleware.ts:10`, `routes/_middleware.ts:45`
  (new, from SAC4), `utils/csp.ts:150` and `utils/app-env.ts:13`.

CFG1 rewrites the evidence when it lands.

### 0.2 Run order

| Lane | Prompt   | Holds                                                         | When                                                                                                                                                           |
| :--- | :------- | :------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App  | **CFG1** | `packages/backend/core/env.ts`, `.env.example`, SA's contract | Any time. Other prompts add keys to these files, so rebase right before you commit: the new test names any key they added.                                     |
| SQL  | **CFG2** | `00001500`, `00002510`, `00005060`                            | When the shared SQL lane hands it `00002510` and `00005060` (one writer each, across all tracks). After CFG1 if it can, so its new key goes into the manifest. |

They touch different files and can run at the same time. If CFG2 lands first, CFG1 lists
`ENCRYPTION_KEY_PREVIOUS` in the manifest.

**§H score projection** (weights: Critical 3 · High 2 · Normal 1; total 9):

| After | Score | Rows that flip |
| :---- | ----: | :------------- |
| Today |   61% | —              |
| CFG1  |   78% | H4, H5         |
| CFG2  |  100% | H2             |

### 0.3 Human stops

**None.** Both prompts run to the end on architect defaults. Each default is written in its prompt,
for you to confirm or override:

- **CFG1:**
  - planned keys sit in `.env.example` as commented lines in a "Planned" block, so a copied file
    sets nothing that nothing reads;
  - tooling variables are listed in the contract, marked as tooling.
- **CFG2:**
  - the ring is two keys, `ENCRYPTION_KEY` and `ENCRYPTION_KEY_PREVIOUS`;
  - the re-seal sweep runs hourly as a no-op until a rotation starts;
  - routine rotation is at least yearly.

The decision that matters was already made: the vault keys on an env variable, not a KMS (Decision
#343, ruling C4 (c)). CFG2 keeps that ruling.

---

## 1. Headers

### 1.1 Standard header — paste above every CFG prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/types the Zod SSOT @projective/types; packages/backend fat services
@server/services/*, with packages/backend/core/env.ts the one typed reader of the server
environment; supabase/migrations Postgres with RLS everywhere; Supabase CLI config in
supabase/config.toml).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (always
     documentation/CLAUDE.md; documentation/database/CLAUDE.md when SQL changes), then
     documentation/reference/guardrails.md and documentation/reference/pr-checklist.md.
  2. Read documentation/readiness/PRODUCTION_READINESS.md §H and
     documentation/readiness/SECRETS_CONFIG_BUILD_PROMPTS.md §0. Read SYSTEM_ARCHITECTURE.md
     §Environment Variable Contract and §The token vault.
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. At minimum: #125 (env files and the cron bearer), #335 and #343
     (ruling C4: the token vault and its key), #447 (the Turnstile test keys), #444 (the readiness
     tracker). If a decision already rules the behaviour you are about to change, stop and ask me.
  4. The CONTEXT below was verified at main @ b7280787 on 2026-11-18. Re-check every file:line
     against the current tree before relying on it.

Hard rules (merge gates; reject your own diff if any fails):
  Secrets
  - No secret value in a migration, seed, probe, fixture, test, log, commit or tool output, ever.
    .env.example holds XXXX-XXXX for every secret (Turnstile's published test keys are the one
    exception, Decision #447), and false for every *_BACKEND_LIVE gate.
  - Never change the shared .env.local. Every session in this checkout reads it, and its
    ENCRYPTION_KEY seals their rows. Prove anything key-related on a throwaway database with a
    throwaway env.
  - A key, DEK or plaintext token is zeroed after use, and never logged, returned to a route, or
    attached to an error.
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE; never an ALTER patch or a "fix" file. Each
    statement goes in its category file (1 functions: 00001500 integrations; 2 grants: 00002510; 5
    seed: 00005060 jobs). The Additive Rule: no dropped table, column or FK without my OK. 00002510
    and 00005060 have one writer at a time across ALL tracks.
  - A new SECURITY DEFINER function pins search_path = '' and schema-qualifies every name; it is
    REVOKEd from PUBLIC, anon and authenticated, and granted to service_role.
  - Thin routes; logic lives in packages/backend/services/* and returns ServiceResult<T> (Decision
    #10). Islands never import Supabase or @server/*. Web code imports the env reader as
    @projective/backend/core/env.ts (apps/web/features/marketing/core/site-origin.ts does).
  - These land in the same change as the thing they describe:
      an env key → SYSTEM_ARCHITECTURE.md §Environment Variable Contract, .env.example and env.ts
        (and the manifest, once CFG1 has landed);
      a job → its row in SYSTEM_ARCHITECTURE.md §Scheduled jobs;
      a schema or RPC change → documentation/database/*.
  - Path aliases only; JSDoc on exports; // #region blocks; no meta-comments.
  - A NEW contradiction between source docs: do not pick a side. Add a decision row (the newest
    decisions-*.md + a README index line; re-check the next free number right before writing) and
    ask me.

Verification: reproduce the gap first (a failing test or probe), then close it.
  SQL: rollback-safe probes under supabase/probes/ (BEGIN … ROLLBACK); `deno task test:probes`; at
  most two SQL sessions on the one local DB, on disjoint migration files. `deno task db:reset` is
  standing-approved, but announce it to concurrent sessions first. Finish with your own clean
  `deno task test:probes:fresh`.
  Always: `deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt` on the files
  you touched only (never a directory). Compare any red unit test with main before calling it yours
  (theme-engine failures are pre-existing, Decisions #96 (a) and #157 (m)). Docs and .env.example
  are CRLF in the working tree: edit them with an editor tool, never sed.
This checkout may be shared with other sessions: never switch branch, never stash, stage only your
own hunks. Commit on the branch you were given. Do not push or open a PR unless I ask.
```

### 1.2 Readiness addendum — paste after every CFG prompt

```text
READINESS (Decision #444): in the same change, update documentation/readiness/
PRODUCTION_READINESS.md: the row(s) <ROWS> — status, and evidence naming your commit and
decision; recompute the §H line and the three tier rows of the Scoreboard (score = Σ weight ×
credit / Σ weight; ✅ 1 · 🟡 0.5 · ❌ 0; Critical 3 · High 2 · Normal 1; ⏸ rows excluded; a row
counts toward its Gate tier and every later tier); add one line to §Score history. A gap you find
and do not fix gets a new row at the end of §H, never silence. Several sessions edit this file
each day: re-read it right before you edit, and change only your rows and the totals.
```

---

## 2. Existing work orders that touch §H

None owns a §H row. These prompts add §H keys as they build their providers. After CFG1 lands, each
one flips its keys from **planned** to **live** in the manifest, in its own change. Their pasters
need no other delta.

| Work order                    | Keys it makes live                                                                                                                    |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| COMMS NT2                     | `COMMS_DISPATCH_SECRET` (also a Vault secret, so OPS1's tool picks it up from the job registry)                                       |
| COMMS NT3                     | `RESEND_WEBHOOK_SECRET`                                                                                                               |
| COMMS NT4                     | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                                                                              |
| COMMS NT5                     | the Twilio transport's keys (read NT5 for their names)                                                                                |
| T&S SN1 (and the safety node) | `SAFETY_NODE_URL`, `SAFETY_NODE_TOKEN`, `MALWARE_SCAN_LIVE`, `FILES_CRON_SECRET`, `MODERATION_BACKEND_LIVE`, `MODERATION_CRON_SECRET` |
| OPS5 / MONEY MR4              | `OPS_CRON_SECRET`, `OPS_HEALTH_TOKEN`, `OPS_ALERT_WEBHOOK_URL`, `OPS_ALERT_EMAIL`                                                     |
| SSO1 (Identity §5)            | `AUTH_SSO_ENABLED`                                                                                                                    |
| SAC6, OPS1                    | tooling only: `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `CRON_VAULT_DB_URL` (inside an env file)                               |

This list is a starting point, not the inventory. CFG1 harvests the complete one.

---

## 3. New prompts

### CFG1 — One env manifest, and a contract test that keeps every copy of it equal

Closes PRD-H4 and PRD-H5.

```text
PROMPT CFG1: One env manifest, and a contract test that keeps SYSTEM_ARCHITECTURE's contract,
.env.example, env.ts and config.toml equal to it

ROLE: Platform engineer. App lane: no migration. packages/backend/core/env.ts and .env.example are
edited by many prompts, so rebase them right before you commit.

CONTEXT (diffed by script on 2026-11-18 at b7280787; PRD-H4's evidence is partly stale):
  - SA's contract now names RESEND_API_KEY and MAIL_FROM. Still missing: USE_MOCKS and PORT, both in
    .env.example and env.ts.
  - env.ts reads VITE_USE_MOCKS as an alias of USE_MOCKS. Nothing sets it (deno.json, vite.config.ts,
    scripts and .env* never do), and env.ts's header says "no fallback aliases remain".
    SUPABASE_PUBLIC_URL falling back to SUPABASE_URL is another alias the header does not mention.
  - .env.example carries seven keys env.ts never reads: OPENAI_API_KEY, S3_HOST, S3_REGION,
    S3_ACCESS_KEY, S3_SECRET_KEY, SUPABASE_AUTH_EXTERNAL_APPLE_SECRET and
    SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN. All are env() references in supabase/config.toml (:114,
    :489-495, :416, :384), which the Supabase CLI resolves; the app does not. So are
    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (:499-500), SUPABASE_AUTH_CAPTCHA_SECRET (:245) and
    SUPABASE_AUTH_SMTP_PASS / SUPABASE_AUTH_SMTP_ADMIN_EMAIL (:277-278). SA names this group only
    as a category ("Google sign-in, Twilio, Apple, S3, GoTrue SMTP, the Turnstile secret").
    SAML_PRIVATE_KEY (:343) and SECRET_VALUE (:53) sit in commented examples: check that before
    listing them.
  - Direct reads that bypass env.ts:
      apps/web/routes/api/_middleware.ts:10: Deno.env.get("APP_URL") into
        refuseCrossSiteWrite(req, appUrl?);
      apps/web/routes/_middleware.ts:45: the same for page writes (SAC4; it may still be
        uncommitted);
      apps/web/utils/csp.ts:150: SUPABASE_PUBLIC_URL ?? SUPABASE_URL;
      apps/web/utils/app-env.ts:13: DENO_ENV, "matching serverEnv().appEnv" (unset means
        production).
    CAREFUL: serverEnv().appUrl DEFAULTS to http://localhost:<PORT> when APP_URL is unset, while
    the CSRF guard is handed undefined today. Read refuseCrossSiteWrite and ownOrigins
    (apps/web/utils/csrf.ts:106) before you switch. If undefined means "trust only the request's
    own origin", the default would widen that to localhost on a misconfigured deploy. Keep today's
    behaviour exactly, for example with an accessor that has no default.
  - Tooling variables are listed nowhere: PROBES_DB_CONTAINER, SMOKE_DB_CONTAINER, STRIPE_MOCK_URL,
    and 16 E2E_* names in apps/web/tests/e2e/. Peers are adding more: SAC6's SUPABASE_PROJECT_REF
    and SUPABASE_ACCESS_TOKEN, and OPS1's CRON_VAULT_DB_URL.
  - PRD-H5: the planned providers' keys are named only inside the prompts that build them
    (SECRETS_CONFIG_BUILD_PROMPTS.md §2 starts the list). Harvest the complete list: grep every
    documentation/architecture/*_BUILD_PROMPTS.md and documentation/readiness/*_BUILD_PROMPTS.md
    for new env keys in FILES and SAME CHANGE lines, and record which work order each comes from.
  - OPS6's deploy:check needs "one exported list that env.ts and the script share". This prompt
    builds that list.

FILES:
  - packages/backend/core/env-manifest.ts (new): pure data with JSDoc, no Deno.env read. One entry
    per name:
      name;
      reader: 'app' | 'supabase-cli' (an env() in config.toml) | 'tooling';
      kind: 'secret' | 'gate' | 'url' | 'config';
      status: 'live' | 'planned', where planned also carries the work order that builds it (for
        example "COMMS NT4");
      requiredIn: development · staging · production.
    Never a value.
  - packages/backend/core/env.ts. Reads stay as they are, except:
      USE_MOCKS without the VITE_ alias;
      the accessors the four direct reads need, without defaults where today's code has none;
      the header states which aliases remain, and why.
  - The four direct-read files: read through env.ts instead (serverEnv(), or the DENO_ENV reader
    env.ts already has).
  - packages/backend/core/env-contract.contract.test.ts (new). Pure file reads, no network; follow
    gotrue-config.contract.test.ts and captcha.contract.test.ts. It fails when any of these hold:
      a name env.ts reads (any firstEnv argument) has no manifest entry, or an 'app' entry that is
        live is not read by env.ts;
      a non-comment env(NAME) in supabase/config.toml has no 'supabase-cli' entry, or vice versa;
      any Deno.env.get(...) or import.meta.env.NAME exists under apps/ or packages/ outside
        env.ts. Tests and scripts are exempt as tooling, and Vite's import.meta.env.DEV is allowed
        by name;
      a manifest name is missing from SA §Environment Variable Contract or from .env.example
        (planned names appear there as commented lines in a "Planned" block);
      .env.example holds a name the manifest does not;
      a secret in .env.example holds anything but XXXX-XXXX (except Turnstile's published test
        keys, #447), or a gate holds anything but false.
    Each failure message names the key and the three places to add it.
  - .env.example: the supabase-cli keys grouped and labelled; a Planned block (commented lines,
    each naming its work order).
  - SYSTEM_ARCHITECTURE.md §Environment Variable Contract: every manifest name, grouped by reader
    (app · Supabase CLI · tooling) and by status (live · planned → its work order). Include
    USE_MOCKS (what it overrides, and that `dev` and `dev:mock` pin it) and PORT.
  - documentation/reference/pr-checklist.md, one line: "A new env key goes in the manifest, SA's
    contract and .env.example in the same change; env-contract.contract.test.ts enforces it. A
    planned key flips to live when its feature lands."

STEPS:
  1. Write the test first, against today's tree. It must fail on exactly the gaps CONTEXT lists,
     plus any a peer has added since; list those in your report.
  2. Build the manifest from the union of env.ts, config.toml, .env.example, the tooling reads and
     the harvested planned keys.
  3. Route the four direct reads through env.ts without changing behaviour. One unit test per site
     pins it: APP_URL unset gives the same guard result as today; SUPABASE_PUBLIC_URL unset falls
     back to SUPABASE_URL's origin; DENO_ENV unset means production.
  4. Remove VITE_USE_MOCKS once you have confirmed nothing sets it.
  5. Fix the docs and .env.example until the test is green.
  6. If OPS6 has landed, make deploy:check read requiredIn from the manifest and delete its own
     list. If it has not, leave it: OPS6 is told to read the manifest.

ACCEPTANCE:
  - env-contract.contract.test.ts fails on today's tree (step 1, shown in your report) and passes
    after.
  - Adding firstEnv("FOO") with no manifest entry makes it fail, with a message that names FOO and
    the three places to add it.
  - The four sites behave as before (their tests).
  - check, lint, test:unit green.
```

§1.2 rows: **PRD-H4 → ✅**. **PRD-H5 → ✅**: every planned provider key is named in the contract
with its work order; making each one live belongs to that prompt.

### CFG2 — The token vault rotates its key without stranding a row or losing a refresh

Closes PRD-H2.

```text
PROMPT CFG2: A two-key ring, a lease-safe re-seal sweep and a rotation runbook for the token vault

ROLE: Security + backend engineer. SQL lane (00001500, 00002510, 00005060), plus token-vault.ts,
the integrations service and one thin cron route. Holds 00002510 and 00005060 while it runs.

CONTEXT:
  - token-vault.ts seals under ENCRYPTION_KEY only.
      key_id = 'env:' + the first 8 hex of sha256(the key).
      unseal() refuses any row whose key_id is not the current key's (:195).
      Its header (:25) says: "no rewrap, a changed ENCRYPTION_KEY strands every row until each is
        reconnected; build rewrap before the first key rotation". SA §The token vault says the
        same.
    That is PRD-H2.
  - The key_id is inside each token's AAD: <connection_id>|<kind>|<key_id> (:65). So the data key
    cannot simply be re-wrapped under a new key: the stored ciphertexts would then fail their tag
    under the new key_id. A rotation is a full RE-SEAL: unseal under the old key, then seal() under
    the new one, with a fresh DEK and fresh nonces. Do not change the AAD format; every existing row
    depends on it.
  - Refreshed rows migrate by themselves: every refresh already re-seals under the active key
    (fn_commit_refresh → fn_write_secret, 00001500:306, :117). API-key and S3 connections
    (api_secret) and rarely refreshed rows never do, so the sweep finishes the job.
  - THE RACE.
      A refresh claims its connection under refresh_claimed_at, a 5-minute lease
        (fn_claim_connections_for_refresh, 00001500:256-285).
      It spends the refresh token at the provider.
      It commits only if refresh_token_cipher still equals what it read (fn_commit_refresh).
    A re-seal in between changes that cipher, so the commit fails and discards the new tokens. If
    the provider rotated the refresh token, the connection then dies on invalid_grant. So the sweep
    takes the SAME lease (skipping any row already leased), and its write is a compare-and-swap.
  - Only the token vault reads ENCRYPTION_KEY (serverEnv().encryptionKey). The column
    connection_secrets.rotated_at exists: check what writes it before you reuse it.
  - No seed writes connection_secrets; only the integrations_runtime.sql probe does.
  - The ruling stands: the key is an env variable, not a KMS (Decision #343, ruling C4 (c)).

Architect defaults (confirm or override; none blocks):
  - The ring is two names. ENCRYPTION_KEY is the active key, and seal() uses only it.
    ENCRYPTION_KEY_PREVIOUS is optional, and unseal() accepts it by key_id. At most two keys are
    live; a third rotation waits until the sweep has finished.
  - Boot refuses three things: a malformed PREVIOUS; a PREVIOUS equal to the active key; and two
    keys whose key_ids collide.
  - The sweep is an http job, because the app holds the keys: integrations-rewrap-secrets, hourly
    on a free minute, '/api/integrations/cron/rewrap?limit=100', INTEGRATIONS_CRON_SECRET. With
    every row on the active key it is a cheap no-op.

FILES:
  - packages/backend/services/integrations/token-vault.ts:
      loadKeyRing();
      seal() unchanged (the active key);
      unseal() picks the ring key whose id matches the row, and otherwise refuses as today;
      reseal(connectionId, secret): unseal every kind present, then seal under the active key,
        zeroing every DEK;
      the header's "shortcut" paragraph replaced by the rotation rule.
  - packages/backend/core/env.ts: encryptionKeyPrevious (and the manifest entry, if CFG1 has
    landed).
  - 00001500, three functions, all service_role only:
      integrations.fn_claim_secrets_for_rewrap(p_active_key_id text, p_limit integer DEFAULT 100):
        rows whose key_id differs from the active id and whose connection holds no live refresh
        lease. It sets that same refresh_claimed_at lease, so a refresh skips them, with SKIP
        LOCKED, and returns the envelopes;
      integrations.fn_commit_rewrap(p_connection_id, p_read_key_id, p_read_wrapped_dek,
        p_secret jsonb): writes through fn_write_secret only if the row still holds both
        p_read_key_id and p_read_wrapped_dek, else returns false. It passes the row's own expiry
        values unchanged, clears the lease, and adds a connection_audit line ('rewrapped');
      integrations.fn_vault_key_census(): the row count per key_id, for the runbook's check.
  - 00002510: the three functions.
  - 00005060: the job row.
  - packages/backend/services/integrations/ (IntegrationsBackendService.ts, or a new
    VaultRotationBackendService.ts): rewrapDue(limit) runs claim → reseal → commit. A row that will
    not open is logged (ops.log_entries, scope 'integrations.vault', the connection id only) and its
    lease released. Never retry it in a tight loop.
  - apps/web/routes/api/integrations/cron/rewrap.ts: thin, with the packages/backend/core/bearer.ts
    guard (404 otherwise).
  - Tests:
      token-vault.test.ts: the ring, reseal, the refusals;
      the service, with a fake database;
      supabase/probes/vault_rewrap.sql (ROLLBACK): the claim skips a leased row and leases what it
        returns; the commit's compare-and-swap refuses a row that changed; a refresh claim skips a
        row the rewrap leased; the census counts.
  - Docs:
      SA §The token vault: rotation, the ring, the race, the job;
      SA §Scheduled jobs: the row;
      SA §Environment Variable Contract and .env.example: ENCRYPTION_KEY_PREVIOUS (XXXX-XXXX);
      documentation/database/integrations/Functions.md;
      the runbook (step 6).

STEPS:
  1. Reproduce the strand: seal under key A, switch to key B, and unseal() throws.
  2. Build the ring and reseal(), unit-tested:
     - a row sealed under A opens with B active and A as PREVIOUS;
     - reseal() yields key_id B, with a fresh DEK and fresh nonces;
     - the AAD format is unchanged (pin it with a test).
  3. Write the SQL doors and the probe, race included: the refresh's claim and the rewrap's claim
     exclude each other through the one lease, and a commit after a concurrent refresh returns
     false and writes nothing.
  4. Build the service, the route and the job.
  5. Run a rotation drill on a THROWAWAY database with a throwaway env, never the shared .env.local.
     A database made inside supabase_db_Projective is wiped by any peer's `deno task db:reset`,
     because the reset recreates that container. Prefer a separate container; otherwise check that
     yours still exists right before the drill.
     - seed connections under A, at least one with an api_secret and one with a refresh token;
     - rotate to B, with A as PREVIOUS;
     - run the sweep until the census shows only B;
     - drop A, and prove every row still opens;
     - time it.
  6. Write the runbook in SA §The token vault. Link it from
     documentation/architecture/DEPLOYMENT_RUNBOOK.md if OPS6 has written that file.
     Routine rotation:
       generate key B;
       set ENCRYPTION_KEY=B and ENCRYPTION_KEY_PREVIOUS=A in the app env, and deploy;
       let the job run, or run `deno task cron:run integrations-rewrap-secrets`, until the census
         shows only B;
       remove PREVIOUS, and deploy.
     On suspected compromise:
       do the routine rotation;
       then treat every provider token as exposed. Backups and PITR still hold ciphertext the old
         key opens, so a re-seal is not enough;
       force a refresh of every refresh-token connection (the provider issues new tokens);
       ask the owners of api-secret connections (S3) to rotate their keys at the provider;
       record it as an incident.
     Cadence: on a staff change or a compromise, and at least yearly. That is an architect
     default; the owner may set another.

ACCEPTANCE:
  - The unit tests and vault_rewrap.sql pass.
  - The drill ends with every row on B, A removed, and no plaintext or key in any output.
  - scheduled_jobs.sql and integrations_runtime.sql pass.
  - check, lint, test:unit green.
```

§1.2 rows: **PRD-H2 → ✅** (the drill is the evidence). The first hosted rotation follows the
runbook and needs no new code.
