import { navCountLabel, type ProjectNavActivity, ProjectNavView } from "../types/projects-types.ts";

/**
 * nav-activity-model — how one viewer's {@link ProjectNavActivity} becomes the marks on the lane's
 * view links: which views carry one, whether it is a dot or a figure, its tone, and the phrase a
 * screen reader hears for it. Pure, so the expanded lane, the collapsed rail and the tests agree.
 *
 * A figure is drawn only where the reader acts on the number — unread messages, submissions waiting,
 * membership changes — and as plain tabular text, never a pill (Decision #146). Every other view
 * carries a dot.
 */

/** A mark's colour role: the brand accent, a neutral ink, or the warning hue. */
export type NavMarkTone = "accent" | "neutral" | "alert";

/** The mark one view link carries. */
export interface ProjectViewStatus {
	/** What the mark means, folded into the link's accessible name and the rail tooltip. */
	label: string;
	/** The figure to print ("3", "9+"), or `null` for a dot. */
	count: string | null;
	tone: NavMarkTone;
}

function counted(n: number, one: string, many: string): ProjectViewStatus | null {
	if (n <= 0) return null;
	return {
		label: n === 1 ? one : many.replace("{n}", navCountLabel(n)),
		count: navCountLabel(n),
		tone: "accent",
	};
}

/** The lane view a view-link key names, or `null` for a link with no activity of its own. */
export function navViewOf(key: string): ProjectNavView | null {
	const parsed = ProjectNavView.safeParse(key);
	return parsed.success ? parsed.data : null;
}

/** The mark `view` carries for this activity, or `null` when nothing is waiting there. */
export function viewStatusOf(
	view: ProjectNavView,
	activity: ProjectNavActivity,
): ProjectViewStatus | null {
	switch (view) {
		case "overview":
			return activity.overview.changes.length > 0
				? { label: "updated since your last visit", count: null, tone: "accent" }
				: null;
		case "discussion":
			return counted(activity.discussion.unread, "1 unread message", "{n} unread messages");
		case "board":
			if (activity.board.tone === "new") {
				return { label: "new tickets", count: null, tone: "accent" };
			}
			if (activity.board.tone === "moved") {
				return { label: "cards moved", count: null, tone: "neutral" };
			}
			return null;
		case "timeline":
			if (activity.timeline.tone === "deadline") {
				return { label: "a deadline within 48 hours", count: null, tone: "alert" };
			}
			if (activity.timeline.tone === "update") {
				return { label: "progress updated", count: null, tone: "accent" };
			}
			return null;
		case "files":
			return activity.files.fresh ? { label: "new files", count: null, tone: "accent" } : null;
		case "submissions":
			return counted(activity.submissions.count, "1 awaiting you", "{n} awaiting you");
		case "members":
			return counted(activity.members.count, "1 membership update", "{n} membership updates");
	}
}

/**
 * The lane view the reader is on, given the view links and which one is current — the view an
 * arrival marks as seen, or `null` on a page that is none of them (Details, a stage room, …).
 */
export function currentNavView<T extends { key: string }>(
	links: readonly T[],
	isCurrent: (link: T) => boolean,
): ProjectNavView | null {
	for (const link of links) {
		const view = navViewOf(link.key);
		if (view && isCurrent(link)) return view;
	}
	return null;
}
