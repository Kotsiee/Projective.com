import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { findStageChannel } from "@projective/types/projects";
import { canConfigureStage } from "@web/features/projects/core/channel-view.ts";
import { resolveProjectDetail } from "@web/features/projects/core/detail-ssr.ts";
import { resolveProjectSetup } from "@web/features/projects/core/setup-ssr.ts";
import StageDetailsForm from "@web/features/projects/islands/StageDetailsForm.island.tsx";
import ProjectPageStyleAnchor from "@web/features/projects/islands/ProjectPageStyleAnchor.island.tsx";
import type { ProjectSetup } from "@web/features/projects/types/projects-types.ts";

/**
 * Details tab — one stage's own configuration
 * (`/projects/[projectId]/[channelId]/details`).
 *
 * The stage a channel IS, editable from inside the channel. Its scope, its price, its steps, its
 * skills, its timing, its seats and its submission rules were previously reachable only through a
 * disclosure in a list on a different surface, so changing the terms of the work happening in this
 * room meant leaving it.
 *
 * **The routed segment is the stage's `stg-…` address; the stage ROW is still resolved through
 * `stageId`.** Three keys are in play and only one of them is a URL: the segment addresses the stage,
 * `StageChannel.id` is the room the tree opens (a `comms.project_channels` row on the live path), and
 * `StageSetup.id` is the `projects.project_stages` row this page writes to. The fixtures make the last
 * two equal, which is precisely why a lookup written against the routed id worked in the stub and
 * found nothing in production.
 *
 * **The guard lives here, in `define.handlers`, and never in the page component.** A `Response`
 * returned by a `define.page` component is dead code: the redirect silently never fires and the body
 * renders anyway — a defect this codebase has shipped before (root CLAUDE.md §8 Decision #61).
 *
 * **Two refusals, told apart on purpose.**
 *
 *   • A channel that is not a stage, or a stage the configuration read cannot account for, is a
 *     MISS. Nothing exists at this address for anybody, so the body says so and offers the way back.
 *   • A viewer who may not configure the engagement is REDIRECTED, one level up, to the channel they
 *     were already entitled to. The tab that leads here is absent for them (`visibleChannelTabKeys`),
 *     so arriving is either a typed address or a shared link — and a 403 page would be a dead end
 *     beside a perfectly good destination. `303`, not `302`: the answer is a different resource,
 *     reached with `GET`, which is exactly what a See Other says.
 *
 * The permission test is {@link canConfigureStage} — the SAME function the header uses to decide
 * whether to render the tab. A tab hidden by one predicate and a route guarded by another is how a
 * link disappears while its URL stays open, which is a gate that only holds for people who do not
 * type addresses. Neither is the real gate: RLS is, and the write path re-asks independently
 * (root CLAUDE.md §6).
 *
 * The order is deliberate — existence, then permission, then the configuration read. `resolveProjectSetup`
 * reaches columns a non-owner has no business having assembled for them at all, so it runs only once
 * the viewer has been allowed through.
 */

// #region Route data
/** What the page renders from. Both fields are `null` together on a miss. */
interface StageDetailsData {
	/**
	 * The WHOLE configuration, not the one stage.
	 *
	 * The form seeds the shared setup store with it, which is what buys the surface Ctrl+S, the save
	 * serialiser, auto-save on blur and the footer rig's Save ⁄ Discard for nothing — all of which
	 * measure a whole configuration, because the write path is the project's own `PATCH`.
	 */
	setup: ProjectSetup | null;
	/** The `projects.project_stages` id this page configures, resolved from the channel's `stageId`. */
	stageId: string | null;
}
// #endregion

export const handler = define.handlers({
	async GET(ctx) {
		const { projectSlug: projectId, channelId } = ctx.params;
		const actor = readActor(ctx);
		const context = asAuthenticatedContext(ctx.state.userContext);
		const miss: StageDetailsData = { setup: null, stageId: null };

		const { detail } = await resolveProjectDetail(projectId, context, actor);
		// A stage channel, or nothing. A general/team/DM channel has no configuration to edit and no
		// Details tab, so its address here names a page that does not exist rather than one being
		// withheld.
		const channel = findStageChannel(detail?.channels.stages ?? [], channelId);
		if (!detail || !channel) return page(miss);

		// The owner test is the server's own (`projects.projects.owner_user_id === viewer`, which is
		// what `viewerIsClient` projects on this read); the admin arm comes from the chrome context,
		// decoded from the access token. Identical to the header slot's, so the tab and the route
		// cannot disagree about who may open this.
		const canConfigure = detail.viewerIsClient || context.role === "admin";
		if (!canConfigureStage({ channelKind: "stage", canConfigure })) {
			return new Response(null, {
				status: 303,
				headers: { location: `/projects/${projectId}/${channelId}` },
			});
		}

		const { setup } = await resolveProjectSetup(projectId, actor);
		const stage = setup?.stages.find((s) => s.id === channel.stageId);
		if (!setup || !stage) return page(miss);

		ctx.state.title = `${channel.name} · ${detail.title} · Projective`;
		const data: StageDetailsData = { setup, stageId: stage.id };
		return page(data);
	},
});

export default define.page<typeof handler>(function StageDetailsPage({ data }) {
	if (!data.setup || !data.stageId) {
		/*
		 * The miss body carries the style anchor because the form island — the only importer of
		 * `project-setup.css` on this route — is exactly what is NOT rendering here. Feature CSS is
		 * collected from the ISLAND graph, so without it this branch ships correct markup and no rules,
		 * which is how the sibling engagement surface lost its styling once already.
		 *
		 * It does not quote what was asked for: a channel id read back at somebody tells them nothing
		 * they can act on, and it dresses an ordinary miss up as a system fault.
		 */
		return (
			<div class="psu">
				<ProjectPageStyleAnchor />
				<div class="psu__head">
					<h1 class="psu__title">Nothing to configure here</h1>
					<p class="psu__lede">
						This channel isn’t a stage, or its configuration is no longer part of the project.
					</p>
				</div>
				<p class="psu-note">
					<a href="/projects">Back to all projects</a>
				</p>
			</div>
		);
	}

	return <StageDetailsForm setup={data.setup} stageId={data.stageId} />;
});
