import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ViewControlRig from "../islands/ViewControlRig.island.tsx";

/**
 * files-footer-slot — the SSR-idiomatic resolver for the File Explorer's View Control Rig in the
 * middle-nav FOOTER band. It mirrors {@link channelFooterFor} (which owns the Chat composer) and is
 * composed after it in the `(dashboard)` layout, so exactly one footer wins per URL: the rig on a
 * `/files` route (channel scope `/projects/[id]/[channel]/files` or project scope
 * `/projects/[id]/files`), else `null`. Unlike the channel resolvers this needs no project detail —
 * the rig is a dumb island driving the shared zoom signal — so it stays a pure URL match.
 */
export function filesFooterFor(url: URL, _context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", id, ...]
	if (segs[0] !== "projects" || segs[1] === "create") return null;

	const isProjectFiles = segs.length === 3 && segs[2] === "files";
	const isChannelFiles = segs.length >= 4 && segs[3] === "files";
	if (!isProjectFiles && !isChannelFiles) return null;

	return <ViewControlRig />;
}
