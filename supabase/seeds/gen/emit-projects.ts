/**
 * emit-projects.ts — `06_projects.sql`: projects, stages, participants, assignments, invitations,
 * applications, tickets (with history), submissions (with deliverable files) and status history.
 *
 * Every row here is a consequence of the world spec's project narrative, so the money rows in 07
 * (escrows, releases, invoices) and the channels in 08 point at ids minted from the same keys.
 */

import {
	ago,
	ahead,
	arr,
	HEADER,
	id,
	insert,
	insertAbsent,
	jsonb,
	num,
	q,
	uuidFor,
} from "./sql.ts";
import { party, persona, type ResolvedProject, type World } from "./resolve.ts";

/** Team assignees expand to their active members for participant/access rows. */
function assigneeUsers(world: World, key: string): string[] {
	const who = party(world, key);
	if (who.kind === "user") return [who.persona.userId];
	return who.entity.members.map((m) => persona(world, m.persona).userId);
}

export function emitProjects(world: World): string {
	const out: string[] = [
		HEADER(
			"06_projects.sql — projects, stages, hiring, tickets and submissions",
			"Slugs are minted deterministically (they satisfy the slug CHECKs, and the slug guard accepts an explicit slug on INSERT), so /projects/prj-… addresses survive a reset. A draft project is stored `unlisted` regardless of its requested publish visibility, per the setup SSOT.",
		),
	];

	const projects = [...world.projects.values()];

	// #region Projects + stages
	out.push(
		insert(
			"projects.projects",
			[
				"id",
				"client_business_id",
				"owner_user_id",
				"title",
				"slug",
				"description",
				"description_text",
				"format",
				"structure_variation",
				"status",
				"visibility",
				"publish_visibility",
				"currency",
				"budget_type",
				"budget_amount_cents",
				"timeline_preset",
				"target_project_start_date",
				"ip_ownership_mode",
				"nda_required",
				"portfolio_display_rights",
				"location_restriction",
				"language_requirement",
				"allow_deadline_bonuses",
				"created_at",
				"updated_at",
				"last_activity_at",
			],
			projects.map((p) => [
				id(p.projectId),
				id(p.clientBusinessId),
				id(p.ownerUserId),
				q(p.title),
				q(p.slug),
				jsonb({ text: p.summary }),
				q(p.summary),
				q(p.format),
				q(p.structure),
				q(p.status),
				q(p.status === "draft" ? "unlisted" : p.visibility),
				q(p.status === "draft" ? "public" : p.visibility),
				"'USD'",
				"'fixed_price'",
				String(p.budgetCents),
				"'sequential'",
				p.startsInDays >= 0 ? ahead(p.startsInDays) : ago(-p.startsInDays),
				"'exclusive_transfer'",
				"false",
				"'allowed'",
				arr(["Remote"]),
				arr(["English"]),
				String(p.allowDeadlineBonuses),
				ago(p.createdDaysAgo),
				ago(lastActivity(p)),
				ago(lastActivity(p)),
			]),
		),
	);

	out.push(
		insert(
			"projects.project_status_history",
			["id", "project_id", "actor_user_id", "from_status", "to_status", "reason", "created_at"],
			projects.flatMap((p) => {
				const rows: string[][] = [[
					id(uuidFor("status_history", `${p.key}:draft`)),
					id(p.projectId),
					id(p.ownerUserId),
					"NULL",
					"'draft'",
					"'Created'",
					ago(p.createdDaysAgo),
				]];
				if (p.status !== "draft") {
					rows.push([
						id(uuidFor("status_history", `${p.key}:${p.status}`)),
						id(p.projectId),
						id(p.ownerUserId),
						"'draft'",
						q(p.status),
						"'Published'",
						ago(Math.max(0, p.createdDaysAgo - 1)),
					]);
				}
				return rows;
			}),
		),
	);

	out.push(
		insertAbsent(
			"projects.project_stages",
			[
				"id::uuid",
				"project_id::uuid",
				"name",
				"slug",
				"description",
				"description_text",
				"sort_order",
				"status::stage_status",
				"skills",
				"unit_price_cents",
				"milestone",
				"completed_at::timestamptz",
				"seat_limit",
				"created_at::timestamptz",
			],
			projects.flatMap((p) =>
				p.stages.map((s, i) => {
					const r = p.stagesByKey.get(s.key)!;
					return [
						id(r.id),
						id(p.projectId),
						q(s.name),
						q(r.slug),
						jsonb({ text: s.brief }),
						q(s.brief),
						String(i + 1),
						q(s.status),
						arr(s.skills),
						String(s.priceCents),
						q(s.status === "paid" ? "Accepted and paid" : ""),
						s.completedDaysAgo !== undefined ? ago(s.completedDaysAgo) : "NULL",
						"3",
						ago(p.createdDaysAgo),
					];
				})
			),
		),
	);
	// #endregion

	// #region Participants, assignments, hiring
	const participants: string[][] = [];
	const assignments: string[][] = [];
	for (const p of projects) {
		if (p.clientBusinessId) {
			participants.push([
				id(uuidFor("participant", `${p.key}:business`)),
				id(p.projectId),
				"'business'",
				id(p.clientBusinessId),
				"'client'",
				ago(p.createdDaysAgo),
			]);
		}
		const seen = new Set<string>();
		for (const a of p.assignments) {
			const stage = p.stagesByKey.get(a.stage);
			if (!stage) {
				throw new Error(`world: assignment on "${p.key}" names unknown stage "${a.stage}"`);
			}
			const who = party(world, a.assignee);
			assignments.push([
				id(uuidFor("assignment", `${p.key}:${a.stage}:${a.assignee}`)),
				id(stage.id),
				q(who.kind === "user" ? "freelancer" : "team"),
				id(who.kind === "user" ? who.persona.userId : null),
				id(who.kind === "user" ? null : who.entity.entityId),
				id(persona(world, a.by).userId),
				"false",
				q(a.status),
				ago(a.daysAgo),
			]);
			for (const userId of assigneeUsers(world, a.assignee)) {
				if (seen.has(userId)) continue;
				seen.add(userId);
				participants.push([
					id(uuidFor("participant", `${p.key}:${userId}`)),
					id(p.projectId),
					"'freelancer'",
					id(userId),
					"'assignee'",
					ago(a.daysAgo),
				]);
			}
		}
	}
	out.push(
		insert(
			"projects.project_participants",
			["id", "project_id", "profile_type", "profile_id", "role", "created_at"],
			participants,
		),
	);
	out.push(
		insert(
			"projects.stage_assignments",
			[
				"id",
				"project_stage_id",
				"assignee_type",
				"freelancer_profile_id",
				"team_id",
				"assigned_by",
				"is_client_managed",
				"status",
				"created_at",
			],
			assignments,
		),
	);

	out.push(
		insert(
			"projects.project_invitations",
			[
				"id",
				"project_id",
				"project_stage_id",
				"target_user_id",
				"message",
				"offer_price_cents",
				"placeholder",
				"role",
				"inviter_user_id",
				"token",
				"status",
				"created_at",
				"expires_at",
				"accepted_at",
				"declined_at",
			],
			projects.flatMap((p) =>
				p.invitations.map((inv) => {
					const stage = inv.stage ? p.stagesByKey.get(inv.stage) : null;
					if (inv.stage && !stage) {
						throw new Error(`world: invitation on "${p.key}" names unknown stage "${inv.stage}"`);
					}
					const key = `${p.key}:${inv.to}:${inv.stage ?? "project"}`;
					return [
						id(uuidFor("invitation", key)),
						id(p.projectId),
						id(stage?.id),
						id(persona(world, inv.to).userId),
						q(inv.message),
						num(inv.offerCents ?? null),
						String(!!inv.placeholder),
						"'freelancer'",
						id(persona(world, inv.by).userId),
						q(uuidFor("invitation_token", key)),
						q(inv.status),
						ago(inv.daysAgo),
						ahead(14 - inv.daysAgo),
						inv.status === "accepted" ? ago(Math.max(0, inv.daysAgo - 1)) : "NULL",
						inv.status === "declined" ? ago(Math.max(0, inv.daysAgo - 1)) : "NULL",
					];
				})
			),
		),
	);

	const applications: string[][] = [];
	const targets: string[][] = [];
	for (const p of projects) {
		for (const app of p.applications) {
			const stage = p.stagesByKey.get(app.stage);
			if (!stage) {
				throw new Error(`world: application on "${p.key}" names unknown stage "${app.stage}"`);
			}
			const applicant = persona(world, app.by);
			const appId = uuidFor("application", `${p.key}:${app.by}:${app.stage}`);
			applications.push([
				id(appId),
				id(p.projectId),
				id(applicant.userId),
				"'freelancer'",
				id(applicant.userId),
				q(app.message),
				q(app.status),
				ago(app.daysAgo),
				ago(app.status === "pending" ? app.daysAgo : Math.max(0, app.daysAgo - 1)),
			]);
			targets.push([
				id(uuidFor("application_target", `${p.key}:${app.by}:${app.stage}`)),
				id(appId),
				"'stage'",
				id(stage.id),
			]);
		}
	}
	out.push(
		insert(
			"projects.project_applications",
			[
				"id",
				"project_id",
				"applicant_user_id",
				"applicant_type",
				"applicant_profile_id",
				"message",
				"status",
				"created_at",
				"updated_at",
			],
			applications,
		),
	);
	out.push(
		insert("projects.project_application_targets", [
			"id",
			"application_id",
			"target_type",
			"target_id",
		], targets),
	);
	// #endregion

	// #region Tickets
	const tickets: string[][] = [];
	const history: string[][] = [];
	for (const p of projects) {
		p.tickets.forEach((t, i) => {
			const r = p.ticketsByKey.get(t.key)!;
			const stage = p.stagesByKey.get(t.stage)!;
			const stageSpec = p.stages.find((s) => s.key === t.stage)!;
			const assignee = t.assignee ? persona(world, t.assignee) : null;
			const owner = persona(world, t.owner ?? p.owner);
			const createdDaysAgo = Math.min(p.createdDaysAgo, (t.claimedDaysAgo ?? 0) + 2 + i);
			tickets.push([
				id(r.id),
				id(p.projectId),
				id(stage.id),
				id(assignee?.userId),
				q(r.slug),
				id(owner.userId),
				q(t.title),
				jsonb({ text: t.brief }),
				q(t.brief),
				q(t.status),
				q(t.priority),
				jsonb([{ stage_id: stage.id, order: 0 }]),
				jsonb(t.tasks.map((task, ti) => ({
					id: uuidFor("task", `${p.key}:${t.key}:${ti}`),
					text: task.text,
					done: task.done,
					completed_by: task.done && assignee ? [assignee.userId] : [],
				}))),
				t.dueInDays === undefined
					? "NULL"
					: t.dueInDays >= 0
					? ahead(t.dueInDays)
					: ago(-t.dueInDays),
				t.intensity.toFixed(2),
				q(t.payment),
				String(stageSpec.priceCents),
				t.payment === "released" ? String(stageSpec.priceCents) : "0",
				String(i),
				t.claimedDaysAgo !== undefined ? ago(t.claimedDaysAgo) : "NULL",
				ago(createdDaysAgo),
				ago(
					t.releasedDaysAgo ??
						(t.claimedDaysAgo !== undefined ? Math.min(t.claimedDaysAgo, 1) : createdDaysAgo),
				),
			]);

			history.push([
				id(uuidFor("ticket_history", `${p.key}:${t.key}:created`)),
				id(r.id),
				id(owner.userId),
				"'created'",
				"NULL",
				id(stage.id),
				"NULL",
				"'backlog'",
				jsonb({ title: t.title }),
				ago(createdDaysAgo),
			]);
			if (assignee && t.claimedDaysAgo !== undefined) {
				history.push([
					id(uuidFor("ticket_history", `${p.key}:${t.key}:claimed`)),
					id(r.id),
					id(assignee.userId),
					"'reassigned'",
					id(stage.id),
					id(stage.id),
					"'todo'",
					"'claimed'",
					jsonb({ assignee: assignee.userId }),
					ago(t.claimedDaysAgo),
				]);
			}
			if (t.status === "in_progress" || t.status === "in_review" || t.status === "completed") {
				history.push([
					id(uuidFor("ticket_history", `${p.key}:${t.key}:${t.status}`)),
					id(r.id),
					id(t.status === "completed" ? owner.userId : (assignee?.userId ?? owner.userId)),
					"'status_changed'",
					id(stage.id),
					id(stage.id),
					t.status === "completed" ? "'in_review'" : "'claimed'",
					q(t.status),
					jsonb({}),
					ago(t.releasedDaysAgo ?? Math.max(0, (t.claimedDaysAgo ?? 1) - 1)),
				]);
			}
		});
	}
	out.push(
		insertAbsent(
			"projects.tickets",
			[
				"id::uuid",
				"project_id::uuid",
				"current_stage_id::uuid",
				"current_assignee_id::uuid",
				"slug",
				"owner_user_id::uuid",
				"title",
				"description",
				"text_description",
				"status::ticket_status",
				"priority::projects.ticket_priority",
				"required_stages",
				"tasks",
				"due_date::timestamptz",
				"workload_intensity",
				"payment_status::payment_status",
				"unit_price_cents",
				"total_amount_paid",
				"sort_order",
				"claimed_at::timestamptz",
				"created_at::timestamptz",
				"updated_at::timestamptz",
			],
			tickets,
		),
	);
	out.push(
		insert(
			"projects.ticket_history",
			[
				"id",
				"ticket_id",
				"actor_id",
				"action_type",
				"previous_stage_id",
				"new_stage_id",
				"previous_status",
				"new_status",
				"changes",
				"created_at",
			],
			history,
		),
	);
	// #endregion

	// #region Submissions
	const submissions: string[][] = [];
	const submissionFiles: string[][] = [];
	for (const p of projects) {
		p.submissions.forEach((s, i) => {
			const submissionId = p.submissionsByKey.get(s.key)!;
			const ticket = p.tickets.find((t) => t.key === s.ticket)!;
			const ticketRow = p.ticketsByKey.get(s.ticket)!;
			const stage = p.stagesByKey.get(ticket.stage)!;
			const by = persona(world, s.by);
			const reviewer = s.reviewedBy ? persona(world, s.reviewedBy) : null;
			submissions.push([
				id(submissionId),
				id(stage.id),
				id(ticketRow.id),
				id(by.userId),
				q(s.notes),
				q(s.title),
				q(s.status),
				jsonb({ text: s.notes }),
				jsonb(
					ticket.tasks.flatMap((task, ti) =>
						task.done ? [uuidFor("task", `${p.key}:${s.ticket}:${ti}`)] : []
					),
				),
				String(i + 1),
				id(reviewer?.userId),
				reviewer ? ago(Math.max(0, s.daysAgo - 1)) : "NULL",
				s.feedback ? jsonb({ text: s.feedback }) : "NULL",
				s.revisionOf ? id(p.submissionsByKey.get(s.revisionOf)) : "NULL",
				ago(s.daysAgo),
				ago(reviewer ? Math.max(0, s.daysAgo - 1) : s.daysAgo),
			]);
			for (const file of world.submissionFiles.get(`${p.key}:${s.key}`) ?? []) {
				submissionFiles.push([
					id(uuidFor("submission_file", `${submissionId}:${file.id}`)),
					id(submissionId),
					id(file.id),
				]);
			}
		});
	}
	out.push(
		insert(
			"projects.stage_submissions",
			[
				"id",
				"project_stage_id",
				"ticket_id",
				"submitted_by",
				"notes",
				"title",
				"status",
				"description",
				"checked_item_ids",
				"number",
				"reviewed_by",
				"reviewed_at",
				"feedback",
				"revision_of",
				"created_at",
				"updated_at",
			],
			submissions,
		),
	);
	out.push(
		insert("projects.submission_files", ["id", "submission_id", "file_id"], submissionFiles),
	);
	// #endregion

	// #region Per-user project preferences (starred projects on the feed)
	const prefs: string[][] = [];
	for (const p of projects) {
		const viewers = new Set<string>([p.ownerUserId]);
		for (const a of p.assignments) for (const u of assigneeUsers(world, a.assignee)) viewers.add(u);
		for (const u of viewers) {
			prefs.push([
				id(u),
				id(p.projectId),
				String(p.key === "helia-wallet" || p.key === "atlas-analytics"),
				"false",
				ago(Math.min(lastActivity(p), 1)),
			]);
		}
	}
	out.push(
		insert(
			"projects.user_preferences",
			["user_id", "project_id", "is_starred", "is_archived", "last_viewed_at"],
			prefs,
			"(user_id, project_id)",
		),
	);
	// #endregion

	// #region Reviews (dual-track: a client reviews the freelancer/team, the freelancer reviews the client)
	const reviewRows: string[][] = [];
	for (const p of projects) {
		for (const rv of p.reviews) {
			const target = party(world, rv.target);
			const targetType = target.kind === "user" ? "freelancer" : target.kind;
			const targetId = target.kind === "user" ? target.persona.userId : target.entity.entityId;
			reviewRows.push([
				id(uuidFor("review", `${p.key}:${rv.from}:${rv.target}`)),
				id(targetId),
				q(targetType),
				id(persona(world, rv.from).userId),
				id(p.projectId),
				rv.rating.toFixed(2),
				q(rv.title),
				q(rv.comment),
				ago(rv.daysAgo),
				ago(rv.daysAgo),
			]);
		}
	}
	out.push(
		insert(
			"reviews.entity_reviews",
			[
				"id",
				"target_entity_id",
				"target_entity_type",
				"reviewer_user_id",
				"project_id",
				"rating",
				"title",
				"comment",
				"created_at",
				"updated_at",
			],
			reviewRows,
		),
	);
	// #endregion

	return out.join("\n");
}

/** The most recent thing that happened on a project, in days ago. */
function lastActivity(p: ResolvedProject): number {
	const candidates = [
		p.createdDaysAgo,
		...p.messages.map((m) => m.daysAgo),
		...p.submissions.map((s) => s.daysAgo),
		...p.invitations.map((i) => i.daysAgo),
		...p.applications.map((a) => a.daysAgo),
	];
	return Math.min(...candidates);
}
