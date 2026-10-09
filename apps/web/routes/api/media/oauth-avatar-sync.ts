import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toProfileResponse } from "@features/profile/core/respond.ts";
import { MediaBackendService } from "@server/services/media/MediaBackendService.ts";
import { UserBackendService } from "@server/services/user/UserBackendService.ts";

/**
 * `/api/media/oauth-avatar-sync` — the caller's sign-in picture as a media-library source.
 *
 * - `GET` answers which provider the caller signed in with and its allowlisted picture URL
 *   (`OAuthAvatarSource`), for the picker to show before anything is copied.
 * - `POST` (no body) fetches that picture server-side, runs it through the quarantine pipeline and
 *   answers with the new library asset, ready to crop.
 *
 * The URL is always read from the caller's verified identity; nothing in the request names it.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to use your sign-in picture." }, {
				status: 401,
			});
		}
		return toProfileResponse(await UserBackendService.oauthAvatar(actor));
	},

	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to use your sign-in picture." }, {
				status: 401,
			});
		}
		return toProfileResponse(await MediaBackendService.syncOAuthAvatar(actor));
	},
});
