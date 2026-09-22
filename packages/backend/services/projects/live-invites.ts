import type { SupabaseClient } from "supabaseClient";
import type { ReadActor } from "../read-actor.ts";
import { getServiceClient } from "../../core/supabase.ts";
import { clamp, clampOr, orgDb, projectsDb, resolveProjectRef, UUID_RE } from "./live-support.ts";
import { fetchInvitations } from "./live-members.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "./live-writes.ts";
import type {
	HireInvitation,
	HireOffer,
	InviteActionInput,
	InviteDecisionInput,
	MemberInvite,
	RemovalImpact,
	RemoveMemberInput,
	RemoveMemberResult,
	SentInvitesPage,
} from "@projective/types/projects";

/**
 * live-invites — the RLS-scoped Postgres WRITE path behind a project's invitations and the removal
 * that undoes an acceptance: `ProjectBackendService.hire` (the live INSERT), `inviteAction`
 * (cancel · dismiss), `decideInvite` (the forced answer, development only), `removeMember`, and the
 * `sentInvites` read the Dev Tools Invites window lists.
 *
 * ## Which door each write takes, and why
 *
 * - **Issuing** an invitation goes through `projects.invite_to_project`, a DEFINER RPC, because the
 *   row and the `stage.invite` notification that announces it have to land in ONE transaction and
 *   `comms.fn_notify` is reachable only from a definer context (00002510 grants it to `service_role`
 *   alone). The RPC checks project ownership itself and DERIVES `placeholder`, so nothing this module
 *   sends can mark a live project's invitation as unpriced.
 * - **Cancel** and **dismiss** are plain UPDATEs under the caller's own RLS (`Owner manages
 *   invitations`, FOR ALL). Under RLS an UPDATE whose `USING` arm matches nothing affects ZERO rows
 *   and raises NOTHING, so every write here selects its id back and treats an empty result as a
 *   refusal rather than a success — the `notWritten` rule of `live-writes.ts`.
 * - **A forced decision** calls `projects.fn_apply_invitation_decision` through the SERVICE-ROLE
 *   client — the ONE implementation of an acceptance, the same body the invitee's own
 *   `respond_to_project_invitation` runs. It has no client grant on purpose (a caller-supplied actor
 *   is a forgery primitive), which is why the service role is the door; the fat service gates the
 *   whole path on `DENO_ENV=development` and on the caller OWNING the invitation, and this module
 *   re-reads the row under the caller's RLS before it lets the service role near it.
 * - **Removal** calls `projects.remove_project_member` under the caller's client: the RPC checks
 *   ownership, applies `PRODUCT_SPEC.md` §Freelancer Removal Mid-Ticket (escrow to the freelancer,
 *   tickets back to New), releases the assignments, retires the accepted invitations it undoes, and
 *   deletes the participant row on a whole-project removal.
 *
 * Every function throws on a genuine query failure (the fat service turns that into a 502 rather
 * than falling back to the stub, because a write that silently landed in memory is worse than one
 * that reported failure) and returns `null` when the subject did not resolve for this caller.
 */

// #region Row shapes

/** The `projects.projects` columns an invitation write resolves the project by. */
interface ProjectKeyRow {
	id: string;
	slug: string;
	title: string;
	status: string;
	currency: string | null;
}
const PROJECT_KEY_COLUMNS = "id, slug, title, status, currency";

/** One `projects.project_invitations` row as the ownership pre-check reads it. */
interface InviteKeyRow {
	id: string;
	project_id: string;
	project_stage_id: string | null;
	target_user_id: string | null;
	inviter_user_id: string;
	status: string;
	dismissed_at: string | null;
}
const INVITE_KEY_COLUMNS =
	"id, project_id, project_stage_id, target_user_id, inviter_user_id, status, dismissed_at";

/** What `projects.remove_project_member` returns. */
interface RemoveMemberRpcRow {
	participant_id: string;
	removed_from: "project" | "stage";
	claimed_tickets: number;
	submitted_tickets: number;
	started_stages: number;
}

// #endregion

