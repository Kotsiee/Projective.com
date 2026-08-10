import type { DisplayPreferences } from "@projective/types/org";
import type { FxRateTable } from "@projective/types/finance";

/**
 * CurrencyService — the THIN client service for money presentation (the front half of the
 * thin-frontend / fat-backend contract; the back halves are `@server/services/user/UserBackendService`
 * and `@server/services/finance/FxService`).
 *
 * Islands stay dumb: they call these two methods and render what comes back. No conversion math, no
 * column mapping, no decision about what a preference means.
 *
 * Both methods are **chrome-safe**: a failure resolves to `null` rather than throwing. The currency
 * switcher's job is to be reversible, not to be a blocking operation — a failed save reverts the
 * optimistic choice and says so, which is a far better outcome than an unhandled rejection on a
 * header menu.
 */
export const CurrencyService = {
	/**
	 * Persist the viewer's display currency. Returns the preferences the SERVER now holds, so the
	 * caller reconciles against the truth rather than assuming its optimistic value stuck.
	 *
	 * **Plain `fetch`, deliberately not `apiFetch`.** The shared interceptor treats an unrecoverable
	 * 401 as "the session is gone" and navigates to `/login`. That is right for a request the user is
	 * waiting on, and wrong here: choosing a display currency is a preference, it has already been
	 * applied locally and persisted to the cookie by the time this runs, and throwing someone off the
	 * page they were reading because a formatting choice could not be saved to their account is a
	 * wildly disproportionate response. A 401 resolves to `null`, the caller keeps the local choice,
	 * and the surface says plainly that it saved on this device only.
	 */
	async setDisplayCurrency(code: string): Promise<DisplayPreferences | null> {
		try {
			const res = await fetch("/api/user/preferences", {
				method: "PATCH",
				headers: { "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify({ preferredDisplayCurrency: code.toUpperCase() }),
			});
			if (!res.ok) return null;
			const body = await res.json().catch(() => null);
			const prefs = body && typeof body === "object"
				? (body as { preferences?: DisplayPreferences }).preferences
				: null;
			return prefs ?? null;
		} catch {
			return null;
		}
	},

	/**
	 * Fetch the FX rate table for a base. Only needed when the SSR-embedded table cannot price a pair
	 * the viewer has just asked for — the common path never calls this at all.
	 */
	async rates(base?: string): Promise<FxRateTable | null> {
		try {
			const query = base ? `?base=${encodeURIComponent(base)}` : "";
			const res = await fetch(`/api/finance/fx${query}`, {
				headers: { accept: "application/json" },
			});
			if (!res.ok) return null;
			const body = await res.json().catch(() => null);
			const table = body && typeof body === "object"
				? (body as { table?: FxRateTable }).table
				: null;
			return table ?? null;
		} catch {
			return null;
		}
	},
};
