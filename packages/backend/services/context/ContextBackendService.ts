import type { UserContext } from "@projective/types/auth";
import type { ActingOrganisation, SwitchContextInput } from "@projective/types/workspace";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient } from "../../core/supabase.ts";

/**
 * ContextBackendService — the FAT service that changes **which identity a session is acting as**.
 *
 * It sits deliberately outside the workspace service even though the workspace surface is its loudest
 * caller: the acting context is a **session-wide** concern that also drives the header account popover,
 * the global sidebar's gating, RLS scoping and every `/wallet` read, and the `organisation` context it must
 * also serve is not a workspace kind at all.
 *
 * ## The database invariant this service exists to protect
 *
 * `security.session_context` holds **four mutually-exclusive active slots** — `active_profile_type` +
 * `active_profile_id`, `active_team_id`, `active_organisation_id`. "One context at a time" is a **schema
 * invariant, not a UI convention**: every switch RPC upserts the whole row through one internal setter
 * that NULLs every slot it is not setting, so there is no representable state in which a session is acting
 * as two identities. The table is SELECT-only to clients; these four RPCs are the only doors:
 *
 * | Target         | RPC                                                  |
 * | :------------- | :--------------------------------------------------- |
 * | `personal`     | `security.clear_session_context()`                   |
 * | `team`         | `security.switch_team_context(p_team_id)`            |
 * | `business`     | `security.switch_session_context('business', p_id)`  |
 * | `organisation` | `security.switch_organisation_context(p_org_id)`     |
 *
 * Each resolves the caller from `auth.uid()` and refuses (`42501`) anybody who is not an active member of
 * a non-archived target — so authority is the database's, and this service only forwards and maps.
 *
 * ## Switching is only step one — the caller MUST re-mint the token
 *
 * The acting context is not read from the database per request. It is stamped into the access token by
 * the GoTrue custom access-token hook (`public.custom_access_token_hook`), which re-checks membership at
 * every mint and drops a stale context back to personal. So a successful call here changes **nothing the
 * browser can see** until the caller follows it with `POST /api/auth/refresh` and a hard navigation. The
 * client-side `useContextSwitch` hook owns that sequence (switch → refresh → hard navigation) and is the
 * only sanctioned caller.
 *
 * ## Live-only
 *
 * There is no stub path: a switch is a write to session state, so without a session token there is
 * nothing to switch. Every call runs through the **user-scoped** client — the functions are
 * `SECURITY DEFINER` but resolve the actor from `auth.uid()`, so a service-role call would resolve a NULL
 * actor and write nothing.
 */

// #region Request shape
/** The per-request session facts a switch needs: who is asking, and with which token. */
export interface ContextRequest {
	/** The chrome-only acting context resolved from the session JWT (never an authority, only an input). */
	context: UserContext;
	/**
	 * The caller's access token. Required — the RPCs resolve the actor from `auth.uid()`, so without a
	 * user-scoped client there is no actor to switch.
	 */
	accessToken?: string;
}

/**
 * The switch payload.
 *
 * Deliberately EMPTY on success. The obvious convenience — echoing the context the session will act as — is
 * a prediction, not a fact: the browser's token still carries the old claims until `/api/auth/refresh`
 * lands, so anything shipped here would be a shape that *looks* authoritative while contradicting the live
 * session for the next few hundred milliseconds. The optional field exists only so a future caller with a
 * genuine post-refresh projection has somewhere to put it.
 */
export interface SwitchContextResult {
	context?: UserContext;
}
// #endregion

// #region The service
/** Session-context switching (see the module docblock). */
export class ContextBackendService {
	/**
	 * Re-stamp the session's acting context.
	 *
	 * Order of decisions: a target is required (and must be a row id) for an entity context → the caller
	 * must hold a session token → the RPC decides membership. Every refusal carries a human message, and a
	 * `contextId` complaint is field-keyed so the switcher can point at the control that caused it.
	 */
	static async switchContext(
		input: SwitchContextInput,
		request: ContextRequest,
	): Promise<ServiceResult<SwitchContextResult>> {
		const targetId = input.contextId?.trim() || null;

		// An entity context without a target is unrepresentable. Personal is the one context with nothing to
		// point at, so a stray id there is ignored rather than refused: "act as myself" is unambiguous.
		if (input.contextType !== "personal") {
			if (!targetId) return fieldRefusal(422, "Choose which workspace to act as.");
			if (!UUID_RE.test(targetId)) return fieldRefusal(404, "That workspace doesn't exist.");
		}
		if (!request.accessToken) return fail(401, { message: "Sign in to switch workspace." });

		try {
			const db = getUserClient(request.accessToken).schema("security");
			const { error } = input.contextType === "team"
				? await db.rpc("switch_team_context", { p_team_id: targetId })
				: input.contextType === "business"
				? await db.rpc("switch_session_context", { p_type: "business", p_id: targetId })
				: input.contextType === "organisation"
				? await db.rpc("switch_organisation_context", { p_org_id: targetId })
				: await db.rpc("clear_session_context");
			if (error) return refusalFrom(error);
			return ok<SwitchContextResult>({}, { message: switchedMessage(input) });
		} catch (error) {
			// A configuration or transport failure — logged, never surfaced verbatim.
			console.error("[context:switch]", error instanceof Error ? error.message : error);
			return fail(503, { message: "Could not switch workspace — please try again." });
		}
	}

