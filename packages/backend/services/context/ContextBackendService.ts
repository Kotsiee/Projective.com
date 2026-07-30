import type { UserContext } from "@projective/types/auth";
import type { SwitchContextInput, WorkspaceKind } from "@projective/types/workspace";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isAuthBackendLive } from "../../core/supabase.ts";
import { WorkspaceBackendService } from "../workspace/WorkspaceBackendService.ts";

/**
 * ContextBackendService — the FAT service that changes **which identity a session is acting as**.
 *
 * It sits deliberately outside the workspace service even though the workspace surface is its loudest
 * caller: the acting context is a **session-wide** concern that also drives the header account popover,
 * the global sidebar's gating, RLS scoping and every `/wallet` read. Folding it into
 * {@link WorkspaceBackendService} would tie a session primitive to one feature's lifetime, and the
 * `organisation` context it must also serve is not a {@link WorkspaceKind} at all.
 *
 * ## The database invariant this service exists to protect
 *
 * `security.session_context` holds **four mutually-exclusive active slots** — `active_profile_type` +
 * `active_profile_id`, `active_team_id`, `active_organisation_id`. "One context at a time" is a **schema
 * invariant, not a UI convention**: each switch RPC NULLs every slot it is not setting, so there is no
 * representable state in which a session is acting as two identities. Callers must therefore never try to
 * compose a switch out of two writes, and nothing may assume a previous slot survives.
 *
 * ## Switching is only step one — the caller MUST re-mint the token
 *
 * The acting context is not read from the database per request. It is stamped into the access token by the
 * GoTrue custom access-token hook (`public.custom_access_token_hook`, Decision #17), which reads those
 * slots and writes both the raw RLS claims (`active_profile_type`/`_id`, `active_team_id`,
 * `active_organisation_id`) and the chrome claim `app_metadata.active_context` that
 * `resolveUserContext` decodes (Decision #16).
 *
 * So a successful call here changes **nothing the browser can see**. Until the caller follows it with
 * `POST /api/auth/refresh`, the browser still holds a token stamped with the PREVIOUS context: every band
 * would render the old identity while RLS enforced the old claims underneath — a screen that is wrong in a
 * way the reader cannot detect. The client-side `useContextSwitch` hook owns that sequence
 * (switch → refresh → hard navigation) and is the only sanctioned caller.
 *
 * ## Stub-first, behind the existing `AUTH_BACKEND_LIVE` gate
 *
 * This is session lifecycle, so it rides the auth gate rather than introducing a tenth switch: when live it
 * calls the RPCs through the **user-scoped** client (the functions are `SECURITY DEFINER` but resolve the
 * actor from `auth.uid()`, so they must run as the user, never as the service role — a service-role call
 * would resolve a NULL actor and silently write nothing). When stubbed it validates membership against the
 * workspace fixtures and reports success, so the whole switcher is exercisable without a wired GoTrue.
 *
 * ## Flagged gaps in the live path (surface, do not silently resolve)
 *
 * 1. **There is no `security.switch_team_context` RPC.** The access-token hook already READS
 *    `active_team_id` and resolves it to a `team` chrome context, and the column exists on
 *    `security.session_context` — but `switch_session_context` only accepts `profile_type`
 *    (`'freelancer' | 'business'`) and NULLs the team slot on every call, so **no setter exists for it**.
 *    A live team switch therefore refuses (`501`) rather than succeeding into a context the token can never
 *    carry. Adding the RPC is a migration and needs human sign-off (`security` is protected surface).
 * 2. **Returning to `personal` only works for a freelancer.** `switch_session_context('freelancer', <own
 *    id>)` is genuinely the personal switch — the hook's slot resolution falls through to `personal` for a
 *    `freelancer` profile type — but the RPC RAISES for anybody without an `org.freelancer_profiles` row,
 *    so a client-only individual who has entered a business context has no sanctioned way out. There is no
 *    "clear all slots" RPC. Also needs a human decision.
 *
 * Both are reported honestly rather than papered over: `useContextSwitch` surfaces the message and does not
 * navigate, which is strictly better than landing the user in a context the session does not actually hold.
 */

// #region Request shape
/** The per-request session facts a switch needs: who is asking, and with which token. */
export interface ContextRequest {
	/** The chrome-only acting context resolved from the session JWT (never an authority, only an input). */
	context: UserContext;
	/**
	 * The caller's access token. Required for the LIVE path — the RPCs resolve the actor from `auth.uid()`,
	 * so without a user-scoped client there is no actor to switch.
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
export class ContextBackendService {
	/**
	 * Re-stamp the session's acting context.
	 *
	 * Order of decisions: a target is required for an entity context → the caller must be authenticated →
	 * then either the live RPC or the stubbed membership check. Every refusal carries a human message, and
	 * a `contextId` complaint is field-keyed so the switcher can point at the control that caused it.
	 */
	static async switchContext(
		input: SwitchContextInput,
		request: ContextRequest,
	): Promise<ServiceResult<SwitchContextResult>> {
		const targetId = input.contextId?.trim() || null;
		const { context, accessToken } = request;

		// An entity context without a target is unrepresentable — every switch RPC needs the id it is
		// binding the session to. Personal is the one context with nothing to point at, so a stray id there
		// is ignored rather than refused: the caller's intent ("act as myself") is unambiguous.
		if (input.contextType !== "personal" && !targetId) {
			return fail(422, {
				message: "Choose which workspace to act as.",
				errors: { contextId: "Choose which workspace to act as." },
			});
		}

		// Switching mutates server-side session state, so unlike the read surfaces this one genuinely needs
		// a session. Accept EITHER a resolved user id or a bare token: in development the session cookie is
		// often an opaque non-JWT, which decodes to a guest context while still being a real signed-in
		// session — rejecting on `userId` alone would make the switcher untestable there.
		if (!context.userId && !accessToken) {
			return fail(401, { message: "Sign in to switch workspace." });
		}

		if (isAuthBackendLive() && accessToken) {
			return await ContextBackendService.switchLive(input, targetId, context, accessToken);
		}
		return ContextBackendService.switchStub(input, targetId, context);
	}

