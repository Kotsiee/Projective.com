import { getWorkspace, postWorkspace, queryOf } from "./api.ts";
import type { UserContext } from "@projective/types/auth";
import type {
	ArchiveRoleInput,
	CreateWorkspaceInput,
	HandleCheck,
	InviteActionInput,
	InviteMemberInput,
	RespondInviteInput,
	SwitchContextInput,
	TransferOwnershipInput,
	UpdateMemberInput,
	UpdatePayoutInput,
	UpdateSpendInput,
	UpdateWorkspaceInput,
	UpsertRoleInput,
	WorkspaceDetail,
	WorkspaceKind,
	WorkspaceRoster,
} from "@projective/types/workspace";
import type { CreatedWorkspace, InviteAnswer, WorkspaceResult } from "../types/results.ts";

/**
 * WorkspaceService — the THIN client controller for the multi-member entity console (`/teams`,
 * `/businesses`).
 *
 * A dumb object of named methods: each builds a query string or a JSON payload, forwards to an internal
 * `/api/workspace/*` route, and returns a soft {@link WorkspaceResult}. There are no permission
 * decisions and no money arithmetic here — the fat `WorkspaceBackendService` owns all of it, and this
 * file exists purely so an island never has to know a URL or a transport shape (root CLAUDE.md §2:
 * islands are dumb; they `fetch` internal API routes only, never a service or a DB).
 *
 * **Every mutation resolves to the FULL re-read detail.** A permission matrix, a split bar and a roster
 * are all views of the same server-resolved truth, so re-rendering them from what the server actually
 * stored is the only way a three-layer permission model stays honest. An island that patched its own
 * local copy would drift the moment the server clamped or refused a value. The two writes that can
 * remove the caller from the entity (leaving, or handing ownership over and leaving) resolve to `null`
 * instead, because there is no longer a console for them to see.
 *
 * `switchContext` lives here rather than in a separate auth service because its payload is the workspace
 * SSOT's {@link SwitchContextInput} and its only callers reach it through {@link useContextSwitch},
 * which owns the multi-step re-stamping flow. Its endpoint is `/api/context/switch`, outside the
 * `/api/workspace` namespace, because the acting context is a session-wide concern.
 */

// #region Endpoint paths
/** The route paths this service targets, collected so the thin routes and the client agree in one place. */
export const WORKSPACE_ENDPOINTS = {
	roster: "/api/workspace/roster",
	detail: "/api/workspace/detail",
	handle: "/api/workspace/handle",
	create: "/api/workspace/create",
	update: "/api/workspace/update",
	invite: "/api/workspace/invite",
	inviteAction: "/api/workspace/invite-action",
	inviteRespond: "/api/workspace/invite-respond",
	member: "/api/workspace/member",
	transferOwnership: "/api/workspace/transfer-ownership",
	role: "/api/workspace/role",
	roleArchive: "/api/workspace/role-archive",
	payout: "/api/workspace/payout",
	spend: "/api/workspace/spend",
	spendDecide: "/api/workspace/spend-decide",
	contextSwitch: "/api/context/switch",
} as const;
// #endregion

