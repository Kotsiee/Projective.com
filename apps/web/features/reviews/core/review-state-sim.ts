import type { Reviewable, ReviewState } from "@projective/types/reviews";

/**
 * The development-only review-state simulation (Decision #487, root CLAUDE.md §5).
 *
 * Which state an engagement's review is in — open, written and editable, fixed by a reply or by its
 * window, withdrawn, or never written before the window closed — is the DATABASE's answer
 * (`reviews.get_reviewables`), and a seeded viewer meets only the states the seed happens to hold. The
 * Dev Context Switcher writes this cookie instead, and the Overview honours it only in development: each
 * reviewable on the page is restated in the simulated state, and a page with nothing to review gets one
 * sample provider so the block and the dialog can be seen at all. It grants nothing — a write from a
 * simulated state still meets the doors, which refuse what the real state does not allow.
 *
 * Pure, and free of `IS_DEV`/`import.meta.env`, so it loads under `deno test`.
 */

// #region Contract
/** The cookie the Dev Context Switcher writes and the Overview reads in development. */
export const REVIEW_STATE_SIM_COOKIE = "pj.dev.review-state";

const REVIEW_STATE_SIMS: ReadonlyArray<ReviewState> = [
	"open",
	"reviewed",
	"locked",
	"withdrawn",
	"closed",
];

const DAY_MS = 86_400_000;
const SAMPLE_COMMENT =
	"Clear stage reviews, a handoff our team could build from, and every question answered within a day. The scope held from the first week to the last.";
// #endregion

// #region Codec
/** Read a cookie value back; anything unrecognised is ignored, so a typo never invents a state. */
export function parseReviewStateSim(raw: string | null | undefined): ReviewState | null {
	if (!raw) return null;
	return REVIEW_STATE_SIMS.find((s) => s === raw) ?? null;
}

/** One reviewable restated in `state`, its window and review consistent with it. */
function restate(item: Reviewable, state: ReviewState, now: number): Reviewable {
	const openedAt = new Date(now - 2 * DAY_MS).toISOString();
	const closedOpen = new Date(now - 40 * DAY_MS).toISOString();
	const opened = state === "closed" ? closedOpen : openedAt;
	const closes = new Date(Date.parse(opened) + 30 * DAY_MS).toISOString();
	const base = { ...item, opened_at: opened, closes_at: closes, open: state !== "closed" };
	if (state === "open" || state === "closed") return { ...base, review: null };
	return {
		...base,
		review: {
			id: item.review?.id ?? "00000000-0000-4000-8000-000000000487",
			rating: item.review?.rating ?? 5,
			title: item.review?.title ?? "A handoff we could build from",
			comment: item.review?.comment ?? SAMPLE_COMMENT,
			created_at: openedAt,
			edited_at: null,
			withdrawn: state === "withdrawn",
			hidden: false,
			reply: state === "locked" ? "Thank you. It was a pleasure to work on." : null,
			replied_at: state === "locked" ? new Date(now - DAY_MS).toISOString() : null,
			window_closes_at: closes,
			mine: true,
			revealed: state !== "reviewed",
			editable: state === "reviewed",
		},
	};
}

/**
 * Lay a simulation over what `get_reviewables` answered. No simulation passes the items through; a
 * simulation over nothing to review answers one sample provider, so the surface is reachable.
 */
export function applyReviewStateSim(
	items: Reviewable[],
	sim: ReviewState | null,
	now = Date.now(),
): Reviewable[] {
	if (!sim) return items;
	const base: Reviewable[] = items.length ? items : [{
		anchor_kind: "project",
		anchor_id: "00000000-0000-4000-8000-000000000001",
		target_type: "freelancer",
		target_id: "00000000-0000-4000-8000-000000000002",
		target: { name: "Sample provider", handle: "@sample", avatar: null },
		opened_at: new Date(now).toISOString(),
		closes_at: new Date(now + 30 * DAY_MS).toISOString(),
		open: true,
		review: null,
	}];
	return base.map((item) => restate(item, sim, now));
}
// #endregion
