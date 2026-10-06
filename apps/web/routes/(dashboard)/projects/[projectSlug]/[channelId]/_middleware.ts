import { define } from "@web/utils/state.ts";
import { legacyDiscussionRedirect } from "@web/features/projects/core/discussion-guard.ts";
import { unknownRoomRedirect } from "@web/features/projects/core/room-guard.ts";

/**
 * Channel routes — two redirects before any page renders, in this order:
 *
 *   1. An old address for the engagement's discussion room is sent to
 *      `/projects/[projectSlug]/discussion` (and its tab path). A Task's stage was its discussion's
 *      address until the room had one of its own (Decision #121), so a bookmark, a notification or a
 *      file's provenance link may still carry `/projects/{slug}/stg-…`. The rule and the reasons for a
 *      `303` are in {@link legacyDiscussionRedirect}.
 *   2. An address that names NO room — a typo, a retired word like `settings` — is sent to the
 *      engagement's Overview with a `room-not-found` flash instead of rendering an empty room with a
 *      working composer (Decision #144, {@link unknownRoomRedirect}).
 *
 * Every real channel — the discussion, a staged engagement's stages, team rooms, DMs — falls through.
 */
export default define.middleware(async (ctx) => {
	const redirect = await legacyDiscussionRedirect(ctx) ?? await unknownRoomRedirect(ctx);
	return redirect ?? ctx.next();
});
