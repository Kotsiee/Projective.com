import { define } from "@web/utils/state.ts";
import { DedupCheckSchema, simFromParams } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";

/**
 * `POST /api/files/dedup` — the thin route for the pre-flight duplicate check.
 *
 * Zod-validates a whole drop's fingerprints in one payload ({@link DedupCheckSchema}, capped at
 * `DEDUP_BATCH_MAX`), then delegates to the fat {@link FilesBackendService.dedupCheck}. Verdicts come
 * back positionally aligned with `fingerprints`.
 *
 * This runs BEFORE any bytes move, which is the only moment at which "you already have this" saves
 * anybody anything — a 400 MB re-upload becomes a click. A `sampled-sha-256` match is a CANDIDATE and
 * never authoritative; the server re-digests in full at `upload-complete` before it collapses two rows
 * onto one stored object, because a false positive there does not save a copy, it silently replaces
 * one person's file with someone else's.
 *
 * **The acting principal comes from the SESSION, and the index searched is theirs.** A duplicate check
 * that accepted a target owner would answer "does this exact file exist in that person's library?" —
 * a content-addressed read of a library the caller may not hold.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = DedupCheckSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That duplicate check is not valid.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await FilesBackendService.dedupCheck(
				parsed.data,
				actorFromContext(ctx.state.userContext),
				simFromParams(ctx.url.searchParams),
			),
		);
	},
});
