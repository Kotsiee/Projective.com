import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import SubmissionViewControlRig from "../islands/SubmissionViewControlRig.island.tsx";

/**
 * submissions-footer-slot — the SSR-idiomatic resolver for the Submissions explorer's footer band. It
 * mirrors {@link filesFooterFor} (the File Explorer's View Control Rig) and is composed after it in the
 * `(dashboard)` layout, so exactly one footer wins per URL: the submissions rig on a `/submissions`
 * route (channel scope `/projects/[id]/[channel]/submissions/…` or project scope
 * `/projects/[id]/submissions/…`), else `null`. The rig carries the zoom View Control Rig on the left
 * AND the far-right **Review Submission** trigger (Part 4). Like the sibling resolvers it needs no
 * project detail — the rig is a dumb island driving shared signals — so it stays a pure URL match.
 */
export function submissionsFooterFor(url: URL, _context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", id, ...]
	if (segs[0] !== "projects" || segs[1] === "create") return null;

	const isProjectSubs = segs.length >= 3 && segs[2] === "submissions";
	const isChannelSubs = segs.length >= 4 && segs[3] === "submissions";
	if (!isProjectSubs && !isChannelSubs) return null;

	return <SubmissionViewControlRig />;
}
