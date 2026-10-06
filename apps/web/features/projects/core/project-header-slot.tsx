import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import { previewAllowed } from "@projective/types/projects";
import type { State } from "@web/utils/state.ts";
import ProjectSetupHeader from "../islands/ProjectSetupHeader.island.tsx";
import { ProjectOverviewHeader } from "../components/overview/ProjectOverviewHeader.tsx";
import { storedProjectAccess } from "./project-access.ts";
import { resolveProjectSetup } from "./setup-ssr.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * project-header-slot — the SSR-idiomatic resolver for the middle-nav header band on the engagement's
 * own three pages (Decision #144). It mirrors the shell's other URL-keyed slot resolvers
 * (`channelHeaderFor` / `viewHeaderFor`): a pure function of the URL plus the acting context, evaluated
 * by the `(dashboard)` layout and threaded into `UserShell`'s `middleNavHeader`, so the correct band
 * paints in the first byte with no client-context flash.
 *
 * Composed AFTER `channelHeaderFor`, which owns the channel routes — this claims only the Overview
 * (`/projects/[slug]`), the configuration (`/details`) and the preview (`/preview`). Every other URL
 * under `/projects` (board, files, submissions, members, a channel) must fall through, or this steals
 * a band that belongs to another surface.
 *
 *   • **Overview** → {@link ProjectOverviewHeader}: the engagement's name, plus the owner's Details
 *     and (when the engagement may preview) Preview links. It reads the access the
 *     project middleware memoised for this request, so the band and the page cannot disagree.
 *   • **Details / Preview** → {@link ProjectSetupHeader}, the owner's: identity · the Details ⇄ Preview
 *     pair · the setup ladder (or, once published, the outstanding fixes in words). A non-owner never
 *     stays on either page — both routes send them on — so this draws nothing for them.
 *
 * Server-only (it reaches `@server/services`); never imported by an island.
 */

/** Which of the engagement's own pages a URL addresses, or `null` when this resolver declines it. */
type ProjectMode = "overview" | "details" | "preview";

/**
 * Resolve the mode from the path segments.
 *
 * Written as an explicit whitelist rather than "anything of length 2 or 3", because `/projects/{slug}/
 * board`, `/files`, `/members` and every channel id are all length 3 and every one of them owns its
 * own header band already.
 */
function modeOf(segs: string[]): ProjectMode | null {
	if (segs[0] !== "projects" || segs.length < 2 || segs[1] === "create") return null;
	if (segs.length === 2) return "overview";
	if (segs.length === 3 && (segs[2] === "details" || segs[2] === "preview")) return segs[2];
	return null;
}

/** Resolve the engagement header band for a request, or `null` so the band collapses. */
export async function projectHeaderFor(
	url: URL,
	_context: UserContext,
	actor: ReadActor,
	state?: State,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean);
	const mode = modeOf(segs);
	if (!mode) return null;

	const slug = segs[1];
	const resolved = storedProjectAccess(state, slug);

	if (mode === "overview") {
		if (!resolved || resolved.access === "prospect") return null;
		const owner = resolved.access === "owner";
		// A published engagement always previews; only a draft needs its ladder, which only the setup
		// read carries — so the read is paid for in the one state that asks the question.
		const ladderDone = owner && resolved.status === "draft"
			? (await resolveProjectSetup(slug, actor)).setup?.previewReady ?? false
			: true;
		return (
			<ProjectOverviewHeader
				slug={slug}
				title={resolved.title}
				owner={owner}
				canPreview={owner && previewAllowed(resolved.status, ladderDone)}
			/>
		);
	}

	// `/preview` skips the project middleware, so `resolved` may be absent there; the setup read's own
	// `viewerIsClient` then decides, exactly as the route's guard does.
	if (resolved && resolved.access !== "owner") return null;
	const { setup } = await resolveProjectSetup(slug, actor);
	if (!setup || !setup.viewerIsClient) return null;
	return <ProjectSetupHeader slug={slug} active={mode} setup={setup} />;
}
