import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import StageDetailsRig from "../islands/StageDetailsRig.island.tsx";
import { canConfigureStage } from "./channel-view.ts";
import { resolveProjectDetail } from "./detail-ssr.ts";
import { resolveProjectSetup } from "./setup-ssr.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * stage-details-footer-slot — the SSR-idiomatic resolver for the stage Details tab's action rig in
 * the middle-nav FOOTER band. The sibling of {@link channelFooterFor}, composed alongside the other
 * footer resolvers in the `(dashboard)` layout so exactly one footer wins per URL.
 *
 * It exists because the shell's region contract (DESIGN_SYSTEM Part D) puts every action in the
 * band: without it the stage form would have to grow a Save button of its own, and the body would
 * stop being a form and nothing else.
 *
 * It claims ONLY `/projects/{projectId}/{channelId}/details`. `channelFooterFor` runs before it and
 * cannot reach this URL — it is gated to the Chat tab — and no other projects resolver tests for a
 * `details` segment, so the position in the chain is a matter of reading order rather than of
 * precedence.
 *
 * The permission test is {@link canConfigureStage}, the SAME function the header uses to decide
 * whether to render the tab and the route uses to decide whether to serve it. Three call sites, one
 * predicate: a band that offered Save on a page the route redirects away from would be a control
 * with nothing behind it.
 *
 * Server-only (it reaches `@server/services`); never imported by an island.
 */
export async function stageDetailsFooterFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	// ["projects", projectId, channelId, "details"]
	const segs = url.pathname.split("/").filter(Boolean);
	if (segs[0] !== "projects" || segs.length !== 4 || segs[3] !== "details") return null;
	if (segs[1] === "create") return null;

	const [, projectId, channelId] = segs;
	const { detail } = await resolveProjectDetail(projectId, context, actor);
	// A stage channel, or nothing — a general/team/DM channel has no configuration and no Details tab.
	const channel = detail?.channels.stages.find((s) => s.id === channelId);
	if (!detail || !channel) return null;

	const canConfigure = detail.viewerIsClient || context.role === "admin";
	if (!canConfigureStage({ channelKind: "stage", canConfigure })) return null;

	/*
	 * Resolved AFTER the permission test, exactly as the route orders it: `resolveProjectSetup`
	 * assembles columns a non-owner has no business having assembled for them.
	 *
	 * The stage is looked up through `channel.stageId`, never through the routed segment — on the live
	 * path the channel id is a `comms` row and the stage id a `projects` row, and only the fixtures
	 * make them equal. Without the check the rig would render Save beside a route that had already
	 * answered "nothing to configure here".
	 */
	const { setup } = await resolveProjectSetup(projectId, actor);
	if (!setup || !setup.stages.some((s) => s.id === channel.stageId)) return null;

	return <StageDetailsRig setup={setup} />;
}
