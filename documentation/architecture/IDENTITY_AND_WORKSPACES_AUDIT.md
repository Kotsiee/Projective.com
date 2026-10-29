# Identity, User Management & Workspaces Audit (2026-10-29)

> Read-only evaluation of the identity domain: authentication (`/join`, `/login`, `/verify`,
> `/forgot-password`, OAuth, SSO), the acting-context engine (`security.session_context` → the
> access-token hook → JWT claims), personas (`/become-partner`), `/settings`, and the Teams &
> Businesses workspace console with its permission engine and vault projection. Measured against
> `PRODUCT_SPEC.md` (PS), `SYSTEM_ARCHITECTURE.md` (SA), `ROUTING.md`, `DESIGN_SYSTEM.md`,
> `documentation/database/{org,security}/*` and the decision log. **No code was changed by this
> audit.** Everything below comes from reading code, migrations and config; no SQL probe, test or
> server was run (§9). Conflicts and founder questions are in the companion
> [`IDENTITY_DECISIONS_AND_GAPS.md`](IDENTITY_DECISIONS_AND_GAPS.md), logged as **Decision #336**.
>
> Abbreviations: **T11** = `supabase/migrations/00000011_tables_org.sql` · **T12** =
> `…/00000012_tables_security.sql` · **F1001** = `…/00001001_functions_security_context.sql` ·
> **F1010** = `…/00001010_functions_org_onboarding.sql` · **F1020** =
> `…/00001020_functions_org_entities.sql` · **F1060** =
> `…/00001060_functions_org_account_lifecycle.sql` · **F1700** =
> `…/00001700_functions_access_token_hook.sql` · **P2010** = `…/00002010_policies_org.sql` ·
> **P2019** = `…/00002019_policies_security_ops.sql` · **G2500** =
> `…/00002500_permissions_schema_grants.sql` · **G2510** =
> `…/00002510_permissions_function_grants.sql` · **ABS** =
> `packages/backend/services/auth/AuthBackendService.ts` · **svc/** = `packages/backend/services/`.

**Status (2026-10-29, after the audit):**

- **IW-C1 fixed at column level.** `00002520` revokes table `SELECT` on `org.users_public` from
  `anon` / `authenticated` and re-grants `authenticated` every column except `dob` · `city` ·
  `country` · `timezone`. The owner reads their own date of birth and zone through the new definer
  `org.get_own_private_profile()` (`00001040`, granted in `00002510`). Settings → Account, the
  calendar, the wallet and the listing heatmap moved onto it.
  - Verified by `supabase/probes/users_public_private_columns.sql` (all PASS) and over PostgREST
    with a seeded session: each private column and `*` answer `42501`, and a guest reads nothing.
  - The row-level half (any signed-in account can still list every profile's name and handle,
    `private` ones included) is re-filed as **IW-M13**.
- **IW-H1 fixed.** `alertEnterprisesForDomain` and its matching helpers are deleted from ABS. The
  `enterprise.domain_colleague` catalogue row stays seeded and nothing sends it. Founder question F5
  decides whether it returns.

## 0. Premise corrections

The commissioning brief carried several names and numbers that the code and the guardrails have
moved past. They are corrected here so the findings do not re-open settled ground.

| Brief assumed                                                                                   | Actual (source)                                                                                                                                                                                                                                                                            |
| :---------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org.organisations`, `org.is_organisation_member`                                               | **Renamed to Enterprise** (Decision #231): `org.enterprises` (T11:919), `org.enterprise_members` (T11:957), `org.is_enterprise_member` (F1020:166), claim `active_enterprise_id`. The `org` schema name is kept.                                                                           |
| Four mutually exclusive contexts (personal, team, business, organisation)                       | **Five acting states in four slots.** Personal = every slot NULL; the **profile slot** holds `freelancer` _or_ `business` (`active_profile_type` + `active_profile_id`); then `active_team_id`; then `active_enterprise_id`. `ck_session_context_one_slot` (T12:72-75) admits at most one. |
| "90-day account deletion retention"                                                             | **Account erasure is 30 days** (F1060:490; PS §Settings "Deleting an account"). **90 days** is the freelancer-profile give-up window (F1060:434) and the released-handle hold (F1060:47-50). Money records are kept anonymised for ~7 years (PS §5 Retention Policies).                    |
| "AuthBackendService, UserBackendService, WorkspaceBackendService" are the whole service surface | Two more own identity behaviour: `ContextBackendService` (`svc/context/`, the switch) and `AccountLifecycleBackendService` (`svc/user/`, handle policy + erasure). `IdentitiesBackendService` owns linking.                                                                                |
| Enterprise SSO is SAML/OIDC                                                                     | The code path is `signInWithSSO({ domain })` (ABS:977), which GoTrue serves for **SAML only**; `[auth.sso.saml]` is commented out (`supabase/config.toml:286-288`). There is no OIDC path and no domain table. PS:2958-2962 records SSO as "surface ships now, wiring deferred".           |
| RLS policies read the acting context from JWT claims                                            | **No policy reads `security.current_context()` or `auth.jwt()`.** The function is referenced only in F1001 and F1700. Every org policy authorises through membership tables via definer helpers (§6.3). Claims drive chrome and service scoping only.                                      |
| 13–17 adult proxy for team members is a live model                                              | PS:3094-3101: **specified, post-MVP and disabled**. The database refuses every minor as a Team / Business / Enterprise member (`trg_workspace_member_adult`, `00001810_triggers_auth_onboarding.sql:44-54`; owner decision 2026-10-13).                                                    |

---

## 1. Executive summary

**Verdict.** The architecture is sound and largely as specified. The age policy is enforced in
Postgres first. Workspace authority is a single SQL engine, pinned to its TypeScript twin by a
contract test. The context switch is re-verified at the switch and again at every token mint, and
RLS never trusts a claim. Routes are thin, and no identity route touches the database directly.

The defects sit at the **edges** of that core:

- a table grant that exposes everyone's date of birth;
- an enterprise path that bypasses the age gate;
- an unverified "domain colleague" alert that hands out sign-up emails;
- erasure that leaves seats and personal data behind;
- a role-edit hole in the "only someone you outrank" rule;
- no rate limiting on any credential endpoint.

| ID        | Sev          | Finding                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                 |
| :-------- | :----------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IW-C1** | **Critical** | Any signed-in account can read **every column of every** `org.users_public` row, `dob`, names, `city`, `country` and `timezone` included, minors and `private` profiles alike, straight from PostgREST.                                                                                                  | P2010:10-13 (`USING (auth.role() = 'authenticated')`, no visibility filter) + G2500:44 (`GRANT ALL ON ALL TABLES IN SCHEMA org TO anon, authenticated`); no column `REVOKE` exists       |
| **IW-H1** | High         | The "domain colleague" alert lets anyone who registers an enterprise with `website = gmail.com` receive the address of every new Gmail sign-up (minors included, before confirmation).                                                                                                                   | ABS:441-443, 465-516: free-text `website`, no domain verification, no free-mail exclusion                                                                                                |
| **IW-H2** | High         | The **enterprise sign-up bypasses the age policy**: no DoB is collected, no `users_public` row is written, and `org.fn_is_minor` answers `false` for a profile-less user, so every `fn_assert_adult` door admits them.                                                                                   | `EnterpriseJoinSchema` (no `dob`); `apps/web/routes/api/auth/join.ts:50-53` (lock is individual-only); F1010:391 (no profile row, Decision #87(b)); F1010:743-754 (`COALESCE(…, false)`) |
| **IW-H3** | High         | **No app-level rate limit** on login, join, verify, resend, forgot, reset or SSO. GoTrue's per-IP limits see the **app server's** IP, because the anon client forwards no client address: one shared bucket for the whole platform, and no per-account brute-force throttle.                             | only `/verify`'s poll is limited (`svc/auth/verification-status.ts:41-58`); `packages/backend/core/supabase.ts:189-197`; `config.toml:226-228`                                           |
| **IW-H4** | High         | **Role-edit escalation.** `upsert_workspace_role` checks only the _new_ `base_preset` against the editor's rank, never the edited role's current rank or its holders. An admin can demote a role a peer admin holds, then remove that admin.                                                             | F1020:3155-3157 (new-rank check only), 3175-3190 (edit path, no existing-rank check)                                                                                                     |
| **IW-H5** | High         | **Erasure leaves workspace seats active.** A tombstoned account keeps its seat, its vault rows and its team payout share, so splits keep landing in a wallet nobody can withdraw from.                                                                                                                   | F1060:555-582 (no membership update); blockers check ownership only (F1060:224-238)                                                                                                      |
| **IW-H6** | High         | **Erasure scope falls short of the "Right to be Forgotten" claim.** Portfolio, education, experience, certifications, languages, links, skills, showcase, follows, bookmarks, recent views, preferences, past handles, avatar and banner objects, the password hash and audit IPs are all left in place. | F1060:555-582 vs PS:2842-2844; extends Decision #156(a)                                                                                                                                  |
| **IW-H7** | High         | `org` grants `ALL` on every table **and every future table/view** to `anon` and `authenticated`. RLS is the only barrier, so a table that ships without RLS is world-writable.                                                                                                                           | G2500:44-54; only TRUNCATE revoked (G2500:352-358); prior incident `profile_follows` (P2010:250-256)                                                                                     |
| **IW-H8** | High         | **Enterprise sign-up is not atomic.** If `create_enterprise` fails after `admin.createUser`, the GoTrue user is orphaned and a retry with the same email is refused.                                                                                                                                     | ABS:369-391                                                                                                                                                                              |

Twenty-two Medium and Low findings complete the register (§7).

---

## 2. Authentication paths: completeness

### 2.1 Path matrix

Routes are `apps/web/routes/api/auth/*` unless noted. Service methods are in ABS.

| Path                                                         | Routes                                                           | Service                                | GoTrue calls                                                          | Status                                                                                                                                                                                                                                                                                                                                |
| :----------------------------------------------------------- | :--------------------------------------------------------------- | :------------------------------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Email + password sign-up (OTP)**                           | `join.ts`, page `(public)/(auth)/join.tsx`                       | `provisionAccount` :346-455            | `auth.admin.createUser` (:433), `auth.resend({type:"signup"})` (:825) | ✅ **BUILT** (live). Stub skips the send (:358-364).                                                                                                                                                                                                                                                                                  |
| **Email verification** (6-digit code · link · resend · poll) | `verify.ts`, `confirm.ts`, `resend.ts`, `verification-status.ts` | :686 · :720 · :806 · :744              | `verifyOtp` (email / token_hash)                                      | ✅ **BUILT**. The poll takes no email and is HMAC-cookie bound (Decision #185, `core/pending-verification.ts`). Stub accepts any code but `000000` (:687-692).                                                                                                                                                                        |
| **Password sign-in** (email _or_ `@handle`)                  | `login.ts`                                                       | `authenticate` :531                    | `signInWithPassword`; handle→email via service role (:579-592)        | ✅ **BUILT**. One generic refusal (`login.ts:92`).                                                                                                                                                                                                                                                                                    |
| **Sign-out / silent refresh**                                | `logout.ts`, `refresh.ts`                                        | `signOut` :668 · `refreshSession` :636 | `admin.signOut(global)`, `refreshSession`                             | ✅ **BUILT**. Refusal-only fail-closed, 503 on outage (Decision #193).                                                                                                                                                                                                                                                                |
| **Forgot / reset password**                                  | `forgot-password.ts`, `reset.ts`                                 | :843 · :864                            | `resetPasswordForEmail`; `verifyOtp(recovery)` + `updateUser`         | ✅ **BUILT**. Uniform answers.                                                                                                                                                                                                                                                                                                        |
| **Google OAuth (PKCE)**                                      | `oauth/google.ts`, `callback.ts`                                 | :899 · :918                            | `signInWithOAuth({ flowType: pkce })`, `exchangeCodeForSession`       | ✅ **BUILT**. Verifier in an HttpOnly · Lax · 600 s cookie (`google.ts:30`, `utils/auth-cookies.ts:132-143`), cleared at callback (`callback.ts:51`).                                                                                                                                                                                 |
| **Enterprise SSO (SAML/OIDC)**                               | `sso.ts`; `features/auth/components/SsoPanel.tsx:39-48`          | `resolveSso` :977                      | `signInWithSSO({ domain })`                                           | ⚠️ **PARTIAL / not operable**. The call is real but SAML is disabled in config. There is no OIDC, no domain-verification table, and no JIT membership. A new SSO identity is routed as `provider:"google"` (`callback.ts:67`) and never returned to onboarding, so it would **skip the DoB step** (`features/auth/core/oauth.ts:69`). |
| **Identity linking**                                         | `api/user/identities/{index,[id],link/[provider]}.ts`            | `IdentitiesBackendService`             | `linkIdentity` (PKCE) / REST unlink                                   | ✅ **BUILT** (live only; needs `enable_manual_linking`, Decision #156(e)). Refuses unlinking the email identity or the last method.                                                                                                                                                                                                   |
| **MFA / step-up**                                            | none                                                             | none                                   | none                                                                  | ❌ **Not built and not specified.** `[auth.mfa.totp]` and `[auth.mfa.phone]` are disabled (`config.toml:348-355`). Founder question F7.                                                                                                                                                                                               |

### 2.2 Cross-cutting controls

| Control                   | State                                                                                                                                                                                                | Evidence                                         |
| :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------- |
| Session cookies           | ✅ `sb-access-token` / `sb-refresh-token` are HttpOnly · SameSite=Lax · Secure on HTTPS or in production; 30-day or browser-session lifetime (Decision #201)                                         | `utils/auth-cookies.ts:49-68`                    |
| Access-token verification | ✅ Signature (JWKS / HS256), `exp`, `sub`, `aud` checked locally once per request (Decision #205)                                                                                                    | `core/access-token.ts`; `utils/session.ts:63-97` |
| ⚠️ Stub trust             | When the auth backend is not live and `DENO_ENV` ≠ `production`, presence is trusted. `DENO_ENV` **defaults to `development` when unset**                                                            | ABS:608-610; `core/env.ts:318`                   |
| Open-redirect guard       | ✅ `safeRedirect`: same-origin single-`/` paths; refuses `//`, `/\`, control characters and auth paths; default `/home`. Low: `/api/*` is accepted as a return target                                | `features/auth/core/redirect.ts:17, 64-80`       |
| OAuth `state`             | ✅ Acceptable. GoTrue holds `state` with Google, and PKCE binds the code to this browser                                                                                                             | `google.ts`, `callback.ts`                       |
| Account enumeration       | ⚠️ Login, forgot, resend and the poll are uniform. **Join returns GoTrue's raw error** ("already registered") and raw RPC/exception text. SSO reveals which domains are configured                   | ABS:381, 391, 440, 452; :981                     |
| Rate limiting             | ❌ Only the `/verify` poll is limited (IW-H3)                                                                                                                                                        | §1                                               |
| CSRF on auth POSTs        | ⚠️ No Origin or Content-Type check before `req.json()`, so a cross-site `text/plain` form can **log a victim into the attacker's account** (login CSRF). `pj_csrf` is declared and never implemented | `apps/web/utils/storage-keys.ts:468-469`         |
| PII in URLs               | ⚠️ OAuth pre-fill puts email and name in the `/join` query string                                                                                                                                    | `features/auth/core/auth-routing.ts:95-101`      |

---

## 3. Context switching: end-to-end trace

**UI action → `POST /api/context/switch` → DB update → token claim re-stamping.**

| #  | Hop                   | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                 |
| :- | :-------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | **UI control**        | The account popover's "Acting as" rows, the `/teams` / `/businesses` roster card and `ContextSwitchControl` all call `useContextSwitch`                                                                                                                                                                                                                                                                                                        | `features/shell/islands/UserActions.island.tsx:364-365, 637, 674, 708`; `features/workspaces/islands/WorkspaceRoster.island.tsx:318`; `ContextSwitchControl.tsx:115-127` |
| 2  | **Island transport**  | `useContextSwitch` → `WorkspaceService.switchContext` (`fetch`). On success it makes a **hard** `location.assign`. On `claimsStale` it reports and does not navigate                                                                                                                                                                                                                                                                           | `features/workspaces/core/useContextSwitch.ts:103-135`; `WorkspaceService.ts:276-278`                                                                                    |
| 3  | **Thin route**        | Refuses a guest (`readActor` / `canReadLive`), Zod-parses `SwitchContextInputSchema` (`personal · team · business · enterprise` + `contextId`)                                                                                                                                                                                                                                                                                                 | `apps/web/routes/api/context/switch.ts:38-42`; `packages/types/workspace/workspace.ts:804`                                                                               |
| 4  | **Fat service**       | `ContextBackendService.switchContext` calls the matching RPC **under the caller's JWT** and maps refusals                                                                                                                                                                                                                                                                                                                                      | `svc/context/ContextBackendService.ts:85-115`                                                                                                                            |
| 5  | **Switch RPC**        | `security.switch_session_context` (freelancer / business), `switch_team_context`, `switch_enterprise_context` or `clear_session_context`. Each is `SECURITY DEFINER`, `search_path = ''`, resolves the caller from `auth.uid()` and **re-checks the membership it names**: active seat, entity not archived (team / business); owner or active member (enterprise)                                                                             | F1001:100-190                                                                                                                                                            |
| 6  | **DB write**          | The internal `security.fn_set_session_context` upserts the whole row, nulling every other slot. EXECUTE is revoked from clients, and clients hold SELECT only on the table                                                                                                                                                                                                                                                                     | F1001:71-97; G2510:1801-1802; `00002520_permissions_table_grants.sql:22`; policy P2019:10-11                                                                             |
| 7  | **Exclusivity**       | `ck_session_context_one_slot`: `num_nonnulls(profile, team, enterprise) <= 1` and the profile type/id pair is null-together, so a second slot is unrepresentable                                                                                                                                                                                                                                                                               | T12:72-75                                                                                                                                                                |
| 8  | **Session re-issue**  | The route renews the session **server-side** (GoTrue refresh grant) and mints rotated cookies on the same response. A failed renewal keeps the old cookies and answers `claimsStale: true` (Decision #193)                                                                                                                                                                                                                                     | `utils/session.ts:193-229` (`renewSession`, `respondWithReissuedSession`)                                                                                                |
| 9  | **Claim re-stamping** | GoTrue calls `public.custom_access_token_hook` at mint. It reads `session_context`, **re-verifies the membership again** (F1700:125-145) and drops a stale context back to personal. It stamps raw `active_*` claims (:205-208) and `app_metadata.active_context` (type · id · role · handle · isClient · isFreelancer · isOperator · onboarded · **isRestricted** · belongsTo* · businessHeadroom · currency · locale · dateFormat, :226-251) | F1700; registered `config.toml:330-332`; EXECUTE only to `supabase_auth_admin` (G2510:364-369)                                                                           |
| 10 | **Consumption**       | The global middleware verifies the cookie, then `utils/user-context.ts` decodes the claims into `UserContext` for chrome, the `(dashboard)` guards and service scoping                                                                                                                                                                                                                                                                         | `routes/_middleware.ts:33-35`; `utils/session.ts:63-97`                                                                                                                  |

**Properties**

- **Spoofing:** not possible. The body only _names_ a target, which the RPC validates against
  `auth.uid()`. Cookie claims are signature-verified.
- **Double verification:** at the switch (step 5) and at every mint (step 9). "The stored context is
  a preference, never a grant" (SA:2018-2019) holds in code.
- **Staleness:** claims can outlive a membership by up to `jwt_expiry = 3600` s (`config.toml:193`).
  Local verification cannot see revocation (SA:2197-2200). **This does not widen data access.** No
  RLS policy reads the claims, money doors require a _current_ seat
  (`finance.fn_has_vault_capability`, `00001210_functions_finance_kyc_wallet.sql:369-391`), and
  write RPCs re-check capability. A stale claim affects chrome, cache keys and claim-scoped
  TypeScript filters (catalogue `ownership.ts:19`, the files library) only.
- **Hook failure** returns the event unchanged (F1700:254-257). Context claims are then absent (a
  personal shell: fail-closed), but `onboarded` and `isRestricted` are absent too. The app reads
  absence as onboarded and unrestricted (fail-open, **chrome only**; `fn_assert_adult` still
  refuses).

**Gaps on this path**

| ID    | Sev    | Gap                                                                                                                                                                                                                                                                                              |
| :---- | :----- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IW-M7 | Medium | **An enterprise-only owner probably cannot hold the enterprise context.** `session_context.user_id` has an FK to `org.users_public` (T12:77), and enterprise owners get no profile row (F1010:391), so `fn_set_session_context`'s INSERT should fail. _Inferred from the schema; needs a probe._ |
| IW-L1 | Low    | Neither `switch_enterprise_context` (F1001:165-171) nor the hook (F1700:129-134) checks enterprise `status` (archived), although `ContextBackendService.enterprises` filters archived (`:149`).                                                                                                  |
| IW-L2 | Low    | A `freelancer` profile-slot context is never re-verified at mint (only `business` is, F1700:140). This is harmless today (it falls through to personal), but a given-up freelancer profile keeps `active_profile_type = 'freelancer'` in the raw claim.                                          |
| IW-L3 | Low    | Stale comments: `ContextBackendService.ts:32-39` says the client calls `/api/auth/refresh` (the route re-issues itself); `useContextSwitch.ts:27` says RLS reads the claims (it does not).                                                                                                       |
| IW-L4 | Low    | No unit test covers `ContextBackendService` or the switch route (§8).                                                                                                                                                                                                                            |

---

## 4. Frontend vs MVP spec & design system

### 4.1 `/join`: single-screen wizard and date of birth

| Requirement (PS:2964-3101)                                               | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                                            |
| :----------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------ |
| Fixed, viewport-height, no-scroll, two columns                           | ⚠️ **PARTIAL.** The root and body are locked at `100dvh` / `overflow: hidden`, but `.auth-step` is `overflow-y: auto`, so a tall step (Enterprise 1.4 / 1.6, or zoomed text) scrolls inside the frame                                                                                                                                                                                                                                                                                                                                                                             | `features/auth/styles/auth.css:19-44, 487-490`                      |
| Step slots 1 · 1.2–1.6; Enterprise skips 1.2; Skills only for Freelancer | ✅ `StepId = account · intent · purpose · specialize · identity · credentials`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `features/auth/core/wizardStore.ts:13`; `wizardValidation.ts:29-88` |
| Choice steps auto-advance; neutral first step; Enter chain               | ✅ (Decisions #9, #105)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `StepForm.tsx`                                                      |
| DoB validated client-side                                                | ✅ `dobError`, live age note, under-13 lock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `wizardValidation.ts:24-27, 69-70`; `StepForm.tsx:212-250, 689-727` |
| **DoB re-validated server-side, independent of the client**              | ✅ Zod `superRefine` (`packages/types/auth/join.ts`) → the service re-derives the bracket (ABS:348-351) → Postgres `org.fn_check_dob` (`PM422`, F1010:695-712) in `provision_user_profile` + `trg_users_public_dob_guard`. A client-sent `restricted` flag is stripped                                                                                                                                                                                                                                                                                                            | SA:2728-2745                                                        |
| Under 13: nothing written, nothing logged, session locked                | ✅ **Individual path.** Refused before `createUser`. An OAuth identity is deleted by `public.discard_underage_signup` (F1010:208-231) and its cookies cleared (`join.ts:21-23`). An HttpOnly `pj_join_age_lock` makes the server refuse further individual sign-ups (`join.ts:20, 50-53`); only the error code is logged (ABS:335). ⚠️ The **page** never reads the lock cookie. The on-screen lock is per-tab `sessionStorage` (`features/auth/core/age-lock.ts:9-16`), so a new tab re-shows the form (the server still refuses). ❌ **Enterprise path: no DoB at all** (IW-H2) | —                                                                   |
| OAuth cannot bypass the age gate                                         | ✅ **Google.** A profile-less session is bounced to `/join` by the dashboard guard (`routes/(dashboard)/_middleware.ts:101-113`) and asked for DoB on the identity step. ❌ **SSO** would bypass (latent while SAML is off)                                                                                                                                                                                                                                                                                                                                                       | §2.1                                                                |
| 13–17 choosing "I want to work" starts as a client                       | ✅ enforced in `provision_user_profile`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | F1010                                                               |

### 4.2 Restricted-surface masking (13–17)

Masking is **layered and server-enforced**, not cosmetic:

| Layer       | Mechanism                                                                                                                                                                                                                     | Evidence                                           |
| :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------- |
| Chrome      | `isRestrictedPath` hides Wallet · Businesses · basket / checkout · Catalogue · Services / Products · Teams · Analytics · Become a Freelancer · Settings → Billing / Verification / Scheduling · `/legal/workspace`            | `features/shell/core/restricted-surfaces.ts:11-28` |
| Route guard | The `(dashboard)` middleware 303s a direct visit to `/home`                                                                                                                                                                   | `routes/(dashboard)/_middleware.ts:119-126`        |
| API mirror  | `refuseIfRestricted` in 17 routes (wallet action and payouts, freelancer unlock, checkout, escrow intent, apply …)                                                                                                            | `apps/web/utils/age-gate.ts`                       |
| Database    | `org.fn_assert_adult` (`PM403`, F1010:759-772) in 13 migration files; `trg_workspace_member_adult`; `comms.trg_dm_shield`; search / interest suppression; minor location masking in `get_profile_view` / `org.profiles_index` | SA:2776-2794                                       |

Gaps:

- **IW-C1** defeats the location masking for anyone who calls PostgREST directly.
- **IW-M1:** the `pj.dev.age` cookie lifts the chrome, guard and API mirror when `DENO_ENV` is
  unset.
- **IW-L5:** `GET /api/settings/[section]` serves the billing, verification and scheduling payloads
  to a minor, because the `adultOnly` gate is UI-only
  (`features/settings/core/settings-registry.ts:137-161`; `settings-ssr.ts:51-60`).

### 4.3 `/settings` and `/become-partner`

- **Settings** ✅ BUILT to Decision #151 / #156:
  - Eleven sections from one registry; `/settings` hub, `/settings/[section]`,
    `/settings/verification`, `/settings/integrations`.
  - Writes go through
    `/api/user/{preferences, emails, handle, lifecycle, notifications, identities}`,
    `/api/settings/attention`, `/api/cards` and `/api/finance/connect/*`, each a thin route over a
    fat service.
  - _Not audited:_ every settings write route's guard, one by one.
- **`/become-partner`** ✅ BUILT and **additive**:
  - `BecomePartnerScreen` → `POST /api/user/freelancer` (`refuseIfRestricted` + Zod) →
    `org.enable_freelancer_profile` (F1020:53-162).
  - That function requires a profile, asserts an adult, refuses during a scheduled deletion, and
    inserts with `ON CONFLICT DO NOTHING` (idempotent).
  - It sets `is_freelancer = true` and switches to the freelancer context through the shared writer;
    the route re-issues the session.
  - No client privilege is removed.
  - Low: its `search_path` is `public, org, security, auth`, not `''`.

### 4.4 Workspace console: no client token spoofing of administrative rights

| Question                                                                   | Answer                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                            |
| :------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------- |
| Where do console capabilities come from?                                   | `consoleOutcome` → `WorkspaceBackendService.detail` (live-only) → RPC `org.get_workspace_detail` under the caller's JWT → `viewer.capabilities`, which is `org.fn_member_capabilities(auth.uid())`                                                                                                                                                                        | `features/workspaces/core/workspace-route.tsx:85-122`; `svc/workspace/live-detail.ts:223, 411, 434` |
| Do modules and `?view=` gate on them?                                      | Yes, only on the server-resolved set                                                                                                                                                                                                                                                                                                                                      | `workspace-route.tsx:113-117`                                                                       |
| Can a cookie, query, header, body field or signal grant or display rights? | **No** for workspace rights. Islands only _read_ the set (`workspace-state.ts:60`). The client dev seam is build-gated by `IS_DEV` (`utils/dev.ts`, `utils/dev-seam.ts:826, 914`), and the workspace axes were removed (SA:1945-1947)                                                                                                                                     | —                                                                                                   |
| Do `/api/workspace/*` routes re-check?                                     | The routes only refuse guests; **every RPC re-checks** with `fn_member_can` / `fn_member_capabilities(auth.uid())`                                                                                                                                                                                                                                                        | e.g. F1020:3140-3157                                                                                |
| Residual                                                                   | ⚠️ **IW-M1:** server-side dev cookies are honoured whenever `DENO_ENV` is unset. `pj.dev.operator` renders the **admin dispute desk preview** (sample data) before any operator check (`features/admin/core/operator-preview.ts:14-17`; `DisputeDeskScreen.tsx:20-23`), and `pj.dev.operator-mode` flips the Teams persona chrome. The database still refuses every write | `utils/operator-mode.ts:20-26`                                                                      |

### 4.5 Routing conformance (`ROUTING.md`)

`/teams*`, `/businesses*` (channels included), `/settings*`, `/invite/:token` and `/become-partner`
match their route files. These conformance gaps remain (all Low, doc or dead-code):

1. `/join`, `/login`, `/verify` and `/forgot-password` have **no route-table rows** (bullets only,
   ROUTING.md:51-56, 66). `/become-partner` appears only in prose (:662-670). The 13 `/api/auth/*`
   routes appear in no ROUTING.md API table (they are listed only in SA).
2. `/register` and `/reset` are in `AUTH_PATHS` (`redirect.ts:27-36`) but have no route file and no
   redirect, so both 404, although `join.tsx:9` says `/join` "supersedes /register".
3. ROUTING.md:14 calls `(auth)` "own chrome later", with Auth "none". That is stale: there is a
   shell and an inverse guard (`auth-routing.ts:33-45` bounces signed-in users off `/login` and
   `/join`, except `/join?oauth=`).
4. The `(dashboard)` middleware bullet (ROUTING.md:47-50) omits the onboarding bounce, the
   restricted-path guard and the Teams persona gate.
5. `/teams/:teamHandle/catalogue/:slug` is documented, but the file is `[id].tsx`.

**What the guards actually enforce:**

- Unauthenticated: silent refresh, then 302 to `/login?redirectTo=…`.
- Un-onboarded: bounced to `/join`.
- Unverified email: no explicit gate. This relies on `enable_confirmations = true`
  (`config.toml:247`), so GoTrue never issues a session before confirmation.
- Minor: restricted paths 303 to `/home`.
- Non-freelancer on `/teams`: 303 to `/home?notice=teams-freelancer`.

### 4.6 Design-system defects (auth surfaces)

The settings and workspace stylesheets had no hex, rgba, px-radius or duration hits; the workspace
sheets are policed by `styles.gate.test.ts` (Decision #251). The auth sheets are not policed:

| ID    | Sev    | Gate                                 | Violation                                                                                                                                                                                                                                                            |
| :---- | :----- | :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IW-D1 | Medium | §3.8 hierarchy                       | `.auth-heading__title` h1 at `font-weight: 700` (= `--fw-bold`) (`auth.css:445`); `.join-aside__title-strong` 700 in a heading (:1131). About 65 literal font-size/weight declarations (e.g. :135, :204-205); `auth-controls.css:11, 122` at 600                     |
| IW-D2 | Low    | §3.12 press feedback                 | Hover and selected cards use `translateY(-3px)` (`auth.css:597-598, 610`)                                                                                                                                                                                            |
| IW-D3 | Low    | token-only                           | Hard-coded durations: `authFloat 14s` (:199), `heroSpin 60s linear infinite` (:1072, a non-spring curve), `authCopyIn 0.55s` (:1119). Shadows: `rgba(0,0,0,.18)` (:1047), `0 -12px 30px … 18%` (:1492). `0 0 0 2px` rings (:609, :844); a 36px control size (:84-85) |
| IW-D4 | Low    | §3.9 / anti-tagification / dead code | `.passport`: translucent background, `backdrop-filter` on a non-pinned card, literal `white`, tag-style chips (`auth.css:238-256, 368-375`). Its component `PassportCard.tsx` is **never imported**; delete both                                                     |
| IW-D5 | Low    | no inline styles                     | `JoinArt.tsx:40` sets `style={{ "--hero-progress": … }}`                                                                                                                                                                                                             |

---

## 5. Backend services & the permission engine

### 5.1 Services

| Service                                        | Public surface                                                                                                                                                                            | Client                                                                                                                                                                                                      | Verdict                       |
| :--------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------- |
| `AuthBackendService` (`svc/auth/`)             | `provisionAccount` :346 · `authenticate` :531 · `verifyAccessToken` :606 · `refreshSession` :636 · `signOut` :668 · verify / resend / forgot / reset · OAuth :899-918 · `resolveSso` :977 | Service role only **pre-session** (create user :369/:433, handle→email :580, poll :756, global sign-out :673). Low: OAuth exchange reads `users_public` with the service role while a session exists (:952) | ✅ BUILT; IW-H1, IW-H8, IW-M3 |
| `UserBackendService` (`svc/user/`)             | `me` :136 · `setup` :193 · preferences :289/:312 · `enableFreelancer` :366                                                                                                                | User JWT (anon for public skills)                                                                                                                                                                           | ✅ BUILT                      |
| `AccountLifecycleBackendService` (`svc/user/`) | `lifecycle` :106 · `schedule` :125 · `cancel` :152 · `sweepDue` :187                                                                                                                      | User JWT; service role only for the cron sweep, behind a bearer with constant-time compare (`core/bearer.ts:6-19`)                                                                                          | ✅ BUILT; IW-H5, IW-H6        |
| `ContextBackendService` (`svc/context/`)       | `switchContext` :85 · `enterprises` :126                                                                                                                                                  | User JWT                                                                                                                                                                                                    | ✅ BUILT                      |
| `WorkspaceBackendService` (`svc/workspace/`)   | roster · detail · create · update · invite* · `updateMember` :234 · `transferOwnership` :242 · `upsertRole` :254 · `archiveRole` :262 · spend / payout                                    | User JWT only (`live-support.ts:250-270`)                                                                                                                                                                   | ✅ BUILT; IW-H4, IW-M4, IW-M5 |

- **Thin routes:** ✅ no file under `api/{auth,user,workspace,context,settings}` calls `.from`,
  `.rpc` or `createClient`. Low: `api/user/preferences.ts` re-implements `readActor` inline.
- **`ServiceResult<T>`:** used throughout.
- **TypeScript "gates" decide nothing.** `core/business-authority.ts`, `team-persona-gate.ts`,
  `spend-gate.ts`, `payout-gate.ts` and `age-gate.ts` are SQLSTATE → HTTP mappers.

### 5.2 Role presets & the unified engine (`org.workspace_capability`)

`org.workspace_capability` is an **enum of 19 capabilities** (`00000004_enums_domains.sql:518-534`).
Authority is `role ∪ granted − revoked` (`org.fn_member_capabilities`, F1020:563-608), checked by
`org.fn_member_can` (F1020:611-619) in every write RPC. Preset rows store no capabilities (CHECK
`ck_*_role_shape`, T11:365-368, 439-442).

| Preset             | Rank | Capabilities (`org.fn_preset_capabilities`, F1020:509-528)                                                                                                                               |
| :----------------- | :--- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner`            | 4    | all, kind-filtered                                                                                                                                                                       |
| `admin`            | 3    | 16: all but the owner-reserved `withdraw_funds` · `manage_billing` · `archive_entity` (grantable to a named co-owner admin, owner-only with typed CONFIRM, Decision #238; F1020:856-893) |
| `lead` (team only) | 2    | `invite_members` · `bind_seat` · `manage_projects` · `publish_listings` · `purchase` · `contribute_funds` · `spend_funds` · `view_analytics`                                             |
| `member`           | 1    | `contribute_funds` · `view_analytics`                                                                                                                                                    |

- **Kind filter** (`fn_kind_capabilities`, F1020:489-505): a team drops `purchase` · `hire` ·
  `contribute_funds` · `approve_spend` · `manage_billing`; a business drops `bind_seat` ·
  `publish_listings`. Business custom roles may not rank as `lead`.
- **TypeScript twin:** `packages/types/workspace/common.ts:244-275` (`PRESET_GRANTS`, `roleRank`,
  `effectivePermissions`), pinned to the SQL by `workspace.contract.test.ts:152-212`.
  - The test pins presets, kinds, ranks and the enum order, but **not** the union/revoke semantics.
  - `live-detail.ts:357` recomputes `effectivePermissions` for display only (Low).
- **Owner protections:** ✅
  - One owner seat, mirrored from `owner_user_id` by `fn_member_role_sync` (F1020:896-933).
  - The owner cannot leave and cannot be changed or removed (F1020:2764, 2821-2823).
  - Transfer is one transaction (F1020:3006-3104).
  - Account deletion is blocked while the user owns a workspace (F1060:224-238).
- **Self-escalation:** ✅ blocked.
  - You cannot act on your own row (F1020:2818).
  - You cannot grant what you lack (F1020:2837, 2854; invites :1773; join requests :2573).
- **Rank rule:** ❌ incomplete.
  - **IW-H4:** role edits check only the new rank (§1).
  - **IW-M4:** `update_workspace_member` (role_id, F1020:2828-2841), `invite_workspace_member`
    (:1773) and `respond_to_join_request` (:2573) compare _capabilities_, never the target role's
    _rank_. A lead-ranked `manage_roles` holder can therefore seat someone in an admin-ranked custom
    role, who then outranks them.

### 5.3 Workspace ↔ `finance.vault_permissions` synchronisation

`org.fn_vault_capabilities_for` (F1020:670-704) projects capabilities onto vault rights.
`org.fn_sync_vault_permissions` (F1020:709-739) rewrites them. Clients have SELECT only
(`00002520:201`). Every money door goes through `finance.fn_has_vault_capability`, which **also
requires a current seat** (`00001210:369-391`): defence in depth against any projection lag.

| Event                                   | Sync path                                                                                                                              | Same transaction? |
| :-------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- | :---------------- |
| Member admitted (invite, link, request) | `fn_admit_workspace_member` → sync (F1020:1908) + AFTER trigger (`00001895_triggers_derived_columns.sql:136-143`)                      | ✅                |
| Role or override changed                | `update_workspace_member` → sync (F1020:2987) + trigger on `role_id` / `granted` / `revoked`                                           | ✅                |
| Custom role edited                      | `upsert_workspace_role` → full re-sync (F1020:3200) + trigger on role capabilities / `base_preset` (`00001895:146-153`)                | ✅                |
| Member removed or left                  | `status = 'left'` → sync projects to `'{}'` (F1020:2786)                                                                               | ✅                |
| Ownership transferred                   | explicit syncs (F1020:3090-3094); no backstop trigger on `owner_user_id` (only this RPC writes it)                                     | ✅                |
| New team or business wallet             | `trg_wallets_sync_vault_permissions` (`00001830_triggers_finance.sql:8-10`)                                                            | ✅                |
| **Workspace archived**                  | `set_workspace_status` (F1020:1442-1538) does **no** re-projection; team archive has **no `wallet_balance` blocker** (F1020:1281-1335) | ❌ **IW-M5**      |
| **Account erased**                      | nothing                                                                                                                                | ❌ **IW-H5**      |
| Reconciliation                          | No job re-derives vault rights; the scheduled reconcilers cover ledgers only (`00005060_seed_scheduled_jobs.sql:47`)                   | ⚠️ Low            |

---

## 6. Database & security schema

### 6.1 Core tables

| Table                                                      | Shape (key facts)                                                                                                                                                                                                                                                                                                                  | Docs / Zod drift                                                                                                                                                          |
| :--------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `security.session_context` (T12:59-78)                     | PK `user_id`. Profile slot (`active_profile_type` ∈ `freelancer · business` + id), `active_team_id`, `active_enterprise_id` (FK `org.enterprises` ON DELETE SET NULL). `ck_session_context_one_slot`. FKs `user_id` → `auth.users` **and** → `org.users_public` (both NO ACTION). Profile and team ids are polymorphic, with no FK | `database/security/Tables.md` omits the second FK; no Zod row schema                                                                                                      |
| `org.users_public` (T11:21-67)                             | A **table**, not a view. PII: `dob date NOT NULL` (:38), first/last name, city, country, timezone. CHECK `dob >= 1900-01-01`, `visibility ∈ public · unlisted · private`. Email lives in `org.user_emails`                                                                                                                         | No Zod row schema                                                                                                                                                         |
| `org.freelancer_profiles` (T11:200-235)                    | FK → `auth.users` **ON DELETE CASCADE**                                                                                                                                                                                                                                                                                            | `Tables.md` misses `availability_status`, `available_since`, `rating_*`                                                                                                   |
| `org.business_profiles` (T11:237-293)                      | owner FK NO ACTION; RLS on, **no client policy** (reads go through definers, Decision #150)                                                                                                                                                                                                                                        | `Tables.md` misses `tax_id`, `invoicing_mode`, `billing_day`, `auto_fund_mode`, `low_balance_floor_cents`, `system_penalty_score`, `address_*`, media, `headline` / `bio` |
| `org.teams` (T11:295-336)                                  | owner FK NO ACTION; **`visibility` has no CHECK** (:304), unlike `business_profiles` (:292)                                                                                                                                                                                                                                        | misses `default_payout_settings`, `available_since`, media                                                                                                                |
| `org.{team,business}_roles` / `_members` (T11:347-488)     | Roles CASCADE from the entity. Members: composite role FK ON DELETE RESTRICT; `status ∈ active · left` + `left_at` CHECK; nothing hard-deleted                                                                                                                                                                                     | No Zod row schemas                                                                                                                                                        |
| `org.enterprises` / `org.enterprise_members` (T11:919-980) | Members: **`status` is free text with no CHECK** (:962); `user_id` → `auth.users` **ON DELETE CASCADE** (:977), against the "nothing hard-deleted" pattern                                                                                                                                                                         | `EnterpriseMemberSchema` (`packages/types/org/enterprises.ts:83-92`) **misses `departments`**; `Tables.md` misses `departments`, `joined_at`, `created_at`                |

**IW-M9 (Medium).** The Zod SSOT has **no row schemas** for `users_public`, `freelancer_profiles`,
`business_profiles`, `teams`, `*_members`, `*_roles` or `session_context`. Only projections exist
(`packages/types/workspace/*`, `auth/user-context.ts`). The "1:1 with zero drift" rule (SA §SSOT)
cannot be checked for the identity core.

### 6.2 RLS posture (default-deny)

- **RLS is enabled on every `org.*` table** (`00002001_policies_enable_rls.sql`, plus three in
  P2010:298-300). **FORCE RLS is used nowhere.** That is correct today, because the definer helpers
  depend on the table owner bypassing RLS (§6.3).
- **No `org` or `security` identity table has a client write policy.** Every write goes through a
  definer, so no UPDATE policy lets a user change their own role, capability or owner column. ✅
- **Policies on the core tables:**
  - `users_public`: **any authenticated user, all rows** (IW-C1).
  - `freelancer_profiles`: own or admin (P2010:98-102).
  - `teams`: owner, active member or admin (:81-86).
  - `team_members`: own, same team or admin (:138-143).
  - `business_members`: active member or admin (:114-118).
  - Roles: active member or admin (:128-151).
  - `enterprises`: owner, member or admin (:184-189).
  - `enterprise_members`: own, enterprise admin+ or platform admin (:204-209).
  - `session_context`: own row (P2019:10-11).
  - `platform_params`: `USING (true)` for authenticated (benign, no secrets).
- **Grants (IW-H7):** `GRANT ALL` on all `org` tables and sequences plus `ALTER DEFAULT PRIVILEGES`
  to `anon` and `authenticated` (G2500:44-54). Specific REVOKEs cover only `user_emails`,
  `email_verification_tokens`, `handle_changes`, `deletion_requests`, `recent_views` and
  `supported_locales` (`00002520:38-66`). `org.profiles_index`, a **definer view**
  (`00003001_views_profiles_business.sql:59`), inherits `ALL` from the defaults with no explicit
  grant.
- **IW-M6 (Medium):** RLS is **off** on `security.feature_flags`, `security.audit_logs`,
  `security.turnstile_verifications` and `security.refresh_tokens` (T12:7, 15, 32, 45). Today they
  are protected only by having no table grant, and `security` is PostgREST-exposed
  (`config.toml:17`). `refresh_tokens` and `turnstile_verifications` are referenced nowhere: they
  are dead tables.
- **Doc drift:** `database/org/Policies.md:411-413` says the Standing tables have "no INSERT/UPDATE
  grant". That is false: G2500:44 covers them. `database/security/Policies.md` covers
  `session_context` only. SA §Row-Level Security still cites a migration "series `0200_org_rls.sql`"
  that no longer exists.

### 6.3 Helper functions & recursion

| Helper                                                               | DEFINER | `search_path` | STABLE | Caller identity        | Client EXECUTE                        |
| :------------------------------------------------------------------- | :------ | :------------ | :----- | :--------------------- | :------------------------------------ |
| `org.is_active_team_member` (F1020:6-20)                             | ✅      | `org, public` | ✅     | `auth.uid()`           | anon, authenticated (G2510:24)        |
| `org.is_active_business_member` (F1020:22-36)                        | ✅      | `org, public` | ✅     | `auth.uid()`           | anon, authenticated (:25)             |
| `org.is_enterprise_member` (F1020:166-187)                           | ✅      | `org, public` | ✅     | `auth.uid()`           | anon, authenticated (:26)             |
| `org.fn_member_can` / `is_team_lead` (F1020:611-652)                 | ✅      | `''`          | ✅     | `auth.uid()`           | revoked (schema blanket, G2510:15)    |
| `org.fn_member_seat` / `fn_member_capabilities` (F1020:563-637)      | ✅      | `''`          | ✅     | **arbitrary `p_user`** | revoked, so not an oracle             |
| `org.fn_profile_visible` (`00001040_functions_org_profiles.sql:73+`) | ✅      | `''`          | ✅     | `auth.uid()`           | anon, authenticated (G2510:1398-1401) |
| `security.is_admin()` (F1001:49-60)                                  | ✅      | **none**      | ✅     | `auth.uid()`           | **PUBLIC** (no revoke in `security`)  |

- **Recursion:** ✅ no risk found. Every `org` and `security` policy calls these definer helpers. No
  policy in `00002010`–`00002021` subqueries `team_members`, `business_members`,
  `enterprise_members`, `teams` or `users_public` directly. The helpers break the loop because they
  run as the table owner. **Adding FORCE RLS later would re-introduce recursion**; record that in
  `database/org/Policies.md`.
- **Membership oracle:** ✅ none. The client-granted helpers resolve the caller from `auth.uid()`,
  and anon gets `false`.
- **IW-M8 (Medium):** `security.is_admin()` is a definer with no pinned `search_path`, executable by
  PUBLIC. SA:2580 lists it as the one known exception, but nothing justifies it.
- **IW-L6 (Low):** `fn_profile_visible('enterprise', id)` is true for any active enterprise, so it
  works as an existence check for enterprise ids. The `public` entry in the `is_*` helpers'
  `search_path` is harmless (fully qualified bodies) but inconsistent.

### 6.4 Age model in the database

- **Stored:** `users_public.dob`.
- **Derived at every call:** `org.fn_age_years(dob, timezone)` (F1010:682-691) and `org.fn_is_minor`
  (:743-754). It is never stored (Decisions #190, #208). ✅
- **Under-13 refused:** `org.fn_check_dob` (`PM422`, F1010:709-710) on provisioning and in
  `trg_users_public_dob_guard` (`00001810:32-34`). ✅
- **13–17 refused:** `fn_assert_adult` (F1010:759-772) and `trg_workspace_member_adult`
  (`00001810:44-54`). ✅
- **No RLS policy consults age.** This is by design; the doors do.
- ❌ **IW-H2:** `fn_is_minor` answers **`false` with no profile row**, so it fails open for every
  profile-less identity (enterprise owners; a future SSO identity).

### 6.5 Account lifecycle & retention

| Item                           | State                                                                                                                                                                                                                                                                                                                                                                          | Evidence                                         |
| :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------- |
| States                         | `scheduled → cancelled \| completed` (terminal CHECK); scope `freelancer_profile` \| `account`                                                                                                                                                                                                                                                                                 | T11:132-153                                      |
| Windows                        | Freelancer profile **90 days**; account **30 days**; **hard-coded**, not in `security.platform_params`                                                                                                                                                                                                                                                                         | F1060:434, 490                                   |
| Blockers                       | `escrow_held` · `live_work` · `wallet_balance` · `active_projects` · `owns_workspaces`; re-checked at sweep time; deferred, never forced                                                                                                                                                                                                                                       | F1060:182-245, 606-613                           |
| Sweep                          | `account-erasures` daily 04:10 over HTTP + `ACCOUNT_CRON_SECRET` → service-role `security.purge_due_account_deletions`                                                                                                                                                                                                                                                         | `00005060:33-35`; F1060:635-643; G2510:1894-1895 |
| Anonymised                     | `users_public` → tombstone (`deleted-…`, `dob = 1900-01-01`, private); `user_emails` and the `auth.users` email replaced; account banned; `auth.identities` / `auth.sessions` deleted                                                                                                                                                                                          | F1060:555-582                                    |
| Kept                           | Finance ledger, escrows, reviews, Standing. `auth.users` is never deleted (`users_public`'s NO ACTION FK also blocks it)                                                                                                                                                                                                                                                       | —                                                |
| **Left behind** (IW-H5, IW-H6) | Workspace seats; education, experience, certifications, languages, portfolios, links, skills, showcase; follows, bookmarks, recent views, preferences; `handle_changes`; member titles; `security.audit_logs.ip` / `user_agent`; the password hash and MFA factors; avatar and banner `files.items` rows and storage objects (only pointers nulled). Messages were not checked | F1060:555-582                                    |
| Latent cascades                | `finance.payout_splits` cascades from `escrows` **and** `users_public`; `contribution_agreements`, `split_rules` and `vault_permissions` cascade from `teams` / `users_public` (`00000017_tables_finance.sql:347-361, 475, 485`). A service-role delete of a person or team would silently erase split history (IW-L7)                                                         | —                                                |

### 6.6 Enterprise SSO in the schema

There is none: no SSO-domain, identity-provider, verified-domain, SAML or OIDC table or function.
The only domain-like field is the free-text `org.enterprises.website` (T11:928), which IW-H1 misuses
as if it were verified.

---

## 7. Findings register

**Critical and High:** IW-C1 and IW-H1–H8 are listed in §1. Their fixes:

| ID    | Fix (edit in place, §1 of root `CLAUDE.md`)                                                                                                                                                                                             |
| :---- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IW-C1 | ✅ **Fixed 2026-10-29** (see Status): column grants without `dob` · `city` · `country` · `timezone`, the owner-only `org.get_own_private_profile()`, probe `users_public_private_columns.sql`. The row policy is unchanged; see IW-M13. |
| IW-H1 | ✅ **Fixed 2026-10-29:** `alertEnterprisesForDomain` deleted. A rebuild waits on founder question F5 (DNS-verified domains, a free-mail denylist, after the colleague confirms, naming no address).                                     |
| IW-H2 | Founder question F4: give every natural-person owner a `users_public` row with DoB, _or_ collect DoB on the enterprise owner step. Either way, make `fn_is_minor` **fail closed** (no row → refuse in `fn_assert_adult`).               |
| IW-H3 | Add `core/rate-limit.ts` buckets per IP **and** per identifier on every `/api/auth/*` POST. Forward the client address to GoTrue (`X-Forwarded-For` on the anon client, behind a trusted proxy).                                        |
| IW-H4 | `upsert_workspace_role` must refuse an edit unless the editor outranks `max(existing base rank, new base rank)` and does not hold the role.                                                                                             |
| IW-H5 | At erasure: set every seat to `left` (the existing departure path, so vault and split sync fire), or block erasure while the person holds a payout share (founder question F3).                                                         |
| IW-H6 | Extend `fn_erase_account` to the listed tables and storage objects, and clear the password hash and factors (founder question F1 for what is legally retained).                                                                         |
| IW-H7 | Replace the schema-wide `GRANT ALL` and default privileges with explicit per-table grants, the pattern `projects` already follows. Add a probe that every exposed table has RLS.                                                        |
| IW-H8 | On `create_enterprise` failure, `auth.admin.deleteUser(created.user.id)`; better, one definer that provisions both.                                                                                                                     |

**Medium**

| ID     | Area      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                             |
| :----- | :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| IW-M1  | env       | Dev cookies (`pj.dev.age`, `pj.dev.operator-mode`, `pj.dev.operator`) and stub token trust are honoured when `DENO_ENV` is **unset** (the default is `development`). SA:2744 and 2760 say "only when `DENO_ENV` is `development`"                                                                                                                                                                                                                                                         | `apps/web/utils/age-gate.ts:26-30`; `core/env.ts:318`; ABS:608-610; `deno.json` `serve` sets nothing |
| IW-M2  | auth      | Login CSRF: no Origin or Content-Type check on auth POSTs; `pj_csrf` is unimplemented                                                                                                                                                                                                                                                                                                                                                                                                     | `utils/storage-keys.ts:468-469`                                                                      |
| IW-M3  | auth      | `/join` leaks account existence and raw RPC/exception text                                                                                                                                                                                                                                                                                                                                                                                                                                | ABS:381, 391, 440, 452                                                                               |
| IW-M4  | workspace | Role-assignment rank inversion (invite, join request, member role change)                                                                                                                                                                                                                                                                                                                                                                                                                 | F1020:1773, 2573, 2828-2841                                                                          |
| IW-M5  | workspace | Archiving does not re-project vault rights; team archive has no `wallet_balance` blocker; team money doors' archived checks unverified                                                                                                                                                                                                                                                                                                                                                    | F1020:1281-1335, 1442-1538                                                                           |
| IW-M6  | security  | Four `security` tables have RLS off (two of them dead)                                                                                                                                                                                                                                                                                                                                                                                                                                    | T12:7, 15, 32, 45                                                                                    |
| IW-M7  | context   | Enterprise-only owner vs the `session_context` → `users_public` FK (inferred)                                                                                                                                                                                                                                                                                                                                                                                                             | T12:77; F1010:391                                                                                    |
| IW-M8  | security  | `security.is_admin()`: definer, no `search_path`, PUBLIC execute                                                                                                                                                                                                                                                                                                                                                                                                                          | F1001:49-60                                                                                          |
| IW-M9  | SSOT      | No Zod row schemas for the identity core; `EnterpriseMemberSchema` misses `departments`                                                                                                                                                                                                                                                                                                                                                                                                   | §6.1                                                                                                 |
| IW-M10 | schema    | `enterprise_members`: free-text status, no CHECK, `ON DELETE CASCADE` from `auth.users`                                                                                                                                                                                                                                                                                                                                                                                                   | T11:962, 977                                                                                         |
| IW-M11 | SSO       | The SSO panel renders but cannot work (SAML off; no OIDC). An SSO identity would skip DoB (routed as Google, never back to onboarding). Against DESIGN gate §3.11 (see K8)                                                                                                                                                                                                                                                                                                                | `callback.ts:67`; `oauth.ts:69`; `config.toml:286-288`                                               |
| IW-M12 | auth      | No MFA or step-up for withdrawals, ownership transfer or role grants (founder question F7)                                                                                                                                                                                                                                                                                                                                                                                                | `config.toml:348-355`                                                                                |
| IW-M13 | privacy   | The `users_public` row policy still admits every signed-in account to every row, so names, handles, headlines and `interests` of `private` profiles (minors' included) are enumerable over PostgREST. Narrowing it to own-row + `fn_profile_visible` needs the invoker readers moved to definers first (`view_business_staff`, `get_dashboard_projects`, `get_client_pipeline`, `list_ledger`, and the ~18 service reads of other people's names, which `get_party_cards` already serves) | P2010:10-13                                                                                          |
| IW-D1  | design    | Auth heading weights at `--fw-bold`                                                                                                                                                                                                                                                                                                                                                                                                                                                       | §4.6                                                                                                 |

**Low:** IW-L1–L7 and IW-D2–D5 above. Further Low items:

- `/join` steps scroll internally.
- The `/join` page ignores the server lock cookie.
- OAuth pre-fill PII sits in the query string.
- `/api/settings/[section]` gates adult-only sections in the UI only (IW-L5).
- `teams.visibility` has no CHECK.
- `enable_freelancer_profile` has a loose `search_path`.
- The OAuth exchange uses the service role.
- Retention windows are hard-coded.
- No vault-rights reconciler exists.
- The `/register` and `/reset` dead aliases.
- The ROUTING.md and database-doc drift (§4.5, §6.1–6.2).

---

## 8. Test coverage

| Covered                                                                                                                                                                                                                                                                                                                                                                                                        | Not covered                                                                                                                                                                                                                                                   |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/access-token.test.ts` (13), `session-reissue.test.ts`, `session-verify.test.ts`, `bearer.test.ts`, `pending-verification.test.ts`; refusal mappers (`account-lifecycle-refusals`, `freelancer-unlock`, `refresh-outcome`, `verification-status`); `AuthBackendService.test.ts` (5 pure helpers); `workspace.contract.test.ts` (38 SQL↔TS pins); workspace `live.test.ts` (48 mapping tests over doubles) | `ContextBackendService` and the switch route; rank rules in role edits and assignment (IW-H4, IW-M4); `fn_erase_account` and the sweep; archive → vault; team ownership transfer's vault effect; the `users_public` column exposure (IW-C1); auth rate limits |

There are **89 rollback-safe SQL probes** in `supabase/probes/` (e.g. `vault_sync_backstop.sql`,
`ownership_transfer_gate.sql`, `function_grants.sql`). They are run by hand; `deno task test`
(`deno.json:80-91`) never runs them. Wiring the probes into CI, or at least into `db:reset`, would
have caught IW-C1 and IW-M6.

## 9. Limits of this audit

- **Static reading only.** No SQL, probe, test or server was run. These findings come from reading
  migrations and config and should be confirmed by a probe:
  - IW-C1 (exposure);
  - IW-H3 (GoTrue sees the server's IP);
  - IW-M2 (login CSRF);
  - IW-M7 (enterprise FK).
- **Not checked:**
  - how GoTrue builds claims when the hook fails;
  - message retention after erasure;
  - every settings write route's guard;
  - `redeem_workspace_invite_link` re-validation;
  - the team money doors' archived checks;
  - card-in-card on rendered pages;
  - who owns the definer views.
- **The 2026-10-19/20 Teams and Businesses audits (Decisions #265, #300)** list open red rows on
  these consoles. Those files are deleted in the current working tree; their open rows were not
  re-measured here.
