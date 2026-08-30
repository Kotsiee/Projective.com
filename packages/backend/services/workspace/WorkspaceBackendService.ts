import type { UserContext } from "@projective/types/auth";
import type {
	CreateWorkspaceInput,
	HandleCheck,
	InviteMemberInput,
	UpdateMemberInput,
	UpdatePayoutInput,
	UpdateSpendInput,
	UpdateWorkspaceInput,
	UpsertRoleInput,
	WorkspaceDetail,
	WorkspaceKind,
	WorkspaceRoster,
	WorkspaceSim,
	WorkspaceSummary,
} from "@projective/types/workspace";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { serverEnv } from "../../core/env.ts";
import { isSupabaseConfigured, useMocks } from "../../core/supabase.ts";
import {
	applyRosterSim,
	applyWorkspaceSim,
	buildRoster,
	checkWorkspaceHandle,
	createWorkspace,
	decideSpendRequest,
	deleteRoleDef,
	inviteMember,
	type Outcome,
	readWorkspace,
	respondToInvite,
	updateMemberRow,
	updatePayoutPolicy,
	updateSpendPolicy,
	updateWorkspace,
	upsertRoleDef,
	withViewer,
} from "./workspace-fixtures.ts";

/**
 * True when LIVE workspace-backend behaviour is enabled AND Supabase is configured.
 *
 * Its eight siblings (`isCatalogueBackendLive`, `isFinanceBackendLive`, …) live in `core/supabase.ts`;
 * this one lives beside the service that reads it because the workspace surface owns no client
 * provisioning of its own. **Flagged for reconciliation:** if the gate collection is ever treated as a
 * single registry, move this to `core/supabase.ts` with the rest rather than keeping two homes.
 */
export function isWorkspaceBackendLive(): boolean {
	return !useMocks() && serverEnv().workspaceBackendLive && isSupabaseConfigured();
}

/**
 * WorkspaceBackendService — the FAT half of the multi-member entity console (`/teams`, `/businesses`),
 * per the thin-routes / fat-services contract (root CLAUDE.md §2 · SYSTEM_ARCHITECTURE §Backend
 * Services). It owns the roster read, one entity's full console projection, and every mutation
 * (create · invite · membership · roles · payout split · spend governance), each returning a
 * transport-agnostic {@link ServiceResult}. The thin `/api/workspaces/*` routes parse + Zod-validate +
 * guard + delegate here; islands never reach it.
 *
 * **One architecture, two kinds.** Every method takes {@link WorkspaceKind} rather than existing twice:
 * a team is a freelancer with multiple members, a business is a client with multiple members, and the
 * difference is a capability table (`@projective/types/workspace` `capabilitiesForKind`), never a forked
 * service.
 *
 * **Every mutation returns the FULL refreshed detail** so an island re-renders from server truth rather
 * than patching its own copy — the roster's stats, the role member counts, the viewer's effective
 * capabilities, the split's 100% invariant and the Draft-First checklist are all re-derived server-side
 * on every write, so the projection can never drift from its own parts.
 *
 * **All money is server-computed.** Balances, split projections, the platform fee, spend envelopes and
 * the pooled ledger are formatted into `MoneyView`s here; the client renders `display` strings and never
 * totals, splits, converts or fee-adjusts (root CLAUDE.md §12 · Decision #55).
 *
 * Gated by {@link isWorkspaceBackendLive} (`WORKSPACE_BACKEND_LIVE`, default off): until the RLS-scoped
 * reads land, reads answer from the deterministic fixtures and writes mutate an in-module session store,
 * so the whole surface is exercisable without persistence. The LIVE branch reads the **existing**
 * `org.teams` / `org.business_profiles` / `org.*_members` / `org.*_roles` tables — this surface adds no
 * schema, which is why **no migration accompanies it**.
 */
export class WorkspaceBackendService {
	// #region Reads
	/** Every entity of a kind the viewer belongs to, plus the invitations awaiting them. */
	static roster(
		kind: WorkspaceKind,
		viewer: UserContext,
		sim?: WorkspaceSim,
	): ServiceResult<WorkspaceRoster> {
		if (!isWorkspaceBackendLive()) return ok(applyRosterSim(buildRoster(kind, viewer), sim));
		// LIVE: read RLS-scoped `org.teams` / `org.business_profiles` + `org.*_members` for this viewer —
		// not yet implemented; the projection shape is already the SSOT's, so fall back with no churn.
		// The developer simulation overlay is deliberately NOT applied on the live path: it exists to make
		// every axis reachable against fixtures, never to reshape real data.
		return ok(buildRoster(kind, viewer));
	}

	/** One entity's full console projection, viewer-scoped (403 when the viewer is not a member). */
	static detail(
		kind: WorkspaceKind,
		id: string,
		viewer: UserContext,
		sim?: WorkspaceSim,
	): ServiceResult<{ workspace: WorkspaceDetail }> {
		return wrap(
			readWorkspace(kind, id, viewer),
			(workspace) => ({
				workspace: isWorkspaceBackendLive() ? workspace : applyWorkspaceSim(workspace, sim),
			}),
		);
	}

