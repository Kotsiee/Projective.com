import { fail, ok, type ServiceResult, type SessionTokens } from "../ServiceResult.ts";
import {
	CookieStore,
	getAnonClient,
	getOAuthClient,
	getServiceClient,
	getUserClient,
	isAuthBackendLive,
} from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import type { CreateOrganisation } from "@projective/types/org";

// #region GoTrue mapping helpers
/** A GoTrue session's token subset (the client returns a wider object). */
interface GoTrueSession {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
}

/** Map a GoTrue session to the transport {@link SessionTokens}, or `undefined` if incomplete. */
function toSession(session: GoTrueSession | null | undefined): SessionTokens | undefined {
	if (!session?.access_token || !session?.refresh_token) return undefined;
	return {
		accessToken: session.access_token,
		refreshToken: session.refresh_token,
		expiresIn: session.expires_in,
	};
}

/** Coerce an unknown metadata value to a trimmed non-empty string, else undefined. */
function str(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
// #endregion

// #region Corporate-domain matching helpers
/** The lowercased domain of an email address (`ada@Acme.com` → `acme.com`), or null. */
function emailDomain(email: string): string | null {
	const at = email.lastIndexOf("@");
	if (at < 0) return null;
	const domain = email.slice(at + 1).trim().toLowerCase();
	return domain.length > 0 ? domain : null;
}

/** Normalise an organisation website/domain to a bare host (strip scheme, `www.`, port, and path). */
function siteDomain(website: string | null | undefined): string | null {
	if (!website) return null;
	const host = website
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.split(/[/?#]/)[0]
		.split(":")[0];
	return host.length > 0 ? host : null;
}

/** True when an email's domain equals — or is a sub-domain of — an organisation's registered domain. */
function domainMatches(emailDom: string, orgDom: string): boolean {
	return emailDom === orgDom || emailDom.endsWith(`.${orgDom}`);
}
// #endregion

/**
 * AuthBackendService — the FAT server-side auth service.
 *
 * It owns the business logic and (once `AUTH_BACKEND_LIVE` is enabled) the Supabase/GoTrue calls and
 * DB transactions behind account creation, sign-in, email verification, password recovery, and
 * Enterprise-SSO discovery. Thin routes under `apps/web/routes/api/auth/*` do only HTTP parsing,
 * Zod validation, and auth guarding, then delegate here and map the returned {@link ServiceResult}
 * to a `Response`. Islands never reach this — they `fetch` the routes.
 *
 * **Stub mode (default).** Until the real calls are implemented and verified, every method returns
 * the same safe outcome the MVP route stubs returned, so the running app is unchanged. The live
 * paths — gated on {@link isAuthBackendLive} — mark exactly where the Supabase work slots in, and
 * are wired to real client provisioning so implementing them is a fill-in, not a re-architecture.
 *
 * Note on the boundary: input *guarding* that depends on feature-local pure helpers (the DoB
 * age-gate, password-required-unless-OAuth) stays in the route per `SYSTEM_ARCHITECTURE.md` §2
 * ("routes do … auth guarding"); it will consolidate into `@projective/types` alongside the Zod
 * schemas when that package lands. This service owns everything downstream of a validated request.
 */

// #region Input / output contracts
/** Individual account provisioning input (the server-derived, validated shape). */
export interface ProvisionIndividualInput {
	type: "individual";
	email: string;
	/** Required for email/password signups; absent for an OAuth completion. */
	password?: string;
	/** True when completing an already-authenticated OAuth signup. */
	oauth?: boolean;
	/** The caller's Supabase access token — required to complete an OAuth signup in-context. */
	accessToken?: string;
	firstName: string;
	lastName: string;
	username: string;
	dob: string;
	intent: "client" | "freelancer";
	skills?: string[];
	/** The onboarding "purpose" tags → `org.users_public.interests`. */
	interests?: string[];
	/** Server-sanitised return path. */
	redirectTo: string;
}

/** Organisation account provisioning input. */
export interface ProvisionOrganisationInput {
	type: "organization";
	corporateEmail: string;
	password: string;
	/**
	 * The validated organisation to provision (the {@link CreateOrganisation} SSOT shape from
	 * `@projective/types`). The live path admin-creates the owner identity, then inserts it into
	 * `org.organisations` + seeds the owner's `org.organisation_members` row via the
	 * `public.create_organisation` RPC (migrations 0314/0315).
	 */
	organisation: CreateOrganisation;
	/** Server-sanitised return path. */
	redirectTo: string;
}

/** Fields the fat service needs to provision an individual or organisation account. */
export type ProvisionAccountInput = ProvisionIndividualInput | ProvisionOrganisationInput;

/** Credentials for a password sign-in. */
export interface AuthenticateInput {
	email: string;
	password: string;
	remember?: boolean;
	redirectTo: string;
}

/** A 6-digit email-confirmation attempt. */
export interface ConfirmEmailInput {
	code: string;
	email?: string;
	redirectTo: string;
}

/** A verification-status poll. */
export interface VerificationStatusInput {
	email?: string;
	redirectTo: string;
	/** The caller's access token, when available, for an RLS-scoped read. */
	accessToken?: string;
}

/** A password-reset completion. */
export interface ResetPasswordInput {
	email: string;
	code: string;
	password: string;
	redirectTo: string;
}

/** The success shape shared by the auth endpoints (mirrors the client `AuthResult` fields). */
export interface AuthPayload {
	redirectTo?: string;
	requiresVerification?: boolean;
	verified?: boolean;
}
// #endregion

/** Sentinel code the MVP stubs treat as the deterministic failure path. */
const SENTINEL_BAD_CODE = "000000";

export class AuthBackendService {
	// #region Account creation & sign-in
	/**
	 * Provision a new account.
	 *
	 * Live paths (`AUTH_BACKEND_LIVE=true`):
	 *  - **Individual, email/password** — admin-create the `auth.users` identity with the onboarding
	 *    metadata; the `on_auth_user_created` trigger (migration 0304) provisions `org.users_public`,
	 *    the email row, the persona profile, session context, and the audit entry. Email unconfirmed →
	 *    `requiresVerification: true`.
	 *  - **Individual, OAuth completion** — the caller is already authenticated (they OAuth'd, landed
	 *    profile-less on `/join`), so provision in-context via the `complete_onboarding` RPC. OAuth
	 *    email is pre-verified → `requiresVerification: false`.
	 *  - **Organisation** — admin-create the owner identity, then insert the org + owner membership
	 *    atomically via the `create_organisation` RPC (migrations 0314/0315). Email unconfirmed →
	 *    `requiresVerification: true`.
	 *
	 * Stub path (default): reports `requiresVerification: true` without touching Supabase.
	 */
	static async provisionAccount(input: ProvisionAccountInput): Promise<ServiceResult<AuthPayload>> {
		if (!isAuthBackendLive()) {
			return ok({ requiresVerification: true, redirectTo: input.redirectTo });
		}

		try {
			if (input.type === "organization") {
				const admin = getServiceClient();
				const { data: created, error } = await admin.auth.admin.createUser({
					email: input.corporateEmail,
					password: input.password,
					email_confirm: false,
					user_metadata: { objective: "organization" },
				});
				if (error || !created?.user) {
					return fail(422, {
						message: error?.message ?? "We couldn't create the organisation owner account.",
					});
				}
				const { error: rpcError } = await admin.rpc("create_organisation", {
					p_owner: created.user.id,
					p_payload: input.organisation,
				});
				if (rpcError) {
					// e.g. a duplicate handle surfaces here as a unique_violation.
					return fail(422, {
						message: rpcError.message ?? "We couldn't create the organisation.",
					});
				}
				return ok({ requiresVerification: true, redirectTo: input.redirectTo });
			}

			// Individual — build the profile metadata the 0304 provisioning reads.
			const meta = {
				first_name: input.firstName,
				last_name: input.lastName,
				username: input.username,
				dob: input.dob,
				objective: input.intent === "freelancer" ? "freelancer" : "client",
				skills: input.skills ?? [],
				interests: input.interests ?? [],
			};

			if (input.oauth) {
				if (!input.accessToken) {
					return fail(401, { message: "Your session has expired. Please sign in again." });
				}
				const user = getUserClient(input.accessToken);
				const { error } = await user.rpc("complete_onboarding", { p_payload: meta });
				if (error) {
					return fail(422, {
						message: error.message ?? "We couldn't finish setting up your account.",
					});
				}
				return ok({ requiresVerification: false, redirectTo: input.redirectTo });
			}

			const admin = getServiceClient();
			const { data: created, error } = await admin.auth.admin.createUser({
				email: input.email,
				password: input.password,
				email_confirm: false,
				user_metadata: meta,
			});
			if (error || !created?.user) {
				return fail(422, { message: error?.message ?? "We couldn't create your account." });
			}
			// Corporate-domain signal: if this address belongs to a registered organisation's domain,
			// alert that org so it can invite/approve the colleague. Best-effort — never blocks signup.
			await AuthBackendService.alertOrganisationsForDomain(input.email, created.user.id);
			return ok({ requiresVerification: true, redirectTo: input.redirectTo });
		} catch (e) {
			return fail(500, {
				message: e instanceof Error ? e.message : "Account provisioning failed.",
			});
		}
	}

	/**
	 * Corporate-domain onboarding signal.
	 *
	 * When a standard (email/password) individual signs up with an address whose domain matches an
	 * existing Organisation's registered domain (e.g. `ada@acme.com` ↔ an org whose website is
	 * `acme.com`), drop an in-app `comms.notifications` entry to that org's owners and admins so they
	 * can invite or approve the new colleague. Sub-domains (`ada@eu.acme.com`) match too. Live-only,
	 * best-effort, and non-blocking — every failure is swallowed so it can never affect account
	 * creation.
	 */
	private static async alertOrganisationsForDomain(
		email: string,
		newUserId?: string,
	): Promise<void> {
		if (!isAuthBackendLive()) return;
		const dom = emailDomain(email);
		if (!dom) return;
		try {
			const db = getServiceClient();
			const { data: orgs } = await db
				.schema("org")
				.from("organisations")
				.select("id, legal_name, website")
				.not("website", "is", null);

			const matched = (orgs ?? []).filter((o) => {
				const orgDom = siteDomain(o.website as string | null);
				return orgDom ? domainMatches(dom, orgDom) : false;
			});

			for (const org of matched) {
				const { data: members } = await db
					.schema("org")
					.from("organisation_members")
					.select("user_id")
					.eq("organisation_id", org.id)
					.eq("status", "active")
					.in("role", ["owner", "admin"]);

				const rows = (members ?? [])
					// Don't notify the joiner about themselves (e.g. an org owner re-registering).
					.filter((m) => m.user_id !== newUserId)
					.map((m) => ({
						user_id: m.user_id as string,
						type: "organisation.domain_member_signup",
						title: "Someone from your domain just joined",
						body: `${email} signed up on Projective using your ${dom} domain.`,
						entity_table: "org.organisations",
						entity_id: org.id as string,
					}));

				if (rows.length > 0) {
					await db.schema("comms").from("notifications").insert(rows);
				}
			}
		} catch {
			// Non-blocking: a failed alert must never fail the signup.
		}
	}

	/**
	 * Authenticate with email + password. Live: GoTrue password grant → return the session (the route
	 * mints the cookie); flag `requiresVerification` when the identity's email is unconfirmed. Stub:
	 * succeeds without a session.
	 */
	static async authenticate(input: AuthenticateInput): Promise<ServiceResult<AuthPayload>> {
		if (!isAuthBackendLive()) {
			return ok({ requiresVerification: false, redirectTo: input.redirectTo });
		}
		try {
			const anon = getAnonClient();
			const { data, error } = await anon.auth.signInWithPassword({
				email: input.email,
				password: input.password,
			});
			if (error) {
				// GoTrue reports an unconfirmed email distinctly; everything else is a credential failure
				// (kept generic to avoid leaking which half was wrong).
				if (/confirm/i.test(error.message)) {
					return ok({ requiresVerification: true, redirectTo: input.redirectTo });
				}
				return fail(401, { message: "Invalid email or password." });
			}
			return ok(
				{ requiresVerification: false, redirectTo: input.redirectTo },
				{ session: toSession(data.session) },
			);
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : "Sign-in failed." });
		}
	}
	// #endregion

	// #region Email verification
	/**
	 * Confirm an email with the 6-digit code. Live: exchange the code with GoTrue (`verifyOtp`) and
	 * mint the session cookie. Stub: rejects the sentinel `000000`, accepts any other 6-digit code.
	 */
	static async confirmEmail(input: ConfirmEmailInput): Promise<ServiceResult<AuthPayload>> {
		if (input.code === SENTINEL_BAD_CODE) {
			return fail(422, { message: "That code didn't match. Check the digits and try again." });
		}
		if (!isAuthBackendLive()) {
			return ok({ redirectTo: input.redirectTo });
		}
		try {
			if (!input.email) {
				return fail(422, {
					message: "We couldn't verify the code without your email. Please retry.",
				});
			}
			const anon = getAnonClient();
			const { data, error } = await anon.auth.verifyOtp({
				email: input.email,
				token: input.code,
				type: "email",
			});
			if (error) {
				return fail(422, { message: "That code didn't match. Check the digits and try again." });
			}
			return ok({ redirectTo: input.redirectTo }, { session: toSession(data.session) });
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : "Verification failed." });
		}
	}

	/**
	 * Poll app-owned verification state — the "database listener" behind `/verify`. Live: read
	 * `org.user_emails.verified_at` (kept in lockstep with GoTrue by migration 0312). Stub: not-yet.
	 */
	static async getVerificationStatus(
		input: VerificationStatusInput,
	): Promise<ServiceResult<AuthPayload>> {
		if (isAuthBackendLive() && input.email) {
			// Administrative read of the app-owned flag; the real flow prefers an RLS-scoped read via
			// the caller's JWT once a pre-session token exists for the pending account.
			const db = getServiceClient();
			const { data } = await db
				.schema("org")
				.from("user_emails")
				.select("verified_at")
				.eq("email", input.email)
				.maybeSingle();
			return ok({ verified: !!data?.verified_at, redirectTo: input.redirectTo });
		}
		return ok({ verified: false, redirectTo: input.redirectTo });
	}

	/** Re-issue the verification email. Live: GoTrue resend. Stub/anti-enumeration: always succeeds. */
	static async resendVerification(input: { email?: string }): Promise<ServiceResult<AuthPayload>> {
		if (isAuthBackendLive() && input.email) {
			try {
				await getAnonClient().auth.resend({ type: "signup", email: input.email });
			} catch {
				// Swallow — always report success (anti-enumeration; the client throttles anyway).
			}
		}
		return ok({});
	}
	// #endregion

	// #region Password recovery
	/**
	 * Begin password recovery. Anti-enumeration: always reports success regardless of whether the
	 * address has an account. Live: GoTrue sends the recovery email (recovery.html template).
	 */
	static async requestPasswordReset(
		input: { email: string; redirectTo: string },
	): Promise<ServiceResult<AuthPayload>> {
		if (isAuthBackendLive()) {
			try {
				await getAnonClient().auth.resetPasswordForEmail(input.email, {
					redirectTo: `${serverEnv().appUrl}/reset`,
				});
			} catch {
				// Swallow — never reveal whether the address exists.
			}
		}
		return ok({});
	}

	/**
	 * Complete password recovery: verify the recovery code, then set the new password as the
	 * now-authenticated user. Live: GoTrue `verifyOtp(type:"recovery")` → `updateUser`. Stub: rejects
	 * the sentinel `000000`. No session cookie is minted — the flow returns to `/login` to sign in
	 * fresh.
	 */
	static async resetPassword(input: ResetPasswordInput): Promise<ServiceResult<AuthPayload>> {
		if (input.code === SENTINEL_BAD_CODE) {
			return fail(422, { message: "That code didn't match or has expired." });
		}
		if (!isAuthBackendLive()) {
			return ok({ redirectTo: input.redirectTo });
		}
		try {
			const anon = getAnonClient();
			const { data, error } = await anon.auth.verifyOtp({
				email: input.email,
				token: input.code,
				type: "recovery",
			});
			if (error || !data.session) {
				return fail(422, { message: "That code didn't match or has expired." });
			}
			const authed = getUserClient(data.session.access_token);
			const { error: updateError } = await authed.auth.updateUser({ password: input.password });
			if (updateError) {
				return fail(422, { message: updateError.message ?? "We couldn't update your password." });
			}
			return ok({ redirectTo: input.redirectTo });
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : "Password reset failed." });
		}
	}
	// #endregion

	// #region Google OAuth (PKCE)
	/**
	 * Begin the Google OAuth handshake. Returns the provider authorize URL and the {@link CookieStore}
	 * holding the PKCE code-verifier the route must persist (as a short-lived cookie) so the callback
	 * can complete the exchange. Non-live: no URL (the route falls back to its simulated prefill).
	 */
	static async startGoogleOAuth(
		input: { callbackUrl: string },
	): Promise<{ url: string | null; store: CookieStore; error?: string }> {
		const store = new CookieStore();
		if (!isAuthBackendLive()) return { url: null, store };
		const client = getOAuthClient(store);
		const { data, error } = await client.auth.signInWithOAuth({
			provider: "google",
			options: { redirectTo: input.callbackUrl, skipBrowserRedirect: true },
		});
		return { url: data?.url ?? null, store, error: error?.message };
	}

	/**
	 * Complete the Google OAuth handshake: exchange the `code` (with the round-tripped PKCE verifier
	 * in `cookies`) for a session, resolve whether the identity has a Projective profile yet, and
	 * surface the Google-provided identity for pre-filling `/join`. The returned {@link CookieStore}'s
	 * `diff()` lets the route clear the spent verifier cookie.
	 */
	static async exchangeOAuthCode(
		input: { code: string; cookies: Record<string, string> },
	): Promise<{
		session?: SessionTokens;
		identity?: { firstName?: string; lastName?: string; email?: string; avatar?: string };
		isNewUser: boolean;
		store: CookieStore;
		error?: string;
	}> {
		const store = new CookieStore(input.cookies);
		const client = getOAuthClient(store);
		const { data, error } = await client.auth.exchangeCodeForSession(input.code);
		if (error || !data.session) {
			return { isNewUser: true, store, error: error?.message ?? "OAuth exchange failed." };
		}

		const user = data.session.user;
		const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
		const fullName = str(meta.full_name) ?? str(meta.name);
		const identity = {
			firstName: str(meta.given_name) ?? fullName?.split(/\s+/)[0],
			lastName: str(meta.family_name) ??
				(fullName ? str(fullName.split(/\s+/).slice(1).join(" ")) : undefined),
			email: user.email ?? str(meta.email),
			avatar: str(meta.avatar_url) ?? str(meta.picture),
		};

		// New user = no org.users_public profile yet → route to /join for onboarding.
		let isNewUser = true;
		try {
			const { data: profile } = await getServiceClient()
				.schema("org")
				.from("users_public")
				.select("user_id")
				.eq("user_id", user.id)
				.maybeSingle();
			isNewUser = !profile;
		} catch {
			// Default to new-user (send to /join) if the lookup fails.
		}

		return { session: toSession(data.session), identity, isNewUser, store };
	}
	// #endregion

	// #region Enterprise SSO (SAML/OIDC)
	/**
	 * Resolve a corporate email domain to its registered SAML/OIDC identity provider and begin the
	 * handshake. Live: `signInWithSSO({ domain })` returns the IdP authorize URL; the PKCE verifier is
	 * written to the {@link CookieStore} (the route persists it as a short-lived cookie) so the shared
	 * `/api/auth/callback` can complete the exchange — SSO and OAuth converge on the same callback.
	 *
	 * Returns `{ url: null, message }` when no provider is configured for the domain (or non-live), so
	 * the login panel shows a friendly note instead of redirecting.
	 */
	static async resolveSso(
		input: { domain: string; callbackUrl: string },
	): Promise<{ url: string | null; store: CookieStore; message?: string }> {
		const store = new CookieStore();
		const notConfigured = `No SSO provider is configured for ${input.domain} yet.`;
		if (!isAuthBackendLive()) return { url: null, store, message: notConfigured };
		try {
			const client = getOAuthClient(store);
			const { data, error } = await client.auth.signInWithSSO({
				domain: input.domain,
				options: { redirectTo: input.callbackUrl },
			});
			if (error || !data?.url) return { url: null, store, message: notConfigured };
			return { url: data.url, store };
		} catch {
			return { url: null, store, message: notConfigured };
		}
	}
	// #endregion
}
