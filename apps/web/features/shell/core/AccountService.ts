import type { CurrentUser } from "@projective/types/user";

/**
 * AccountService — the THIN client service for the acting user's own account (the front half of the
 * thin-frontend / fat-backend contract; the back half is `@server/services/user/UserBackendService`).
 *
 * The header account popover ({@link UserActions}) stays a dumb island: it calls {@link current},
 * which GETs `/api/user/me` and maps the response to the {@link CurrentUser} SSOT shape (or `null`).
 * This is pure chrome — a failed load is not an access failure, so it degrades to `null` (the popover
 * falls back to the SSR-hydrated {@link UserContext} placeholders) rather than throwing or forcing a
 * sign-in redirect. Access is gated elsewhere (RLS + the `(dashboard)` guard).
 */
export const AccountService = {
	/** The acting user's account projection, or `null` when it can't be resolved (chrome-safe). */
	async current(): Promise<CurrentUser | null> {
		try {
			const res = await fetch("/api/user/me", { headers: { accept: "application/json" } });
			if (!res.ok) return null;
			const body = await res.json().catch(() => null);
			const user = body && typeof body === "object" ? (body as { user?: CurrentUser }).user : null;
			return user ?? null;
		} catch {
			return null;
		}
	},
};
