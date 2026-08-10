import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getAnonClient, getUserClient, isAuthBackendLive } from "../../core/supabase.ts";
import type { UserContext } from "@projective/types/auth";
import { type CurrentUser, resolveAccountRole } from "@projective/types/user";
import {
	DEFAULT_USER_LOCALE,
	type DisplayPreferences,
	type LayoutDirection,
	type UserPreferencesUpdate,
} from "@projective/types/org";
import { toDisplayCurrency } from "@projective/types/finance";

/**
 * UserBackendService — the FAT server-side service for the **acting user's own account**.
 *
 * It answers "who am I" for the authenticated header's account popover: the actor's real display name,
 * avatar, email, role badge, live status, and active workspace. This is the account/self domain —
 * distinct from {@link ProfileBackendService} (a public profile *by handle*) and {@link
 * AuthBackendService} (session lifecycle) — so it composes both worlds: the chrome-only {@link
 * UserContext} (resolved from the session JWT) for the structural role + workspace, and the live
 * Supabase `auth.users` record for the identity's name/email/avatar.
 *
 * Thin route `apps/web/routes/api/user/me.ts` does only cookie/context resolution, then delegates here
 * and maps the {@link ServiceResult} to a `Response`. Islands never reach this — they `fetch` the
 * route via the client `AccountService`. Returns a derived read projection; there is no `current_user`
 * table, so no migration is coupled to it.
 *
 * **Graceful degradation.** When live (`AUTH_BACKEND_LIVE=true`) and an access token is present, the
 * identity is enriched from GoTrue (`auth.getUser`). If that read is unavailable — stub mode, a
 * missing token, or a token that fails verification — the projection is composed from the chrome
 * context alone (name from the handle, no email, initials avatar) rather than failing, so the popover
 * always renders something truthful. Only a genuine guest (no `userId`) is rejected with a 401.
 */

