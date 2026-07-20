import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import BoardViewControlRig from "../islands/BoardViewControlRig.island.tsx";

/**
 * board-footer-slot — the SSR-idiomatic resolver for the Kanban board's action rig in the middle-nav
 * FOOTER band. It mirrors {@link filesFooterFor}/{@link submissionsFooterFor} and is composed after
 * them in the `(dashboard)` layout, so exactly one footer wins per URL: the board rig on the project
 * board (`/projects/[id]/board`) or a stage Tasks board (`/projects/[id]/[channel]/tasks`), else `null`.
 * Like the sibling resolvers it needs no project detail — the rig is a dumb island driving the shared
 * board signals — so it stays a pure URL match.
 */
export function boardFooterFor(url: URL, _context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", id, ...]
	if (segs[0] !== "projects" || segs[1] === "create") return null;

	const isProjectBoard = segs.length === 3 && segs[2] === "board";
	const isStageTasks = segs.length >= 4 && segs[3] === "tasks";
	if (!isProjectBoard && !isStageTasks) return null;

	return <BoardViewControlRig />;
}
