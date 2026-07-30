import { getWorkspace, postWorkspace, queryOf } from "./api.ts";
import type { UserContext } from "@projective/types/auth";
import type {
	CreateWorkspaceInput,
	HandleCheck,
	InviteMemberInput,
	SwitchContextInput,
	UpdateMemberInput,
	UpdatePayoutInput,
	UpdateSpendInput,
	UpdateWorkspaceInput,
	UpsertRoleInput,
	WorkspaceDetail,
	WorkspaceKind,
	WorkspaceRoster,
	WorkspaceSummary,
} from "@projective/types/workspace";
import type { WorkspaceResult } from "../types/results.ts";

/**
 * WorkspaceService — the THIN client controller for the multi-member entity console (`/teams`,
 * `/businesses`).
 *
 * A dumb object of named methods: each builds a query string or a JSON payload, forwards to an internal
 * `/api/workspace/*` route, and returns a soft {@link WorkspaceResult}. There are no fixtures, no
 * permission decisions and no money arithmetic here — the fat `WorkspaceBackendService` owns all of it,
 * and this file exists purely so an island never has to know a URL or a transport shape (root CLAUDE.md
 * §2: islands are dumb; they `fetch` internal API routes only, never a service or a DB).
 *
 * **Every mutation resolves to the FULL refreshed detail.** That is a deliberate contract, not an
 * accident of convenience: a permission matrix, a split bar and a roster are all views of the same
 * server-resolved truth, so re-rendering them from what the server actually stored is the only way a
 * three-layer permission model stays honest. An island that patched its own local copy would drift the
 * moment the server clamped a value (a rebalanced split, a refused last-owner demotion, a capability
 * the actor could not grant), and the reader would be looking at a lie that survives until reload.
 *
 * `switchContext` lives here rather than in a separate auth service because its payload is the workspace
 * SSOT's {@link SwitchContextInput} and its only callers are the workspace surface and the account
 * popover — both of which reach it through {@link useContextSwitch}, which owns the multi-step
 * re-stamping flow. Note the endpoint is `/api/context/switch`, outside the `/api/workspace` namespace,
 * because the acting context is a session-wide concern that outlives this feature.
 */

// #region Endpoint paths
/**
 * The route paths this service targets. Collected so the thin routes and the client agree in one
 * inspectable place — a renamed endpoint is a one-line change here rather than a hunt through methods.
 */
export const WORKSPACE_ENDPOINTS = {
	roster: "/api/workspace/roster",
	detail: "/api/workspace/detail",
	handle: "/api/workspace/handle",
	create: "/api/workspace/create",
	update: "/api/workspace/update",
	invite: "/api/workspace/invite",
	inviteRespond: "/api/workspace/invite-respond",
	member: "/api/workspace/member",
	role: "/api/workspace/role",
	roleDelete: "/api/workspace/role-delete",
	payout: "/api/workspace/payout",
	spend: "/api/workspace/spend",
	spendDecide: "/api/workspace/spend-decide",
	contextSwitch: "/api/context/switch",
} as const;
// #endregion

