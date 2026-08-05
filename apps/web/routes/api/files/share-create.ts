import { define } from "@web/utils/state.ts";
import { CreateShareSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";

/**
 * `POST /api/files/share-create` — mint a read-only capability URL over exactly one asset or one
 * folder.
 *
 * Zod-validates the payload ({@link CreateShareSchema}, which refuses `private` and enforces
 * exactly-one-subject) and delegates to the fat {@link FilesBackendService.createShare}.
 *
 * **The slug is minted server-side and is never in this payload.** A client-chosen slug is a
 * client-chosen entropy budget, and a guessable slug turns the public share route into an enumeration
 * oracle over every private library on the platform. **A share link is READ-ONLY** — it grants viewing
 * and downloading and nothing else, because a URL is a bearer token that gets forwarded,
 * screenshotted and indexed.
 *
 * **The link's creator comes from the SESSION and is never in the payload.** A link minted while acting
 * for a team is still attributable to whoever pressed the button — that is the fact an owner needs when
 * a URL turns up somewhere it should not have.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateShareSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That share link could not be created.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await FilesBackendService.createShare(parsed.data, actorFromContext(ctx.state.userContext)),
		);
	},
});
