# Identity, User Management & Workspaces — Consolidated Audit (2026-10-29 → 2026-11-11)

> **Evaluation, not binding.** Consolidated 2026-11-11 from `IDENTITY_AND_WORKSPACES_AUDIT.md`
> (2026-10-29) and `IDENTITY_DECISIONS_AND_GAPS.md` (IDG, 2026-10-29); IDG was deleted, and §15 maps
> its old sections and IDs to this one. Pre-merge text:
> `git show 08296359:documentation/architecture/IDENTITY_AND_WORKSPACES_AUDIT.md` (and
> `…/IDENTITY_DECISIONS_AND_GAPS.md`). Status is doc-derived (audit banners,
> [`IDENTITY_BUILD_PROMPTS.md`](IDENTITY_BUILD_PROMPTS.md) run order, FOUNDER_QUESTIONNAIRE Part C,
> `git log`), not re-verified in code. Rulings: Decision #336
> (`reference/decisions/decisions-122-126.md`; FLAGS (a)–(i) = F1–F9; OWNER RULINGS I1–I4, S7, Q0.2
> (b), (c) and Q0.4), with the later flags #344 (h), (i), (n) and the correction #382.
>
> Read-only evaluation of the identity domain: authentication (`/join`, `/login`, `/verify`,
> `/forgot-password`, OAuth, SSO), the acting-context engine (`security.session_context` → the
> access-token hook → JWT claims), personas (`/become-partner`), `/settings`, and the Teams &
> Businesses workspace console with its permission engine and vault projection. Measured against
> `PRODUCT_SPEC.md` (PS), `SYSTEM_ARCHITECTURE.md` (SA), `ROUTING.md`, `DESIGN_SYSTEM.md`,
> `documentation/database/{org,security}/*` and the decision log. **No code was changed by this
> audit.** Everything below comes from reading code, migrations and config; no SQL probe, test or
> server was run (§9). What the code alone cannot settle follows the findings: questions for founder
> sign-off, each with options, trade-offs and a recommendation (§10, F1–F9); contradictions between
> source documents, or between a document and the built system (§11, K1–K12); and the fixes that
> follow existing rules and need no ruling (folded into §7). Per root `CLAUDE.md` §8, nothing was
> silently resolved, and neither audit edited a source-of-truth document.
>
> **Section numbers.** §0–§9 keep the pre-merge numbers, which `IDENTITY_BUILD_PROMPTS.md`,
> `FOUNDER_QUESTIONNAIRE.md` (A-B6) and `supabase/probes/` cite; the absorbed material follows as
> §10–§14.
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
> `packages/backend/services/auth/AuthBackendService.ts` · **svc/** = `packages/backend/services/` ·
> **IDG** = the absorbed `IDENTITY_DECISIONS_AND_GAPS.md` (deleted; §15) · **IBP** =
> `IDENTITY_BUILD_PROMPTS.md` · **FQ** = `FOUNDER_QUESTIONNAIRE.md` (Part C is the ruling table) ·
> **SEC** = `SECURITY_MODERATION_AND_AI_GAPS.md` · **CAS** = `COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`
> · **FBP** = `FINANCE_BUILD_PROMPTS.md` · **SBP-A** = `SUBSCRIPTIONS_AUDIT.md`. `F1`–`F9` (no
> four-digit number) are founder questions, never migration files.

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

**Status (2026-11-11, doc-derived):**

- **Wave 0, no ruling needed (fixed):** IW-C1's column half and IW-H1 (`660c9658`); IW-H3,
  IW-M1/K10, IW-M2, IW-M3 and IW-H8 (`12a80862`); IW-H7, IW-M6's RLS half, IW-M8, IW-M10's CHECK,
  IW-H4/IW-M4/K6, IW-L1, IW-L2, the `teams.visibility` CHECK, `enable_freelancer_profile`'s
  `search_path` and `org.fn_is_minor` failing closed (`81a108f0`); IW-M9 (`4c9482a2`); IW-D1–D5
  (`e30b4111`); the probe runner `deno task test:probes` (`f9c4fc31`). Source: the IBP header.
- **Wave 1.1 (`94d22e84`):** every ruling recorded on #336 (§10); IDG §4's documentation patches
  applied as the Q0.4 sweep (§13).
- **Wave 2:** OWN1 (`96599cea`) and OWN2 (`aaaeab07`) close IW-H2, IW-M7, K3 and F4. Until they
  landed, Wave 0's fail-closed `fn_is_minor` refused every enterprise sign-up (`PM403` on the
  profile-less owner's seat).
- **Later correction:** Decision #382 (2026-11-04) made username sign-in work (§2.1).
- **Open:** HK1; the erasure chain ERA1 → ERA4; SSO1; ARC1; MFA1 → MFA3; MIN1; MIN2; RLS1 (last);
  LOW1; the roadmap prompts X1 and X2; the Z1 docs sweep (§12).

## 0. Premise corrections

The commissioning brief carried several names and numbers that the code and the guardrails have
moved past. They are corrected here so the findings do not re-open settled ground.

| Brief assumed                                                                                                                 | Actual (source)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :---------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org.organisations`, `org.is_organisation_member`                                                                             | **Renamed to Enterprise** (Decision #231): `org.enterprises` (T11:919), `org.enterprise_members` (T11:957), `org.is_enterprise_member` (F1020:166), claim `active_enterprise_id`. The `org` schema name is kept.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Four mutually exclusive contexts (personal, team, business, organisation)                                                     | **Five acting states in four slots.** Personal = every slot NULL; the **profile slot** holds `freelancer` _or_ `business` (`active_profile_type` + `active_profile_id`); then `active_team_id`; then `active_enterprise_id`. `ck_session_context_one_slot` (T12:72-75) admits at most one.                                                                                                                                                                                                                                                                                                                                             |
| "90-day account deletion retention" (IDG §0.1: "90-day account deletion vs GDPR immediate purge" is mis-stated on both sides) | **Account erasure is 30 days** (F1060:490; PS §Settings "Deleting an account"). **90 days** is the freelancer-profile give-up window (F1060:434) and the released-handle hold (F1060:47-50). Money records are kept anonymised for ~7 years (PS §5 Retention Policies). **What GDPR requires** is not an immediate purge: erasure "without undue delay", answered within **one month** (Art. 12(3), extendable by two months for complexity, with notice). So the 30-day account window is defensible as built; the real conflicts are **scope** (K1) and the **90-day freelancer window when it is used as an erasure request** (K2). |
| "AuthBackendService, UserBackendService, WorkspaceBackendService" are the whole service surface                               | Two more own identity behaviour: `ContextBackendService` (`svc/context/`, the switch) and `AccountLifecycleBackendService` (`svc/user/`, handle policy + erasure). `IdentitiesBackendService` owns linking.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Enterprise SSO is SAML/OIDC                                                                                                   | The code path is `signInWithSSO({ domain })` (ABS:977), which GoTrue serves for **SAML only**; `[auth.sso.saml]` is commented out (`supabase/config.toml:286-288`). There is no OIDC path and no domain table. PS:2958-2962 records SSO as "surface ships now, wiring deferred".                                                                                                                                                                                                                                                                                                                                                       |
| RLS policies read the acting context from JWT claims                                                                          | **No policy reads `security.current_context()` or `auth.jwt()`.** The function is referenced only in F1001 and F1700. Every org policy authorises through membership tables via definer helpers (§6.3). Claims drive chrome and service scoping only.                                                                                                                                                                                                                                                                                                                                                                                  |
| 13–17 adult proxy for team members is a live model (IDG §0.2)                                                                 | PS:3094-3101: **specified, post-MVP and disabled**. The database refuses every minor as a Team / Business / Enterprise member (`trg_workspace_member_adult`, `00001810_triggers_auth_onboarding.sql:44-54`; owner decision 2026-10-13). The open question was whether it should exist at all, and on what legal footing (F8); reconciling a running system was not the issue. Since ruled: I4 builds it behind a flag that stays off (§10 F8).                                                                                                                                                                                         |

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

**Since 2026-10-29:** see the 2026-11-11 status above. Per-ID status is in the §7 register, rulings
in §10, contradictions in §11 and the prompt that owns each open item in §12.

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

**Since (doc-derived):**

- **Password sign-in by `@handle`.** Decision #382 (2026-11-04) found that the handle half never
  worked: the service role had no `USAGE` on `org`, so the handle→email read failed `42501`,
  `resolveUsernameEmail` took that as an unknown username, and every username sign-in answered 401
  while fetch-faked tests stayed green. The role now holds `USAGE` plus column grants
  (`users_public (user_id, username)`, `user_emails (user_id, email)`), never a table grant. This
  row's ✅ held for email sign-in only; Fixed for `@handle` (#382).
- **SSO:** Ruled → S7 (b), hide the panel; Open → SSO1, roadmap X1 (§10 F6).
- **MFA / step-up:** Ruled → I3 (a); Open → MFA1 → MFA3 (§10 F7).

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

Status: stub trust (IW-M1), join enumeration (IW-M3), rate limiting (IW-H3) and CSRF (IW-M2) Fixed
(`12a80862`); the `/api/*` return target and the PII in URLs → LOW1; the SSO domain reveal Open (no
prompt). Per row: §7.

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
  TypeScript filters (catalogue `ownership.ts:19`, the files library) only. The revoked-session
  window is founder question F9 (§10).
- **Hook failure** returns the event unchanged (F1700:254-257). Context claims are then absent (a
  personal shell: fail-closed), but `onboarded` and `isRestricted` are absent too. The app reads
  absence as onboarded and unrestricted (fail-open, **chrome only**; `fn_assert_adult` still
  refuses).

**Gaps on this path** (Status per ID: §7)

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

**Since (doc-derived):** the enterprise path now collects the owner's name and DoB on step 1.6, the
under-13 lock covers it, and an owner under 18 is refused (OWN1, `96599cea`; OWN2, `aaaeab07`):
IW-H2 Fixed. Step 1.6 fits the fixed frame unscrolled at 1440, 900 and 390 px (OWN2). The page lock
cookie → LOW1 (5); the SSO bypass → X1 (a JIT seat must route through `/join` completion).

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

Domain instances of the age gate stay in their own audits (§14): SCA S-32 (the entity-schedule
routes; fixed 2026-10-30), PMA X12 (an unclaimed ticket's assignee write skips the adult gate) and
CAS S33 (`search.query_logs` anonymises minors, `00001400:702-704`). The minors model itself (the
proxy, EU consent ages) is §10 F8 and §11 K9.

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
  - Low: its `search_path` is `public, org, security, auth`, not `''` (Fixed, `81a108f0`).

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

Status: items 1, 3, 4 and 5 Fixed in ROUTING.md (Wave 1.1, `94d22e84`; §13). Item 2 Open → LOW1 (6).
`ROUTING.md` cites this section as "IDG §4.5" (:136, :172, :699); IDG never had a §4.5.

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

Status: all five Fixed (Wave 0 A-B5, `e30b4111`);
`apps/web/features/auth/styles/styles.gate.test.ts` now polices the auth sheets (IBP §1).

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
- **Rank rule:** ❌ incomplete (Fixed since: §7 IW-H4, IW-M4).
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

Status: IW-M5 Open → ARC1 (which adds a `pending_funds` blocker beside `wallet_balance`, an IBP
architect default); IW-H5 Ruled → I1 (c), Open → ERA3; the reconciler Open (no prompt).

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

Status: IW-M9 and the `Tables.md` drift Fixed (`4c9482a2`); the `teams.visibility` CHECK and the
`enterprise_members.status` CHECK Fixed (`81a108f0`); the `enterprise_members` CASCADE → HK1 (§7
IW-M10).

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

Status: IW-H7 Fixed (`81a108f0`: per-table grants in `00002520`, per-view in `00003005`, probe
`rls_exposed_tables.sql`); IW-M6 Partly fixed (RLS on, nothing dropped, `81a108f0`), the drop Ruled
→ Q0.2 (b), Open → HK1; the doc drift Fixed (`81a108f0`, `94d22e84`; §13).

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
  `database/org/Policies.md` (recorded: `Policies.md:458-460`, `81a108f0`).
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
  profile-less identity (enterprise owners; a future SSO identity). (Fixed since: `fn_is_minor`
  fails closed for an `auth.users` identity with no profile row, `81a108f0`; every enterprise owner
  gets a profile, OWN1 `96599cea`.)
- **Minor seats (ruling I4):** the off state is `trg_workspace_member_adult`'s hard refusal; no
  proxy flag exists yet, and MIN2 creates it, built ⚖️ off (§10 F8).

### 6.5 Account lifecycle & retention

| Item                                                       | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Evidence                                         |
| :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------- |
| States                                                     | `scheduled → cancelled \| completed` (terminal CHECK); scope `freelancer_profile` \| `account`                                                                                                                                                                                                                                                                                                                                                                                                     | T11:132-153                                      |
| Windows                                                    | Freelancer profile **90 days**; account **30 days**; **hard-coded**, not in `security.platform_params`                                                                                                                                                                                                                                                                                                                                                                                             | F1060:434, 490                                   |
| Blockers                                                   | `escrow_held` · `live_work` · `wallet_balance` · `active_projects` · `owns_workspaces`; re-checked at sweep time; deferred, never forced                                                                                                                                                                                                                                                                                                                                                           | F1060:182-245, 606-613                           |
| Sweep                                                      | `account-erasures` daily 04:10 over HTTP + `ACCOUNT_CRON_SECRET` → service-role `security.purge_due_account_deletions`                                                                                                                                                                                                                                                                                                                                                                             | `00005060:33-35`; F1060:635-643; G2510:1894-1895 |
| Anonymised                                                 | `users_public` → tombstone (`deleted-…`, `dob = 1900-01-01`, private); `user_emails` and the `auth.users` email replaced; account banned; `auth.identities` / `auth.sessions` deleted                                                                                                                                                                                                                                                                                                              | F1060:555-582                                    |
| Kept                                                       | Finance ledger, escrows, reviews, Standing. `auth.users` is never deleted (`users_public`'s NO ACTION FK also blocks it)                                                                                                                                                                                                                                                                                                                                                                           | —                                                |
| **Left behind** (IW-H5, IW-H6)                             | Workspace seats; education, experience, certifications, languages, portfolios, links, skills, showcase; follows, bookmarks, recent views, preferences; `handle_changes`; member titles; `security.audit_logs.ip` / `user_agent`; the password hash and MFA factors; avatar and banner `files.items` rows and storage objects (only pointers nulled). Messages were not checked                                                                                                                     | F1060:555-582                                    |
| **Left behind: search data** (SEC G16 = CAS S17, absorbed) | Erasure leaves search data (it extends IW-H6; #336 (a)'s table list omitted the `search` schema): the freelancer row stays active with its embedding of the erased profile; `query_logs` keeps `user_id`, raw text and the query vector forever; `user_affinity` and `interest_events` stay linked. This contradicts the published "erased after 30 days" (`features/legal/core/content/privacy.ts:233`). `query_logs` anonymises minors (`00001400:702-704`) and had no retention sweep (CAS S33) | `00001060:532-581` (SEC G16)                     |
| Latent cascades                                            | `finance.payout_splits` cascades from `escrows` **and** `users_public`; `contribution_agreements`, `split_rules` and `vault_permissions` cascade from `teams` / `users_public` (`00000017_tables_finance.sql:347-361, 475, 485`). A service-role delete of a person or team would silently erase split history (IW-L7)                                                                                                                                                                             | —                                                |

Status (rulings I1 (a)–(d), Q0.2 (c); §10): the windows → dials, ERA2; the seats → ERA3; the left
behind rows, credentials, storage objects, messages and the search data (I1 (d): erasure also nulls
search embeddings, query logs and affinity rows) → ERA1; the legal-hold vault and the restore replay
→ ERA4; the latent cascades → HK1. The `search-query-log-retention` job is seeded dormant and
registers itself once ERA2's `search.fn_prune_query_logs` exists (IBP §0.4). The retention period
per record class is the owner's ⚖️ table in `finance-model.md` §17 (FQ I1), not repeated here.

### 6.6 Enterprise SSO in the schema

There is none: no SSO-domain, identity-provider, verified-domain, SAML or OIDC table or function.
The only domain-like field is the free-text `org.enterprises.website` (T11:928), which IW-H1 misuses
as if it were verified.

Ruled since: S7 (§10 F5, F6). The spec to record, `org.enterprise_domains` checked by a DNS TXT
lookup with a free-mail denylist, then SAML per verified domain and JIT seats on the Enterprise
plan, is IBP X1's (Open, 🧑 when the build starts).

---

## 7. Findings register

**Critical and High:** IW-C1 and IW-H1–H8 are listed in §1. The fixes that need no ruling (IDG §3)
follow rules the spec and architecture already state; each is an edit in place (root `CLAUDE.md` §1)
and should carry a probe in `supabase/probes/`. Their fixes:

| ID    | Fix (edit in place, §1 of root `CLAUDE.md`)                                                                                                                                                                                                                                                                                                                                                                                        | Rule it restores (IDG §3)                               | Status                                                                          |
| :---- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------ | :------------------------------------------------------------------------------ |
| IW-C1 | ✅ **Fixed 2026-10-29** (see Status): column grants without `dob` · `city` · `country` · `timezone`, the owner-only `org.get_own_private_profile()`, probe `users_public_private_columns.sql`. The row policy is unchanged; see IW-M13. IDG §3 (K4) had proposed the whole set: an own-row + `fn_profile_visible` SELECT policy, the column `REVOKE`, the owner's DoB through a definer, and a re-check of "the 8 direct readers". | PS 13–17 rules 3 and 5; SA:2788                         | Fixed at column level (`660c9658`); the row half → IW-M13                       |
| IW-H1 | ✅ **Fixed 2026-10-29:** `alertEnterprisesForDomain` deleted. A rebuild waits on founder question F5 (DNS-verified domains, a free-mail denylist, after the colleague confirms, naming no address).                                                                                                                                                                                                                                | — (ruling: F5; K12)                                     | Fixed (`660c9658`); rebuild Ruled → S7 (a), Open → X1                           |
| IW-H2 | Founder question F4: give every natural-person owner a `users_public` row with DoB, _or_ collect DoB on the enterprise owner step. Either way, make `fn_is_minor` **fail closed** (no row → refuse in `fn_assert_adult`).                                                                                                                                                                                                          | — (ruling: F4; K3)                                      | Fixed (fail closed, `81a108f0`; OWN1, `96599cea`; OWN2, `aaaeab07`); Ruled → I2 |
| IW-H3 | Add `core/rate-limit.ts` buckets per IP **and** per identifier on every `/api/auth/*` POST. Forward the client address to GoTrue (`X-Forwarded-For` on the anon client, behind a trusted proxy).                                                                                                                                                                                                                                   | SA §Runtime & API Security                              | Fixed (Wave 0 A-B1, `12a80862`)                                                 |
| IW-H4 | `upsert_workspace_role` must refuse an edit unless the editor outranks `max(existing base rank, new base rank)` and does not hold the role. IDG §3: rank checks against the existing role, the target role and the role's holders.                                                                                                                                                                                                 | SA:1962-1963 (K6)                                       | Fixed (Wave 0 S-A5, `81a108f0`; probe `workspace_rank_rule.sql`)                |
| IW-H5 | At erasure: set every seat to `left` (the existing departure path, so vault and split sync fire), or block erasure while the person holds a payout share (founder question F3).                                                                                                                                                                                                                                                    | — (ruling: F3; K7)                                      | Ruled → I1 (c); Open → ERA3                                                     |
| IW-H6 | Extend `fn_erase_account` to the listed tables and storage objects, and clear the password hash and factors (founder question F1 for what is legally retained). IDG §3: delete the storage objects. The `search` schema too (SEC G16, §6.5).                                                                                                                                                                                       | PS:3185-3190 (K1, the personal-table half)              | Ruled → I1 (a), (d); Open → ERA1 (+ ERA4 for the hold)                          |
| IW-H7 | Replace the schema-wide `GRANT ALL` and default privileges with explicit per-table grants, the pattern `projects` already follows. Add a probe that every exposed table has RLS (IDG §3: and a policy).                                                                                                                                                                                                                            | SA §RLS "mandatory", §Function grants "deny by default" | Fixed (Wave 0 S-A5, `81a108f0`; probe `rls_exposed_tables.sql`)                 |
| IW-H8 | On `create_enterprise` failure, `auth.admin.deleteUser(created.user.id)`; better, one definer that provisions both.                                                                                                                                                                                                                                                                                                                | Thin route / fat service atomicity                      | Fixed (Wave 0 A-B1, `12a80862`)                                                 |

**Medium**

| ID     | Area      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                             | Fix · rule it restores (IDG §3)                                                                                                   | Status                                                                                                                                                |
| :----- | :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| IW-M1  | env       | Dev cookies (`pj.dev.age`, `pj.dev.operator-mode`, `pj.dev.operator`) and stub token trust are honoured when `DENO_ENV` is **unset** (the default is `development`). SA:2744 and 2760 say "only when `DENO_ENV` is `development`"                                                                                                                                                                                                                                                         | `apps/web/utils/age-gate.ts:26-30`; `core/env.ts:318`; ABS:608-610; `deno.json` `serve` sets nothing | Unset `DENO_ENV` means production for every security-bearing switch · SA:2744, 2760 (K10)                                         | Fixed (`12a80862`)                                                                                                                                    |
| IW-M2  | auth      | Login CSRF: no Origin or Content-Type check on auth POSTs; `pj_csrf` is unimplemented                                                                                                                                                                                                                                                                                                                                                                                                     | `utils/storage-keys.ts:468-469`                                                                      | Require `Content-Type: application/json` and a same-origin `Origin` on every state-changing `/api/*` POST · SA §Session Integrity | Fixed (`12a80862`)                                                                                                                                    |
| IW-M3  | auth      | `/join` leaks account existence and raw RPC/exception text                                                                                                                                                                                                                                                                                                                                                                                                                                | ABS:381, 391, 440, 452                                                                               | One generic `/join` refusal with a "sign in or reset" path; never forward raw GoTrue or SQL text · SA:2679-2681 (no enumeration)  | Fixed (`12a80862`)                                                                                                                                    |
| IW-M4  | workspace | Role-assignment rank inversion (invite, join request, member role change)                                                                                                                                                                                                                                                                                                                                                                                                                 | F1020:1773, 2573, 2828-2841                                                                          | Rank checks against the existing role, the target role and the role's holders · SA:1962-1963 (K6)                                 | Fixed (`81a108f0`)                                                                                                                                    |
| IW-M5  | workspace | Archiving does not re-project vault rights; team archive has no `wallet_balance` blocker; team money doors' archived checks unverified                                                                                                                                                                                                                                                                                                                                                    | F1020:1281-1335, 1442-1538                                                                           | Re-project vault rights on archive; add a `wallet_balance` team-archive blocker · SA:1965-1971                                    | Open → ARC1                                                                                                                                           |
| IW-M6  | security  | Four `security` tables have RLS off (two of them dead)                                                                                                                                                                                                                                                                                                                                                                                                                                    | T12:7, 15, 32, 45                                                                                    | Enable RLS on the four `security` tables (drop the two dead ones, with approval) · SA §RLS                                        | Partly fixed (RLS on, nothing dropped; `81a108f0`); the drop Ruled → Q0.2 (b), Open → HK1 (🧑 only if #335 (h) adopted the Turnstile table; #344 (h)) |
| IW-M7  | context   | Enterprise-only owner vs the `session_context` → `users_public` FK (inferred)                                                                                                                                                                                                                                                                                                                                                                                                             | T12:77; F1010:391                                                                                    | — (ruling: F4)                                                                                                                    | Fixed (OWN1, `96599cea`: its probe first confirmed `23503` on `session_context_user_id_fkey1`, then closed it)                                        |
| IW-M8  | security  | `security.is_admin()`: definer, no `search_path`, PUBLIC execute                                                                                                                                                                                                                                                                                                                                                                                                                          | F1001:49-60                                                                                          | Pin `is_admin`'s `search_path` and revoke PUBLIC · SA §Function grants                                                            | Fixed (`81a108f0`)                                                                                                                                    |
| IW-M9  | SSOT      | No Zod row schemas for the identity core; `EnterpriseMemberSchema` misses `departments`                                                                                                                                                                                                                                                                                                                                                                                                   | §6.1                                                                                                 | Zod row schemas for the identity core, pinned to the migrations like `workspace.contract.test.ts` · SA §Zod SSOT                  | Fixed (`4c9482a2`)                                                                                                                                    |
| IW-M10 | schema    | `enterprise_members`: free-text status, no CHECK, `ON DELETE CASCADE` from `auth.users`                                                                                                                                                                                                                                                                                                                                                                                                   | T11:962, 977                                                                                         | Add a CHECK on `enterprise_members.status`; turn the identity and split cascades into RESTRICT · "nothing hard-deleted" (K11)     | Partly fixed (`ck_enterprise_member_status`, `81a108f0`); the FK → HK1                                                                                |
| IW-M11 | SSO       | The SSO panel renders but cannot work (SAML off; no OIDC). An SSO identity would skip DoB (routed as Google, never back to onboarding). Against DESIGN gate §3.11 (see K8)                                                                                                                                                                                                                                                                                                                | `callback.ts:67`; `oauth.ts:69`; `config.toml:286-288`                                               | — (ruling: F6; until then hide the panel behind a flag, K8)                                                                       | Ruled → S7 (b); Open → SSO1; roadmap → X1                                                                                                             |
| IW-M12 | auth      | No MFA or step-up for withdrawals, ownership transfer or role grants (founder question F7)                                                                                                                                                                                                                                                                                                                                                                                                | `config.toml:348-355`                                                                                | — (ruling: F7)                                                                                                                    | Ruled → I3 (a); Open → MFA1 → MFA2 → MFA3                                                                                                             |
| IW-M13 | privacy   | The `users_public` row policy still admits every signed-in account to every row, so names, handles, headlines and `interests` of `private` profiles (minors' included) are enumerable over PostgREST. Narrowing it to own-row + `fn_profile_visible` needs the invoker readers moved to definers first (`view_business_staff`, `get_dashboard_projects`, `get_client_pipeline`, `list_ledger`, and the ~18 service reads of other people's names, which `get_party_cards` already serves) | P2010:10-13                                                                                          | the narrowing in the finding · PS 13–17 rules 3 and 5; SA:2788                                                                    | Open → RLS1 (runs last)                                                                                                                               |
| IW-D1  | design    | Auth heading weights at `--fw-bold`                                                                                                                                                                                                                                                                                                                                                                                                                                                       | §4.6                                                                                                 | Token-only auth sheets; extend `styles.gate.test.ts` to `features/auth/styles/` · DESIGN_SYSTEM Part E                            | Fixed (`e30b4111`)                                                                                                                                    |

**Low:** IW-L1–L7 and IW-D2–D5 above, then further Low items.

| ID    | Finding                                                                                                                       | Where          | Status                                                                                                           |
| :---- | :---------------------------------------------------------------------------------------------------------------------------- | :------------- | :--------------------------------------------------------------------------------------------------------------- |
| IW-L1 | No enterprise `status` check at the switch or the hook                                                                        | §3             | Fixed (`81a108f0`)                                                                                               |
| IW-L2 | A `freelancer` profile-slot context is never re-verified at mint                                                              | §3             | Fixed (`81a108f0`)                                                                                               |
| IW-L3 | Stale comments in `ContextBackendService.ts` and `useContextSwitch.ts`                                                        | §3             | Open → LOW1 (1)                                                                                                  |
| IW-L4 | No unit test for `ContextBackendService` or the switch route                                                                  | §3, §8         | Open → LOW1 (2)                                                                                                  |
| IW-L5 | `/api/settings/[section]` gates adult-only sections in the UI only                                                            | §4.2           | Open → LOW1 (3)                                                                                                  |
| IW-L6 | `fn_profile_visible('enterprise', id)` is an existence check; `public` in the `is_*` helpers' `search_path`                   | §6.3           | Open → LOW1 (8); a SQL change needs a ruling                                                                     |
| IW-L7 | Latent cascades would silently erase split history                                                                            | §6.5           | Ruled → Q0.2 (c); Open → HK1                                                                                     |
| IW-D2 | Press feedback by `translateY`                                                                                                | §4.6           | Fixed (`e30b4111`)                                                                                               |
| IW-D3 | Hard-coded durations, shadows, rings and a control size                                                                       | §4.6           | Fixed (`e30b4111`)                                                                                               |
| IW-D4 | `.passport` and the never-imported `PassportCard.tsx` (IDG §3: delete `PassportCard`)                                         | §4.6           | Fixed (`e30b4111`)                                                                                               |
| IW-D5 | Inline `style` in `JoinArt.tsx`                                                                                               | §4.6           | Fixed (`e30b4111`)                                                                                               |
| —     | `/join` steps scroll internally                                                                                               | §4.1           | Partly fixed (Enterprise 1.6 fits the frame unscrolled; OWN2, `aaaeab07`); the other tall steps Open (no prompt) |
| —     | The `/join` page ignores the server lock cookie                                                                               | §4.1           | Open → LOW1 (5)                                                                                                  |
| —     | OAuth pre-fill PII sits in the query string                                                                                   | §2.2           | Open → LOW1 (4)                                                                                                  |
| —     | `safeRedirect` accepts `/api/*` as a return target                                                                            | §2.2           | Open → LOW1 (7)                                                                                                  |
| —     | SSO reveals which domains are configured                                                                                      | §2.2           | Open (no prompt)                                                                                                 |
| —     | `teams.visibility` has no CHECK                                                                                               | §6.1           | Fixed (`81a108f0`)                                                                                               |
| —     | `enable_freelancer_profile` has a loose `search_path`                                                                         | §4.3           | Fixed (`81a108f0`)                                                                                               |
| —     | The OAuth exchange uses the service role                                                                                      | §5.1           | Open (no prompt)                                                                                                 |
| —     | `api/user/preferences.ts` re-implements `readActor` inline                                                                    | §5.1           | Open → LOW1 (9)                                                                                                  |
| —     | `live-detail.ts:357` recomputes `effectivePermissions` for display; the contract test does not pin the union/revoke semantics | §5.2           | Open (no prompt)                                                                                                 |
| —     | Retention windows are hard-coded                                                                                              | §6.5           | Ruled → I1 (b); Open → ERA2                                                                                      |
| —     | No vault-rights reconciler exists                                                                                             | §5.3           | Open (no prompt)                                                                                                 |
| —     | The `/register` and `/reset` dead aliases                                                                                     | §4.5           | Open → LOW1 (6)                                                                                                  |
| —     | The ROUTING.md and database-doc drift (§4.5, §6.1–6.2)                                                                        | §4.5, §6.1–6.2 | Fixed (`81a108f0`, `4c9482a2`, `94d22e84`; §13)                                                                  |

---

## 8. Test coverage

| Covered                                                                                                                                                                                                                                                                                                                                                                                                        | Not covered                                                                                                                                                                                                                                                   |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/access-token.test.ts` (13), `session-reissue.test.ts`, `session-verify.test.ts`, `bearer.test.ts`, `pending-verification.test.ts`; refusal mappers (`account-lifecycle-refusals`, `freelancer-unlock`, `refresh-outcome`, `verification-status`); `AuthBackendService.test.ts` (5 pure helpers); `workspace.contract.test.ts` (38 SQL↔TS pins); workspace `live.test.ts` (48 mapping tests over doubles) | `ContextBackendService` and the switch route; rank rules in role edits and assignment (IW-H4, IW-M4); `fn_erase_account` and the sweep; archive → vault; team ownership transfer's vault effect; the `users_public` column exposure (IW-C1); auth rate limits |

There are **89 rollback-safe SQL probes** in `supabase/probes/` (e.g. `vault_sync_backstop.sql`,
`ownership_transfer_gate.sql`, `function_grants.sql`). They are run by hand; `deno task test`
(`deno.json:80-91`) never runs them. Wiring the probes into CI, or at least into `db:reset`, would
have caught IW-C1 and IW-M6.

Status: Partly fixed (the probe runner `deno task test:probes` / `test:probes:fresh`; Wave 0 A-B6 =
PM-WP13, `f9c4fc31`). Since the audit, the rank rule (`workspace_rank_rule.sql`), the `users_public`
columns (`users_public_private_columns.sql`), exposed-table RLS (`rls_exposed_tables.sql`) and the
enterprise owner (`enterprise_owner_profile.sql`) have probes; the `ContextBackendService` tests →
LOW1 (2).

## 9. Limits of this audit

- **Static reading only.** No SQL, probe, test or server was run. These findings come from reading
  migrations and config and should be confirmed by a probe:
  - IW-C1 (exposure);
  - IW-H3 (GoTrue sees the server's IP);
  - IW-M2 (login CSRF);
  - IW-M7 (enterprise FK).
  - (Since confirmed: IW-C1 by `users_public_private_columns.sql`; IW-M7 by OWN1's probe, `23503`.)
- **Not checked:**
  - how GoTrue builds claims when the hook fails;
  - message retention after erasure (ERA1 now carries a message clause);
  - every settings write route's guard;
  - `redeem_workspace_invite_link` re-validation;
  - the team money doors' archived checks (ARC1 probes them);
  - card-in-card on rendered pages;
  - who owns the definer views.
- **The 2026-10-19/20 Teams and Businesses audits (Decisions #265, #300)** list open red rows on
  these consoles. Those files are deleted in the current working tree; their open rows were not
  re-measured here.
- **The consolidation (2026-11-11)** derives every Status from documents and `git log` only; no
  code, probe or test was re-run.

---

## 10. Decisions and rulings (IDG §2)

Ordered by risk. Each recommendation was the default that §7's no-ruling fixes (IDG §3) assume.
Every question was ruled in Wave 1.1 (FQ Part C; OWNER RULINGS on Decision #336, which holds the
full text); the option tables are kept as the only home of the rationale. ⭐ = the recommendation
taken, ✎ = the owner's own answer, ⚖️ = ruled, pending counsel, 🧑 = still open.

| ID     | Question                                                                      | Ruling (FQ Part C)                                                                             | Decision #                    | Status                                                                                 |
| :----- | :---------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- | :---------------------------- | :------------------------------------------------------------------------------------- |
| F1     | What survives an erasure                                                      | I1 (a) ⭐ B, the legal-hold vault; ⚖️ the AML "No", the retention table and the PITR statement | #336 (a)                      | Open → ERA4 (🧑 where the tombstone lives), ERA1; X2 (🧑 who builds the AML programme) |
| F2     | The 90-day freelancer-profile window                                          | I1 (b) ⭐ A, both windows `platform_params`                                                    | #336 (b)                      | Open → ERA2                                                                            |
| F3     | Workspace seats when an account is erased                                     | I1 (c) ⭐ A; the share redistributes by the split rule (M10 (b))                               | #336 (c); #337                | Open → ERA3 (🧑 the freelancer scope's seats, #344 (n))                                |
| F4     | Is an enterprise owner a person?                                              | I2 ⭐ A                                                                                        | #336 (d); closes #87 (b), (c) | Fixed (OWN1, `96599cea`; OWN2, `aaaeab07`)                                             |
| F5     | Domain-colleague alerts                                                       | S7 (a) ⭐ rebuild later on DNS-verified domains with a free-mail denylist                      | #336 (e)                      | Disabled (IW-H1, `660c9658`); rebuild Open → X1 (🧑 when)                              |
| F6     | Enterprise SSO: sequencing and packaging                                      | S7 (b) ⭐ hide the panel now, roadmap A; (c) ✎ Enterprise only                                 | #336 (f); #252                | Open → SSO1; roadmap → X1                                                              |
| F7     | MFA and step-up                                                               | I3 (a) ⭐ A                                                                                    | #336 (g)                      | Open → MFA1 (🧑 recovery), MFA2, MFA3                                                  |
| F8     | Minors in workspaces and the EU consent ages                                  | I4 ✎ ⚖️ build the proxy behind a flag that stays off; ⭐ one EU rule; ⭐ Art. 5(1)(c)          | #336 (h)                      | Partly fixed (PS wording, `94d22e84`); Open → MIN1, MIN2 (⚖️; 🧑 team seats, #344 (i)) |
| F9     | How long a revoked session may act                                            | I3 (b) ⭐ A                                                                                    | #336 (i)                      | Open → MFA2                                                                            |
| Q0.2 b | Drop `security.refresh_tokens` and `security.turnstile_verifications` (IW-M6) | ⭐ Yes                                                                                         | #336 (G)                      | Open → HK1 (🧑 only if #335 (h) adopted the table; #344 (h))                           |
| Q0.2 c | RESTRICT on the four split tables (K11)                                       | ⭐ Yes                                                                                         | #336 (G)                      | Open → HK1                                                                             |
| Q0.4   | IDG §4's documentation patches                                                | ⭐ approve the sweep                                                                           | #336                          | Fixed (doc halves, Wave 1.1, `94d22e84`; §13)                                          |

### F1. What survives an erasure: legal hold vs full anonymisation

| Option                                                         | Pros                                                                                                                                                                                                                                                                                                                                                                 | Cons                                                                                                                                                                                                                                                                                            |
| :------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Full anonymisation (today, extended per K1)**             | Simplest; strongest privacy posture; matches the PS:2842 promise                                                                                                                                                                                                                                                                                                     | If Projective is an obliged entity under AML rules, or must keep payee identity for tax reporting, anonymised money rows may fail record-keeping duties (UK MLR 2017 reg. 40: 5 years after the relationship ends; tax: 6–7 years). Disputes and chargebacks after erasure have no counterparty |
| **B. Legal-hold vault (recommended)**                          | Erase everything personal _except_ a minimal identity record (legal name, DoB, country, Stripe account and KYC references) linked to the retained ledger rows. Held encrypted (Supabase Vault, PS §5), access-logged, readable by the service role only, purged when the statutory period ends. GDPR Art. 17(3)(b) expressly permits retention for legal obligations | One new restricted table and a purge job. Retention periods need counsel's sign-off per jurisdiction                                                                                                                                                                                            |
| **C. Keep the account intact until the retention period ends** | No new machinery                                                                                                                                                                                                                                                                                                                                                     | Fails Art. 17 for all non-financial data; contradicts PS §Settings                                                                                                                                                                                                                              |

**Ask:**

- Approve **B**.
- Have counsel confirm whether Projective's wallet makes it an AML-obliged entity, or whether
  Stripe's KYC records suffice.
- Name the retention period per record type.
- Also confirm the published erasure statement covers **backups** (point-in-time recovery holds
  erased data until it ages out).

**Ruled:** I1 (a) = B ⭐ (Decision #336 (a)), keeping the AML-grade identity set. ⚖️ Pending counsel
on the owner's positions: not AML-obliged but AML-ready, every retention period a `platform_params`
dial (`finance-model.md` §17), and the erasure statement covers PITR backups.

### F2. The 90-day freelancer-profile window

| Option                                                                                                               | Pros                                                                                                                                                                                                                    | Cons                                                                                     |
| :------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| **A. Keep 90 days for "switch to client"; route any explicit erasure request through a ≤ 30-day path (recommended)** | Keeps the commercial benefit: a returning seller restores their Standing, reviews and listings, which protects supply-side retention and marketplace liquidity. Meets Art. 12(3) when someone actually asks for erasure | Two wordings in Settings; one more `deletion_requests.scope` value or a window parameter |
| B. Shorten to 30 days for everyone                                                                                   | One rule                                                                                                                                                                                                                | Weakens restore-to-sell. Sellers who pause for a season lose their history               |
| C. Keep 90 days for everything                                                                                       | No change                                                                                                                                                                                                               | Exceeds the one-month default whenever the downgrade is in substance an erasure request  |

**Ask:** approve **A**. Move both windows into `security.platform_params` so legal can tune them
without a migration.

**Ruled:** I1 (b) = A ⭐, both windows as `platform_params` (Decision #336 (b)).

### F3. Workspace seats when an account is erased

| Option                                                                     | Pros                                                                                                                                                                                     | Cons                                                                                                                      |
| :------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| **A. Auto-leave every seat when the erasure is _scheduled_ (recommended)** | Uses the existing departure path, so vault rights and splits re-project at once and no money is stranded. Live work and held escrow already block scheduling, so no delivery is orphaned | A cancelled deletion does not restore seats; the person must be re-invited. Settings must say so before the typed CONFIRM |
| B. Block deletion while the person holds any seat                          | Nothing silent                                                                                                                                                                           | Pushes the person to leave five workspaces by hand. Hostile UX, and a GDPR friction risk ("undue delay")                  |
| C. Leave seats at erasure time (day 30)                                    | Cancel restores everything                                                                                                                                                               | The person stays a member, with rights, for 30 days while "deleted" and hidden                                            |

**Ask:** approve **A**. Also confirm that a departing member's split share **redistributes per the
team's rule** rather than being held for a dormant member. That is a micro-agency trust promise and
belongs in PS §Teams.

**Ruled:** I1 (c) = A ⭐ (Decision #336 (c)); the rider is ruling M10 (b), redistribute by the split
rule (Decision #337; the split mechanics are FCA's, §14). **Open:** 🧑 what a freelancer-profile
give-up does to team seats (#344 (n); ERA3's stop).

### F4. Is an enterprise owner a person?

Today an enterprise owner is an `auth.users` row with no `users_public` profile (Decision #87(b),
never ruled). That single fact causes IW-H2 (age bypass), IW-M7 (cannot hold the enterprise context)
and the null-claim wart in #87(c).

| Option                                                                                                                  | Pros                                                                                                                                                                                            | Cons                                                                                                                                         |
| :---------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Every natural person gets a `users_public` row, DoB included; the enterprise is an entity they own (recommended)** | One identity model. The age policy holds on every path (K3), the context FK works, and the owner can later unlock a freelancer persona under the additive-persona rule. Every gate stays in SQL | Adds DoB and name to the enterprise wizard's step 1.6 (one field each). Needs a back-fill for existing owners                                |
| B. Keep profile-less owners; add a DoB attestation to the enterprise wizard and make `fn_is_minor` fail closed          | Smallest diff                                                                                                                                                                                   | Two identity kinds forever. Every new gate must remember the profile-less case. The FK to `users_public` still blocks the enterprise context |
| C. Keep it as is                                                                                                        | None                                                                                                                                                                                            | An open COPPA, Children's Code and Stripe 18+ exposure                                                                                       |

**Ask:** approve **A**. Under either A or B, `fn_is_minor` must fail closed: no row means not
provably adult.

**Ruled:** I2 = A ⭐ (Decision #336 (d)); closes #87 (b), (c). The "back-fill" is read as a forced
completion step at the next sign-in, since a migration cannot write a DoB never collected (IBP §0.5
(f)): OWN2's `/join?complete=owner`.

### F5. Domain-colleague alerts

| Option                                                        | Pros                                                                                                                                                                                                                         | Cons                                                                                                                                     |
| :------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Disable now; rebuild on verified domains (recommended)** | Closes IW-H1 immediately. The rebuild (DNS TXT verification, a free-mail denylist, an alert only after the colleague confirms, naming no address, offering "invite your colleagues" instead) is the same foundation F6 needs | The enterprise "land and expand" signal is lost until the rebuild                                                                        |
| B. Keep it but require KYB-verified enterprises               | Quick                                                                                                                                                                                                                        | KYB proves a company exists, not that it owns `gmail.com` or a look-alike domain. Still discloses addresses without the person's consent |
| C. Remove the feature permanently                             | Zero risk                                                                                                                                                                                                                    | Loses a genuine enterprise-procurement growth loop                                                                                       |

**Ask:** approve **A**. Commercially, verified domains are also what makes enterprise trust credible
against Upwork Enterprise's managed-account pitch.

**Ruled:** S7 (a) = A ⭐ (Decision #336 (e)).

### F6. Enterprise SSO: sequencing and packaging

| Option                                                                                                                                              | Pros                                                                                                                                                                                                                | Cons                                                                                                                                                                                          |
| :-------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Verified domains → SAML through GoTrue SSO → JIT seat into `enterprise_members` at a default role, gated to an Enterprise plan (recommended)** | Fits the stack (Supabase's SSO is SAML; no new IdP). Domain verification also serves F5. Plan gating adds SaaS revenue under the investor thesis without touching execution capacity or Standing (Decision #252(C)) | Supabase SSO needs a paid project tier and per-IdP CLI or API registration. OIDC-only buyers (Okta OIDC, Entra OIDC) wait. Every SSO identity must still pass the DoB / profile step (IW-M11) |
| B. Generic OIDC first (custom provider)                                                                                                             | Broader IdP coverage                                                                                                                                                                                                | Built and maintained outside GoTrue's supported path; more attack surface                                                                                                                     |
| C. Hide the SSO panel until a paying enterprise asks                                                                                                | Removes the dead control (K8) at no cost                                                                                                                                                                            | Loses procurement credibility in enterprise sales                                                                                                                                             |

**Ask:**

- Approve **C now**, **A as the roadmap**.
- Decide whether SSO is Enterprise-plan-only (the industry "SSO tax") or part of Business Pro.
- Record in PS §Authentication that the scope is SAML-first.

**Ruled:** S7 (b) ⭐ C now, A as the roadmap; (c) ✎ Enterprise only (Decision #336 (f)). The plan
table's "SAML/OIDC" means this roadmap, not OIDC first; Decision #252 gives SSO to Enterprise alone.
SAML-first is recorded in SA §Authentication and PS (§13). SSO1's flag is `AUTH_SSO_ENABLED` plus a
`pj.dev.sso` dev override (IBP architect default).

### F7. MFA and step-up for money and authority

Neither PS nor SA specifies MFA; TOTP and phone factors are disabled (`config.toml:348-355`).
Projective holds wallet balances, executes withdrawals and lets owners transfer entities, all on one
password.

| Option                                                                                                                                                           | Pros                                                                                                                                                                     | Cons                                                                                      |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| **A. Opt-in TOTP for everyone; mandatory step-up (AAL2) for withdrawals, payout-account changes, ownership transfer, co-owner grants and erasure (recommended)** | Targets the account-takeover-to-cash path, the costliest fraud vector for an escrow platform. Supported natively by GoTrue (`aal` claim). A trust signal clients can see | One enrolment surface plus an `aal2` check in the money RPCs. Some friction at withdrawal |
| B. Opt-in only                                                                                                                                                   | Low friction                                                                                                                                                             | Takeover still reaches the wallet for most users                                          |
| C. Defer                                                                                                                                                         | No work                                                                                                                                                                  | An escrow platform without MFA fails most enterprise security questionnaires              |

**Ask:** approve **A**, and record it in PS §Identity, Taxes & Compliance.

**Ruled:** I3 (a) = A ⭐ (Decision #336 (g)); recorded in PS (§13). The AAL2 checks inside the
payout doors (MFA3) wait for the finance SQL lane, `begin_payout` and `record_payout_account` (FBP
§0, "Identity").

### F8. Minors in workspaces, and the EU consent ages

| Option                                                                                                                                               | Pros                                                                                                                                                                                                                                                                                | Cons                                                                                                                                                                                        |
| :--------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Keep minors to personal projects and portfolios indefinitely; remove the proxy model from the roadmap until counsel designs one (recommended)** | The micro-agency pitch sells _trust_ to enterprise buyers, and an unseen minor on a delivering team is a liability (voidable contracts and IP assignments, child-employment hour limits) that no buyer wants. Minors are not the ideal customer profile; the downside is asymmetric | Closes a long-term "learn by doing" funnel                                                                                                                                                  |
| B. Build the proxy as specified (an adult holds the vault and signs, the minor never holds money)                                                    | A youth-talent story                                                                                                                                                                                                                                                                | Child-employment law (UK Children and Young Persons Act 1933, local bylaws; EU Directive 94/33/EC) is untouched by "the adult signs". IP chain of title (PS deeds) is voidable by the minor |
| C. Verified-guardian accounts                                                                                                                        | Strongest consent record                                                                                                                                                                                                                                                            | Requires storing guardian identity, which PS:3098 forbids; heavy KYC                                                                                                                        |

**Also ask:**

- **(i)** Correct PS:3098-3100's "Article 9" rationale (K9). The rule (store no guardian IDs) can
  stand on data minimisation (Art. 5(1)(c)) instead.
- **(ii)** For EU/EEA users aged 13–15, choose one:
  - (a) keep one global rule set and rely on a non-consent lawful basis for every processing, with
    no consent-based processing (marketing email, non-essential cookies) for under-16s; recommended;
  - (b) apply each member state's Art. 8 age;
  - (c) refuse EU under-16 sign-ups.

**Ruled:** I4 ⚖️ (Decision #336 (h)): for workspaces the owner chose ✎ **B** (not ⭐), built behind
a flag that stays off until counsel signs off; (i) ⭐ Art. 5(1)(c), applied in PS (§13); (ii) ⭐
(a). No flag existed (the #336 correction of 2026-10-30): MIN2 creates it. **Open:** 🧑 proxied
minors on **teams**, since Teams are the freelancer side (#228 (A)) and nobody under 18 has a
freelancer persona (#190, #192): #344 (i), MIN2's stop (recommended: business seats only).

### F9. How long may a revoked session keep acting?

Access tokens live **1 hour** (`config.toml:193`) and are verified locally, so a banned, erased or
signed-out-elsewhere token keeps passing signature checks until it expires (SA:2197-2200). RLS still
authorises by `auth.uid()`, so an erased user's live token can still _read_ their own rows and any
public rows during that hour.

| Option                                                                                                                       | Pros                                                         | Cons                                                            |
| :--------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------- | :-------------------------------------------------------------- |
| **A. Keep 1 h; check `auth.sessions` (cached seconds in Deno KV) on money, authority and erasure routes only (recommended)** | Closes the high-value window without a refresh storm         | A KV lookup on sensitive routes                                 |
| B. Shorten `jwt_expiry` to 15 minutes                                                                                        | Simple; also shortens stale-context chrome (§3 of the audit) | About 4× refresh traffic; more 503 exposure during GoTrue blips |
| C. Accept                                                                                                                    | None                                                         | An erased or banned account acts for up to an hour              |

**Ruled:** I3 (b) = A ⭐ (Decision #336 (i)); MFA2's SQL step-up helper also checks that the session
is live (IBP architect default).

---

## 11. Contradictions register (IDG §1)

Each row names the sources in tension, what the built system does, and whether a human must rule.
Under §0 of root `CLAUDE.md`, `PRODUCT_SPEC.md` wins on business rules and `SYSTEM_ARCHITECTURE.md`
on technical ones; a ruling is needed only where the spec itself is silent, self-contradictory or
legally unsound. "(§7)" and "(§13)" below were IDG's "(§3)" and "(§4)".

| #       | Tension                                                                                                                                                                                                                                                                                                                                                                        | Built system                                                                                                                                                                                                                                                                 | Impact                                                                                                                                                                                                                                                                                                                                                        | Ruling needed?                                                                                                                                                                   | Status                                                             |
| :------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| **K1**  | **Right to be Forgotten vs erasure scope.** PS:2842-2844 says Projective "strictly adhere[s] to GDPR/CCPA 'Right to be Forgotten' protocols". PS:3185-3190 says "personal data is erased". Decision #156(a) ruled an _anonymising_ erasure that keeps tombstones and money records.                                                                                            | `fn_erase_account` anonymises `users_public`, emails and `auth.users`, but leaves portfolios, education, experience, certifications, skills, links, showcase, follows, bookmarks, preferences, past handles, audit IPs, avatar/banner objects and the password hash (IW-H6). | A data-subject request answered "erased" while identifying data remains is a regulator-visible breach. `handle_changes` alone re-identifies the tombstone.                                                                                                                                                                                                    | **Partly.** Extending erasure to purely personal tables follows the spec and needs no ruling (§7). **What may be kept for legal obligations** (identity on money records) is F1. | Ruled → I1 (a), (d); Open → ERA1, ERA4                             |
| **K2**  | **90-day freelancer-profile window vs GDPR Art. 12(3).** PS §Settings keeps a given-up freelancer profile 90 days so the person can restore it.                                                                                                                                                                                                                                | One code path (F1060:434) serves both "switch to client" and any wish to have the seller data gone.                                                                                                                                                                          | As a _product downgrade_ the window is fine. As an _erasure request_ it exceeds the one-month default.                                                                                                                                                                                                                                                        | **Yes, F2.**                                                                                                                                                                     | Ruled → I1 (b); Open → ERA2                                        |
| **K3**  | **Age policy on "every path" vs the enterprise path.** PS:3010-3011 says "the join form, the API and the database all enforce". SA:2728 says "holds on every path". Yet PS:2982-2983 (step 1.6) collects **no DoB** for an Enterprise, and Decision #87(b) left enterprise owners without a profile row.                                                                       | The enterprise owner has no `users_public` row, and `fn_is_minor` returns `false` for a missing row, so every adult gate passes (IW-H2).                                                                                                                                     | Under-13 and 13–17 users can open an enterprise, its wallet included. That breaks COPPA, the Children's Code and Stripe's 18+ terms.                                                                                                                                                                                                                          | **Yes, F4** (which also closes #87(b)).                                                                                                                                          | Fixed (`81a108f0`; OWN1, `96599cea`; OWN2, `aaaeab07`); Ruled → I2 |
| **K4**  | **Children's Code masking vs the `users_public` grant.** PS 13–17 rules 3 and 5 say location and local time are never shown to others, and the profile is never public. SA:2788-2789 masks them in `get_profile_view` and `profiles_index`.                                                                                                                                    | P2010:10-13 plus the G2500:44 blanket grant expose every column of every row to any signed-in account (IW-C1).                                                                                                                                                               | Critical. Every user's DoB is effectively public, because sign-up is self-serve.                                                                                                                                                                                                                                                                              | **No.** The spec is clear; the code is wrong (§7).                                                                                                                               | Fixed at column level (`660c9658`); row half Open → RLS1 (IW-M13)  |
| **K5**  | **SA §Security vs SA §Teams & Businesses.** SA:2535-2537 says "Permissions are checked at the Service layer using custom claims within the JWT (e.g. the acting context's `role`)". SA:2547 cites "`0200_org_rls.sql`". SA:2018-2019 says "the stored context is a preference, never a grant", and SA:1962 says "every write RPC gates on a capability, never on a role name". | The code follows the latter: no RLS reads claims, and every write RPC checks `fn_member_can`.                                                                                                                                                                                | A reader following §Security would build claim-trusting checks, the exact anti-pattern the console avoids.                                                                                                                                                                                                                                                    | **No.** A doc patch to SA §Security (§13).                                                                                                                                       | Fixed (doc, `94d22e84`: SA §Security RBAC bullet; #336 (C))        |
| **K6**  | **"Only someone you outrank" (SA:1962-1963) vs the role RPCs.**                                                                                                                                                                                                                                                                                                                | Role edits check only the new rank. Assignment, invites and join requests check capabilities, never rank (IW-H4, IW-M4).                                                                                                                                                     | Peer-admin demotion, then removal; leads seating admins.                                                                                                                                                                                                                                                                                                      | **No.** The rule is explicit (§7).                                                                                                                                               | Fixed (`81a108f0`)                                                 |
| **K7**  | **Deletion blockers vs seats.** PS:3187-3188 blocks deletion only when the person owns a team, business or enterprise, and says nothing of _membership_. The vault model (SA:1965-1971) assumes seats end.                                                                                                                                                                     | Erasure leaves seats `active`. Team splits keep crediting a tombstone's wallet (IW-H5).                                                                                                                                                                                      | Money stranded in an un-withdrawable wallet; seat counts and plan caps inflated.                                                                                                                                                                                                                                                                              | **Yes, F3.**                                                                                                                                                                     | Ruled → I1 (c); Open → ERA3                                        |
| **K8**  | **SSO surface vs DESIGN gate §3.11.** PS:2958-2962 says the SSO surface "ships now", wiring deferred, "SAML/OIDC". Root `CLAUDE.md` §3.11 says "a control that renders must do something".                                                                                                                                                                                     | `SsoPanel` renders. `signInWithSSO` is SAML-only and SAML is off, so every domain is refused. A future SSO identity would skip the DoB step (IW-M11).                                                                                                                        | A dead control on the login page; a latent age-gate bypass once switched on.                                                                                                                                                                                                                                                                                  | **Yes, F6** (sequencing). Until then, hide the panel behind a flag.                                                                                                              | Ruled → S7 (b); Open → SSO1                                        |
| **K9**  | **The proxy model's legal rationale.** PS:3098-3100 says raw guardian IDs are never stored "(GDPR Article 9 special-category exposure)". PS:3025-3027 applies one rule set, "the EU's national digital-consent ages (13 to 16) are not applied separately".                                                                                                                    | Disabled; the database refuses minor seats.                                                                                                                                                                                                                                  | Art. 9 covers health, biometrics, beliefs and the like, so an ID document is not Art. 9 data unless processed biometrically. National ID numbers fall under Art. 87. The rationale is mis-cited. Separately, where consent is the lawful basis, Art. 8 needs parental consent below the member state's age (16 in e.g. Germany, the Netherlands and Ireland). | **Yes, F8** (with counsel).                                                                                                                                                      | Ruled → I4 ⚖️; PS wording Fixed (`94d22e84`); Open → MIN1, MIN2    |
| **K10** | **"Honoured only when `DENO_ENV` is `development`" (SA:2744, 2760) vs a default of `development` when unset.**                                                                                                                                                                                                                                                                 | `isDevelopment()` and `serverEnv().appEnv` both treat unset as development (IW-M1).                                                                                                                                                                                          | A production deploy that forgets one variable re-enables the minor-gate override, the operator chrome and stub token trust. The database still refuses money and workspace writes.                                                                                                                                                                            | **No.** Make unset mean _production_ for every security-bearing switch (§7).                                                                                                     | Fixed (`12a80862`; SA env contract)                                |
| **K11** | **"Nothing hard-deleted" (root `CLAUDE.md` §5, PRODUCT_MANAGEMENT) vs cascades.**                                                                                                                                                                                                                                                                                              | `enterprise_members.user_id` ON DELETE CASCADE. `payout_splits`, `split_rules`, `contribution_agreements` and `vault_permissions` cascade from `users_public` / `teams` (IW-M10, IW-L7).                                                                                     | Latent today (no app path deletes those parents), but a service-role cleanup would silently erase split history.                                                                                                                                                                                                                                              | **No.** Switch them to RESTRICT, which is additive in spirit and touches no `escrows`, `wallets` or `stages` columns (§7).                                                       | Ruled → Q0.2 (c); Open → HK1                                       |
| **K12** | **Domain-colleague alerts vs PS §5 "Zero-Trust" privacy.** No spec section describes the feature.                                                                                                                                                                                                                                                                              | Any self-registered enterprise is told the address of every sign-up on the domain its free-text `website` names (IW-H1).                                                                                                                                                     | An email-harvesting oracle. Personal data goes to an unverified third party without consent or a lawful basis.                                                                                                                                                                                                                                                | **Yes, F5.** Disable now regardless.                                                                                                                                             | Fixed (disabled, `660c9658`); Ruled → S7 (a); rebuild Open → X1    |

**Raised by the 2026-11-11 consolidation, Decision #410 (`reference/decisions/decisions-122-126.md`,
2026-11-11; open):** flag (b), erasure and `search.query_logs`: SEC G16 and ruling I1 (d) null
`user_id` and `query_embedding`, while `IDENTITY_BUILD_PROMPTS.md` §0.5 ERA1's default deletes the
rows (nulling would keep the raw query text). Flag (c), K11: IDG said the `ON DELETE RESTRICT`
change needs no ruling, the questionnaire put it to the owner as destructive (Q0.2 (c), approved),
and HK1 extends RESTRICT to `enterprise_members.user_id` on K11's word, which Q0.2 (c) may not
cover.

---

## 12. Remediation map

Fix text stays in the §7 rows; the prompts are IBP's. Priority is the audit's severity.

| ID(s)                                                                                                                                             | Priority       | Prompt                  | Status                                 |
| :------------------------------------------------------------------------------------------------------------------------------------------------ | :------------- | :---------------------- | :------------------------------------- |
| IW-C1 (column half), IW-H1                                                                                                                        | Critical, High | post-audit fix          | Fixed (`660c9658`)                     |
| IW-H3, IW-M1 / K10, IW-M2, IW-M3, IW-H8                                                                                                           | High, Medium   | Wave 0 A-B1             | Fixed (`12a80862`)                     |
| IW-H7, IW-M6 (RLS), IW-M8, IW-M10 (CHECK), IW-H4 / IW-M4 / K6, IW-L1, IW-L2, `teams.visibility`, `enable_freelancer_profile`, IW-H2 (fail closed) | High → Low     | Wave 0 S-A5             | Fixed (`81a108f0`)                     |
| IW-M9                                                                                                                                             | Medium         | Wave 0 A-B4             | Fixed (`4c9482a2`)                     |
| IW-D1–D5                                                                                                                                          | Medium, Low    | Wave 0 A-B5             | Fixed (`e30b4111`)                     |
| §8 probes                                                                                                                                         | —              | Wave 0 A-B6 (= PM-WP13) | Partly fixed (runner, `f9c4fc31`)      |
| K5, IDG §4 patches                                                                                                                                | —              | Wave 1.1 (Q0.4)         | Fixed (`94d22e84`; §13)                |
| IW-H2, IW-M7, K3, F4                                                                                                                              | High, Medium   | OWN1 → OWN2             | Fixed (`96599cea`; `aaaeab07`)         |
| IW-M6 (drop), IW-M10 (FK), K11, IW-L7                                                                                                             | Medium, Low    | HK1                     | Open → HK1                             |
| IW-H6, K1, SEC G16 = CAS S17                                                                                                                      | High           | ERA1                    | Open → ERA1                            |
| K2, F2, hard-coded windows                                                                                                                        | Low            | ERA2                    | Open → ERA2                            |
| IW-H5, K7, F3                                                                                                                                     | High           | ERA3                    | Open → ERA3 (🧑)                       |
| F1                                                                                                                                                | High           | ERA4                    | Open → ERA4 (⚖️, 🧑)                   |
| IW-M11, K8, F6 (the panel)                                                                                                                        | Medium         | SSO1                    | Open → SSO1                            |
| IW-M5                                                                                                                                             | Medium         | ARC1                    | Open → ARC1                            |
| IW-M12, F7                                                                                                                                        | Medium         | MFA1 → MFA2 → MFA3      | Open → MFA1 (🧑), MFA2, MFA3 (⏳ F·DB) |
| F9                                                                                                                                                | —              | MFA2                    | Open → MFA2                            |
| F8 (ii), K9                                                                                                                                       | —              | MIN1                    | Open → MIN1                            |
| F8 (the proxy), K9                                                                                                                                | —              | MIN2                    | Open → MIN2 (⚖️, 🧑)                   |
| IW-M13                                                                                                                                            | Medium         | RLS1                    | Open → RLS1 (last)                     |
| IW-L3, IW-L4, IW-L5, IW-L6 and five untagged Lows                                                                                                 | Low            | LOW1                    | Open → LOW1                            |
| IW-H1 rebuild, F5, F6 roadmap, §6.6                                                                                                               | —              | X1                      | Open → X1 (🧑)                         |
| F1 (the AML programme)                                                                                                                            | —              | X2                      | Open → X2 (⚖️, 🧑)                     |
| Status columns, docs sweep                                                                                                                        | —              | Z1                      | Open → Z1                              |
| OAuth exchange service role; vault reconciler; `effectivePermissions` recompute and union/revoke pin; SSO domain reveal; other tall `/join` steps | Low            | —                       | Open (no prompt)                       |

## 13. Documentation patches (IDG §4)

IDG §4 proposed these patches (not applied by the audit). Q0.4 approved them and Wave 1.1 applied
the doc halves; each target now carries the patch, so the patch text is dropped here. Line numbers
are the tree's on 2026-11-11.

| Patch                                                                                                                        | Status · evidence                                                                                                    |
| :--------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| SA §Security: rewrite the RBAC bullet (claims are chrome and scoping; authority is `fn_member_can`) (K5)                     | Fixed (`94d22e84`): SA:2668-2672                                                                                     |
| SA §Security: replace the "`0200_org_rls.sql`" citation with `00002001`–`00002021`                                           | Fixed: no document outside the audits and the decision log cites it                                                  |
| SA §Security: remove `security.is_admin()` from the definer exceptions once pinned                                           | Fixed (`81a108f0`): SA:2716-2718                                                                                     |
| SA §Authentication & Identity: an unset `DENO_ENV` is production (K10)                                                       | Fixed (`94d22e84`): SA:2868-2869; env contract SA:3844-3847                                                          |
| SA §Authentication & Identity: SSO is SAML-first, flag-hidden (F6)                                                           | Fixed (`94d22e84`): SA:2870-2872 (its "Not built yet" waits on SSO1)                                                 |
| ROUTING.md: route-table rows for `/join`, `/login`, `/verify`, `/forgot-password`, `/become-partner`; an `/api/auth/*` table | Fixed (`94d22e84`): ROUTING:136-139, 161, 694-716                                                                    |
| ROUTING.md: correct the `(auth)` group's chrome and guard                                                                    | Fixed: ROUTING:14, 60                                                                                                |
| ROUTING.md: complete the `(dashboard)` middleware bullet                                                                     | Fixed (`94d22e84`): ROUTING:47-59 (OWN2 added `?complete=owner`)                                                     |
| ROUTING.md: remove or redirect `/register` and `/reset`                                                                      | Doc: ROUTING:76 lists `AUTH_PATHS` without them; the code half Open → LOW1 (6)                                       |
| ROUTING.md: fix the catalogue `[id]` segment                                                                                 | Fixed (`94d22e84`): ROUTING:172                                                                                      |
| `database/*/Tables.md`: the missing columns and the second `session_context` FK                                              | Fixed (`4c9482a2`): `security/Tables.md:18`; `org/Tables.md` (e.g. :61, :93, :240, :722-724)                         |
| `database/security/Tables.md`, `Policies.md`: mark the four RLS-off tables                                                   | Fixed (`81a108f0`; RLS now on): `security/Tables.md:55-57`, `security/Policies.md:13-19`                             |
| `database/org/Policies.md`: correct the Standing-grants sentence                                                             | Fixed (`81a108f0`): `org/Policies.md:50`                                                                             |
| `database/org/Policies.md`: FORCE RLS would break the recursion helpers                                                      | Fixed (`81a108f0`): `org/Policies.md:458-460`                                                                        |
| PS after F1 (retention statement and legal hold)                                                                             | Fixed (`94d22e84`): PS:3288-3295, 3303-3305                                                                          |
| PS after F2 (two erasure wordings)                                                                                           | Fixed (`94d22e84`): PS:3296-3298                                                                                     |
| PS after F3 (seats and split redistribution on erasure)                                                                      | Fixed (`94d22e84`): PS:3299-3300                                                                                     |
| PS after F4 (enterprise owner identity, DoB on step 1.6)                                                                     | Fixed (`94d22e84`; marker removed by OWN2, `aaaeab07`): PS:3456, 3614                                                |
| PS after F5 (verified domains)                                                                                               | Fixed (`94d22e84`): PS:3424-3428                                                                                     |
| PS after F7 (MFA)                                                                                                            | Fixed (`94d22e84`): PS:3431                                                                                          |
| PS after F8 (proxy model, Art. 9 wording, EU consent ages)                                                                   | Fixed (`94d22e84`): PS:3583; "Article 9" no longer appears in PS                                                     |
| PRODUCT_MANAGEMENT: the scheduled-removal row gains the seat auto-leave (F3)                                                 | Fixed (`acad9b64`, narrowed to the `account` scope by #344's merge): PRODUCT_MANAGEMENT:217 ("Not built yet" → ERA3) |
| PRODUCT_MANAGEMENT: a new `deletion_requests.scope`, if F2 (A) adds one                                                      | Not applied: the row records both windows as dials and no new scope; ERA2 decides                                    |

## 14. Cross-domain pointers

**Owned here** (spec §3), with the aliases other audits keep:

| Topic                                    | Here                                                     | Elsewhere (pointer or domain evidence only)                                               |
| :--------------------------------------- | :------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| Erasure model (FQ I1)                    | §6.5, §7 IW-H5 / IW-H6, §10 F1–F3, §11 K1 / K2 / K7      | SEC G16 = CAS S17 (absorbed in §6.5); CAS S33 (query logs, the search schema's own row)   |
| MFA, step-up, session revocation (FQ I3) | §2.1, §7 IW-M12, §10 F7 / F9                             | FBP §0 "Identity" (MFA3 waits on `begin_payout`, `record_payout_account`)                 |
| Minors 13–17 (FQ I4)                     | §4.1, §4.2, §6.4, §10 F8, §11 K9                         | SCA S-32, PMA X12, CAS S33 keep their domain evidence                                     |
| Enterprise SSO and domains (FQ S7)       | §2.1, §6.6, §7 IW-H1 / IW-M11, §10 F5 / F6, §11 K8 / K12 | SBP-A #252 (b), (j) (plan prices, entitlement keys); SSO's plan placement is S7 (c), here |

**Owned elsewhere:**

| Topic                                                                             | Our IDs                                                 | Owner file §                                                                             |
| :-------------------------------------------------------------------------------- | :------------------------------------------------------ | :--------------------------------------------------------------------------------------- |
| Team money on departure: split redistribution, the departed finder's cut (FQ M10) | F3 rider, IW-H5                                         | `FINANCE_AUDIT.md` (A19, the M10 rows; ruling M10, #337)                                 |
| Fair Exit, removal and deletion refunds (FQ P1, P2)                               | the erasure blockers `escrow_held` · `live_work` (§6.5) | `PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md`                                               |
| Search query logs: retention, `fn_log_query`'s `p_user_id`, the guest policy      | §6.5 search row                                         | CAS S33; SEC G13                                                                         |
| Messaging tables under erasure (the N1 schema window)                             | ERA1's message clause; §9                               | CAS (#339 (f)); IBP §0.4 (ERA1 ↔ M·N1)                                                   |
| App-side Turnstile verifications vs the table drop                                | IW-M6, Q0.2 (b)                                         | `EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md` §Turnstile (#335 (h)); #344 (h) |

---

## 15. Section map of the merged conflicts file (IDG)

`IDENTITY_DECISIONS_AND_GAPS.md` (2026-10-29) was merged here on 2026-11-11 and deleted. Pre-merge
text: `git show 08296359:documentation/architecture/IDENTITY_DECISIONS_AND_GAPS.md`.

| Old section / IDs                                                                                                                                                               | Now                                                                                                           |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------ |
| Header (companion scope; Decision #336; FLAGS (a)–(i) = F1–F9)                                                                                                                  | [`IDENTITY_AND_WORKSPACES_AUDIT.md`](IDENTITY_AND_WORKSPACES_AUDIT.md) header; §10 table, "Decision #" column |
| §0.1 "90-day account deletion vs GDPR immediate purge" (GDPR Art. 12(3), the K1 / K2 framing)                                                                                   | §0, row "90-day account deletion retention"                                                                   |
| §0.2 "Adult proxy models for 13–17 team members"                                                                                                                                | §0, row "13–17 adult proxy"                                                                                   |
| §1 Conflict analysis, K1–K12                                                                                                                                                    | §11 (same IDs, Status added)                                                                                  |
| §2 Questions for founder sign-off, F1–F9 (with F8 (i), (ii) (a)–(c))                                                                                                            | §10 (same IDs; option tables kept, each with its Ruled line)                                                  |
| §3 Fixes that need no ruling (cited as "IDG §3" by `IDENTITY_BUILD_PROMPTS.md` ARC1 and in commit `81a108f0`)                                                                   | §7 register: the "Rule it restores (IDG §3)" and "Fix · rule it restores (IDG §3)" columns                    |
| §4 Documentation patches proposed, not applied (cited as "IDG §4" by `FOUNDER_QUESTIONNAIRE.md` Q0.4, Decision #336 and `ROUTING.md:59`)                                        | §13 (applied in Wave 1.1, `94d22e84`, but for one conditional item and one code half)                         |
| "IDG §4.5" (cited by `ROUTING.md:136`, `:172`, `:699`; this file never had a §4.5: the content is the audit's §4.5 Routing conformance, patched through §4's ROUTING.md bullet) | §4.5 and §13                                                                                                  |
| `IW-*` finding IDs referenced here                                                                                                                                              | §1 and §7 (unchanged IDs)                                                                                     |
