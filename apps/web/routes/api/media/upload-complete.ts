import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { LibraryUploadCompleteSchema } from "@projective/types/files";
import { parseBody, toProfileResponse } from "@features/profile/core/respond.ts";
import { MediaBackendService } from "@server/services/media/MediaBackendService.ts";

/**
 * `POST /api/media/upload-complete` — the bytes have landed in quarantine: inspect them (magic
 * bytes, not the declared type), decode them, write the WebP tiers and admit the file to the caller's
 * library. Body: {@link LibraryUploadCompleteSchema}. Answers with the finished library asset, or a
 * refusal that names why the file could not be used.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to upload." }, { status: 401 });
		}
		const body = await parseBody(ctx.req, LibraryUploadCompleteSchema);
		if (!body.ok) return body.response;
		return toProfileResponse(await MediaBackendService.uploadComplete(actor, body.data));
	},
});
