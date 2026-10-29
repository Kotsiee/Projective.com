import { fail, ok, type ServiceResult, type SessionTokens } from "../ServiceResult.ts";
import {
	CookieStore,
	getAnonClient,
	getOAuthClient,
	getServiceClient,
	getUserClient,
	isAuthBackendLive,
	runWithClientAddress,
} from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import {
	type AccessTokenVerifier,
	createAccessTokenVerifier,
	jwksUrlFor,
} from "../../core/access-token.ts";
import {
	mintPendingVerification,
	pendingVerificationKey,
} from "../../core/pending-verification.ts";
export { PENDING_VERIFICATION_TTL_SECONDS } from "../../core/pending-verification.ts";
import {
	resolveVerificationStatus,
	type VerificationPollInput,
	verificationPollLimiter,
} from "./verification-status.ts";
import { refreshFailure, SESSION_EXPIRED_MESSAGE } from "./refresh-outcome.ts";
import type { CreateEnterprise } from "@projective/types/org";
import {
	AGE_SQLSTATE,
	bracketFromDob,
	isJoinable,
	UNDER_MINIMUM_REASON,
	UNDER_MINIMUM_REFUSAL,
} from "@projective/types/auth";

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

// #region Sign-in identifier helpers
/** The one refusal every failed password sign-in gets, whichever half was wrong. */
const INVALID_CREDENTIALS = "Invalid credentials — check your email or username and your password.";
/**
 * The one refusal a sign-up that GoTrue or the database turned down receives (IW-M3). It never says
 * whether the address already has an account, and never carries GoTrue or SQL text.
 */
export const JOIN_REFUSED =
	"We couldn't create an account with those details. If you already have one, sign in or reset your password.";
/** The refusal when the enterprise record itself could not be written (the owner account is undone). */
export const ENTERPRISE_REFUSED =
	"We couldn't register that business. Check its handle and details, then try again.";
/** The refusal when an OAuth identity could not finish onboarding. */
const ONBOARDING_REFUSED =
	"We couldn't finish setting up your account. Check your details and try again.";
/** The refusal when provisioning failed on our side. */
const JOIN_UNAVAILABLE =
	"We couldn't finish creating your account just now. Please try again in a moment.";

/** Whether a sign-in identifier is an email address (carries `@`) rather than a username. */
function isEmailIdentifier(identifier: string): boolean {
	return identifier.includes("@");
}

/** A candidate row from the username lookup. */
export interface UsernameRow {
	user_id: string;
	username: string;
}

/**
 * Pick the account a typed username names from the rows the lookup returned. The lookup asks for the
 * value as typed AND lowercased — `org.users_public.username` is `UNIQUE` but not case-insensitively
 * so, while every handle the join wizard writes is lowercased — and an exact match wins over the
 * canonical one, so a mixed-case row can never be shadowed by its lowercase twin. Pure, and exported
 * for its test.
 */
export function pickUsernameMatch(
	typed: string,
	rows: readonly UsernameRow[],
): UsernameRow | null {
	const exact = rows.find((row) => row.username === typed);
	if (exact) return exact;
	const lower = typed.toLowerCase();
	return rows.find((row) => row.username.toLowerCase() === lower) ?? null;
}

/** The distinct spellings the username lookup queries for. */
export function usernameCandidates(typed: string): string[] {
	return [...new Set([typed, typed.toLowerCase()])];
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
 * Note on the boundary: account ELIGIBILITY (the DoB age-gate from `@projective/types/auth`,
 * password-required-unless-OAuth) is enforced here, in {@link AuthBackendService.provisionAccount},
 * on both the stub and live paths — the route only parses and delegates, and the client's own flags
 * are never trusted.
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
	/** The browser's IANA zone: the profile's `timezone`, and the zone its birthdays are counted in. */
	timeZone?: string;
	intent: "client" | "freelancer";
	skills?: string[];
	/** The onboarding "purpose" tags → `org.users_public.interests`. */
	interests?: string[];
	/** A supported browser locale → `org.user_preferences.locale` (Decision #207). */
	locale?: string;
	/** An offerable display currency → `org.user_preferences.preferred_display_currency`. */
	displayCurrency?: string;
	/** Server-sanitised return path. */
	redirectTo: string;
}

