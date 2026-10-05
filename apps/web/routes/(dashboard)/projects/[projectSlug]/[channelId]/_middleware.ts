import { define } from "@web/utils/state.ts";
import { legacyDiscussionRedirect } from "@web/features/projects/core/discussion-guard.ts";

/**
 * Channel routes — an old address for the engagement's discussion room is sent to
 * `/projects/[projectSlug]/discussion` (and its tab path) before any page renders.
 *
 * A Task's stage was its discussion's address until the room had one of its own (Decision #121), so a
 * bookmark, a notification or a file's provenance link may still carry `/projects/{slug}/stg-…`. Every
 * other channel — a staged engagement's stages, team rooms, DMs — falls straight through. The rule and
 * the reasons for a `303` are in {@link legacyDiscussionRedirect}.
 */
export default define.middleware(async (ctx) => {
	const redirect = await legacyDiscussionRedirect(ctx);
	return redirect ?? ctx.next();
});
