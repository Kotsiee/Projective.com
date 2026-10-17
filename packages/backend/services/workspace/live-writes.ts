import type {
	ArchiveRoleInput,
	CreateWorkspaceInput,
	InviteActionInput,
	InviteMemberInput,
	RespondInviteInput,
	SplitRuleInput,
	TransferOwnershipInput,
	UpdateMemberInput,
	UpdatePayoutInput,
	UpdateSpendInput,
	UpdateWorkspaceInput,
	UpsertRoleInput,
	WorkspaceDetail,
	WorkspaceKind,
} from "@projective/types/workspace";
import { type EntitlementKey, PLAN_GATE_REASON } from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import {
	badId,
	callRpc,
	clientFor,
	type DbError,
	isUuid,
	type LiveActor,
	refusalFrom,
	sentence,
	splitRefusal,
} from "./live-support.ts";
import { forgetDetails, readDetail } from "./live-detail.ts";

/**
 * live-writes — every console mutation, as the caller, through the definer RPCs.
 *
 * Each function maps the SSOT input onto the RPC's arguments (a PATCH carries only the keys the input
 * sets, because the RPCs read "absent" and "null" differently), forwards the refusal verbatim when the
 * database says no, and otherwise answers with the entity's RE-READ detail — so an island adopts what
 * the database now holds rather than patching its own copy. Every id is checked for shape first, so a
 * malformed reference is a clean 404 rather than a bare `22P02` from Postgres.
 */

// #region Shared

/** The entity's detail after a write — fresh, never the memoised pre-write read. */
function reread(
	kind: WorkspaceKind,
	id: string,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	return readDetail(kind, id, actor, { fresh: true });
}

/**
 * The detail after a write that may have taken the caller OUT of the entity (leaving, transferring and
 * leaving): `null` when the re-read says they are no longer a member, the detail otherwise.
 */
async function rereadOrGone(
	kind: WorkspaceKind,
	id: string,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail | null>> {
	const res = await reread(kind, id, actor);
	if (!res.ok && res.status === 403) return ok(null);
	return res;
}

/** Trimmed text, or `null` when empty. */
function textOrNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : null;
}

// #endregion

// #region Lifecycle

/** The sentence a create gets when its handle was claimed between the probe and the insert. */
export const HANDLE_RACE_REFUSAL = "That handle was claimed a moment ago — pick another.";

/**
 * Map `org.create_workspace`'s refusal onto the result the create form reads. Two refusals are named
 * more precisely than {@link refusalFrom} can, because only this door knows what they mean:
 *
 *   - `23505` — the handle's UNIQUE index fired: somebody claimed it between the form's probe and
 *     this insert. A 409 keyed to `handle`, so the form re-runs its availability check.
 *   - `55000 plan: …` — the caller already owns as many of this kind as their plan includes. A 402
 *     whose `details` name the entitlement (`teams_owned` · `businesses_owned`), the plan gates'
 *     envelope (Decision #230 (e)), so the form can link to the plan rather than parse a sentence.
 *
 * Everything else — the persona and earning gates, a malformed field — is {@link refusalFrom}'s.
 */
export function createRefusal(error: DbError, kind: WorkspaceKind): ServiceResult<never> {
	if (error.code === "23505") {
		return fail(409, { message: HANDLE_RACE_REFUSAL, errors: { handle: HANDLE_RACE_REFUSAL } });
	}
	const parts = splitRefusal(error.message ?? "");
	if (error.code === "55000" && parts?.field === "plan") {
		const entitlement: EntitlementKey = kind === "team" ? "teams_owned" : "businesses_owned";
		return fail(402, {
			message: sentence(parts.reason),
			details: { reason: PLAN_GATE_REASON, entitlement },
		});
	}
	return refusalFrom(error, "create_workspace");
}

