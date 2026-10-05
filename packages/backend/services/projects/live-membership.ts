import type { ReadActor } from "../read-actor.ts";
import { plainTextToHtml } from "@projective/types/richtext";
import { projectsDb, resolveProjectRef, UUID_RE } from "./live-support.ts";
import { fetchInvitations } from "./live-members.ts";
import { inviteRefusalFrom, resolveHandle, stageNameMap } from "./live-invites.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "./live-writes.ts";
import type {
	AssignableMemberRole,
	CreateStageInput,
	MemberInvite,
} from "@projective/types/projects";

/**
 * live-membership — the RLS-scoped Postgres WRITE path behind three surface actions that used to be
 * client stubs: "Create stage" (Board · Timeline · the lane's Stages group), the Members tab's
 * "Invite people", and its "Change role".
 *
 * ## Which door each write takes
 *
 * - **Create stage** → `projects.create_stage`, the RPC the setup save already uses: it appends after
 *   the last `sort_order`, takes the column defaults (`status = 'open'`), and opens the stage's General
 *   room in the same transaction — a stage inserted without it would be missing from the channel
 *   tree. Its own owner check is the gate (a refusal maps to 403 through `refusalFrom`).
 * - **Invite by `@handle`** → `projects.invite_to_project`: identity-addressed, the 48-day decline
 *   cooldown and the `stage.invite` notification in one transaction (Decision #109/#113).
 * - **Invite by email** → `projects.invite_by_email` (00001135): the row stays email-addressed so the
 *   inviter cannot learn whose account owns the address; a VERIFIED holder is notified.
 * - **Change role** → `projects.set_member_role` (00001135): review authority, the stored vocabulary
 *   the invitation acceptance writes, `security.audit_logs` in the same transaction.
 *
 * Like every live write module here: throws on a genuine query failure (the fat service answers 502,
 * never a stub fallback) and returns `null` when the subject did not resolve for this caller.
 */

type LiveActor = ReadActor & { accessToken: string };

interface ProjectKeyRow {
	id: string;
	slug: string;
}
const PROJECT_KEY_COLUMNS = "id, slug";

async function resolveProject(actor: LiveActor, slug: string): Promise<ProjectKeyRow | null> {
	return await resolveProjectRef<ProjectKeyRow>(projectsDb(actor), PROJECT_KEY_COLUMNS, slug);
}

// #region Create stage
/** The stage a {@link createStageRow} minted: its uuid, so the caller can re-read it as the board projects it. */
export interface MintedStage {
	stageId: string;
}

/** Append one stage through `projects.create_stage`. */
export async function createStageRow(
	actor: LiveActor,
	slug: string,
	input: CreateStageInput,
): Promise<WriteOutcome<MintedStage>> {
	const project = await resolveProject(actor, slug);
	if (!project) return null;
	const text = input.description.trim();
	const { data, error } = await projectsDb(actor).rpc("create_stage", {
		p_project_id: project.id,
		p_name: input.name.trim(),
		// The rich-text column's shape (`{ html }`) and its flattened twin, as the setup save writes them.
		p_description: { html: text ? plainTextToHtml(text) : "" },
		p_description_text: text,
	});
	if (error) return { refusal: refusalFrom(error.message, "name") };
	const stageId = typeof data === "string" ? data : null;
	if (!stageId) return { refusal: refusalFrom("create_stage returned no id", "name") };
	return { data: { stageId } };
}
// #endregion

// #region Invite people
/** The project an invite batch addresses, resolved once for every address in it. */
export interface InviteTarget {
	projectId: string;
}

/** Resolve the routed project for an invite batch, or `null` when this caller cannot see it. */
export async function resolveInviteTarget(
	actor: LiveActor,
	slug: string,
): Promise<InviteTarget | null> {
	const project = await resolveProject(actor, slug);
	return project ? { projectId: project.id } : null;
}

/**
 * Issue ONE invitation — by `@handle` through `invite_to_project`, by email through
 * `invite_by_email`. Returns the new invitation id, or the database's own refusal.
 */
