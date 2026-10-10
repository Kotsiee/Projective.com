import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ProjectSetupScreen } from "@features/projects/components/setup/ProjectSetupScreen.tsx";
import { resolveProjectSetup } from "@features/projects/core/setup-ssr.ts";
import {
	projectHref,
	resolveProjectAccess,
	seeOther,
} from "@features/projects/core/project-access.ts";
import { projectsNoticeHref } from "@features/projects/core/project-notice.ts";
import type { ProjectSetup } from "@features/projects/types/projects-types.ts";

/**
 * `/projects/[slug]/details` — the owner's **configuration** of the engagement (Decision #144): the
 * brief, the stages or roles and their prices, attachments, terms and visibility.
 *
 * It is the setup surface that used to be the engagement's root, moved rather than changed. The form,
 * its save model (Ctrl+S, auto-save on blur), the progress ladder in the header band and the actions
 * in the footer band are exactly as they were; what changed is that the root now belongs to the
 * Overview, so an operational engagement no longer opens on a form. The post-onboarding locks
 * (Decision #89) still draw every frozen term — the type, and each staffed stage's price — as locked,
 * with its reason.
 *
 * Review authority only — the owner, or an active member of the paying client business
 * (`projects.can_review_project`, mirrored as `canConfigure`). Anyone else is sent to the Overview with
 * a 303 (the configuration is not theirs to see, and a participant's "Project details" now IS the
 * Overview). `/edit` and `/settings` 308 here.
 */

interface DetailsData {
	setup: ProjectSetup | null;
	slug: string;
}

export const handler = define.handlers({
	async GET(ctx) {
		const slug = ctx.params.projectSlug;
		const resolved = await resolveProjectAccess(ctx, slug);
		if (!resolved) return seeOther(projectsNoticeHref("project-not-found"));
		if (!resolved.canConfigure) return seeOther(projectHref(slug));

		ctx.state.title = `Details · ${resolved.title} · Projective`;
		const { setup } = await resolveProjectSetup(slug, readActor(ctx));
		const data: DetailsData = { setup, slug };
		return page(data);
	},
});

export default define.page<typeof handler>(function ProjectDetailsPage({ data }) {
	return <ProjectSetupScreen setup={data.setup} slug={data.slug} />;
});