/** Create a Draft-First entity; the caller becomes its owner. */
export async function createWorkspace(
	input: CreateWorkspaceInput,
	actor: LiveActor,
): Promise<ServiceResult<{ id: string; kind: WorkspaceKind; handle: string }>> {
	const { data, error } = await clientFor(actor).schema("org").rpc("create_workspace", {
		p_kind: input.kind,
		p_name: input.name,
		p_handle: input.handle,
	});
	if (error) return createRefusal(error, input.kind);
	const created = data as { id: string; kind: WorkspaceKind; handle: string };
	return ok({ id: created.id, kind: created.kind, handle: created.handle }, {
		status: 201,
		message: `${input.kind === "team" ? "Team" : "Business"} created.`,
	});
}

/**
 * Patch identity (name · tagline · directory visibility) and/or lifecycle status, then answer with the
 * fresh detail. A refused archive is a 409 whose `details` name the blocker (`{ reason, blockers }`, see
 * `refusalFrom`), so Settings can say what to clear.
 */
export async function updateWorkspace(
	input: UpdateWorkspaceInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.id)) return badId("id", input.kind);
	const patch: Record<string, unknown> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.tagline !== undefined) patch.headline = input.tagline;
	if (input.visibility !== undefined) patch.visibility = input.visibility;
	if (Object.keys(patch).length > 0) {
		const res = await callRpc(actor, "org", "update_workspace", {
			p_kind: input.kind,
			p_id: input.id,
			p_patch: patch,
		});
		if (!res.ok) return res.refusal;
	}
	if (input.status !== undefined) {
		const res = await callRpc(actor, "org", "set_workspace_status", {
			p_kind: input.kind,
			p_id: input.id,
			p_status: input.status,
		});
		if (!res.ok) {
			// The identity half may already have landed; the refusal is still the answer, but the next
			// read in this request must not serve the pre-write projection.
			forgetDetails(actor);
			return res.refusal;
		}
	}
	return reread(input.kind, input.id, actor);
}

// #endregion

// #region Invitations

/** Invite somebody by handle or email to one of the entity's roles. */
export async function inviteMember(
	input: InviteMemberInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", input.kind);
	if (!isUuid(input.roleId)) return badId("roleId", "role");
	const res = await callRpc(actor, "org", "invite_workspace_member", {
		p_kind: input.kind,
		p_entity: input.workspaceId,
		p_handle: textOrNull(input.handle?.replace(/^@+/, "")),
		p_email: textOrNull(input.email),
		p_role: input.roleId,
		p_note: textOrNull(input.note),
	});
	if (!res.ok) return res.refusal;
	return reread(input.kind, input.workspaceId, actor);
}

/** Revoke or resend a pending invitation this entity sent. */
export async function actOnInvite(
	input: InviteActionInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", input.kind);
	if (!isUuid(input.inviteId)) return badId("inviteId", "invitation");
	const name = input.action === "revoke"
		? "revoke_workspace_invitation"
		: "resend_workspace_invitation";
	const res = await callRpc(actor, "org", name, { p_invitation: input.inviteId });
	if (!res.ok) return res.refusal;
	return reread(input.kind, input.workspaceId, actor);
}

/** Accept or decline an invitation addressed to the caller. */
export async function respondToInvite(
	input: RespondInviteInput,
	actor: LiveActor,
): Promise<
	ServiceResult<
		{ status: "accepted" | "declined"; kind: WorkspaceKind; id: string; handle: string | null }
	>
> {
	if (!isUuid(input.inviteId)) return badId("inviteId", "invitation");
	const res = await callRpc<
		{ status: "accepted" | "declined"; kind: WorkspaceKind; id: string; handle?: string }
	>(
		actor,
		"org",
		"respond_to_workspace_invitation",
		{ p_invitation: input.inviteId, p_accept: input.accept },
	);
	if (!res.ok) return res.refusal;
	forgetDetails(actor);
	return ok({
		status: res.data.status,
		kind: res.data.kind,
		id: res.data.id,
		handle: res.data.handle ?? null,
	}, { message: res.data.status === "accepted" ? "Invitation accepted." : "Invitation declined." });
}