// #region Shared resolution

/** The project a route slug names, or `null` when this caller cannot see one. */
async function resolveProject(
	actor: ReadActor & { accessToken: string },
	slug: string,
): Promise<ProjectKeyRow | null> {
	return await resolveProjectRef<ProjectKeyRow>(projectsDb(actor), PROJECT_KEY_COLUMNS, slug);
}

/**
 * The invitation row, read under the caller's OWN RLS — so a row that comes back is one the caller
 * may manage (the owner arm) or was addressed (the invitee arm). `null` for anything else, which the
 * caller reports as a plain miss: a stranger learns nothing from the difference.
 */
async function resolveInvite(
	actor: ReadActor & { accessToken: string },
	projectId: string,
	inviteId: string,
): Promise<InviteKeyRow | null> {
	if (!UUID_RE.test(inviteId)) return null;
	const { data, error } = await projectsDb(actor)
		.from("project_invitations")
		.select(INVITE_KEY_COLUMNS)
		.eq("id", inviteId)
		.eq("project_id", projectId)
		.maybeSingle();
	if (error) throw new Error(`projects.project_invitations read failed: ${error.message}`);
	return (data as unknown as InviteKeyRow | null) ?? null;
}

/**
 * The user id behind a seller's `@handle`.
 *
 * `org.users_public` is readable by any signed-in user ("Any authenticated user can view public
 * profiles"), so the lookup runs under the caller's own client. Compared lowercase against a
 * lowercase column value: every handle the join wizard writes is lowercase, and the `ilike` route
 * would treat `_` — a legal handle character — as a wildcard.
 */
async function resolveHandle(
	actor: ReadActor & { accessToken: string },
	handle: string,
): Promise<string | null> {
	const bare = handle.replace(/^@+/, "").trim().toLowerCase();
	if (!bare) return null;
	const { data, error } = await orgDb(actor)
		.from("users_public")
		.select("user_id, username")
		.in("username", [bare, handle.replace(/^@+/, "").trim()])
		.limit(2);
	if (error) throw new Error(`org.users_public read failed: ${error.message}`);
	const rows = (data ?? []) as { user_id: string; username: string }[];
	const exact = rows.find((row) => row.username === bare) ?? rows[0];
	return exact?.user_id ?? null;
}

/** The refusal an RLS-filtered write deserves — see the module docblock. */
function notWritten(field: string): WriteRefusal {
	return {
		status: 403,
		message: "You cannot make that change.",
		errors: { [field]: "not_permitted" },
	};
}

// #endregion

// #region Issue

/**
 * Record a client's invitation(s) to one seller — one row per selected stage, or one whole-project
 * row for a task-priced engagement — through `projects.invite_to_project`.
 *
 * `offer` is the RESOLVED offer (`resolveHireOffer`) and decides WHICH rows are issued (one per
 * selected stage, or one whole-project row); the figure each row RECORDS is the caller's own stated
 * price from `input`, `null` when the invitation is at the project's configured terms — the column
 * comment is explicit that a stated figure and an absent one are different claims, and the RPC
 * derives `placeholder` from the configured rate itself. The RPC refuses the 48-day cooldown and a
 * duplicate open seat in the database's own words, which are passed through as a 409/422 rather than
 * rewritten.
 *
 * The rows are issued in SEQUENCE, not in parallel, so a refusal on the second stage leaves exactly
 * the first recorded — a partial success the caller reports as such — instead of a race that may
 * have landed any subset. Then the queue is re-read so the invitations returned carry the labels the
 * roster's own reader produces, rather than a second rendering of them assembled here.
 */