/** Enterprise account provisioning input. */
export interface ProvisionEnterpriseInput {
	type: "enterprise";
	corporateEmail: string;
	password: string;
	/** The owner's supported browser locale → their `org.user_preferences.locale` (Decision #207). */
	locale?: string;
	/** An offerable display currency → the owner's `org.user_preferences.preferred_display_currency`. */
	displayCurrency?: string;
	/**
	 * The validated enterprise to provision (the {@link CreateEnterprise} SSOT shape from
	 * `@projective/types`). The live path admin-creates the owner identity, then inserts it into
	 * `org.enterprises` + seeds the owner's `org.enterprise_members` row via the
	 * `public.create_enterprise` RPC (migrations 0314/0315).
	 */
	enterprise: CreateEnterprise;
	/** Server-sanitised return path. */
	redirectTo: string;
}

/** Fields the fat service needs to provision an individual or enterprise account. */
export type ProvisionAccountInput = ProvisionIndividualInput | ProvisionEnterpriseInput;

/** Credentials for a password sign-in. */
export interface AuthenticateInput {
	/** An email address OR a username — the service tells them apart and resolves the latter. */
	identifier: string;
	password: string;
	/** "Keep me signed in": `false` (the default) ends the session with the browser session. */
	remember?: boolean;
	redirectTo: string;
}

/** A 6-digit email-confirmation attempt. */
export interface ConfirmEmailInput {
	code: string;
	email?: string;
	redirectTo: string;
}

/** A confirmation-link click: the `token_hash` GoTrue put in the email's button. */
export interface ConfirmEmailLinkInput {
	tokenHash: string;
	redirectTo: string;
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
	/** The `/verify` poll: whether the account bound to this browser's pending cookie is confirmed. */
	verified?: boolean;
	/**
	 * Set only alongside `verified: true`: whether the polling request already carries a session.
	 * `false` means the email was confirmed elsewhere (another device or browser), so the page asks
	 * the reader to sign in instead of navigating into a guarded route that would bounce them.
	 */
	signedIn?: boolean;
	/**
	 * The account email a verification code was sent to. Returned ONLY on the
	 * `requiresVerification` branch of a password sign-in, so a reader who signed in by USERNAME can
	 * still be routed to `/verify` with the address it needs. Safe to disclose there: GoTrue checks
	 * the password before it reports an unconfirmed email, so the branch is reachable only by
	 * somebody who already holds the account's credentials.
	 */
	email?: string;
	/**
	 * Whether the confirmation email was dispatched when a new account was provisioned. `false`
	 * means the account exists but GoTrue refused the send, so `/verify` must offer Resend at once
	 * rather than open on a countdown for a code that never left.
	 */
	verificationSent?: boolean;
}

/** The outcome of {@link AuthBackendService.verifyAccessToken} that admits the token. */
export interface AccessTokenCheck {
	/** `true` when the signature was checked; `false` when a dev stub session is trusted by presence. */
	verified: boolean;
}
// #endregion

// #region Access-token verification
const SESSION_UNAVAILABLE_MESSAGE =
	"We couldn't check your session right now. Try again in a moment.";

let verifier: { config: string; instance: AccessTokenVerifier } | null = null;

function projectVerifier(): AccessTokenVerifier {
	const { supabaseUrl, supabaseJwtSecret } = serverEnv();
	const jwksUrl = supabaseUrl ? jwksUrlFor(supabaseUrl) : undefined;
	const config = `${jwksUrl ?? ""}\n${supabaseJwtSecret ?? ""}`;
	if (verifier?.config !== config) {
		verifier = {
			config,
			instance: createAccessTokenVerifier({ jwksUrl, hsSecret: supabaseJwtSecret }),
		};
	}
	return verifier.instance;
}
// #endregion

/** Sentinel code the MVP stubs treat as the deterministic failure path. */
const SENTINEL_BAD_CODE = "000000";

function appOrigin(): string {
	return serverEnv().appUrl.replace(/\/+$/, "");
}

export class AuthBackendService {
	// #region Request scope
	/**
	 * Run `fn` with `address` as the client address every GoTrue call inside it forwards
	 * (`X-Forwarded-For`), so GoTrue's per-IP limits count the client, not this server (IW-H3).
	 */
	static withClientAddress<T>(address: string, fn: () => T): T {
		return runWithClientAddress(address, fn);
	}
	// #endregion

