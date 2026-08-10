import { z } from "zod";
import type { UserContext } from "../auth/mod.ts";
import { DisplayPreferencesSchema } from "../org/preferences.ts";

/**
 * user/current-user — the Zod SSOT for the **acting user's account projection**.
 *
 * This is the small, read-only shape the authenticated header's account popover binds to: the actor's
 * display name, avatar, email, role badge, live status, and active workspace. It composes the
 * chrome-only {@link UserContext} (resolved from the session JWT) with the acting user's real identity
 * (the Supabase `auth.users` record + `org.users_public` profile) — see
 * `@server/services/user/UserBackendService`.
 *
 * Unlike {@link UserContext} (a non-authoritative wayfinding guide) this carries *display* data, not
 * capability claims; it never grants access. It is a derived read projection — there is no
 * `current_user` table, so it lands with no DB migration (like the projects `detail`/`messages`
 * projections). Only regex/min/max/enum/boolean/nullable primitives are used so the schema stays
 * stable across Zod majors (matching `@projective/types/auth`).
 */

// #region Role badge
/**
 * The account's headline role badge — the persona chip shown beside the name. Derived from the
 * structural context + capability flags: an entity context reads as its kind (`team`/`business`/
 * `organisation`); an individual reads as `freelancer` when they can sell, else `client`.
 */
export const AccountRole = z.enum(["client", "freelancer", "team", "business", "organisation"]);
export type AccountRole = z.infer<typeof AccountRole>;

/** The structural kind of the active workspace (mirrors the context's structural space). */
export const WorkspaceKind = z.enum(["personal", "team", "business", "organisation"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKind>;
// #endregion

// #region Shape
/** The active workspace/team the actor is operating within. */
export const ActiveWorkspaceSchema = z.object({
	/** The workspace display name (the actor's own name for a personal space; the tenant's otherwise). */
	name: z.string().max(120),
	/** The structural kind of the workspace. */
	kind: WorkspaceKind,
});
export type ActiveWorkspace = z.infer<typeof ActiveWorkspaceSchema>;

/**
 * The acting user's account projection for the header popover. `email` may be an empty string when the
 * identity is resolved from chrome-only context (no live `auth.users` read); `avatar` is `null` when
 * the identity has no photo (the UI falls back to the name's initials).
 */
export const CurrentUserSchema = z.object({
	/** The authenticated user's id (`auth.users.id`), or `null` when unresolved. */
	userId: z.string().max(64).nullable(),
	/** The acting `@handle` (`org.users_public.username`), or `null` when unresolved. */
	handle: z.string().max(40).nullable(),
	/** Display name (full name → username → handle fallback chain, resolved server-side). */
	name: z.string().max(160),
	/** Primary email address, or `""` when not resolvable from chrome-only context. */
	email: z.string().max(320),
	/** Avatar image URL, or `null` (→ initials fallback). */
	avatar: z.string().nullable(),
	/** The headline role badge. */
	role: AccountRole,
	/** The human label for {@link role} (e.g. "Freelancer"). */
	roleLabel: z.string().max(40),
	/** Live presence — whether the actor is currently online. */
	online: z.boolean(),
	/** The active workspace/team, or `null` for the neutral personal space. */
	workspace: ActiveWorkspaceSchema.nullable(),
	/**
	 * The viewer's **resolved** presentation preferences — the currency and locale every money figure
	 * on the platform is formatted with (`org.user_preferences.preferred_display_currency` / `locale`).
	 *
	 * Resolved, so the nullable "follow the origin" column state has already been collapsed to a
	 * concrete code by the server: the popover renders a currency switcher, and a switcher whose
	 * current value is `null` has nothing truthful to check. This is the AUTHORITATIVE value the
	 * client reconciles its optimistic switch against — the same read that survives a page load, so a
	 * switch that failed server-side cannot masquerade as one that stuck.
	 */
	preferences: DisplayPreferencesSchema,
});
export type CurrentUser = z.infer<typeof CurrentUserSchema>;
// #endregion

// #region Pure derivation
/** A resolved role badge — the enum value + its display label. */
export interface AccountBadge {
	role: AccountRole;
	label: string;
}

/**
 * Resolve the headline {@link AccountBadge} from a chrome-only {@link UserContext}. Pure and total, so
 * both the fat {@link UserBackendService} (building the projection) and the header island (its
 * loading-state fallback) derive the badge identically. Type-only import of `UserContext` keeps the
 * `user` domain a decoupled leaf (no runtime cycle with `auth`).
 */
export function resolveAccountRole(
	context: Pick<UserContext, "contextType" | "isFreelancer">,
): AccountBadge {
	switch (context.contextType) {
		case "organisation":
			return { role: "organisation", label: "Organisation" };
		case "business":
			return { role: "business", label: "Business" };
		case "team":
			return { role: "team", label: "Team" };
		default:
			return context.isFreelancer
				? { role: "freelancer", label: "Freelancer" }
				: { role: "client", label: "Client" };
	}
}
// #endregion