// #endregion

// #region Members

/** The snake_case patch `org.update_workspace_member` reads. Only the keys the input sets travel. */
export function memberPatch(input: UpdateMemberInput): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	if (input.roleId !== undefined) patch.role_id = input.roleId;
	if (input.granted !== undefined) patch.granted = input.granted;
	if (input.revoked !== undefined) patch.revoked = input.revoked;
	if (input.title !== undefined) patch.title = input.title;
	if (input.reportsTo !== undefined) patch.reports_to = input.reportsTo;
	if (input.canSpend !== undefined) patch.can_spend = input.canSpend;
	if (input.spendLimitMinor !== undefined) patch.spend_limit_minor = input.spendLimitMinor;
	if (input.perTransactionMinor !== undefined) {
		patch.per_transaction_minor = input.perTransactionMinor;
	}
	if (input.remove !== undefined) patch.remove = input.remove;
	if (input.confirm !== undefined) patch.confirm = input.confirm;
	if (input.relinquish !== undefined) patch.relinquish = input.relinquish;
	return patch;
}

/** Change a member (or remove them); `null` when the caller removed themselves. */
export async function updateMember(
	input: UpdateMemberInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail | null>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", input.kind);
	if (!isUuid(input.memberId)) return badId("memberId", "member");
	if (input.roleId !== undefined && !isUuid(input.roleId)) return badId("roleId", "role");
	if (input.reportsTo && !isUuid(input.reportsTo)) return badId("reportsTo", "member");
	const res = await callRpc(actor, "org", "update_workspace_member", {
		p_kind: input.kind,
		p_member: input.memberId,
		p_patch: memberPatch(input),
	});
	if (!res.ok) return res.refusal;
	return rereadOrGone(input.kind, input.workspaceId, actor);
}

/** Hand the owner seat to another active member; `null` when the caller left in the same act. */
export async function transferOwnership(
	input: TransferOwnershipInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail | null>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", input.kind);
	if (!isUuid(input.successorMemberId)) return badId("successorMemberId", "member");
	const res = await callRpc(actor, "org", "transfer_workspace_ownership", {
		p_kind: input.kind,
		p_entity: input.workspaceId,
		p_successor: input.successorMemberId,
		p_leave: input.leave ?? false,
	});
	if (!res.ok) return res.refusal;
	return rereadOrGone(input.kind, input.workspaceId, actor);
}

// #endregion

// #region Roles

/** Create (no `roleId`) or edit a custom role. */
export async function upsertRole(
	input: UpsertRoleInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", input.kind);
	if (input.roleId !== undefined && !isUuid(input.roleId)) return badId("roleId", "role");
	const res = await callRpc(actor, "org", "upsert_workspace_role", {
		p_kind: input.kind,
		p_entity: input.workspaceId,
		p_role: input.roleId ?? null,
		p_name: input.name,
		p_summary: input.summary ?? "",
		p_capabilities: input.capabilities,
		p_base_preset: input.basePreset ?? "member",
	});
	if (!res.ok) return res.refusal;
	return reread(input.kind, input.workspaceId, actor);
}

/** Retire a custom role (archived, never deleted). */
export async function archiveRole(
	input: ArchiveRoleInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", input.kind);
	if (!isUuid(input.roleId)) return badId("roleId", "role");
	const res = await callRpc(actor, "org", "archive_workspace_role", {
		p_kind: input.kind,
		p_entity: input.workspaceId,
		p_role: input.roleId,
	});
	if (!res.ok) return res.refusal;
	return reread(input.kind, input.workspaceId, actor);
}

// #endregion

// #region Money governance

/**
 * The arguments `finance.save_split_rule` takes for a template. A finder travels only under
 * `finders_fee`; `benevolent_dictator` sends 10 000 bp, the vault cut the RPC stores for it.
 */
