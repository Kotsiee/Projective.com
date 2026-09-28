import type {
	ArchiveRoleInput,
	CreateWorkspaceInput,
	HandleCheck,
	InviteActionInput,
	InviteMemberInput,
	RespondInviteInput,
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
import { ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { callRpc, isLive, type LiveActor, signedOut, unavailable } from "./live-support.ts";
import { readRoster } from "./live-roster.ts";
import { readDetail } from "./live-detail.ts";
import * as writes from "./live-writes.ts";

/**
 * WorkspaceBackendService — the FAT half of the multi-member entity console (`/teams`, `/businesses`),
 * per the thin-routes / fat-services contract (root CLAUDE.md §2). It owns the roster read, one
 * entity's full console projection, and every mutation (create · invite · membership · ownership ·
 * roles · payout split · spend governance), each returning a transport-agnostic {@link ServiceResult}.
 * Thin routes under `apps/web/routes/api/workspace/*` parse + Zod-validate + delegate here; the console
 * pages call it directly for SSR. Islands never reach it.
 *
 * **Live-only.** Like the profile (Decision #119) there is no fixture branch: every read and write is
 * one of the definer RPCs in `00001020_functions_org_entities.sql` §6–§16 and
 * `00001210_functions_finance_kyc_wallet.sql` §13, made under the CALLER's session, so the database
 * decides membership and authority and this layer only forwards and maps. A guest is `401`; a database
 * that cannot be reached is `503` — never a stand-in console that looks real and is not.
 *
 * **One architecture, two kinds.** A team is a freelancer with multiple members, a business is a
 * client with multiple members; every method takes {@link WorkspaceKind} and the difference is a
 * capability table in the SSOT, never a forked service.
 *
 * **Every write answers with the RE-READ detail** (`org.get_workspace_detail` by id, bypassing the
 * render memo), so an island adopts the server's state — role counts, effective capabilities, the
 * split's 100% invariant, the checklist — rather than patching its own copy. **All money is
 * server-formatted** `MoneyView`s; the client never totals, splits or converts (Decision #55).
 */
export class WorkspaceBackendService {
	// #region Reads

	/** Every entity of a kind the caller belongs to, the invitations awaiting them, and their create allowance. */
	static roster(kind: WorkspaceKind, actor: ReadActor): Promise<ServiceResult<WorkspaceRoster>> {
		return guarded("roster", actor, async (live) => {
			const res = await readRoster(kind, live);
			return res.ok ? ok(res.data) : res.refusal;
		});
	}

	/**
	 * One entity's full console projection, addressed by handle or row id. `404` when no entity of the
	 * kind holds the reference, `403` when the caller is not an active member.
	 */
	static detail(
		kind: WorkspaceKind,
		handleOrId: string,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("detail", actor, (live) => readDetail(kind, handleOrId, live));
	}

	/** Probe a handle's availability across the one namespace people and entities share. */
	static checkHandle(handle: string, actor: ReadActor): Promise<ServiceResult<HandleCheck>> {
		return guarded("check-handle", actor, async (live) => {
			const res = await callRpc<{ handle: string; available: boolean; reason: string | null }>(
				live,
				"org",
				"check_handle",
				{ p_handle: handle },
			);
			if (!res.ok) return res.refusal;
			return ok({
				handle: res.data.handle.slice(0, 40),
				available: res.data.available,
				reason: res.data.reason ? res.data.reason.slice(0, 160) : null,
				suggestions: [],
			});
		});
	}

	// #endregion

	// #region Lifecycle

	/** Create a Draft-First entity from name + handle alone, with the caller as its owner (`201`). */
	static create(
		input: CreateWorkspaceInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ id: string; kind: WorkspaceKind; handle: string }>> {
		return guarded("create", actor, (live) => writes.createWorkspace(input, live));
	}

	/** Patch identity (name · tagline) through `update_workspace`, lifecycle through `set_workspace_status`. */
	static update(
		input: UpdateWorkspaceInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("update", actor, (live) => writes.updateWorkspace(input, live));
	}

	// #endregion

	// #region Membership

	/** Invite somebody by handle or email, at a role the inviter holds the authority to hand out. */
	static invite(
		input: InviteMemberInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("invite", actor, (live) => writes.inviteMember(input, live));
	}

	/** Revoke or resend a pending invitation (the inviting side's two queue actions). */
	static inviteAction(
		input: InviteActionInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("invite-action", actor, (live) => writes.actOnInvite(input, live));
	}

	/** Accept or decline an invitation addressed to the caller. */
	static respondInvite(
		input: RespondInviteInput,
		actor: ReadActor,
	): Promise<
		ServiceResult<
			{ status: "accepted" | "declined"; kind: WorkspaceKind; id: string; handle: string | null }
		>
	> {
		return guarded("invite-respond", actor, (live) => writes.respondToInvite(input, live));
	}

	/** Change a member's role, overrides, title, org-chart edge or spend envelope, or remove them. `null` when the caller left. */
	static updateMember(
		input: UpdateMemberInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail | null>> {
		return guarded("member", actor, (live) => writes.updateMember(input, live));
	}

	/** Hand the owner seat to another active member in one act. `null` when the caller left in the same act. */
	static transferOwnership(
		input: TransferOwnershipInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail | null>> {
		return guarded("transfer", actor, (live) => writes.transferOwnership(input, live));
	}

	// #endregion

	// #region Roles

	/** Create or edit a CUSTOM role. Presets are read-only — duplicating one is the escape hatch. */
	static upsertRole(
		input: UpsertRoleInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("role", actor, (live) => writes.upsertRole(input, live));
	}

	/** Retire a custom role (archived, never deleted). Refused while anybody holds or is offered it. */
	static archiveRole(
		input: ArchiveRoleInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("role-archive", actor, (live) => writes.archiveRole(input, live));
	}

	// #endregion

	// #region Money governance

	/** Replace a team's split. Refused unless the active members' stakes total exactly 10 000 bp. */
	static updatePayout(
		input: UpdatePayoutInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("payout", actor, (live) => writes.saveSplit(input, live));
	}

	/** Write a business's pooled-wallet governance (threshold, approvers, contributors, envelopes). */
	static updateSpend(
		input: UpdateSpendInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("spend", actor, (live) => writes.saveSpendPolicy(input, live));
	}

	/** Approve or decline an outstanding spend request. */
	static decideSpend(
		input: { workspaceId: string; requestId: string; approve: boolean },
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("spend-decide", actor, (live) => writes.decideSpend(input, live));
	}

	// #endregion
}

// #region Guard

/**
 * Refuse a guest, then run a live call — turning a transport failure (an unreachable database, a
 * thrown read) into a logged `503` rather than a thrown request.
 */
async function guarded<T>(
	label: string,
	actor: ReadActor,
	run: (actor: LiveActor) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
	if (!isLive(actor)) return signedOut();
	try {
		return await run(actor);
	} catch (error) {
		console.error(`[workspace:${label}]`, error instanceof Error ? error.message : error);
		return unavailable();
	}
}

// #endregion