// #region The service
export const WorkspaceService = {
	// --- Reads ------------------------------------------------------------------------------------

	/** Every entity of `kind` the viewer belongs to, plus the invitations awaiting them. */
	roster(kind: WorkspaceKind): Promise<WorkspaceResult<WorkspaceRoster>> {
		return getWorkspace<WorkspaceRoster>(`${WORKSPACE_ENDPOINTS.roster}${queryOf({ kind })}`);
	},

	/**
	 * One entity's full console projection. `ref` is the entity's handle (its console address) or its
	 * row id; the server resolves either.
	 */
	detail(kind: WorkspaceKind, ref: string): Promise<WorkspaceResult<WorkspaceDetail>> {
		return getWorkspace<WorkspaceDetail>(`${WORKSPACE_ENDPOINTS.detail}${queryOf({ kind, ref })}`);
	},

	/**
	 * Probe a handle's availability for the create form. Debouncing is the caller's job — an
	 * availability check that fires per keystroke is a scraper, not a form.
	 */
	checkHandle(handle: string): Promise<WorkspaceResult<HandleCheck>> {
		return getWorkspace<HandleCheck>(`${WORKSPACE_ENDPOINTS.handle}${queryOf({ handle })}`);
	},

	// --- Identity & lifecycle ---------------------------------------------------------------------

	/**
	 * Create a Draft-First entity from name + handle. Resolves to its id, kind and handle — the caller's
	 * next move is to navigate into the new console, which resolves its own detail server-side.
	 */
	create(input: CreateWorkspaceInput): Promise<WorkspaceResult<CreatedWorkspace>> {
		return postWorkspace<CreatedWorkspace>(WORKSPACE_ENDPOINTS.create, input);
	},

	/** Patch the entity's name or tagline, or archive / restore it. */
	update(input: UpdateWorkspaceInput): Promise<WorkspaceResult<WorkspaceDetail>> {
		return postWorkspace<WorkspaceDetail>(WORKSPACE_ENDPOINTS.update, input);
	},

	// --- Membership -------------------------------------------------------------------------------

	/** Invite somebody by handle or email, to one of the entity's roles. */
	invite(input: InviteMemberInput): Promise<WorkspaceResult<WorkspaceDetail>> {
		return postWorkspace<WorkspaceDetail>(WORKSPACE_ENDPOINTS.invite, input);
	},

	/** Revoke or resend a pending invitation the entity sent. */
	inviteAction(input: InviteActionInput): Promise<WorkspaceResult<WorkspaceDetail>> {
		return postWorkspace<WorkspaceDetail>(WORKSPACE_ENDPOINTS.inviteAction, input);
	},

	/** Accept or decline an invitation addressed to the VIEWER. */
	respondInvite(input: RespondInviteInput): Promise<WorkspaceResult<InviteAnswer>> {
		return postWorkspace<InviteAnswer>(WORKSPACE_ENDPOINTS.inviteRespond, input);
	},

	/**
	 * Change a member — role, overrides, title, reporting line, spend envelope — or remove them.
	 * Resolves to `null` when the caller removed THEMSELVES.
	 */
	updateMember(input: UpdateMemberInput): Promise<WorkspaceResult<WorkspaceDetail | null>> {
		return postWorkspace<WorkspaceDetail | null>(WORKSPACE_ENDPOINTS.member, input);
	},

	/** Hand the owner seat to another active member in one act. `null` when the owner also left. */
	transferOwnership(
		input: TransferOwnershipInput,
	): Promise<WorkspaceResult<WorkspaceDetail | null>> {
		return postWorkspace<WorkspaceDetail | null>(WORKSPACE_ENDPOINTS.transferOwnership, input);
	},

	// --- Roles ------------------------------------------------------------------------------------

	/** Create or edit a custom role. Presets are read-only server-side; sending one is refused. */
	upsertRole(input: UpsertRoleInput): Promise<WorkspaceResult<WorkspaceDetail>> {
		return postWorkspace<WorkspaceDetail>(WORKSPACE_ENDPOINTS.role, input);
	},

	/** Archive a custom role. Refused while anybody holds it or a pending invitation offers it. */
	archiveRole(input: ArchiveRoleInput): Promise<WorkspaceResult<WorkspaceDetail>> {
		return postWorkspace<WorkspaceDetail>(WORKSPACE_ENDPOINTS.roleArchive, input);
	},

	// --- Money policy -----------------------------------------------------------------------------

	/**
	 * Write a team's payout split. The server re-validates the 100% invariant, which is why the refreshed
	 * detail is authoritative and the editor re-seeds from it rather than keeping its optimistic stakes.
	 */
	updatePayout(input: UpdatePayoutInput): Promise<WorkspaceResult<WorkspaceDetail>> {
		return postWorkspace<WorkspaceDetail>(WORKSPACE_ENDPOINTS.payout, input);
	},

	/** Write a business's spend policy — approval threshold, approvers, contributors, per-member limits. */
	updateSpend(input: UpdateSpendInput): Promise<WorkspaceResult<WorkspaceDetail>> {
		return postWorkspace<WorkspaceDetail>(WORKSPACE_ENDPOINTS.spend, input);
	},

	/** Approve or decline an outstanding spend request on a business's pooled wallet. */
	decideSpend(
		input: { workspaceId: string; requestId: string; approve: boolean },
	): Promise<WorkspaceResult<WorkspaceDetail>> {
		return postWorkspace<WorkspaceDetail>(WORKSPACE_ENDPOINTS.spendDecide, input);
	},

	// --- Session context --------------------------------------------------------------------------

	/**
	 * Re-stamp the session's acting context. Call this through {@link useContextSwitch}, never directly:
	 * on its own it changes server-side session state while the browser still holds a token carrying the
	 * OLD claims. The hook owns the switch → refresh → hard-navigation sequence.
	 */
	switchContext(input: SwitchContextInput): Promise<WorkspaceResult<{ context?: UserContext }>> {
		return postWorkspace<{ context?: UserContext }>(WORKSPACE_ENDPOINTS.contextSwitch, input);
	},
};
// #endregion
