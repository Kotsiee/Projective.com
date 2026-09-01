import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { resolveProjectSetup } from "@features/projects/core/setup-ssr.ts";
import ShowcaseStyleAnchor from "@features/projects/islands/ShowcaseStyleAnchor.island.tsx";

/**
 * `/projects/[projectId]/preview` — the owner's view of how the engagement will read on Explore.
 *
 * The body is deliberately a PLACEHOLDER while the Explore presentation is being reworked. It says so
 * in one sentence and does nothing else: a half-rebuilt showcase shown to the person deciding whether
 * to publish would be worse than an honest gap, because they would be judging the engagement by a
 * layout that is about to change.
 *
 * **Two server guards, and both matter.**
 *
 * A non-owner is bounced because Preview is one half of a switch only the owner is offered; and an
 * owner whose `previewReady` is false is bounced too, because the tab that leads here renders LOCKED
 * until every required step is done. A control disabled in the interface and open at its URL is a gate
 * that only holds for people who did not think to type the address — the lock has to be real on the
 * server or it is decoration.
 *
 * The redirect is returned from `define.handlers`, never from the page component: a `Response`
 * returned by a `define.page` component is dead code, the redirect silently never fires, and the body
 * renders anyway — a defect this codebase has shipped before (root CLAUDE.md §8 Decision #61).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const slug = ctx.params.projectId;
		const { setup } = await resolveProjectSetup(slug, readActor(ctx));
		if (!setup || !setup.viewerIsClient || !setup.previewReady) {
			return new Response(null, { status: 303, headers: { location: `/projects/${slug}` } });
		}
		ctx.state.title = `Preview ${setup.title} · Projective`;
		return page({ slug });
	},
});

export default define.page<typeof handler>(function ProjectPreviewPage() {
	return (
		<div class="psu">
			<ShowcaseStyleAnchor />
			<div class="psu__head">
				<p class="psu__eyebrow">Preview</p>
				<h1 class="psu__title">Explore Preview (Revamp in progress)</h1>
				<p class="psu__lede">
					This is where the engagement will render exactly as a freelancer browsing Explore sees it.
					The presentation is being rebuilt, so it is deliberately blank rather than half-finished —
					everything you have configured is safe and visible under Details.
				</p>
			</div>
		</div>
	);
});