export function splitRuleArgs(teamId: string, rule: SplitRuleInput): Record<string, unknown> {
	switch (rule.ruleType) {
		case "finders_fee":
			return {
				p_team_id: teamId,
				p_rule_type: rule.ruleType,
				p_vault_bp: rule.vaultBp,
				p_finder_user_id: rule.finderUserId,
				p_finder_bp: rule.finderBp,
			};
		case "benevolent_dictator":
			return { p_team_id: teamId, p_rule_type: rule.ruleType, p_vault_bp: 10_000 };
		case "co_op":
			return { p_team_id: teamId, p_rule_type: rule.ruleType, p_vault_bp: rule.vaultBp };
	}
}

/**
 * Write a team's split — its template, its stakes, or both. The template goes first, then the stakes
 * (the release plan reads both); each RPC is its own transaction, so a stakes refusal after a saved
 * template leaves the template saved, and the refusal is what returns. The stakes RPC refuses anything
 * that does not total exactly 10 000 bp.
 */
export async function saveSplit(
	input: UpdatePayoutInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", "team");
	if (input.stakes?.some((s) => !isUuid(s.memberId))) return badId("stakes", "member");
	if (input.rule?.ruleType === "finders_fee" && !isUuid(input.rule.finderUserId)) {
		return badId("finderUserId", "member");
	}
	if (input.rule) {
		const res = await callRpc(
			actor,
			"finance",
			"save_split_rule",
			splitRuleArgs(input.workspaceId, input.rule),
		);
		if (!res.ok) return res.refusal;
	}
	if (input.stakes) {
		const res = await callRpc(actor, "finance", "save_team_split", {
			p_team_id: input.workspaceId,
			p_stakes: input.stakes.map((s) => ({
				member_id: s.memberId,
				share_bp: s.shareBp,
				held: s.held ?? false,
			})),
		});
		if (!res.ok) return res.refusal;
	}
	return reread("team", input.workspaceId, actor);
}

/** The snake_case patch `finance.save_spend_policy` reads. Only the keys the input sets travel. */
export function spendPatch(input: UpdateSpendInput): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	if (input.currency !== undefined) patch.currency = input.currency;
	if (input.approvalThresholdMinor !== undefined) {
		patch.approval_threshold_minor = input.approvalThresholdMinor;
	}
	if (input.approverIds !== undefined) patch.approver_ids = input.approverIds;
	if (input.contributorIds !== undefined) patch.contributor_ids = input.contributorIds;
	if (input.limits !== undefined) {
		patch.limits = input.limits.map((l) => ({
			member_id: l.memberId,
			can_spend: l.canSpend,
			limit_minor: l.limitMinor,
			per_transaction_minor: l.perTransactionMinor,
		}));
	}
	return patch;
}

/** Write a business's spend policy. */
export async function saveSpendPolicy(
	input: UpdateSpendInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", "business");
	const ids = [
		...(input.approverIds ?? []),
		...(input.contributorIds ?? []),
		...(input.limits ?? []).map((l) => l.memberId),
	];
	if (ids.some((id) => !isUuid(id))) return badId("limits", "member");
	const res = await callRpc(actor, "finance", "save_spend_policy", {
		p_business_id: input.workspaceId,
		p_patch: spendPatch(input),
	});
	if (!res.ok) return res.refusal;
	return reread("business", input.workspaceId, actor);
}

/** Approve or decline an outstanding spend request against a business's pooled wallet. */
export async function decideSpend(
	input: { workspaceId: string; requestId: string; approve: boolean },
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", "business");
	if (!isUuid(input.requestId)) return badId("requestId", "request");
	const res = await callRpc(actor, "finance", "decide_spend_approval", {
		p_approval: input.requestId,
		p_decision: input.approve ? "approve" : "reject",
	});
	if (!res.ok) return res.refusal;
	return reread("business", input.workspaceId, actor);
}

// #endregion