	/** Probe a handle's availability — format, reserved words, then collisions, with alternatives. */
	static checkHandle(handle: string): ServiceResult<HandleCheck> {
		return ok(checkWorkspaceHandle(handle));
	}
	// #endregion

	// #region Lifecycle
	/** Create a Draft-First entity from name + handle alone, with the viewer as its owner. */
	static create(
		input: CreateWorkspaceInput,
		viewer: UserContext,
	): ServiceResult<{ workspace: WorkspaceSummary }> {
		return wrap(createWorkspace(input, viewer), (workspace) => ({ workspace }), 201);
	}

	/** Patch the entity's identity or lifecycle state (nothing is hard-deleted — archive instead). */
	static update(
		input: UpdateWorkspaceInput,
		viewer: UserContext,
	): ServiceResult<{ workspace: WorkspaceDetail }> {
		return refresh(updateWorkspace(input), viewer);
	}
	// #endregion

	// #region Membership
	/** Invite somebody by handle or email, at a role the inviter holds the authority to hand out. */
	static invite(
		input: InviteMemberInput,
		viewer: UserContext,
	): ServiceResult<{ workspace: WorkspaceDetail }> {
		return refresh(inviteMember(input), viewer);
	}

	/** Accept or decline an invitation addressed to the viewer; answers with the refreshed roster. */
	static respondInvite(
		inviteId: string,
		accept: boolean,
		viewer: UserContext,
	): ServiceResult<{ roster: WorkspaceRoster }> {
		return wrap(respondToInvite(inviteId, accept, viewer), (roster) => ({ roster }));
	}

	/** Change a member's role, their per-member overrides, their spend envelope, or remove them. */
	static updateMember(
		input: UpdateMemberInput,
		viewer: UserContext,
	): ServiceResult<{ workspace: WorkspaceDetail }> {
		return refresh(updateMemberRow(input), viewer);
	}
	// #endregion

	// #region Roles
	/** Create or edit a CUSTOM role. Presets are read-only — duplicating one is the escape hatch. */
	static upsertRole(
		input: UpsertRoleInput,
		viewer: UserContext,
	): ServiceResult<{ workspace: WorkspaceDetail }> {
		return refresh(upsertRoleDef(input), viewer);
	}

	/** Delete a custom role. Refused while anybody still holds it — nobody is silently demoted. */
	static deleteRole(
		workspaceId: string,
		roleId: string,
		viewer: UserContext,
	): ServiceResult<{ workspace: WorkspaceDetail }> {
		return refresh(deleteRoleDef(workspaceId, roleId), viewer);
	}
	// #endregion

	// #region Money governance
	/** Write a team's split policy. Refused unless the stakes sum to exactly 10 000 basis points. */
	static updatePayout(
		input: UpdatePayoutInput,
		viewer: UserContext,
	): ServiceResult<{ workspace: WorkspaceDetail }> {
		return refresh(updatePayoutPolicy(input), viewer);
	}

	/** Write a business's pooled-wallet governance (envelopes, approvers, the approval threshold). */
	static updateSpend(
		input: UpdateSpendInput,
		viewer: UserContext,
	): ServiceResult<{ workspace: WorkspaceDetail }> {
		return refresh(updateSpendPolicy(input), viewer);
	}

	/** Decide an outstanding spend request; an approval writes an attributable ledger line. */
	static decideSpend(
		workspaceId: string,
		requestId: string,
		approve: boolean,
		viewer: UserContext,
	): ServiceResult<{ workspace: WorkspaceDetail }> {
		return refresh(decideSpendRequest(workspaceId, requestId, approve), viewer);
	}
	// #endregion
}

// #region Envelope mapping
/**
 * Map a fixture {@link Outcome} onto a {@link ServiceResult}, projecting the payload into the shape the
 * method's contract promises. A refusal carries its own status/message/field-errors straight through, so
 * a guard's reasoning reaches the user unaltered rather than being flattened to a generic 400.
 */
function wrap<T, R>(
	outcome: Outcome<T>,
	project: (value: T) => R,
	successStatus = 200,
): ServiceResult<R> {
	if (!outcome.ok) {
		return fail(outcome.status, { message: outcome.message, errors: outcome.errors });
	}
	return ok(project(outcome.data), { status: successStatus, message: outcome.message });
}

/**
 * Map a mutation outcome, re-stamping the session's acting flag onto the refreshed detail — the store
 * holds one canonical projection, and "am I acting as this entity right now?" is a property of the
 * request, not of the entity.
 */
function refresh(
	outcome: Outcome<WorkspaceDetail>,
	viewer: UserContext,
): ServiceResult<{ workspace: WorkspaceDetail }> {
	return wrap(outcome, (detail) => ({ workspace: withViewer(detail, viewer) }));
}
// #endregion