	// #region Live path
	/**
	 * Write the acting context through the `security` RPCs as the CALLING USER.
	 *
	 * Never throws: an unreachable database, a revoked grant or a raised `Access Denied` all resolve to a
	 * refusal, because a thrown switch would leave the client unable to tell "refused" from "broken" and
	 * `useContextSwitch` would strand the user mid-sequence with no message.
	 */
	private static async switchLive(
		input: SwitchContextInput,
		targetId: string | null,
		context: UserContext,
		accessToken: string,
	): Promise<ServiceResult<SwitchContextResult>> {
		// See the class doc, flagged gap 1: the team slot has a reader (the access-token hook) but no
		// setter, so succeeding here would put the session in a context the token can never carry.
		if (input.contextType === "team") {
			return fail(501, {
				message:
					"Acting as a team is not available yet — the session switch for teams has not been wired.",
			});
		}

		try {
			const db = getUserClient(accessToken).schema("security");

			const { error } = input.contextType === "organisation"
				? await db.rpc("switch_organisation_context", { p_org_id: targetId })
				: input.contextType === "business"
				? await db.rpc("switch_session_context", { p_type: "business", p_id: targetId })
				// Personal: the `freelancer` profile slot is what the access-token hook resolves to a
				// `personal` chrome context (its slot resolution falls through to personal for that type), so
				// this IS the exit from an entity context — for anybody who has a freelancer profile. See
				// flagged gap 2 for the client-only individual who does not.
				: await db.rpc("switch_session_context", {
					p_type: "freelancer",
					p_id: context.userId,
				});

			if (error) return liveRefusal(input, error.message);
			return ok<SwitchContextResult>({}, { message: switchedMessage(input) });
		} catch {
			// A configuration or transport failure — deliberately not surfaced verbatim.
			return fail(502, { message: "Could not switch workspace — please try again." });
		}
	}
	// #endregion

	// #region Stub path
	/**
	 * The exercisable stub: validate that the target is something the viewer could plausibly act as, then
	 * report success without touching a database.
	 *
	 * Membership is checked by asking the workspace service for the entity's detail, which already refuses
	 * `404` for an unknown id and `403` for a non-member — so the switcher's failure states are reachable in
	 * development without duplicating a membership rule that lives in the fixtures.
	 *
	 * **Two honest limits of this path.** The fixture corpus is authored for one fixed acting identity, so
	 * its membership check is a property of the corpus rather than of the caller — it proves the entity is
	 * *joinable*, not that *this* viewer joined it. And an `organisation` cannot be checked at all: it is
	 * not a {@link WorkspaceKind}, so there is no roster to consult, and it is accepted on trust. Neither
	 * matters while the gate is off (the data is synthetic); both vanish when the RLS-scoped live path lands.
	 */
	private static switchStub(
		input: SwitchContextInput,
		targetId: string | null,
		context: UserContext,
	): ServiceResult<SwitchContextResult> {
		if ((input.contextType === "team" || input.contextType === "business") && targetId) {
			const kind: WorkspaceKind = input.contextType;
			const res = WorkspaceBackendService.detail(kind, targetId, context);
			if (!res.ok) {
				return fail(res.status, {
					message: res.message ?? "You cannot act as that workspace.",
				});
			}
		}
		return ok<SwitchContextResult>({}, { message: switchedMessage(input) });
	}
	// #endregion
}
// #endregion

// #region Messages
/** The success note. Short and true on both paths — the client discards it unless something failed. */
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
 * Map an RPC failure onto a refusal.
 *
 * The switch functions raise their own reader-facing sentences (`"Access Denied: You are not an active
 * member of this business."`), so an authority refusal is passed through as a `403` with the database's own
 * words — it is more specific than anything this layer could reconstruct. Everything else is a `502` with a
 * generic message: an unexpected SQL error is not a sentence to show a user, and it may describe internals.
 *
 * The missing-freelancer-profile case is named explicitly because it IS flagged gap 2, not a user error:
 * the RPC's own "You do not have a freelancer profile" would read as a non-sequitur to somebody who only
 * pressed "Back to personal", so it is translated into what actually happened.
 */
function liveRefusal(
	input: SwitchContextInput,
	message: string,
): ServiceResult<SwitchContextResult> {
	if (input.contextType === "personal" && message.includes("freelancer profile")) {
		return fail(501, {
			message: "Returning to your personal space is not available yet on this account.",
		});
	}
	if (message.includes("Access Denied")) {
		return fail(403, { message: message.replace("Access Denied: ", "") });
	}
	return fail(502, { message: "Could not switch workspace — please try again." });
}
// #endregion
