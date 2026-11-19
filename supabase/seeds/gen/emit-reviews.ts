/**
 * emit-reviews.ts — `06_reviews.sql`: every seeded review, written on the anchor that proves it.
 *
 * Decision #487 lets a review exist only on something its author completed, and the seed obeys the
 * same rule: `ck_entity_reviews_one_anchor` is never relaxed for seed data. So each review in
 * `reviews.ts` is emitted with the purchase it rests on, minted from the same natural keys:
 *
 *   - a Pipeline, One-Off or Deliverable listing → a completed engagement bought from it (owned by
 *     the provider, `client_user_id` the reviewer, `source_blueprint_id` the listing), one paid stage,
 *     the provider's completed seat and the status history that dates its completion;
 *   - a Session or Group session listing → the provider's session engagement (one per listing, as
 *     `projects.fn_session_engagement` keeps it), a cohort and a completed membership per attendee
 *     (one shared cohort for a group), and one completed sitting.
 *
 * The review targets the listing's PROVIDER (the freelancer, or the team) and carries the listing in
 * `service_blueprint_id`; it is dated after its anchor completed and inside the 30-day window. A world
 * project's own reviews (`world.ts` PROJECTS) are emitted only for a completed project. Product
 * reviews wait for CK1 (`PRODUCT_REVIEWS_AWAITING_DELIVERY`).
 */

import { SERVICES } from "./corpus.ts";
import { ENTITIES } from "./world.ts";
import { LISTING_REVIEWS, type ListingReview, UNREVIEWED_ENGAGEMENTS } from "./reviews.ts";
import { ago, HEADER, id, insert, insertAbsent, jsonb, q, slugFor, uuidFor } from "./sql.ts";
import { party, persona, type Principal, type World } from "./resolve.ts";

// #region Helpers
/** A review is dated this many days after its anchor completed. */
const REVIEW_LAG_DAYS = 1;
/** The review window (reviews.fn_review_window). */
const WINDOW_DAYS = 30;

function ownerOf(world: World, handle: string): Principal {
	const principal = world.principals.get(handle);
	if (!principal) throw new Error(`reviews: no principal owns "${handle}"`);
	return principal;
}

/** Persona keys that may NOT review a listing owned by `handle`: its owner and the owning team. */
function conflictedReviewers(world: World, handle: string): Set<string> {
	const owner = ownerOf(world, handle);
	const out = new Set<string>();
	for (const p of world.personas.values()) {
		if (p.userId === owner.accountUserId) out.add(p.key);
	}
	if (owner.entityKey) {
		const entity = ENTITIES.find((e) => e.key === owner.entityKey);
		for (const m of entity?.members ?? []) out.add(m.persona);
		if (entity) out.add(entity.owner);
	}
	return out;
}

function reviewerId(world: World, key: string): string {
	const p = world.personas.get(key);
	if (!p) throw new Error(`reviews: unknown reviewer persona "${key}"`);
	return p.userId;
}

/** The review's target: the listing's team, or its freelancer. */
function providerOf(owner: Principal): { type: "team" | "freelancer"; id: string } {
	return owner.kind === "team" && owner.entityId
		? { type: "team", id: owner.entityId }
		: { type: "freelancer", id: owner.accountUserId };
}

function checkReview(listing: string, r: ListingReview, barred: Set<string>): void {
	const [reviewer, , , comment, , reply] = r;
	if (barred.has(reviewer)) {
		throw new Error(`reviews: ${reviewer} may not review ${listing} — they own or staff it`);
	}
	if (comment.trim().length < 100) {
		throw new Error(`reviews: the review of ${listing} by ${reviewer} is under 100 characters`);
	}
	if (reply && (reply.body.trim().length < 1 || reply.body.trim().length > 1000)) {
		throw new Error(
			`reviews: the reply on ${listing} by ${reviewer} is outside 1–1,000 characters`,
		);
	}
}
// #endregion

