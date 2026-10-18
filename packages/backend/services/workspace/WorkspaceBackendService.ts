import type {
	ArchiveRoleInput,
	BusinessBench,
	CreateWorkspaceInput,
	HandleCheck,
	InviteActionInput,
	InviteMemberInput,
	PayoutPreviewQuery,
	RespondInviteInput,
	SpendEnvelopePreview,
	TeamSplitPreview,
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
import { isLive, type LiveActor, signedOut, unavailable } from "./live-support.ts";
import { readRoster } from "./live-roster.ts";
import { checkHandle } from "./live-handle.ts";
import { readDetail } from "./live-detail.ts";
import { readBench } from "./live-bench.ts";
import { previewSpendEnvelope, previewTeamSplit } from "./live-money.ts";
import * as writes from "./live-writes.ts";
import { reembedInBackground } from "../search/embedding-sync.ts";

/**
 * WorkspaceBackendService — the FAT half of the multi-member entity console (`/teams`, `/businesses`),
 * per the thin-routes / fat-services contract (root CLAUDE.md §2). It owns the roster read, one
 * entity's full console projection, and every mutation (create · invite · membership · ownership ·
 * roles · payout split · spend governance), each returning a transport-agnostic {@link ServiceResult}.
 * Thin routes under `apps/web/routes/api/workspace/*` parse + Zod-validate + delegate here; the console
 * pages call it directly for SSR. Islands never reach it.
 *
 * **Live-only.** Like the profile (Decision #119) there is no fixture branch: every read and write is
 * one of the definer RPCs in `00001020_functions_org_entities.sql` §6–§17 and
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

	/**
	 * A business's bench — the freelancers and teams it has hired (the Talent module, Decision
	 * #230 (i)), addressed by handle or row id. ONE RPC. `404` when no business holds the reference,
	 * `403` when the caller is not a member holding `hire`.
	 */
	static bench(handleOrId: string, actor: ReadActor): Promise<ServiceResult<BusinessBench>> {
		return guarded("bench", actor, (live) => readBench(handleOrId, live));
	}

	/**
	 * Probe a handle's availability across the one namespace people and entities share. A TAKEN handle
	 * is answered with up to three alternatives the namespace says are free (`live-handle.ts`).
	 */
	static checkHandle(handle: string, actor: ReadActor): Promise<ServiceResult<HandleCheck>> {
		return guarded("check-handle", actor, (live) => checkHandle(handle, live));
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

	/**
	 * Patch identity (name · tagline) through `update_workspace`, lifecycle through `set_workspace_status`.
	 * A committed change refreshes the entity's discovery vector in the background (Decision #179).
	 */
	static update(
		input: UpdateWorkspaceInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("update", actor, async (live) => {
			const res = await writes.updateWorkspace(input, live);
			if (res.ok && res.data) reembedInBackground([res.data.handle], "a workspace update");
			return res;
		});
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

	/**
	 * Write a team's split — its template (`finance.save_split_rule`), then its stakes
	 * (`finance.save_team_split`, refused unless the active members' stakes total exactly 10 000 bp) —
	 * and answer with the re-read detail.
	 */
	static updatePayout(
		input: UpdatePayoutInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("payout", actor, (live) => writes.saveSplit(input, live));
	}

	/**
	 * What a release of the reader's chosen size would pay under the team's SAVED split
	 * (`finance.preview_team_split(team, gross)` — read-only, the plan the release runs), so the Payouts
	 * module's Preview lists every cut from the server and never splits money on the client. Nothing is
	 * written. The database answers only a `manage_finances` holder (Decision #233 (b)); anyone else is
	 * refused `403`.
	 */
	static previewPayout(
		query: PayoutPreviewQuery,
		actor: ReadActor,
	): Promise<ServiceResult<TeamSplitPreview>> {
		return guarded("payout-preview", actor, (live) => previewTeamSplit(query, live));
	}

	/** Write a business's pooled-wallet governance (threshold, approvers, contributors, envelopes). */
	static updateSpend(
		input: UpdateSpendInput,
		actor: ReadActor,
	): Promise<ServiceResult<WorkspaceDetail>> {
		return guarded("spend", actor, (live) => writes.saveSpendPolicy(input, live));
	}

	/**
	 * The envelopes a DRAFT spend-policy patch would produce (`finance.preview_spend_envelope` —
	 * read-only, `manage_finances`), so the editor renders a draft ceiling against its own figures, never
	 * against the stored ones it is about to replace. Nothing is written.
	 */
	static previewSpend(
		input: UpdateSpendInput,
		actor: ReadActor,
	): Promise<ServiceResult<SpendEnvelopePreview>> {
		return guarded("spend-preview", actor, (live) => previewSpendEnvelope(input, live));
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