// #region Metadata helpers
/** Coerce an unknown metadata value to a trimmed non-empty string, else undefined. */
function str(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** The identity fields lifted from a GoTrue user's metadata + column set. */
interface LiveIdentity {
	name?: string;
	email?: string;
	avatar?: string;
}

/** Resolve the best display name from GoTrue user metadata (full name → first+last → username). */
function nameFromMeta(meta: Record<string, unknown>): string | undefined {
	const full = str(meta.full_name) ?? str(meta.name);
	if (full) return full;
	const composed = [str(meta.first_name), str(meta.last_name)].filter(Boolean).join(" ").trim();
	return composed.length > 0 ? composed : str(meta.username);
}
// #endregion

// #region Display preferences
/** One row of `org.user_preferences`, as PostgREST returns it. */
interface PreferencesRow {
	locale: string | null;
	preferred_display_currency: string | null;
	layout_direction: string | null;
}

/**
 * Collapse a raw preferences row (or its absence) into the RESOLVED {@link DisplayPreferences} every
 * surface renders with.
 *
 * The nullable column state — "follow the origin currency" — is resolved HERE and nowhere else, so no
 * consumer downstream ever has to decide what `null` meant. It falls back to the currency already
 * carried on the chrome context (itself stamped from this same column by the access-token hook), then
 * to the platform base; `toDisplayCurrency` guarantees the result is a code the FX table can price.
 */
function resolvePreferences(
	row: PreferencesRow | null,
	context: Pick<UserContext, "displayCurrency" | "locale">,
): DisplayPreferences {
	const direction = row?.layout_direction;
	return {
		displayCurrency: toDisplayCurrency(
			str(row?.preferred_display_currency) ?? context.displayCurrency,
		),
		locale: str(row?.locale) ?? str(context.locale) ?? DEFAULT_USER_LOCALE,
		layoutDirection: direction === "ltr" || direction === "rtl" ? direction : "auto",
	};
}

/** Map a {@link UserPreferencesUpdate} to the snake_case column patch, omitting untouched fields. */
function toColumnPatch(patch: UserPreferencesUpdate): Record<string, unknown> {
	const columns: Record<string, unknown> = {};
	if (patch.theme !== undefined) columns.theme = patch.theme;
	if (patch.notificationEmail !== undefined) columns.notification_email = patch.notificationEmail;
	if (patch.notificationPush !== undefined) columns.notification_push = patch.notificationPush;
	if (patch.locale !== undefined) columns.locale = patch.locale;
	if (patch.layoutDirection !== undefined) columns.layout_direction = patch.layoutDirection;
	// `null` is a real value here (clear the preference), so the check is against `undefined` only.
	if (patch.preferredDisplayCurrency !== undefined) {
		columns.preferred_display_currency = patch.preferredDisplayCurrency === null
			? null
			: patch.preferredDisplayCurrency.toUpperCase();
	}
	return columns;
}
// #endregion

export class UserBackendService {
	/**
	 * Resolve the acting user's {@link CurrentUser} projection. Composes the chrome {@link UserContext}
	 * (role badge + workspace) with the live identity (name/email/avatar) when available. A guest (no
	 * resolved `userId`) is rejected 401; everything else resolves to a truthful projection.
	 */
	static async me(
		input: { context: UserContext; accessToken?: string },
	): Promise<ServiceResult<{ user: CurrentUser }>> {
		const { context } = input;
		if (!context.userId) {
			return fail(401, { message: "You need to be signed in to view your account." });
		}

		const live = await UserBackendService.liveIdentity(input.accessToken);
		const preferences = resolvePreferences(
			await UserBackendService.livePreferences(context.userId, input.accessToken),
			context,
		);

		const badge = resolveAccountRole(context);
		const handle = context.handle;
		const name = live.name ?? (handle ? `@${handle}` : "Your account");

		const user: CurrentUser = {
			userId: context.userId,
			handle,
			name,
			email: live.email ?? "",
			avatar: live.avatar ?? null,
			role: badge.role,
			roleLabel: badge.label,
			// The actor owns this request, so they are online by definition.
			online: true,
			// A personal space is the neutral default (no workspace chip); an entity context surfaces the
			// active tenant. The stamped `active_context.handle` is the entity's handle for a tenant.
			workspace: context.contextType === "personal"
				? null
				: { name: handle ?? badge.label, kind: context.contextType },
			preferences,
		};

		return ok({ user });
	}

	/**
	 * The acting user's RESOLVED display preferences — the currency + locale every money figure is
	 * formatted with, and the document direction.
	 *
	 * Separate from {@link me} because it is read on a different cadence: `me` answers the account
	 * popover once per hydration, while this is re-read after a currency switch to confirm what
	 * actually persisted. A guest gets the platform defaults with a 200, not a 401 — a signed-out
	 * visitor still browses prices and still deserves them in a sensible currency.
	 */
	static async preferences(
		input: { context: UserContext; accessToken?: string },
	): Promise<ServiceResult<{ preferences: DisplayPreferences }>> {
		const { context } = input;
		const row = context.userId
			? await UserBackendService.livePreferences(context.userId, input.accessToken)
			: null;
		return ok({ preferences: resolvePreferences(row, context) });
	}

	/**
	 * Apply a partial preferences patch and return the RESOLVED result.
	 *
	 * Returns what actually persisted rather than echoing the request, so an optimistic client can
	 * reconcile against the truth instead of trusting its own guess — the difference between a
	 * currency switch that stuck and one that only appeared to.
	 *
	 * A guest is rejected 401 (there is no row to write). While the backend is gated off, or when no
	 * token is available, the patch is applied to the resolved projection **in-memory only** and
	 * reported honestly: the caller sees the currency it asked for, and nothing claims it was stored.
	 * Writing goes through the RLS-scoped user client — a user may only ever update their own
	 * preferences row, and the policy, not this code, is what enforces that.
	 */
	static async updatePreferences(
		input: { context: UserContext; accessToken?: string; patch: UserPreferencesUpdate },
	): Promise<ServiceResult<{ preferences: DisplayPreferences }>> {
		const { context, patch } = input;
		if (!context.userId) {
			return fail(401, { message: "You need to be signed in to change your preferences." });
		}

		const columns = toColumnPatch(patch);
		if (Object.keys(columns).length === 0) {
			return fail(422, { message: "No preference changes were supplied." });
		}

		const stored = await UserBackendService.writePreferences(
			context.userId,
			input.accessToken,
			columns,
		);

		// Live write succeeded → report the row Postgres actually holds. Otherwise fold the patch over
		// the resolved projection so the surface is consistent for this session, without claiming a
		// durability it did not get.
		if (stored) return ok({ preferences: resolvePreferences(stored, context) });

		const base = resolvePreferences(
			await UserBackendService.livePreferences(context.userId, input.accessToken),
			context,
		);
		return ok({
			preferences: {
				displayCurrency: patch.preferredDisplayCurrency !== undefined
					? toDisplayCurrency(patch.preferredDisplayCurrency ?? context.displayCurrency)
					: base.displayCurrency,
				locale: patch.locale ?? base.locale,
				layoutDirection: (patch.layoutDirection ?? base.layoutDirection) as LayoutDirection,
			},
		});
	}

	/**
	 * Best-effort read of the caller's own `org.user_preferences` row. Only attempts it when live + a
	 * token is present; every failure (unconfigured, no row yet, RLS, network) resolves to `null` so
	 * the caller falls back to the chrome-context projection. Never throws.
	 */
	private static async livePreferences(
		userId: string,
		accessToken?: string,
	): Promise<PreferencesRow | null> {
		if (!isAuthBackendLive() || !accessToken) return null;
		try {
			const { data, error } = await getUserClient(accessToken)
				.schema("org")
				.from("user_preferences")
				.select("locale,preferred_display_currency,layout_direction")
				.eq("user_id", userId)
				.maybeSingle();
			return error ? null : (data as PreferencesRow | null);
		} catch {
			return null;
		}
	}

	/**
	 * Best-effort write of the caller's own preferences row, returning the stored row or `null`.
	 *
	 * An `upsert` rather than an `update`: the seed trigger creates a preferences row on signup, but an
	 * account provisioned before that trigger existed has none, and the first thing such a user would
	 * do is discover that changing their currency silently does nothing.
	 */
	private static async writePreferences(
		userId: string,
		accessToken: string | undefined,
		columns: Record<string, unknown>,
	): Promise<PreferencesRow | null> {
		if (!isAuthBackendLive() || !accessToken) return null;
		try {
			const { data, error } = await getUserClient(accessToken)
				.schema("org")
				.from("user_preferences")
				.upsert({ user_id: userId, ...columns }, { onConflict: "user_id" })
				.select("locale,preferred_display_currency,layout_direction")
				.maybeSingle();
			return error ? null : (data as PreferencesRow | null);
		} catch {
			return null;
		}
	}

	/**
	 * Best-effort live identity enrichment from GoTrue. Only attempts the read when live + a token is
	 * present; every failure (unconfigured, network, an unverifiable token) resolves to an empty
	 * identity so the caller falls back to the chrome projection. Never throws.
	 */
	private static async liveIdentity(accessToken?: string): Promise<LiveIdentity> {
		if (!isAuthBackendLive() || !accessToken) return {};
		try {
			const { data, error } = await getAnonClient().auth.getUser(accessToken);
			const authUser = data?.user;
			if (error || !authUser) return {};
			const meta = (authUser.user_metadata ?? {}) as Record<string, unknown>;
			return {
				name: nameFromMeta(meta),
				email: str(authUser.email) ?? str(meta.email),
				avatar: str(meta.avatar_url) ?? str(meta.picture),
			};
		} catch {
			// Non-blocking: an unavailable identity read degrades to the chrome projection.
			return {};
		}
	}
}