export function emitReviews(world: World): string {
	const out: string[] = [
		HEADER(
			"06_reviews.sql — reviews, each on the completed engagement or session seat that proves it",
			"Decision #487: every review carries exactly one anchor and is dated inside its 30-day window. A listing's reviews rest on engagements and session seats minted here from the listing and reviewer keys; the review targets the provider and names the listing it was bought from.",
		),
	];

	const projects: string[][] = [];
	const history: string[][] = [];
	const stages: string[][] = [];
	const seats: string[][] = [];
	const participants: string[][] = [];
	const cohorts: string[][] = [];
	const memberships: string[][] = [];
	const sittings: string[][] = [];
	const reviews: string[][] = [];

	const pushHistory = (
		key: string,
		projectId: string,
		actor: string,
		created: number,
		done: number | null,
	) => {
		history.push([
			id(uuidFor("status_history", `${key}:draft`)),
			id(projectId),
			id(actor),
			"NULL",
			"'draft'",
			"'Created'",
			ago(created),
		]);
		history.push([
			id(uuidFor("status_history", `${key}:active`)),
			id(projectId),
			id(actor),
			"'draft'",
			"'active'",
			"'Published'",
			ago(created - 0.5),
		]);
		if (done !== null) {
			history.push([
				id(uuidFor("status_history", `${key}:completed`)),
				id(projectId),
				id(actor),
				"'active'",
				"'completed'",
				"'Completed'",
				ago(done),
			]);
		}
	};

	// #region Engagements bought from a listing
	/** One completed engagement of `client` on listing `s`, completed `doneDaysAgo` days ago. */
	const engagement = (
		s: (typeof SERVICES)[number],
		client: string,
		doneDaysAgo: number,
	): string => {
		const owner = ownerOf(world, s.owner);
		const provider = providerOf(owner);
		const key = `review-anchor:${s.key}:${client}`;
		const projectId = uuidFor("project", key);
		const created = doneDaysAgo + 14;
		const first = s.stages[0];
		projects.push([
			id(projectId),
			id(owner.accountUserId),
			id(owner.kind === "team" ? owner.entityId ?? null : null),
			id(reviewerId(world, client)),
			q(s.title.slice(0, 200)),
			q(slugFor("prj", key)),
			jsonb({ text: s.summary }),
			q(s.summary),
			q(s.model === "pipeline" ? "pipeline" : "one_off"),
			q(
				s.model === "pipeline"
					? "standard"
					: s.model === "direct_deliverable"
					? "single_task"
					: "one_off",
			),
			"'none'",
			"'completed'",
			"'unlisted'",
			"'USD'",
			"'fixed_price'",
			id(world.serviceId(s.key)),
			ago(created),
			ago(doneDaysAgo),
			ago(doneDaysAgo),
		]);
		pushHistory(key, projectId, owner.accountUserId, created, doneDaysAgo);
		const stageId = uuidFor("stage", `${key}:s1`);
		stages.push([
			id(stageId),
			id(projectId),
			q(first?.name ?? s.title),
			q(slugFor("stg", `${key}:s1`)),
			"1",
			"'paid'",
			String(first?.priceMinor ?? 0),
			"'Accepted and paid'",
			ago(doneDaysAgo),
			ago(created),
		]);
		seats.push([
			id(uuidFor("assignment", `${key}:s1`)),
			id(stageId),
			q(provider.type),
			id(provider.type === "freelancer" ? provider.id : null),
			id(provider.type === "team" ? provider.id : null),
			id(owner.accountUserId),
			"'completed'",
			ago(doneDaysAgo),
			ago(created),
		]);
		participants.push([
			id(uuidFor("participant", `${key}:${owner.accountUserId}`)),
			id(projectId),
			"'freelancer'",
			id(owner.accountUserId),
			"'assignee'",
			ago(created),
		]);
		return projectId;
	};
	// #endregion

	// #region Session seats on a listing
	const sessionProjects = new Map<string, { projectId: string; stageId: string }>();
	const SESSION_KIND: Record<string, string> = { session: "normal", group_session: "group" };
	/** The provider's one session engagement on a session listing, minted once. */
	const sessionProject = (s: (typeof SERVICES)[number], oldest: number) => {
		const known = sessionProjects.get(s.key);
		if (known) return known;
		const owner = ownerOf(world, s.owner);
		const key = `review-anchor:${s.key}:sessions`;
		const projectId = uuidFor("project", key);
		const created = oldest + 21;
		projects.push([
			id(projectId),
			id(owner.accountUserId),
			id(owner.kind === "team" ? owner.entityId ?? null : null),
			"NULL",
			q(s.title.slice(0, 200)),
			q(slugFor("prj", key)),
			jsonb({ text: s.summary }),
			q(s.summary),
			"'session'",
			"'standard'",
			q(SESSION_KIND[s.model]),
			"'active'",
			"'unlisted'",
			"'USD'",
			"'fixed_price'",
			id(world.serviceId(s.key)),
			ago(created),
			ago(1),
			ago(1),
		]);
		pushHistory(key, projectId, owner.accountUserId, created, null);
		const stageId = uuidFor("stage", `${key}:s1`);
		stages.push([
			id(stageId),
			id(projectId),
			"'Sessions'",
			q(slugFor("stg", `${key}:s1`)),
			"0",
			"'open'",
			String(s.stages[0]?.priceMinor ?? 0),
			"''",
			"NULL",
			ago(created),
		]);
		const made = { projectId, stageId };
		sessionProjects.set(s.key, made);
		return made;
	};
	// #endregion

	// #region Listing reviews
	for (const s of SERVICES) {
		const list = LISTING_REVIEWS[s.key] ?? [];
		if (!list.length) continue;
		const barred = conflictedReviewers(world, s.owner);
		const owner = ownerOf(world, s.owner);
		const provider = providerOf(owner);
		const isSession = s.model === "session" || s.model === "group_session";
		const oldest = Math.max(...list.map((r) => r[4]));
		const groupCohort = s.model === "group_session"
			? uuidFor("cohort", `review-anchor:${s.key}:group`)
			: null;

		for (const r of list) {
			checkReview(s.key, r, barred);
			const [reviewer, rating, title, comment, daysAgo, reply] = r;
			const done = daysAgo + REVIEW_LAG_DAYS;
			let projectId: string | null = null;
			let membershipId: string | null = null;
			let sittingId: string | null = null;
			if (isSession) {
				const sp = sessionProject(s, oldest);
				const cohortKey = groupCohort
					? `review-anchor:${s.key}:group`
					: `review-anchor:${s.key}:${reviewer}`;
				const cohortId = groupCohort ?? uuidFor("cohort", cohortKey);
				if (!groupCohort || !cohorts.some((c) => c[0] === id(cohortId))) {
					cohorts.push([
						id(cohortId),
						id(sp.projectId),
						id(sp.stageId),
						q(s.title.slice(0, 200)),
						String(groupCohort ? Math.max(list.length, 6) : 1),
						"'completed'",
						ago(groupCohort ? oldest + 14 : done + 7),
					]);
				}
				membershipId = uuidFor("cohort_membership", `${cohortKey}:${reviewer}`);
				memberships.push([
					id(membershipId),
					id(cohortId),
					id(reviewerId(world, reviewer)),
					"1",
					"'completed'",
					ago(done + 7),
				]);
				// A group shares its sittings; each review rests on the sitting its author attended.
				sittingId = uuidFor("session_event", `${cohortKey}:${reviewer}`);
				const minutes = s.sessionMinutes ?? 60;
				sittings.push([
					id(sittingId),
					id(cohortId),
					q(`${s.title.slice(0, 160)} — session`),
					q(slugFor("ssn", `${cohortKey}:${reviewer}`)),
					`${ago(done)} - interval '${minutes} minutes'`,
					ago(done),
					"'completed'",
					ago(done + 7),
				]);
			} else {
				projectId = engagement(s, reviewer, done);
			}
			reviews.push([
				id(uuidFor("listing_review", `${s.key}:${reviewer}`)),
				id(provider.id),
				q(provider.type),
				id(reviewerId(world, reviewer)),
				id(projectId),
				id(membershipId),
				id(sittingId),
				id(world.serviceId(s.key)),
				ago(done - WINDOW_DAYS),
				rating.toFixed(2),
				q(title),
				q(comment),
				reply ? q(reply.body) : "NULL",
				reply ? id(owner.accountUserId) : "NULL",
				reply ? ago(reply.daysAgo) : "NULL",
				ago(daysAgo),
				ago(reply ? reply.daysAgo : daysAgo),
			]);
		}
	}
	// #endregion

	// #region The unreviewed engagement the live path starts from
	for (const u of UNREVIEWED_ENGAGEMENTS) {
		const s = SERVICES.find((x) => x.key === u.listing);
		if (!s) throw new Error(`reviews: unknown listing "${u.listing}"`);
		if (conflictedReviewers(world, s.owner).has(u.client)) {
			throw new Error(`reviews: ${u.client} may not buy their own listing ${u.listing}`);
		}
		if ((LISTING_REVIEWS[s.key] ?? []).some((r) => r[0] === u.client)) {
			throw new Error(
				`reviews: ${u.client} already reviewed ${u.listing}; this anchor must be unreviewed`,
			);
		}
		engagement(s, u.client, u.completedDaysAgo);
	}
	// #endregion

	// #region A world project's own reviews (completed projects only)
	for (const p of world.projects.values()) {
		if (!p.reviews.length) continue;
		if (p.status !== "completed") {
			throw new Error(
				`reviews: "${p.key}" is ${p.status}; a review rests on a completed engagement (Decision #487)`,
			);
		}
		const done = p.createdDaysAgo - 1;
		for (const rv of p.reviews) {
			const target = party(world, rv.target);
			if (rv.daysAgo > done || rv.daysAgo <= done - WINDOW_DAYS) {
				throw new Error(`reviews: the review on "${p.key}" by ${rv.from} falls outside its window`);
			}
			reviews.push([
				id(uuidFor("review", `${p.key}:${rv.from}:${rv.target}`)),
				id(target.kind === "user" ? target.persona.userId : target.entity.entityId),
				q(target.kind === "user" ? "freelancer" : target.kind),
				id(persona(world, rv.from).userId),
				id(p.projectId),
				"NULL",
				"NULL",
				"NULL",
				ago(done - WINDOW_DAYS),
				rv.rating.toFixed(2),
				q(rv.title),
				q(rv.comment),
				"NULL",
				"NULL",
				"NULL",
				ago(rv.daysAgo),
				ago(rv.daysAgo),
			]);
		}
	}
	// #endregion

	// #region Statements
	out.push(
		insert(
			"projects.projects",
			[
				"id",
				"owner_user_id",
				"owner_team_id",
				"client_user_id",
				"title",
				"slug",
				"description",
				"description_text",
				"format",
				"structure_variation",
				"session_kind",
				"status",
				"visibility",
				"currency",
				"budget_type",
				"source_blueprint_id",
				"created_at",
				"updated_at",
				"last_activity_at",
			],
			projects,
		),
	);
	out.push(
		insert(
			"projects.project_status_history",
			["id", "project_id", "actor_user_id", "from_status", "to_status", "reason", "created_at"],
			history,
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
				"sort_order::integer",
				"status::stage_status",
				"unit_price_cents::bigint",
				"milestone",
				"completed_at::timestamptz",
				"created_at::timestamptz",
			],
			stages,
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
				"status",
				"ended_at",
				"created_at",
			],
			seats,
		),
	);
	out.push(
		insert(
			"projects.project_participants",
			["id", "project_id", "profile_type", "profile_id", "role", "created_at"],
			participants,
		),
	);
	out.push(
		insert(
			"projects.cohorts",
			["id", "project_id", "project_stage_id", "name", "max_seats", "status", "created_at"],
			cohorts,
		),
	);
	out.push(
		insert(
			"projects.cohort_memberships",
			["id", "cohort_id", "user_id", "seats", "status", "joined_at"],
			memberships,
		),
	);
	out.push(
		insert(
			"projects.session_events",
			["id", "cohort_id", "title", "slug", "start_time", "end_time", "status", "created_at"],
			sittings,
		),
	);
	out.push(
		insert(
			"reviews.entity_reviews",
			[
				"id",
				"target_entity_id",
				"target_entity_type",
				"reviewer_user_id",
				"project_id",
				"cohort_membership_id",
				"session_event_id",
				"service_blueprint_id",
				"window_closes_at",
				"rating",
				"title",
				"comment",
				"reply_comment",
				"reply_user_id",
				"replied_at",
				"created_at",
				"updated_at",
			],
			reviews,
		),
	);
	// #endregion

	return out.join("\n");
}
