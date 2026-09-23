import { define } from "@web/utils/state.ts";
import { LinkAttachSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/files/link` — store a web link as a first-class asset.
 *
 * Zod-validates the payload ({@link LinkAttachSchema}) and delegates to the fat
 * {@link FilesBackendService.attachLink}.
 *
 * **The payload's `ownerType`/`ownerId` are a REQUEST, not the answer** — the acting principal comes
 * from `ctx.state.userContext` and the service resolves the library the link is filed into. It matters
 * more here than the shape suggests: the ingest fetch runs on OUR network under OUR egress, so a link
 * filed into someone else's library would also be a fetch attributed to them.
 *
 * **The schema's `https:`-only regex is a cheap gate, not the boundary.** `https://127.0.0.1/…` and
 * `https://metadata.internal/…` both satisfy it, and the service resolves the URL SERVER-side for its
 * title and favicon — so the host guards (loopback, link-local, private ranges) live in
 * `@server/services/files/link-scan.ts` and run before anything is fetched. This route adds no guard
 * of its own precisely because a second, weaker copy of that check is how the real one gets bypassed.
 *
 * Runs under the caller's own session: RLS is the gate, and the library is the acting context's.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = LinkAttachSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That link could not be attached.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await FilesBackendService.attachLink(parsed.data, readActor(ctx)),
		);
	},
});