export async function issueInvitation(
	actor: LiveActor,
	target: InviteTarget,
	address: string,
	role: AssignableMemberRole,
	stageId: string | null,
): Promise<{ data: string } | { refusal: WriteRefusal }> {
	if (stageId !== null && !UUID_RE.test(stageId)) {
		return {
			refusal: {
				status: 422,
				message: "That stage is not part of this project.",
				errors: { stageId: "unknown_stage" },
			},
		};
	}
	const db = projectsDb(actor);

	if (address.startsWith("@")) {
		const userId = await resolveHandle(actor, address);
		if (!userId) {
			return {
				refusal: {
					status: 404,
					message: `No profile found for "${address}".`,
					errors: { addresses: "unknown_handle" },
				},
			};
		}
		const { data, error } = await db.rpc("invite_to_project", {
			p_project_id: target.projectId,
			p_stage_id: stageId,
			p_target_user_id: userId,
			p_role: role,
			p_message: "",
			p_offer_price_cents: null,
			p_answers: {},
		});
		if (error) return { refusal: inviteRefusalFrom(error.message, error.details) };
		return typeof data === "string" && data
			? { data }
			: { refusal: refusalFrom("invite_to_project returned no id", "addresses") };
	}

	const { data, error } = await db.rpc("invite_by_email", {
		p_project_id: target.projectId,
		p_stage_id: stageId,
		p_email: address,
		p_role: role,
	});
	if (error) {
		if (error.message.includes("valid email address")) {
			return {
				refusal: {
					status: 422,
					message: "Enter a valid email address.",
					errors: { addresses: "invalid" },
				},
			};
		}
		return { refusal: inviteRefusalFrom(error.message, error.details) };
	}
	return typeof data === "string" && data
		? { data }
		: { refusal: refusalFrom("invite_by_email returned no id", "addresses") };
}

/**
 * Re-read the queue and return the rows a batch issued, labelled by the roster's own reader — so the
 * Invitations section renders exactly what a reload will.
 */
export async function readIssuedInvitations(
	actor: LiveActor,
	target: InviteTarget,
	ids: readonly string[],
): Promise<MemberInvite[]> {
	if (ids.length === 0) return [];
	const db = projectsDb(actor);
	const names = await stageNameMap(db, target.projectId);
	const queue = await fetchInvitations(actor, db, target.projectId, names, Date.now(), new Map());
	const mine = new Set(ids);
	return queue.filter((invite) => mine.has(invite.id));
}
// #endregion

// #region Change role
/** What `projects.set_member_role` returns. */
interface RoleRpcRow {
	participant_id: string;
	role: AssignableMemberRole;
	changed: boolean;
}

/**
 * The database's role-change refusals, each a rule the caller can read and act on rather than a fault
 * to retry. The ownership refusal is not here: `refusalFrom` answers it as a 403.
 */
const ROLE_RULES = [
	"cannot change your own role",
	"has no role to change",
	"roles can no longer change",
	"not a role a member can hold",
	"not part of this project",
];

/** Change one participant's role through `projects.set_member_role`. */
export async function setMemberRoleRow(
	actor: LiveActor,
	slug: string,
	memberId: string,
	role: AssignableMemberRole,
): Promise<WriteOutcome<RoleRpcRow>> {
	// The owner seat is projected from `projects.owner_user_id` (`owner:<uuid>`), not a participant row.
	if (memberId.startsWith("owner:")) {
		return {
			refusal: {
				status: 409,
				message: "The project owner's role cannot change.",
				errors: { memberId: "owner" },
			},
		};
	}
	if (!UUID_RE.test(memberId)) return null;
	const project = await resolveProject(actor, slug);
	if (!project) return null;
	const { data, error } = await projectsDb(actor).rpc("set_member_role", {
		p_project_id: project.id,
		p_participant_id: memberId,
		p_role: role,
	});
	if (error) {
		const rule = ROLE_RULES.find((sentence) => error.message.includes(sentence));
		if (rule) {
			return {
				refusal: {
					status: 422,
					message: error.message.replace(/^ERROR:\s*/i, "").trim(),
					errors: { role: "not_allowed" },
				},
			};
		}
		return { refusal: refusalFrom(error.message, "role") };
	}
	const row = data as RoleRpcRow | null;
	if (!row?.participant_id) {
		return { refusal: refusalFrom("set_member_role returned nothing", "role") };
	}
	return { data: row };
}
// #endregion
