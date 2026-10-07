import { apiFetch } from "@web/utils/api-client.ts";
import type {
	AppearancePreferences,
	DisplayPreferences,
	EmailDeliveryOutcome,
	UserEmail,
	UserPreferencesUpdate,
} from "@projective/types/org";
import type { NotificationCenter, NotificationCenterUpdate } from "@projective/types/comms";
import type { SettingsSectionDataOf, SettingsSectionKey } from "@projective/types/settings";

/**
 * SettingsService — the THIN client controller for the Settings engine (Decision #150): the
 * contextual modal and the console page both call these, never Supabase. Every method answers a
 * {@link SettingsResult} — a failure carries the server's sentence (and field errors when it gave
 * them), so a section can say exactly what went wrong without parsing responses itself.
 *
 * Reads and writes go through `apiFetch`, so an expired session is refreshed and retried once before a
 * section ever sees a 401.
 */

// #region Result
/** A settled call. */
export type SettingsResult<T> =
	| { ok: true; data: T; message?: string }
	| { ok: false; status: number; message: string; errors?: Record<string, string> };

const OFFLINE = "You seem to be offline. Your change wasn't saved.";

async function call<T>(
	url: string,
	init?: RequestInit,
	fallback = "That didn't work just now.",
): Promise<SettingsResult<T>> {
	let res: Response;
	try {
		res = await apiFetch(url, {
			...init,
			headers: {
				accept: "application/json",
				...(init?.body ? { "content-type": "application/json" } : {}),
				...init?.headers,
			},
		});
	} catch {
		return { ok: false, status: 0, message: OFFLINE };
	}
	const body = await res.json().catch(() => null) as Record<string, unknown> | null;
	if (!res.ok || !body || body.ok === false) {
		return {
			ok: false,
			status: res.status,
			message: typeof body?.message === "string" && body.message ? body.message : fallback,
			errors: body?.errors && typeof body.errors === "object"
				? body.errors as Record<string, string>
				: undefined,
		};
	}
	return {
		ok: true,
		data: body as T,
		message: typeof body.message === "string" ? body.message : undefined,
	};
}

const json = (method: string, payload: unknown): RequestInit => ({
	method,
	body: JSON.stringify(payload),
});
// #endregion

/** What a preferences save answers with. */
export interface PreferencesSaved {
	preferences: DisplayPreferences | null;
	appearance: AppearancePreferences | null;
	appearancePersisted: boolean;
}

/** What an email write answers with. */
export interface EmailsSaved {
	emails: UserEmail[];
	delivery?: EmailDeliveryOutcome;
}

export const SettingsService = {
	// #region Sections
	/** One section's payload — the same read the console page is server-rendered from. */
	async section<K extends SettingsSectionKey>(
		key: K,
	): Promise<SettingsResult<{ data: SettingsSectionDataOf<K>; error: string | null }>> {
		const res = await call<{ data: SettingsSectionDataOf<K>; error: string | null }>(
			`/api/settings/${key}`,
			undefined,
			"This section couldn't be loaded just now.",
		);
		return res.ok
			? { ok: true, data: { data: res.data.data, error: res.data.error ?? null } }
			: res;
	},
	// #endregion

	// #region Preferences
	/** Save part of the preferences — appearance and/or display. */
	savePreferences(patch: UserPreferencesUpdate): Promise<SettingsResult<PreferencesSaved>> {
		return call<PreferencesSaved>(
			"/api/user/preferences",
			json("PATCH", patch),
			"Your preference couldn't be saved.",
		);
	},

	/**
	 * Renew the session so the access token is re-stamped from the preferences row (the locale and the
	 * display currency ride the token's claims). Best effort: a failure only delays the new format until
	 * the session renews on its own.
	 */
	async renewSession(): Promise<boolean> {
		try {
			const res = await fetch("/api/auth/refresh", {
				method: "POST",
				headers: { accept: "application/json" },
			});
			return res.ok;
		} catch {
			return false;
		}
	},
	// #endregion

	// #region Emails
	addEmail(email: string): Promise<SettingsResult<EmailsSaved>> {
		return call<EmailsSaved>(
			"/api/user/emails",
			json("POST", { email }),
			"That address couldn't be added.",
		);
	},
	removeEmail(id: string): Promise<SettingsResult<EmailsSaved>> {
		return call<EmailsSaved>(
			`/api/user/emails/${encodeURIComponent(id)}`,
			{ method: "DELETE" },
			"That address couldn't be removed.",
		);
	},
	makePrimaryEmail(id: string): Promise<SettingsResult<EmailsSaved>> {
		return call<EmailsSaved>(`/api/user/emails/${encodeURIComponent(id)}/primary`, {
			method: "POST",
		}, "That address couldn't be made primary.");
	},
	resendEmail(id: string): Promise<SettingsResult<EmailsSaved>> {
		return call<EmailsSaved>(`/api/user/emails/${encodeURIComponent(id)}/resend`, {
			method: "POST",
		}, "The link couldn't be sent again.");
	},
	/** Email a password-reset link to the sign-in address (GoTrue sends it). */
	requestPasswordReset(email: string): Promise<SettingsResult<Record<string, unknown>>> {
		return call(
			"/api/auth/forgot-password",
			json("POST", { email, redirectTo: "/settings/account" }),
			"The reset link couldn't be sent.",
		);
	},
	// #endregion

	// #region Notifications
	saveNotifications(
		update: NotificationCenterUpdate,
	): Promise<SettingsResult<{ center: NotificationCenter }>> {
		return call<{ center: NotificationCenter }>(
			"/api/user/notifications",
			json("PUT", update),
			"Your notification settings couldn't be saved.",
		);
	},
	// #endregion
};
