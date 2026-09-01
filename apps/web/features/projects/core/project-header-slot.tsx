import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ProjectStickyHeader from "@features/view/islands/ProjectStickyHeader.island.tsx";
import ProjectSetupHeader from "../islands/ProjectSetupHeader.island.tsx";
import { resolveProjectShowcase } from "./showcase-ssr.ts";
import { resolveProjectSetup } from "./setup-ssr.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * project-header-slot — the SSR-idiomatic resolver for the ROLE-BASED middle-nav header band on the
 * engagement routes. It mirrors the shell's other URL-keyed slot resolvers (`channelHeaderFor` /
 * `viewHeaderFor`): a pure function of the URL plus the acting context, evaluated by the `(dashboard)`
 * layout and threaded into `UserShell`'s `middleNavHeader`, so the correct band paints in the first
 * byte with no client-context flash.
 *
 * Composed AFTER `channelHeaderFor`, which owns the channel routes — this claims only the bare
 * engagement page (`/projects/[id]`) and its preview (`/projects/[id]/preview`). Every other URL under
 * `/projects` (board, files, submissions, members, a channel) must fall through, or this steals a band
 * that belongs to another surface.
 *
 * Role gating is re-derived server-side from `viewerIsClient`, never trusted from the client (root
 * CLAUDE.md §6):
 *   • **Client / owner** → {@link ProjectSetupHeader}: identity · the setup progress bar · the
 *     Details ⁄ Preview switch, with Preview rendered-and-locked until every required step is done.
 *   • **Freelancer / member** → the reused view {@link ProjectStickyHeader}, so a non-owner's band on
 *     the engagement looks and behaves exactly as it does on `/view/[id]?type=projects`.
 *
 * Server-only (it reaches `@server/services`); never imported by an island.
 */

/** Which of the owner's two modes a URL addresses, or `null` when this resolver declines it. */
type SetupMode = "details" | "preview";

/**
 * Resolve the mode from the path segments.
 *
 * Written as an explicit whitelist rather than "anything of length 2 or 3", because `/projects/{slug}/
 * board`, `/files`, `/members` and every channel id are all length 3 and every one of them owns its
 * own header band already.
 */
function modeOf(segs: string[]): SetupMode | null {
	if (segs[0] !== "projects" || segs.length < 2 || segs[1] === "create") return null;
	if (segs.length === 2) return "details";
	if (segs.length === 3 && segs[2] === "preview") return "preview";
	return null;
}

/** Resolve the engagement header band for a request, or `null` so the band collapses. */
export async function projectHeaderFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean);
	const mode = modeOf(segs);
	if (!mode) return null;

	const slug = segs[1];
	const { detail, showcase, viewerIsClient } = await resolveProjectShowcase(slug, context, actor);
	if (!detail || !showcase) return null;

	if (!viewerIsClient) {
		// The preview route is owner-only and redirects a non-owner, so only `details` reaches here.
		// Authed (the whole dashboard is behind the guard); the projects scope has no
		// back-to-explore/profile context, so the neutral `explore` scope drives the owner link.
		return <ProjectStickyHeader item={showcase.item} authed ctx={{ scope: "explore" }} />;
	}

	const { setup } = await resolveProjectSetup(slug, actor);
	if (!setup) return null;
	return <ProjectSetupHeader slug={slug} active={mode} setup={setup} />;
}
