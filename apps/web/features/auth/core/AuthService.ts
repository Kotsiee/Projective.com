import { getAuth, postAuth } from "./api.ts";
import type { AuthResult } from "../types/mod.ts";

/**
 * AuthService — the THIN, client-side auth service (the front half of the thin-frontend /
 * fat-backend contract; the back half is `@server/services/auth/AuthBackendService.ts`).
 *
 * Islands stay dumb: they gather inputs and manage local UI state, then call one of these named
 * methods, which make the structured HTTP request to the matching `/api/auth/*` route and hand back
 * the {@link AuthResult}. No business logic, no DB, no `fetch` sprinkled through the components — one
 * place that knows the endpoint map. See `SYSTEM_ARCHITECTURE.md` §Backend Services.
 */
export const AuthService = {
	/** Create an individual or organisation account. */
	join(payload: unknown): Promise<AuthResult> {
		return postAuth("/api/auth/join", payload);
	},

	/** Email + password sign-in. */
	login(payload: unknown): Promise<AuthResult> {
		return postAuth("/api/auth/login", payload);
	},

	/** Confirm an email with the 6-digit code. */
	verify(payload: { code: string; email?: string; redirectTo: string }): Promise<AuthResult> {
		return postAuth("/api/auth/verify", payload);
	},

	/** Poll app-owned email-verification state (the `/verify` auto-login listener). */
	verificationStatus(query: { email?: string; redirectTo?: string }): Promise<AuthResult> {
		const qs = new URLSearchParams();
		if (query.email) qs.set("email", query.email);
		if (query.redirectTo) qs.set("redirectTo", query.redirectTo);
		return getAuth(`/api/auth/verification-status?${qs.toString()}`);
	},

	/** Begin password recovery (emails a reset code). */
	forgotPassword(payload: { email: string; redirectTo: string }): Promise<AuthResult> {
		return postAuth("/api/auth/forgot-password", payload);
	},

	/** Complete password recovery with the code + new password. */
	resetPassword(payload: unknown): Promise<AuthResult> {
		return postAuth("/api/auth/reset", payload);
	},

	/** Re-send the email verification code. */
	resend(payload: { email?: string }): Promise<AuthResult> {
		return postAuth("/api/auth/resend", payload);
	},

	/** Enterprise SSO domain discovery. */
	sso(payload: { domain: string; redirectTo: string }): Promise<AuthResult> {
		return postAuth("/api/auth/sso", payload);
	},
};
