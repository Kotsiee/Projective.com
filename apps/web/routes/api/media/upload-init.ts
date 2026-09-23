import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { LibraryUploadInitSchema } from "@projective/types/files";
import { parseBody, toProfileResponse } from "@features/profile/core/respond.ts";
import { MediaBackendService } from "@server/services/media/MediaBackendService.ts";

/**
 * `POST /api/media/upload-init` — declare a file for the caller's media library. Body:
 * {@link LibraryUploadInitSchema}. Answers with a signed, single-object URL in the private
 * `quarantine` bucket the browser PUTs the bytes to; nothing is admitted until `upload-complete`
 * has inspected them.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to upload." }, { status: 401 });
		}
		const body = await parseBody(ctx.req, LibraryUploadInitSchema);
		if (!body.ok) return body.response;
		return toProfileResponse(await MediaBackendService.uploadInit(actor, body.data));
	},
});
