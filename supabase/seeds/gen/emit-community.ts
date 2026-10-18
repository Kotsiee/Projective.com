/**
 * emit-community.ts — `12_community_feedback.sql`: the feedback board's ideas, their status history
 * and their votes (`community.feedback_*`, Decision #272).
 *
 * Rows are written the way the doors would have written them, so a seeded idea is indistinguishable
 * from a real one: the submission is a history row from NULL into `backlog`, every operator move after
 * it is another, the author's own vote is cast with the idea, and `vote_count` is left at 0 for
 * `trg_feedback_votes_count` to count the vote rows as they arrive. The idea's text passes through the
 * Decision #147 screen trigger like any other write. The moves carry no actor: no seed persona is a
 * platform operator, and `actor_id` is an audit column with no foreign key.
 */

import { ago, HEADER, id, insert, q, slugFor, uuidFor } from "./sql.ts";
import { persona, type World } from "./resolve.ts";
import { FEEDBACK_IDEAS } from "./world.ts";

/** The deterministic id of a seeded idea. */
export function feedbackIdeaId(key: string): string {
	return uuidFor("feedback-idea", key);
}

/** The deterministic `fbk-` address of a seeded idea. */
export function feedbackIdeaSlug(key: string): string {
	return slugFor("fbk", key);
}

export function emitCommunity(world: World): string {
	const out: string[] = [
		HEADER(
			"12_community_feedback.sql — the feedback board's ideas, status history and votes",
			"Ideas under review (`backlog`) are visible only to their author; Planned, In progress and Shipped are public; the Archived one is visible to operators only (00002021). vote_count is kept by trg_feedback_votes_count.",
		),
	];

	const ideaRows: string[][] = [];
	const eventRows: string[][] = [];
	const voteRows: string[][] = [];

	for (const spec of FEEDBACK_IDEAS) {
		const author = persona(world, spec.author);
		const ideaId = feedbackIdeaId(spec.key);
		const last = spec.moves.at(-1);
		const status = last?.to ?? "backlog";
		const changedDaysAgo = last?.daysAgo ?? spec.daysAgo;
		const updatedDaysAgo = Math.min(changedDaysAgo, spec.response?.daysAgo ?? changedDaysAgo);
		ideaRows.push([
			id(ideaId),
			q(feedbackIdeaSlug(spec.key)),
			q(spec.title),
			q(spec.impact),
			q(spec.body ?? null),
			q(spec.category),
			q(status),
			id(author.userId),
			q(spec.response?.text ?? null),
			spec.response ? ago(spec.response.daysAgo) : "NULL",
			ago(spec.daysAgo),
			ago(updatedDaysAgo),
			ago(changedDaysAgo),
			status === "archived" ? ago(changedDaysAgo) : "NULL",
		]);

		let from = "backlog";
		eventRows.push([
			id(uuidFor("feedback-event", `${spec.key}:0`)),
			id(ideaId),
			"NULL",
			"'backlog'",
			id(author.userId),
			ago(spec.daysAgo),
		]);
		spec.moves.forEach((move, i) => {
			eventRows.push([
				id(uuidFor("feedback-event", `${spec.key}:${i + 1}`)),
				id(ideaId),
				q(from),
				q(move.to),
				"NULL",
				ago(move.daysAgo),
			]);
			from = move.to;
		});

		// The author's vote is cast with the idea; each other vote lands a little later, never in the
		// future and never before the idea existed.
		const voters = [spec.author, ...spec.voters];
		voters.forEach((key, i) => {
			const daysAgo = Math.max(spec.daysAgo - i * 0.7, 0.05);
			voteRows.push([id(ideaId), id(persona(world, key).userId), ago(daysAgo)]);
		});
	}

	out.push("-- #region Ideas\n");
	out.push(
		insert(
			"community.feedback_ideas",
			[
				"id",
				"slug",
				"title",
				"impact",
				"body",
				"category",
				"status",
				"author_id",
				"team_response",
				"team_response_at",
				"created_at",
				"updated_at",
				"status_changed_at",
				"archived_at",
			],
			ideaRows,
		),
	);
	out.push("-- #endregion\n\n-- #region Status history\n");
	out.push(
		insert(
			"community.feedback_status_events",
			["id", "idea_id", "from_status", "to_status", "actor_id", "created_at"],
			eventRows,
		),
	);
	out.push("-- #endregion\n\n-- #region Votes (the author's first)\n");
	out.push(
		insert(
			"community.feedback_votes",
			["idea_id", "user_id", "created_at"],
			voteRows,
			"(idea_id, user_id)",
		),
	);
	out.push("-- #endregion\n");
	return out.join("");
}