export async function insertInvitations(
	actor: ReadActor & { accessToken: string },
	input: HireInvitation,
	offer: HireOffer,
	nowMs: number = Date.now(),
): Promise<WriteOutcome<MemberInvite[]>> {
	const project = await resolveProject(actor, input.projectId);
	if (!project) return null;
	const targetUserId = await resolveHandle(actor, input.handle);
	if (!targetUserId) {
		return {
			refusal: {
				status: 404,
				message: `No profile found for "@${input.handle.replace(/^@+/, "")}".`,
			},
		};
	}

	const db = projectsDb(actor);
	const stated = new Map(input.stages.map((line) => [line.stageId, line.priceCents]));
	const targets: Array<{ stageId: string | null; priceCents: number | null }> =
		offer.stages.length > 0
			? offer.stages.map((line) => ({
				stageId: line.stageId,
				priceCents: stated.get(line.stageId) ?? null,
			}))
			: [{ stageId: null, priceCents: input.taskPriceCents }];

	const issued: string[] = [];
	for (const target of targets) {
		if (target.stageId !== null && !UUID_RE.test(target.stageId)) {
			return { refusal: refusalFrom("That stage is not part of this project.", "stages") };
		}
		const { data, error } = await db.rpc("invite_to_project", {
			p_project_id: project.id,
			p_stage_id: target.stageId,
			p_target_user_id: targetUserId,
			p_role: "freelancer",
			p_message: input.message,
			p_offer_price_cents: target.priceCents,
			p_answers: input.answers,
		});
		if (error) return { refusal: inviteRefusalFrom(error.message) };
		if (typeof data === "string" && data) issued.push(data);
	}

	const stageNames = await stageNameMap(db, project.id);
	const queue = await fetchInvitations(actor, db, project.id, stageNames, nowMs, new Map());
	const mine = new Set(issued);
	const rows = queue.filter((invite) => mine.has(invite.id));
	// A row issued and then not re-read (a read refused between the two statements) is still real;
	// it is reported by id so the caller can say how many landed rather than pretending none did.
	if (rows.length === issued.length) return { data: rows };
	return { data: rows.length > 0 ? rows : issued.map((id) => placeholderRow(id, input, nowMs)) };
}

/**
 * Map an `invite_to_project` failure onto the envelope, keeping the database's own sentences.
 *
 * The RPC raises its refusals with messages written for a reader — the cooldown date, the duplicate
 * seat, the closed project — and each carries a distinct code the client can pin to a control. A
 * `unique_violation` is a 409; a `check_violation` (cooldown · closed · foreign stage) is a 422; an
 * ownership refusal falls through to `refusalFrom`'s 403.
 */
function inviteRefusalFrom(message: string): WriteRefusal {
	if (
		message.includes("already pending") || message.includes("already assigned") ||
		message.includes("already on the project")
	) {
		return { status: 409, message: stripPostgresPrefix(message), errors: { stages: "duplicate" } };
	}
	if (message.includes("invite this freelancer to this project again after")) {
		return {
			status: 422,
			message: stripPostgresPrefix(message),
			errors: { projectId: "cooldown" },
		};
	}
	if (message.includes("not part of this project")) {
		return {
			status: 422,
			message: stripPostgresPrefix(message),
			errors: { stages: "unknown_stage" },
		};
	}
	if (
		message.includes("closed") || message.includes("already on this project") ||
		message.includes("not a role an invitation")
	) {
		return { status: 422, message: stripPostgresPrefix(message), errors: { projectId: "refused" } };
	}
	return refusalFrom(message, "projectId");
}

/** PostgREST wraps a raised message in nothing today, but `RAISE` text can arrive with a prefix. */
function stripPostgresPrefix(message: string): string {
	return message.replace(/^ERROR:\s*/i, "").trim();
}

/** The stage name per stage id — the label an invitation row prints beside its stage. */
async function stageNameMap(db: SupabaseClient, projectId: string): Promise<Map<string, string>> {
	const { data, error } = await db
		.from("project_stages")
		.select("id, name")
		.eq("project_id", projectId);
	if (error) return new Map();
	return new Map(
		((data ?? []) as { id: string; name: string | null }[]).map((
			row,
		) => [row.id, clampOr(row.name, 120, "Untitled stage")]),
	);
}

/**
 * The invitation as this write knows it, for the rare case the queue could not be re-read after the
 * RPC committed. Every field the client typed is here; the labels the roster reader would have added
 * ("2 days ago", the stage name) are approximated from the input alone.
 */
