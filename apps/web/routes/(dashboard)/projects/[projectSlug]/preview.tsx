import { page } from "fresh";
import { EmptyState } from "@projective/ui/utils";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { resolveProjectSetup } from "@features/projects/core/setup-ssr.ts";
import {
	projectDetailsHref,
	projectHref,
	projectListingHref,
	resolveProjectAccess,
	seeOther,
} from "@features/projects/core/project-access.ts";
import { projectsNoticeHref } from "@features/projects/core/project-notice.ts";
import { previewAllowed } from "@projective/types/projects";
import { EntityViewPage } from "@features/view/components/EntityViewPage.tsx";
import { resolveProjectPreview } from "@features/view/core/view-ssr.ts";
import ViewStyleAnchor from "@features/view/islands/ViewStyleAnchor.island.tsx";

/**
 * `/projects/[projectSlug]/preview` — the owner's preview, paired with `/details` in the header band
 * (Decision #144): the brief exactly as a freelancer evaluating it on `/view/[id]?type=projects` sees
 * it, minus what is not about the brief.
 *
 * It renders the SAME `EntityViewPage` in `mode="preview"`, from an `EntityView` composed by the same
 * `ExploreBackendService` composer the public page uses — read fresh with the owner's token, so a
 * draft previews and an edit made a second ago shows. The exclusions are the page's mode, not a
 * second template: no "More by …", no "Similar & recommended", no reviews, and a lane footer that
 * names the applicant's two actions instead of handing the owner an Apply button for their own brief.
 * A one-line notice in the frame's first row says what the page is.
 *
 * **The double guard, and both halves matter.**
 *
 *   1. Signed in. The `(dashboard)` group already requires a session; this re-asserts it, because a
 *      preview route that rendered for whatever a middleware let through would be a guard that held
 *      only as long as an unrelated file did.
 *   2. The owner, when the engagement may preview (`previewAllowed`, Decision #144). A DRAFT must have
 *      finished its required setup steps (`previewReady`, the setup ladder's "every required step
 *      done" — the same value that renders the band's Preview tab LOCKED, so a control locked in the
 *      interface is locked at its URL too). A PUBLISHED engagement always previews: its listing is
 *      already public, and the old rule locked the owner out of their own live brief the moment a
 *      stage added later had no price.
 *
 * A non-owner is sent straight to the public listing — the page this one previews, and where they
 * belong — rather than to the engagement's root, which would only redirect them a second time. An
 * owner who may not preview yet is sent to `/details`, where the outstanding steps are. Every exit is a
 * 303 returned from `define.handlers`, never from the page component: a `Response` returned by a
 * `define.page` component is dead code (root CLAUDE.md §8 Decision #61).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const slug = ctx.params.projectSlug;
		if (!ctx.state.isAuthenticated) return seeOther(projectHref(slug));

		const resolved = await resolveProjectAccess(ctx, slug);
		if (!resolved) return seeOther(projectsNoticeHref("project-not-found"));
		if (resolved.access !== "owner") return seeOther(projectListingHref(slug));

		const actor = readActor(ctx);
		const { setup } = await resolveProjectSetup(slug, actor);
		if (!setup || !previewAllowed(resolved.status, setup.previewReady)) {
			return seeOther(projectDetailsHref(slug));
		}

		const { view, status } = await resolveProjectPreview(setup.slug, actor);
		ctx.state.title = `Preview ${setup.title} · Projective`;
		return page({ slug: setup.slug, view, unavailable: status >= 500 });
	},
});

export default define.page<typeof handler>(function ProjectPreviewPage({ data }) {
	const editHref = projectDetailsHref(data.slug);

	// The brief could not be composed — the marketplace read failed, or (in fixture mode) the project
	// exists only in the stub store and has no rows to compose from. Either way the owner is told so
	// and sent back to Details, never shown Explore's "item not found" about their own project.
	if (!data.view) {
		return (
			<div class="evp evp--empty">
				<ViewStyleAnchor />
				<EmptyState
					title="We couldn't build this preview"
					description={data.unavailable
						? "The marketplace didn't respond just now. Your project is safe — try again in a moment."
						: "This project's brief isn't readable as a listing yet. Everything you configured is safe under Details."}
					actions={
						<a
							class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded"
							href={data.unavailable ? "" : editHref}
						>
							<span class="ui-button__label">
								{data.unavailable ? "Try again" : "Back to Details"}
							</span>
						</a>
					}
				/>
			</div>
		);
	}

	return (
		<EntityViewPage
			view={data.view}
			ctx={{ scope: "explore" }}
			authed
			mode="preview"
			editHref={editHref}
		/>
	);
});
