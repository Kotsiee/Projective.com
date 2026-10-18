import {
	FEEDBACK_STATE_LABEL,
	FEEDBACK_STATUS_FILTERS,
	type FeedbackIdea,
	type FeedbackIdeaState,
	type FeedbackStatusCounts,
	type FeedbackStatusFilter,
} from "@projective/types/community";

/**
 * feedback-view — the board's presentation rules (Decision #272), pure so the page, the drawer and
 * their tests agree: the tabs and their counts, the lifecycle tag each state wears, the words a vote
 * control says, the age line and the history dates, and how the roadmap groups ideas into columns.
 */

// #region Tabs
/** A status tab: `null` is every tab at once. */
export type FeedbackTab = FeedbackStatusFilter | null;

/** The tabs in reading order — every idea first, then the lifecycle from intake to shipped. */
export const FEEDBACK_TABS: readonly FeedbackTab[] = [null, ...FEEDBACK_STATUS_FILTERS];

/** A tab's label. */
export function feedbackTabLabel(tab: FeedbackTab): string {
	switch (tab) {
		case null:
			return "All";
		case "under_review":
			return "Under review";
		case "planned":
			return "Planned";
		case "in_progress":
			return "In progress";
		case "shipped":
			return "Shipped";
	}
}

/** How many ideas sit under a tab. */
export function feedbackTabCount(tab: FeedbackTab, counts: FeedbackStatusCounts): number {
	return tab === null ? counts.all : counts[tab];
}
// #endregion

// #region The lifecycle tag
/** The Tag severity each state wears — the lifecycle-status container §B.11.3 allows. */
export type FeedbackTagSeverity = "secondary" | "info" | "primary" | "success";

/** A state's tag: its label and its severity. */
export function feedbackStatusTag(
	state: FeedbackIdeaState,
): { label: string; severity: FeedbackTagSeverity } {
	const severity: Record<FeedbackIdeaState, FeedbackTagSeverity> = {
		backlog: "secondary",
		ready: "info",
		in_progress: "primary",
		complete: "success",
		archived: "secondary",
	};
	return { label: FEEDBACK_STATE_LABEL[state], severity: severity[state] };
}
// #endregion

// #region The vote control's words
/** `1 vote` / `12 votes`. */
export function voteCountText(count: number): string {
	return `${count} ${count === 1 ? "vote" : "votes"}`;
}

/**
 * The vote control's accessible name: what pressing it does and the count it shows — "Upvote Pause
 * a stage, 12 votes". The pressed state itself is `aria-pressed`, so the name does not change with it.
 */
export function voteLabel(title: string, count: number): string {
	return `Upvote ${title}, ${voteCountText(count)}`;
}

/** The guest's version: the link that signs in first. */
export function signInToVoteLabel(title: string, count: number): string {
	return `Sign in to upvote ${title}, ${voteCountText(count)}`;
}

/** What the live region says after a vote lands (or is rolled back). */
export function voteAnnouncement(title: string, voted: boolean, count: number): string {
	return voted
		? `Upvoted ${title}. ${voteCountText(count)}.`
		: `Vote removed from ${title}. ${voteCountText(count)}.`;
}
// #endregion

// #region Time
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto", style: "long" });

/**
 * "3 days ago", "last week", "just now" — the largest unit that keeps the figure at least 1, measured
 * from the board's own `now` so the server and the hydrated island print the same words.
 */
export function feedbackAge(iso: string, nowIso: string): string {
	const diff = Date.parse(iso) - Date.parse(nowIso);
	if (!Number.isFinite(diff)) return "";
	const abs = Math.abs(diff);
	if (abs < MINUTE) return "just now";
	if (abs < HOUR) return relative.format(Math.round(diff / MINUTE), "minute");
	if (abs < DAY) return relative.format(Math.round(diff / HOUR), "hour");
	if (abs < WEEK) return relative.format(Math.round(diff / DAY), "day");
	if (abs < MONTH) return relative.format(Math.round(diff / WEEK), "week");
	if (abs < YEAR) return relative.format(Math.round(diff / MONTH), "month");
	return relative.format(Math.round(diff / YEAR), "year");
}

const historyDate = new Intl.DateTimeFormat("en-GB", {
	day: "2-digit",
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});

/** A history row's date — `17 Oct 2026`, UTC, the same on every machine. */
export function feedbackHistoryDate(iso: string): string {
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? historyDate.format(ms) : "";
}

/** The `<time datetime>` value for an instant — its calendar date. */
export function feedbackDateAttr(iso: string): string {
	return iso.slice(0, 10);
}
// #endregion

// #region The roadmap
/** The roadmap's columns, in order. */
export const FEEDBACK_ROADMAP_COLUMNS = ["planned", "in_progress", "shipped"] as const;

/** One column of the roadmap. */
export type FeedbackRoadmapColumn = (typeof FEEDBACK_ROADMAP_COLUMNS)[number];

const COLUMN_STATE: Record<FeedbackRoadmapColumn, FeedbackIdeaState> = {
	planned: "ready",
	in_progress: "in_progress",
	shipped: "complete",
};

/**
 * Group a board page into the roadmap: Planned · In progress · Shipped, each keeping the page's
 * order, plus the reader's own ideas under review, which no column holds.
 */
export function feedbackRoadmap(ideas: readonly FeedbackIdea[]): {
	columns: Record<FeedbackRoadmapColumn, FeedbackIdea[]>;
	underReview: FeedbackIdea[];
} {
	const columns = {} as Record<FeedbackRoadmapColumn, FeedbackIdea[]>;
	for (const column of FEEDBACK_ROADMAP_COLUMNS) {
		columns[column] = ideas.filter((idea) => idea.status === COLUMN_STATE[column]);
	}
	return { columns, underReview: ideas.filter((idea) => idea.status === "backlog") };
}
// #endregion

// #region An idea that will not open
/** What the idea view says in place of an idea: its heading and one sentence. */
export interface FeedbackUnavailableCopy {
	title: string;
	text: string;
}

/**
 * The idea view's words when the idea will not open. A 404 is one answer for "absent" and "not
 * yours to see", so an idea under review is never confirmed to exist; anything else is a read that
 * failed, which says so with the server's own sentence when it has one.
 */
export function feedbackIdeaUnavailable(
	status: number,
	message?: string | null,
): FeedbackUnavailableCopy {
	if (status === 404) {
		return {
			title: "This idea isn't on the board",
			text:
				"It may still be under review, or it was closed. Ideas appear on the board once the team accepts them.",
		};
	}
	return {
		title: "This idea couldn't load",
		text: message || "Something went wrong reading it. Try again in a moment.",
	};
}
// #endregion

// #region Empty states
/** What an empty tab says. */
export function feedbackEmptyCopy(tab: FeedbackTab, signedIn: boolean): {
	title: string;
	description: string;
} {
	switch (tab) {
		case "under_review":
			return signedIn
				? {
					title: "Nothing under review",
					description:
						"Ideas you suggest wait here until the team reviews them. Only you can see them until then.",
				}
				: {
					title: "Ideas under review are private",
					description: "Sign in to see the ideas you have suggested while the team reviews them.",
				};
		case "planned":
			return { title: "Nothing planned yet", description: "Accepted ideas appear here first." };
		case "in_progress":
			return {
				title: "Nothing in progress",
				description: "Planned ideas move here once work starts.",
			};
		case "shipped":
			return { title: "Nothing shipped yet", description: "Finished ideas land here." };
		case null:
			return {
				title: "No ideas yet",
				description: "Be the first to suggest what Projective should build next.",
			};
	}
}
// #endregion