function placeholderRow(id: string, input: HireInvitation, nowMs: number): MemberInvite {
	const handle = `@${input.handle.replace(/^@+/, "")}`;
	return {
		id,
		email: handle,
		handle,
		role: "freelancer",
		stageId: null,
		stageName: null,
		invitedBy: "You",
		invitedAt: new Date(nowMs).toISOString(),
		invitedLabel: "Just now",
		status: "pending",
	};
}

// #endregion

// #region Cancel · dismiss

/**
 * Cancel a pending offer (`status → revoked`) or dismiss an answered/lapsed record (`dismissed_at`).
 *
 * The status the row is in decides which write is legal, and the WHERE clause restates it so a
 * stale client — one that rendered "Dismiss" on a row the invitee has since accepted — updates zero
 * rows and is told so, instead of hiding a member's record. A revoked pending offer is the client
 * withdrawing before an answer; nothing about it starts a cooldown.
 */
export async function applyInviteAction(
	actor: ReadActor & { accessToken: string },
	input: InviteActionInput,
): Promise<WriteOutcome<MemberInvite | null>> {
	const project = await resolveProject(actor, input.projectId);
	if (!project) return null;
	const db = projectsDb(actor);
	const invite = await resolveInvite(actor, project.id, input.inviteId);
	if (!invite) return null;

	if (input.action === "cancel") {
		if (invite.status !== "pending") {
			return {
				refusal: {
					status: 409,
					message:
						`This invitation has already been ${invite.status}; it can no longer be cancelled.`,
					errors: { inviteId: "not_pending" },
				},
			};
		}
		const { data, error } = await db
			.from("project_invitations")
			.update({ status: "revoked" })
			.eq("id", invite.id)
			.eq("status", "pending")
			.select("id");
		if (error) return { refusal: refusalFrom(error.message, "inviteId") };
		if (!data || data.length === 0) return { refusal: notWritten("inviteId") };
		return { data: null };
	}

	// dismiss
	if (invite.status === "pending") {
		return {
			refusal: {
				status: 409,
				message: "An open invitation is cancelled, not dismissed.",
				errors: { inviteId: "still_pending" },
			},
		};
	}
	if (invite.dismissed_at) return { data: null };
	const { data, error } = await db
		.from("project_invitations")
		.update({ dismissed_at: new Date().toISOString() })
		.eq("id", invite.id)
		.neq("status", "pending")
		.is("dismissed_at", null)
		.select("id");
	if (error) return { refusal: refusalFrom(error.message, "inviteId") };
	if (!data || data.length === 0) return { refusal: notWritten("inviteId") };
	return { data: null };
}

// #endregion

// #region Forced decision (development only)

/**
 * Apply an invitee's answer on their behalf — the Dev Tools Invites window's Force Accept / Force
 * Reject.
 *
 * Two gates before the service role is touched, and both are the fat service's to have passed
 * already: the server says this is a development environment, and the caller OWNS the invitation
 * (it was read back under their RLS as the inviter, above). The decision is then recorded AS THE
 * INVITEE — `p_actor` is the target — because that is who a real acceptance is recorded as, and the
 * rows written must be indistinguishable from the ones `respond_to_project_invitation` writes.
 */
export async function forceInviteDecision(
	actor: ReadActor & { accessToken: string },
	input: InviteDecisionInput,
	nowMs: number = Date.now(),
): Promise<WriteOutcome<MemberInvite | null>> {
	const project = await resolveProject(actor, input.projectId);
	if (!project) return null;
	const invite = await resolveInvite(actor, project.id, input.inviteId);
	if (!invite) return null;
	if (invite.inviter_user_id !== actor.userId) return { refusal: notWritten("inviteId") };
	if (invite.status !== "pending") {
		return {
			refusal: {
				status: 409,
				message: `This invitation has already been ${invite.status}.`,
				errors: { inviteId: "not_pending" },
			},
		};
	}
	if (!invite.target_user_id) {
		return {
			refusal: {
				status: 422,
				message: "An email-addressed invitation is accepted through its link.",
				errors: { inviteId: "email_addressed" },
			},
		};
	}

	const service = getServiceClient().schema("projects") as unknown as SupabaseClient;
	const { error } = await service.rpc("fn_apply_invitation_decision", {
		p_invitation_id: invite.id,
		p_accept: input.decision === "accept",
		p_actor: invite.target_user_id,
	});
	if (error) return { refusal: refusalFrom(error.message, "inviteId") };

	// Re-read through the roster's own reader so the row returned carries the labels the list prints.
	const db = projectsDb(actor);
	const stageNames = await stageNameMap(db, project.id);
	const queue = await fetchInvitations(actor, db, project.id, stageNames, nowMs, new Map());
	return { data: queue.find((row) => row.id === invite.id) ?? null };
}