// #region The service
export const WorkspaceService = {
	// --- Reads ------------------------------------------------------------------------------------

	/**
	 * Every entity of `kind` the viewer belongs to, plus the invitations awaiting them.
	 *
	 * `data` is the roster ITSELF, unwrapped — the fat service returns `ServiceResult<WorkspaceRoster>`,
	 * and every payload shape here mirrors its fat counterpart exactly so a thin route stays a single
	 * `toWorkspaceResponse(result)` pass-through with nothing to re-wrap (and therefore nothing to get
	 * wrong).
	 */
	roster(kind: WorkspaceKind): Promise<WorkspaceResult<WorkspaceRoster>> {
		return getWorkspace<WorkspaceRoster>(
			`${WORKSPACE_ENDPOINTS.roster}${queryOf({ kind })}`,
		);
	},

	/** One entity's full console projection — roster, roles, invites, money policy, projects, activity. */
	detail(
		kind: WorkspaceKind,
		id: string,
	): Promise<WorkspaceResult<{ workspace: WorkspaceDetail }>> {
		return getWorkspace<{ workspace: WorkspaceDetail }>(
			`${WORKSPACE_ENDPOINTS.detail}${queryOf({ kind, id })}`,
		);
	},

	/**
	 * Probe a handle's availability for the create form. Debouncing is the caller's job — an
	 * availability check that fires per keystroke is a scraper, not a form.
	 */
	checkHandle(handle: string): Promise<WorkspaceResult<HandleCheck>> {
		return getWorkspace<HandleCheck>(
			`${WORKSPACE_ENDPOINTS.handle}${queryOf({ handle })}`,
		);
	},

	// --- Identity & lifecycle ---------------------------------------------------------------------

	/**
	 * Create a Draft-First entity from name + handle. Resolves to the roster SUMMARY (not the full
	 * detail): the caller's next move is to navigate into the new console, which resolves its own detail
	 * server-side, so shipping a whole console projection through the create response would be paid for
	 * twice.
	 */
	create(
		input: CreateWorkspaceInput,
	): Promise<WorkspaceResult<{ workspace: WorkspaceSummary }>> {
		return postWorkspace<{ workspace: WorkspaceSummary }>(WORKSPACE_ENDPOINTS.create, input);
	},

	/** Patch the entity's identity/settings (name, tagline, marks, archive/restore). */
	update(
		input: UpdateWorkspaceInput,
	): Promise<WorkspaceResult<{ workspace: WorkspaceDetail }>> {
		return postWorkspace<{ workspace: WorkspaceDetail }>(WORKSPACE_ENDPOINTS.update, input);
	},

	// --- Membership -------------------------------------------------------------------------------

	/** Invite somebody by handle or email, with a role preset. */
	invite(
		input: InviteMemberInput,
	): Promise<WorkspaceResult<{ workspace: WorkspaceDetail }>> {
		return postWorkspace<{ workspace: WorkspaceDetail }>(WORKSPACE_ENDPOINTS.invite, input);
	},

	/**
	 * Accept or decline an invitation addressed to the VIEWER. Resolves to the refreshed ROSTER rather
	 * than a detail, because the viewer is answering from the roster index and an acceptance changes
	 * which entities they belong to — the roster is the thing that just became stale.
	 */
	respondInvite(
		inviteId: string,
		accept: boolean,
	): Promise<WorkspaceResult<{ roster: WorkspaceRoster }>> {
		return postWorkspace<{ roster: WorkspaceRoster }>(WORKSPACE_ENDPOINTS.inviteRespond, {
			inviteId,
			accept,
		});
	},

	/** Change a member's role, their per-member overrides, their spend envelope, or remove them. */
	updateMember(
		input: UpdateMemberInput,
	): Promise<WorkspaceResult<{ workspace: WorkspaceDetail }>> {
		return postWorkspace<{ workspace: WorkspaceDetail }>(WORKSPACE_ENDPOINTS.member, input);
	},

	// --- Roles ------------------------------------------------------------------------------------

	/** Create or edit a custom role. Presets are read-only server-side; sending one is refused. */
	upsertRole(
		input: UpsertRoleInput,
	): Promise<WorkspaceResult<{ workspace: WorkspaceDetail }>> {
		return postWorkspace<{ workspace: WorkspaceDetail }>(WORKSPACE_ENDPOINTS.role, input);
	},

	/** Delete a custom role. The server reassigns its holders; the refreshed detail reports where to. */
	deleteRole(
		workspaceId: string,
		roleId: string,
	): Promise<WorkspaceResult<{ workspace: WorkspaceDetail }>> {
		return postWorkspace<{ workspace: WorkspaceDetail }>(WORKSPACE_ENDPOINTS.roleDelete, {
			workspaceId,
			roleId,
		});
	},

	// --- Money policy -----------------------------------------------------------------------------

	/**
	 * Write a team's payout split. The server re-validates the 100% invariant and may clamp — which is
	 * exactly why the refreshed detail is authoritative and the editor must re-seed from it rather than
	 * keep its optimistic stakes.
	 */
	updatePayout(
		input: UpdatePayoutInput,
	): Promise<WorkspaceResult<{ workspace: WorkspaceDetail }>> {
		return postWorkspace<{ workspace: WorkspaceDetail }>(WORKSPACE_ENDPOINTS.payout, input);
	},

	/** Write a business's spend policy — approval threshold, approvers, contributors, per-member limits. */
	updateSpend(
		input: UpdateSpendInput,
	): Promise<WorkspaceResult<{ workspace: WorkspaceDetail }>> {
		return postWorkspace<{ workspace: WorkspaceDetail }>(WORKSPACE_ENDPOINTS.spend, input);
	},

	/** Approve or decline an outstanding spend request. */
	decideSpend(
		workspaceId: string,
		requestId: string,
		approve: boolean,
	): Promise<WorkspaceResult<{ workspace: WorkspaceDetail }>> {
		return postWorkspace<{ workspace: WorkspaceDetail }>(WORKSPACE_ENDPOINTS.spendDecide, {
			workspaceId,
			requestId,
			approve,
		});
	},

	// --- Session context --------------------------------------------------------------------------

	/**
	 * Re-stamp the session's acting context. Call this through {@link useContextSwitch}, never directly:
	 * on its own it changes server-side session state while the browser still holds a token carrying the
	 * OLD claims, so every band would keep rendering the previous context until something re-mints the
	 * token. The hook owns that sequence.
	 */
	switchContext(input: SwitchContextInput): Promise<WorkspaceResult<{ context?: UserContext }>> {
		return postWorkspace<{ context?: UserContext }>(WORKSPACE_ENDPOINTS.contextSwitch, input);
	},
};
// #endregion
