import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getAnonClient, isAuthBackendLive } from "../../core/supabase.ts";
import type { UserContext } from "@projective/types/auth";
import { type CurrentUser, resolveAccountRole } from "@projective/types/user";

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
		};

		return ok({ user });
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
