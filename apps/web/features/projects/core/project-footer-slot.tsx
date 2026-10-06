import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { State } from "@web/utils/state.ts";
import ProjectSetupRig from "../islands/ProjectSetupRig.island.tsx";
import { ProjectOverviewRig } from "../components/overview/ProjectOverviewRig.tsx";
import { storedProjectAccess } from "./project-access.ts";
import { resolveProjectSetup } from "./setup-ssr.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * project-footer-slot — the SSR-idiomatic resolver for the engagement's action rig in the middle-nav
 * FOOTER band (Decision #144). The sibling of {@link projectHeaderFor}, composed alongside the other
 * footer resolvers in the `(dashboard)` layout so exactly one footer wins per URL.
 *
 * It claims the Overview and the configuration — not the preview, whose whole point is that there is
 * nothing to act on there, and not board/files/submissions/channels, which have their own rigs.
 *
 *   • **Overview** (`/projects/[slug]`) → {@link ProjectOverviewRig}: one filled control (the most
 *     pressing thing on the page, else Open discussion) and at most one outlined one. It renders from
 *     the Overview read the page handler already composed (`ctx.state.projectWorkspace`), so the band
 *     names the same top action the page lists first, and the layout does not compose it twice.
 *   • **Details** (`/projects/[slug]/details`) → the owner's {@link ProjectSetupRig}: save status ·
 *     Auto-save · Publish (on a draft) · Actions.
 *
 * Nobody but a participant or the owner ever reaches the Overview, so the applicant's Apply rig that
 * used to mount here for every non-client — including people already working on the engagement — is
 * gone; Apply lives on the public listing only.
 *
 * Server-only (it reaches `@server/services`); never imported by an island.
 */
export async function projectFooterFor(
	url: URL,
	_context: UserContext,
	actor: ReadActor,
	state?: State,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", slug, "details"?]
	if (segs[0] !== "projects" || segs.length < 2 || segs[1] === "create") return null;

	const slug = segs[1];
	const resolved = storedProjectAccess(state, slug);

	if (segs.length === 2) {
		const workspace = state?.projectWorkspace;
		if (!resolved || resolved.access === "prospect" || !workspace) return null;
		return (
			<ProjectOverviewRig slug={slug} workspace={workspace} discussion={resolved.discussion} />
		);
	}

	if (segs.length !== 3 || segs[2] !== "details") return null;
	if (resolved && resolved.access !== "owner") return null;
	const { setup } = await resolveProjectSetup(slug, actor);
	if (!setup || !setup.viewerIsClient) return null;
	return <ProjectSetupRig setup={setup} />;
}