	/**
	 * The organisations the caller may switch into: the ones they OWN plus the ones they hold an ACTIVE
	 * membership in, archived ones excluded — the same admission `security.switch_organisation_context`
	 * applies, so the switcher never offers a row the RPC would refuse.
	 *
	 * Both reads are RLS-scoped as the caller. The filters are explicit rather than left to the policy,
	 * because the `org.organisations` SELECT policy also admits platform admins to EVERY organisation —
	 * which is a viewing right, not a list of identities the admin can act as.
	 */
	static async organisations(
		request: ContextRequest,
	): Promise<ServiceResult<{ organisations: ActingOrganisation[] }>> {
		const userId = request.context.userId;
		// The id is interpolated into a PostgREST filter, so it must be exactly a uuid, never free text.
		if (!request.accessToken || !userId || !UUID_RE.test(userId)) {
			return fail(401, { message: "Sign in to see your organisations." });
		}
		try {
			const db = getUserClient(request.accessToken).schema("org");
			const memberships = await db.from("organisation_members")
				.select("organisation_id")
				.eq("user_id", userId)
				.eq("status", "active");
			if (memberships.error) throw new Error(memberships.error.message);
			const memberOf = (memberships.data ?? []).map((row) => String(row.organisation_id));

			const filter = memberOf.length > 0
				? `owner_user_id.eq.${userId},id.in.(${memberOf.join(",")})`
				: `owner_user_id.eq.${userId}`;
			const orgs = await db.from("organisations")
				.select("id,owner_user_id,legal_name,trading_name,handle,status")
				.or(filter)
				.neq("status", "archived")
				.order("legal_name");
			if (orgs.error) throw new Error(orgs.error.message);

			const organisations = (orgs.data ?? []).map((row): ActingOrganisation => ({
				id: String(row.id),
				name: String(row.trading_name ?? "").trim() || String(row.legal_name),
				handle: String(row.handle),
				owner: row.owner_user_id === userId,
			}));
			return ok({ organisations });
		} catch (error) {
			console.error("[context:organisations]", error instanceof Error ? error.message : error);
			return fail(503, { message: "Couldn't load your organisations just now." });
		}
	}
}
// #endregion

// #region Messages
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A refusal about the chosen target, keyed to the `contextId` control. */
function fieldRefusal(status: number, message: string): ServiceResult<SwitchContextResult> {
	return fail(status, { message, errors: { contextId: message } });
}

/** The success note. Short and true — the client discards it unless something failed. */
function switchedMessage(input: SwitchContextInput): string {
	switch (input.contextType) {
		case "personal":
			return "Now acting personally.";
		case "team":
			return "Now acting as this team.";
		case "business":
			return "Now acting as this business.";
		case "organisation":
			return "Now acting as this organisation.";
	}
}

/**
 * Map an RPC refusal onto a result. The switch functions raise `<field>: <reason>` sentences
 * (`context: you are not an active member of this team`), so an authority refusal is passed through as a
 * `403` in the database's own words — more specific than anything this layer could reconstruct. `auth:`
 * is the missing-session refusal (`401`); `22023` is a malformed target (`422`). Anything else is logged
 * and answered generically: an unexpected SQL error is not a sentence to show a user.
 */
function refusalFrom(
	error: { code?: string; message?: string },
): ServiceResult<SwitchContextResult> {
	const message = error.message ?? "";
	const match = /^([A-Za-z_]+):\s*([\s\S]+)$/.exec(message.trim());
	const reason = match ? match[2].trim() : message.trim();
	const sentence = reason
		? `${reason[0].toUpperCase()}${reason.slice(1)}${/[.!?]$/.test(reason) ? "" : "."}`
		: "";
	if (error.code === "42501") {
		if (match?.[1] === "auth") return fail(401, { message: "Sign in to switch workspace." });
		return fieldRefusal(403, sentence || "You can't act as that workspace.");
	}
	if (error.code === "22023" || error.code === "22P02") {
		return fieldRefusal(422, sentence || "That isn't a workspace you can act as.");
	}
	console.error("[context:switch]", error.code, message);
	return fail(502, { message: "Could not switch workspace — please try again." });
}
// #endregion