	// #region Account creation & sign-in
	/**
	 * Provision a new account.
	 *
	 * Live paths (`AUTH_BACKEND_LIVE=true`):
	 *  - **Individual, email/password** — admin-create the `auth.users` identity with the onboarding
	 *    metadata; the `on_auth_user_created` trigger (migration 0304) provisions `org.users_public`,
	 *    the email row, the persona profile, session context, and the audit entry. Email unconfirmed →
	 *    the confirmation email is dispatched, then `requiresVerification: true`.
	 *  - **Individual, OAuth completion** — the caller is already authenticated (they OAuth'd, landed
	 *    profile-less on `/join`), so provision in-context via the `complete_onboarding` RPC. OAuth
	 *    email is pre-verified → `requiresVerification: false`.
	 *  - **Enterprise** — admin-create the owner identity, then insert the enterprise + owner membership
	 *    atomically via the `create_enterprise` RPC (migrations 0314/0315); when that RPC fails, the
	 *    owner identity is deleted again. Email unconfirmed → the confirmation email is dispatched,
	 *    then `requiresVerification: true`.
	 *
	 * Every refusal GoTrue or the database returns is answered with {@link JOIN_REFUSED} (or its
	 * enterprise / onboarding sibling), never the raw text, so `/join` does not reveal whether an
	 * address already has an account.
	 *
	 * The admin create sends no mail of its own, so both unconfirmed paths dispatch explicitly through
	 * {@link dispatchConfirmation}. A refused send does not fail the signup — the account already
	 * exists, and a retry would only meet "already registered" — it is reported as
	 * `verificationSent: false` so `/verify` offers Resend immediately.
	 *
	 * Stub path (default): reports `requiresVerification: true` and a simulated send without touching
	 * Supabase.
	 */
	/**
	 * Refuse an under-13 date of birth and keep nothing (Decision #208). An email sign-up has written
	 * nothing yet; an OAuth sign-up's identity already exists, so it is deleted through
	 * `public.discard_underage_signup` — the caller's own, profile-less identity only. The refusal
	 * carries {@link UNDER_MINIMUM_REASON} (the route locks this browser session) and whether the
	 * identity went (the route then clears its session cookies). Nothing about the person is logged.
	 */
	static async refuseUnderMinimum(
		input: Pick<ProvisionIndividualInput, "oauth" | "accessToken" | "dob" | "timeZone">,
	): Promise<ServiceResult<AuthPayload>> {
		let discarded = false;
		if (input.oauth && input.accessToken && isAuthBackendLive()) {
			const { data, error } = await getUserClient(input.accessToken).rpc("discard_underage_signup", {
				p_dob: input.dob,
				p_zone: input.timeZone ?? null,
			});
			if (error) {
				console.error("[auth:discard-underage]", error.code);
				return fail(503, { message: "We couldn't finish this just now. Please try again in a moment." });
			}
			discarded = data === true;
		}
		return fail(422, {
			errors: { dob: UNDER_MINIMUM_REFUSAL },
			details: { reason: UNDER_MINIMUM_REASON, discarded },
		});
	}

