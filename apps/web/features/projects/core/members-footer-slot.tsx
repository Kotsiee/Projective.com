import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import MemberViewControlRig from "../islands/MemberViewControlRig.island.tsx";

/**
 * members-footer-slot — the SSR-idiomatic resolver for the Members tab's footer band. It mirrors
 * {@link filesFooterFor} and is composed beside it in the `(dashboard)` layout, so exactly one footer
 * wins per URL: the members rig on a `/members` route (channel scope `/projects/[id]/[channel]/members`
 * or project scope `/projects/[id]/members`), else `null`. The rig is a dumb island over shared
 * signals, so it needs no project detail and stays a pure URL match. `/messages/[id]/members` gets the
 * same rig from the conversation footer resolver.
 */
export function membersFooterFor(url: URL, _context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", id, ...]
	if (segs[0] !== "projects" || segs[1] === "create") return null;

	const isProjectMembers = segs.length === 3 && segs[2] === "members";
	const isChannelMembers = segs.length === 4 && segs[3] === "members";
	if (!isProjectMembers && !isChannelMembers) return null;

	return <MemberViewControlRig />;
}
