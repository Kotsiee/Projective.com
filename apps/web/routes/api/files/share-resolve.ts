import { define } from "@web/utils/state.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import type { FilesResult } from "@features/files/types/results.ts";
import type { ShareResolution } from "@projective/types/files";

/**
 * `GET /api/files/share-resolve?slug=&u=` — resolve a share slug. **The one PUBLIC route in this
 * folder.**
 *
 * It lives under `routes/api/` rather than `routes/(dashboard)/`, so the dashboard auth guard — which
 * is scoped to that route group and bounces a guest to `/login` — never runs for it. That placement is
 * the whole point: a share link is a capability URL handed to someone who has no account, and a
 * resolver behind a sign-in wall resolves nothing. Nothing in this handler reads `ctx.state`, the
 * session cookie, or the user context, so there is no path by which an unauthenticated request is
 * treated differently from an authenticated one.
 *
 * **Every failure resolves identically.** The fat {@link FilesBackendService.resolveShare} returns
 * `not_found` · `expired` · `revoked` · `exhausted` DISTINCTLY so the service can log and meter them —
 * an owner's "your link was used after it expired" audit line needs the difference. This route
 * collapses all four, plus a missing slug and a service failure, into ONE identical 404 with ONE
 * identical body: telling an anonymous caller "this link expired" rather than "no such link" confirms
 * that a link existed, which is the single bit an enumeration attack needs. The collapse happens in
 * {@link notFound} so there is exactly one shape to audit, rather than five call sites that must
 * remember to agree.
 *
 * `u` is an OPAQUE, server-minted per-recipient reference used to attribute a download to the copy of
 * the link that was actually opened. It is never a handle, a user id or an email — a share URL gets
 * forwarded and pasted into public places, and personal data must never travel in a query string (root
 * CLAUDE.md §Privacy). It is passed through untouched and never echoed into the response.
 */

// #region The single failure answer
/**
 * The one response every non-`ok` outcome produces.
 *
 * Built from a single frozen body so the four service states, the missing-slug case and a service
 * failure are byte-identical — a difference in wording, field order or status between any two of them
 * is an oracle.
 */
const NOT_FOUND: Readonly<FilesResult<never>> = Object.freeze({
	ok: false,
	message: "That link is not available.",
});

/** The identical 404 for every failure path. */
function notFound(): Response {
	return Response.json(NOT_FOUND, { status: 404 });
}
// #endregion

export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const slug = sp.get("slug");
		// A missing slug answers exactly as an unknown one does — a 400 here would separate "you asked
		// badly" from "no such link", and the second of those is the fact worth hiding.
		if (!slug) return notFound();

		const result = await FilesBackendService.resolveShare(slug, sp.get("u"));
		if (!result.ok || !result.data || result.data.state !== "ok") return notFound();

		const body: FilesResult<ShareResolution> = { ok: true, data: result.data };
		return Response.json(body, { status: 200 });
	},
});
