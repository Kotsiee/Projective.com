import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ProjectPreviewRig from "../islands/ProjectPreviewRig.island.tsx";
import { resolveProjectShowcase } from "./showcase-ssr.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * project-footer-slot — the SSR-idiomatic resolver for the engagement preview's action rig in the
 * middle-nav FOOTER band. The sibling of {@link projectHeaderFor}, and composed alongside the other
 * footer resolvers in the `(dashboard)` layout so exactly one footer wins per URL.
 *
 * It claims only the bare engagement page (`/projects/[projectId]`) — not the editor, whose own
 * commit lives in its body footer, and not board/files/submissions/channels, which have their own
 * rigs.
 *
 * Role gating mirrors {@link projectHeaderFor} and is re-derived server-side from `viewerIsClient`,
 * never trusted from the client (root CLAUDE.md §6):
 *   • **Client / owner** → `null`. The header band already carries their Preview↔Edit switch, and
 *     "Apply" is meaningless on your own engagement. A capability the viewer does not have is
 *     expressed as ABSENCE, not as a disabled control (the `/wallet` gate rule).
 *   • **Freelancer / non-owner** → the {@link ProjectPreviewRig}, so the page's one real call to
 *     action is visible without scrolling for it.
 *
 * Server-only (it reaches `@server/services` via {@link resolveProjectShowcase}); never imported by
 * an island.
 */
export async function projectFooterFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", slug]
	if (segs[0] !== "projects" || segs.length !== 2 || segs[1] === "create") return null;

	const { showcase, viewerIsClient } = await resolveProjectShowcase(segs[1], context, actor);
	if (!showcase || viewerIsClient) return null;

	return <ProjectPreviewRig item={showcase.item} authed />;
}