// #endregion

// #region Remove

/**
 * Remove a participant from the project, or unassign them from one stage, through
 * `projects.remove_project_member`. The RPC applies the consequences and returns the counts it
 * applied; those counts — not the ones the dialog estimated — are what the caller is told.
 */
export async function removeMemberRow(
	actor: ReadActor & { accessToken: string },
	input: RemoveMemberInput,
): Promise<WriteOutcome<RemoveMemberResult>> {
	const project = await resolveProject(actor, input.projectId);
	if (!project) return null;
	if (!UUID_RE.test(input.memberId)) return null;
	if (input.stageId !== null && !UUID_RE.test(input.stageId)) {
		return { refusal: refusalFrom("That stage is not part of this project.", "stageId") };
	}
	const { data, error } = await projectsDb(actor).rpc("remove_project_member", {
		p_project_id: project.id,
		p_participant_id: input.memberId,
		p_stage_id: input.stageId,
	});
	if (error) {
		if (error.message.includes("not on this project")) return null;
		return { refusal: refusalFrom(error.message, "memberId") };
	}
	const row = data as unknown as RemoveMemberRpcRow | null;
	if (!row) return { refusal: refusalFrom("remove_project_member returned nothing", "memberId") };
	const impact: RemovalImpact = {
		claimedTickets: Math.max(0, row.claimed_tickets ?? 0),
		submittedTickets: Math.max(0, row.submitted_tickets ?? 0),
		startedStages: Math.max(0, row.started_stages ?? 0),
	};
	return {
		data: {
			memberId: clamp(row.participant_id ?? input.memberId, 120),
			removedFrom: row.removed_from === "stage" ? "stage" : "project",
			impact,
		},
	};
}

// #endregion

// #region Sent invitations (the Dev Tools Invites window)

/**
 * Every invitation this caller has SENT that is still on a list, grouped by project — the owner's
 * projects under their own RLS, then each project's queue through the roster's reader so the rows
 * are the rows the members page shows.
 *
 * One query per project rather than one query for the lot, deliberately: the reader that labels an
 * invitation needs the project's stage names, and a developer has a handful of projects — this is a
 * development window, not a feed.
 */
export async function fetchSentInvitations(
	actor: ReadActor & { accessToken: string },
	nowMs: number = Date.now(),
): Promise<SentInvitesPage> {
	const db = projectsDb(actor);
	const { data, error } = await db
		.from("projects")
		.select(PROJECT_KEY_COLUMNS)
		.eq("owner_user_id", actor.userId)
		.neq("status", "archived")
		.order("created_at", { ascending: false })
		.limit(50);
	if (error) throw new Error(`projects.projects read failed: ${error.message}`);
	const projects = (data ?? []) as unknown as ProjectKeyRow[];

	const groups: SentInvitesPage["projects"] = [];
	let total = 0;
	for (const project of projects) {
		const stageNames = await stageNameMap(db, project.id);
		const invites = await fetchInvitations(actor, db, project.id, stageNames, nowMs, new Map());
		total += invites.length;
		groups.push({
			id: clamp(project.slug, 120),
			title: clampOr(project.title, 160, "Untitled project"),
			status: clamp(project.status, 24),
			invites,
		});
	}
	return { projects: groups, total };
}

// #endregion