	static async provisionAccount(input: ProvisionAccountInput): Promise<ServiceResult<AuthPayload>> {
		if (input.type === "individual") {
			// Age-gate is re-derived server-side; the client's `restricted` flag is never trusted.
			if (!isJoinable(bracketFromDob(input.dob, input.timeZone))) {
				return AuthBackendService.refuseUnderMinimum(input);
			}
			// Password is required unless this is an SSO/OAuth signup (which sets its own credential).
			if (!input.oauth && (!input.password || input.password.length < 8)) {
				return fail(422, { errors: { password: "Use at least 8 characters." } });
			}
		}

		if (!isAuthBackendLive()) {
			return ok({
				requiresVerification: true,
				verificationSent: true,
				redirectTo: input.redirectTo,
			});
		}

		try {
			if (input.type === "enterprise") {
				const admin = getServiceClient();
				const { data: created, error } = await admin.auth.admin.createUser({
					email: input.corporateEmail,
					password: input.password,
					email_confirm: false,
					user_metadata: {
						objective: "enterprise",
						locale: input.locale ?? null,
						display_currency: input.displayCurrency ?? null,
					},
				});
				if (error || !created?.user) {
					console.error("[auth:join]", error?.code ?? error?.status ?? "no-user");
					return fail(422, { message: JOIN_REFUSED });
				}
				// The owner account and the enterprise are two writes. When the second fails (a taken
				// handle surfaces as a unique_violation), the first is undone, so a retry with the same
				// address is not refused as "already registered" (IW-H8).
				let rpcFailed = true;
				try {
					const { error: rpcError } = await admin.rpc("create_enterprise", {
						p_owner: created.user.id,
						p_payload: input.enterprise,
					});
					if (rpcError) console.error("[auth:create-enterprise]", rpcError.code);
					rpcFailed = !!rpcError;
				} catch (e) {
					console.error("[auth:create-enterprise]", e instanceof Error ? e.name : "error");
				}
				if (rpcFailed) {
					await AuthBackendService.discardOrphanedOwner(created.user.id);
					return fail(422, { message: ENTERPRISE_REFUSED });
				}
				return ok({
					requiresVerification: true,
					verificationSent: await AuthBackendService.dispatchConfirmation(input.corporateEmail),
					redirectTo: input.redirectTo,
				}, { pendingVerification: await AuthBackendService.pendingTokenFor(created.user.id) });
			}

			// Individual — build the profile metadata the 0304 provisioning reads.
			const meta = {
				first_name: input.firstName,
				last_name: input.lastName,
				username: input.username,
				dob: input.dob,
				timezone: input.timeZone ?? null,
				objective: input.intent === "freelancer" ? "freelancer" : "client",
				skills: input.skills ?? [],
				interests: input.interests ?? [],
				locale: input.locale ?? null,
				display_currency: input.displayCurrency ?? null,
			};

			if (input.oauth) {
				if (!input.accessToken) {
					return fail(401, { message: "Your session has expired. Please sign in again." });
				}
				const user = getUserClient(input.accessToken);
				const { error } = await user.rpc("complete_onboarding", { p_payload: meta });
				if (error?.code === AGE_SQLSTATE.underMinimum) {
					return AuthBackendService.refuseUnderMinimum(input);
				}
				if (error) {
					console.error("[auth:complete-onboarding]", error.code);
					return fail(422, { message: ONBOARDING_REFUSED });
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
				console.error("[auth:join]", error?.code ?? error?.status ?? "no-user");
				return fail(422, { message: JOIN_REFUSED });
			}
			return ok({
				requiresVerification: true,
				verificationSent: await AuthBackendService.dispatchConfirmation(input.email),
				redirectTo: input.redirectTo,
			}, { pendingVerification: await AuthBackendService.pendingTokenFor(created.user.id) });
		} catch (e) {
			console.error("[auth:join]", e instanceof Error ? e.name : "error");
			return fail(500, { message: JOIN_UNAVAILABLE });
		}
	}

	/**
	 * Delete an enterprise owner's GoTrue user whose enterprise could not be written. The account was
	 * created moments ago in this request, holds no profile (an enterprise owner gets no
	 * `users_public` row) and has never signed in, so nothing else references it. A failed delete is
	 * logged, not surfaced: the sign-up is refused either way.
	 */
	private static async discardOrphanedOwner(userId: string): Promise<void> {
		try {
			const { error } = await getServiceClient().auth.admin.deleteUser(userId);
			if (error) console.error("[auth:orphan-cleanup]", error.code ?? error.status);
		} catch (e) {
			console.error("[auth:orphan-cleanup]", e instanceof Error ? e.name : "error");
		}
	}

	/**
	 * Authenticate with an email OR username plus password. Live: a username is resolved to the
	 * account's email first ({@link resolveUsernameEmail}), then the GoTrue password grant → return
	 * the session (the route mints the cookie); flag `requiresVerification` when the identity's email
	 * is unconfirmed. Stub: succeeds without a session.
	 *
	 * Every failure — unknown username, unknown email, wrong password — answers with ONE generic
	 * refusal. A distinct "no such username" would turn the sign-in form into a handle-enumeration
	 * oracle, and the discovery surfaces already decide which handles are public.
	 */
	static async authenticate(input: AuthenticateInput): Promise<ServiceResult<AuthPayload>> {
		if (!isAuthBackendLive()) {
			return ok({ requiresVerification: false, redirectTo: input.redirectTo });
		}
		try {
			const email = isEmailIdentifier(input.identifier)
				? input.identifier
				: await AuthBackendService.resolveUsernameEmail(input.identifier);
			if (!email) return fail(401, { message: INVALID_CREDENTIALS });

			const anon = getAnonClient();
			const { data, error } = await anon.auth.signInWithPassword({
				email,
				password: input.password,
			});
			if (error) {
				// GoTrue reports an unconfirmed email distinctly (and only AFTER the password checks
				// out); everything else is a credential failure, kept generic.
				if (/confirm/i.test(error.message)) {
					const userId = await AuthBackendService.resolveSignInUserId(email);
					return ok(
						{ requiresVerification: true, redirectTo: input.redirectTo, email },
						{
							pendingVerification: userId
								? await AuthBackendService.pendingTokenFor(userId)
								: undefined,
						},
					);
				}
				return fail(401, { message: INVALID_CREDENTIALS });
			}
			const session = toSession(data.session);
			return ok(
				{ requiresVerification: false, redirectTo: input.redirectTo },
				{ session: session && { ...session, remember: input.remember ?? false } },
			);
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : "Sign-in failed." });
		}
	}

	/**
	 * Resolve a username to the email GoTrue authenticates. An administrative read on purpose: the
	 * caller holds no session yet, so an RLS-scoped read would (correctly) show them nothing. The
	 * email comes from the GoTrue identity rather than `org.user_emails`, because it is the identity's
	 * address the password grant is checked against. `null` for an unknown username; the caller owes
	 * that the same refusal as a wrong password.
	 */
	private static async resolveUsernameEmail(username: string): Promise<string | null> {
		const db = getServiceClient();
		const { data, error } = await db
			.schema("org")
			.from("users_public")
			.select("user_id, username")
			.in("username", usernameCandidates(username))
			.limit(2);
		if (error || !data) return null;
		const match = pickUsernameMatch(username, data as UsernameRow[]);
		if (!match) return null;
		const { data: found } = await db.auth.admin.getUserById(match.user_id);
		return str(found?.user?.email) ?? null;
	}

	/**
	 * Verify a presented access token locally — signature (project JWKS, or HS256 with
	 * `SUPABASE_JWT_SECRET`), expiry, and that it is a signed-in user's session token
	 * (`core/access-token.ts`). No GoTrue round trip on the common path: the JWKS is cached.
	 *
	 * `ok` with `verified: true` → trust it. `401` → refused (tampered, expired, foreign, or no key to
	 * check it with). `503` → the keys could not be obtained; nothing is known about the token.
	 *
	 * Stub (auth backend not live, outside production): `ok` with `verified: false` — there is no
	 * issuer to verify against, and the stub and `dev:mock` sessions are opaque or hand-made tokens, so
	 * presence is all there is. Production always verifies, whatever the gate says.
	 */
	static async verifyAccessToken(token: string): Promise<ServiceResult<AccessTokenCheck>> {
		if (!token) return fail(401, { message: SESSION_EXPIRED_MESSAGE });
		if (!isAuthBackendLive() && serverEnv().appEnv !== "production") {
			return ok({ verified: false });
		}
		const verdict = await projectVerifier().verify(token);
		if (verdict.status === "valid") return ok({ verified: true });
		if (verdict.status === "unavailable") {
			return fail(503, { message: SESSION_UNAVAILABLE_MESSAGE });
		}
		return fail(401, { message: SESSION_EXPIRED_MESSAGE, details: { reason: verdict.reason } });
	}

	/**
	 * Renew a session from its refresh token — the previously-missing half of the session lifecycle.
	 *
	 * The access token is short-lived (~1h; GoTrue's `expires_in`) while the refresh token lives 30
	 * days, so an active session must be **silently renewed** rather than dropped the moment the access
	 * token expires. This is the single renewal primitive behind both the dashboard guard's
	 * refresh-before-redirect and the `/api/auth/refresh` endpoint the client 401-interceptor calls; on
	 * success the caller mints fresh `sb-*` cookies from the returned {@link SessionTokens}.
	 *
	 * Live (`AUTH_BACKEND_LIVE=true`): GoTrue `refreshSession({ refresh_token })` → rotated tokens; a
	 * spent/revoked refresh token yields a 401 so the caller clears the session and bounces to sign-in,
	 * while an unreachable or failing GoTrue yields a 503 and the caller keeps the cookies
	 * ({@link refreshFailure}). Stub (default): re-mints the (opaque) session so the silent-refresh
	 * path is exercisable without a wired GoTrue. It grants **no access** — RLS + the `(dashboard)` guard remain the real gates — and
	 * is only ever reached when a `sb-refresh-token` cookie is actually presented (the stub sign-in
	 * sets none), so a normal dev session never triggers it.
	 */
	static async refreshSession(refreshToken: string): Promise<ServiceResult<AuthPayload>> {
		if (!refreshToken) {
			return fail(401, { message: SESSION_EXPIRED_MESSAGE });
		}
		if (!isAuthBackendLive()) {
			return ok({}, {
				session: { accessToken: refreshToken, refreshToken, expiresIn: 3600 },
			});
		}
		try {
			const anon = getAnonClient();
			const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshToken });
			const session = toSession(data?.session);
			if (error || !session) return refreshFailure(error);
			return ok({}, { session });
		} catch (e) {
			console.error("[auth:refresh]", e instanceof Error ? e.message : e);
			return refreshFailure(e);
		}
	}

	/**
	 * Sign out — revoke the session server-side. The authoritative sign-out is the thin route clearing
	 * the HttpOnly `sb-*` cookies (the browser can no longer present a session); this call is
	 * best-effort defence-in-depth on top: when live, it revokes the refresh token at GoTrue so a
	 * copied token can't be silently refreshed later.
	 *
	 * Live (`AUTH_BACKEND_LIVE=true`): admin `signOut(accessToken, "global")` revokes every session for
	 * the identity. Stub (default) / no token: a no-op success — cookie clearing alone ends the session.
	 * Always succeeds: a failed revocation must never block the user from signing out (the cookies are
	 * cleared regardless), so any error is swallowed.
	 */
	static async signOut(input: { accessToken?: string }): Promise<ServiceResult<AuthPayload>> {
		if (!isAuthBackendLive() || !input.accessToken) {
			return ok({});
		}
		try {
			await getServiceClient().auth.admin.signOut(input.accessToken, "global");
		} catch {
			// Non-blocking: cookie clearing (in the route) is the real sign-out; revocation is a bonus.
		}
		return ok({});
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
	 * Confirm an email from the link in the confirmation email. Live: exchange the `token_hash` with
	 * GoTrue (`verifyOtp`) and mint the session cookie on whichever device opened the link — the
	 * `/verify` tab that started the signup picks the confirmation up through its status poll. Stub:
	 * succeeds without a session.
	 */
	static async confirmEmailLink(input: ConfirmEmailLinkInput): Promise<ServiceResult<AuthPayload>> {
		if (!isAuthBackendLive()) {
			return ok({ redirectTo: input.redirectTo });
		}
		try {
			const { data, error } = await getAnonClient().auth.verifyOtp({
				token_hash: input.tokenHash,
				type: "email",
			});
			if (error) {
				return fail(422, { message: "That confirmation link has expired or was already used." });
			}
			return ok({ redirectTo: input.redirectTo }, { session: toSession(data.session) });
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : "Verification failed." });
		}
	}

	/**
	 * The `/verify` confirmation poll (Decision #185). Answers only for the account named by this
	 * browser's signed pending-verification cookie; any other caller gets the uniform
	 * `{ verified: false }`, and every poll is rate-limited (see {@link resolveVerificationStatus}).
	 * Live: confirmation is GoTrue's `email_confirmed_at` on that account. Stub: never confirmed.
	 */
	static async getVerificationStatus(
		input: VerificationPollInput,
	): Promise<ServiceResult<AuthPayload>> {
		return resolveVerificationStatus(input, {
			key: await AuthBackendService.pendingKey(),
			limiter: verificationPollLimiter,
			isConfirmed: (userId) => AuthBackendService.isEmailConfirmed(userId),
		});
	}

	private static async isEmailConfirmed(userId: string): Promise<boolean> {
		if (!isAuthBackendLive()) return false;
		const { data, error } = await getServiceClient().auth.admin.getUserById(userId);
		if (error) {
			if (error.status === 404) return false;
			throw new Error(`Confirmation lookup failed: ${error.message}`, { cause: error });
		}
		return Boolean(data.user?.email_confirmed_at);
	}

	private static pendingKey(): Promise<CryptoKey | null> {
		const root = serverEnv().supabaseServiceRoleKey;
		return root ? pendingVerificationKey(root) : Promise.resolve(null);
	}

	private static async pendingTokenFor(userId: string): Promise<string | undefined> {
		const key = await AuthBackendService.pendingKey();
		return key ? await mintPendingVerification(userId, key) : undefined;
	}

	/**
	 * The account whose GoTrue sign-in address is `email`, for an unconfirmed sign-in whose password
	 * GoTrue already accepted. `org.user_emails` narrows the candidates (an address can also be another
	 * person's secondary); the GoTrue identity decides. `null` when nothing matches or a read fails —
	 * the caller then sets no pending cookie, and the code on `/verify` still works.
	 */
	private static async resolveSignInUserId(email: string): Promise<string | null> {
		try {
			const db = getServiceClient();
			const { data, error } = await db
				.schema("org")
				.from("user_emails")
				.select("user_id")
				.in("email", [...new Set([email, email.toLowerCase()])])
				.limit(5);
			if (error || !data) return null;
			const wanted = email.toLowerCase();
			for (const row of data as Array<{ user_id: string }>) {
				const { data: found } = await db.auth.admin.getUserById(row.user_id);
				if (found?.user?.email?.toLowerCase() === wanted) return row.user_id;
			}
			return null;
		} catch {
			return null;
		}
	}

	/**
	 * Re-issue the verification email. Live: GoTrue resend. Always reports success whatever the send
	 * did — a distinct refusal (e.g. GoTrue's per-user frequency limit) exists only for a real
	 * account, so surfacing it would make this endpoint an account-enumeration oracle.
	 */
	static async resendVerification(input: { email?: string }): Promise<ServiceResult<AuthPayload>> {
		if (isAuthBackendLive() && input.email) {
			await AuthBackendService.dispatchConfirmation(input.email);
		}
		return ok({});
	}

	/**
	 * Send the signup confirmation email (the 6-digit code) for an unconfirmed account through GoTrue's
	 * mailer. The admin `createUser` that provisions accounts never sends mail — only GoTrue's public
	 * endpoints do — so this is the one door every confirmation email leaves through. supabase-js
	 * RETURNS a refused send as `{ error }` rather than throwing, so the result is read, not assumed.
	 *
	 * `emailRedirectTo` is the app's bare origin: `confirmation.html` builds its button and logo URLs
	 * on `{{ .RedirectTo }}`, and GoTrue substitutes `site_url` (also a bare origin) when it refuses a
	 * redirect, so either value yields a working link.
	 */
	private static async dispatchConfirmation(email: string): Promise<boolean> {
		try {
			const { error } = await getAnonClient().auth.resend({
				type: "signup",
				email,
				options: { emailRedirectTo: appOrigin() },
			});
			return !error;
		} catch {
			return false;
		}
	}
	// #endregion

	// #region Password recovery
	/**
	 * Begin password recovery. Anti-enumeration: always reports success regardless of whether the
	 * address has an account. Live: GoTrue sends the recovery email (recovery.html template), whose
	 * links hang off the bare origin passed as `redirectTo` (see {@link dispatchConfirmation}).
	 */
	static async requestPasswordReset(
		input: { email: string; redirectTo: string },
	): Promise<ServiceResult<AuthPayload>> {
		if (isAuthBackendLive()) {
			try {
				await getAnonClient().auth.resetPasswordForEmail(input.email, {
					redirectTo: appOrigin(),
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

		// New user = no org.users_public profile yet → route to /join for onboarding. Default to
		// EXISTING: /join is only for a CONFIRMED brand-new identity, so a transient lookup failure must
		// never bounce a returning user back through onboarding (root CLAUDE.md — never re-onboard an
		// existing user; task requirement 2B). A genuine new user is still caught by the successful
		// `!profile` read below.
		let isNewUser = false;
		try {
			const { data: profile } = await getServiceClient()
				.schema("org")
				.from("users_public")
				.select("user_id")
				.eq("user_id", user.id)
				.maybeSingle();
			isNewUser = !profile;
		} catch {
			// Keep the safe default (existing): we could not CONFIRM new-ness, so we do not force /join.
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
