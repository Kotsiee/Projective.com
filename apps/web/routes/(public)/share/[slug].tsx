import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { resolveShare } from "@web/features/files/core/files-ssr.ts";
import SharedAsset from "@web/features/files/islands/SharedAsset.island.tsx";

/**
 * `/share/[slug]` — the public resolution of a share link. **The one files surface a stranger can
 * reach.**
 *
 * It lives in `(public)`, not `(dashboard)`, and that placement is the whole feature: a share link is
 * a capability URL handed to someone who has no account, and a page behind a sign-in wall shares
 * nothing. Nothing in this handler reads the session, the cookie or the user context, so there is no
 * path by which a signed-in visitor is treated differently from an anonymous one — the slug is the
 * credential, and holding it is the entire test.
 *
 * ## Every failure is ONE answer
 *
 * {@link resolveShare} already collapses not-found · expired · revoked · exhausted · service-failure
 * into `not_found` at the SSR boundary, so this route cannot tell them apart even by accident. It
 * renders the same body, with the same words, at the same 404, for all of them.
 *
 * That is not politeness about a broken link — it is the only thing standing between an opaque
 * capability space and an enumeration oracle. "This link expired" confirms that the slug was real,
 * which is the single bit a scanner is probing for; once one slug is confirmed real, the shape of the
 * namespace is known and the guessing becomes worth doing. A 404 that never varies leaks nothing but
 * the fact that somebody asked.
 *
 * ## Two headers, and why each is here
 *
 * - **`X-Robots-Tag: noindex, nofollow`** — a share URL gets pasted into a public place eventually,
 *   and a crawler that indexes it turns a link the sender chose to give to one person into a search
 *   result. `nofollow` rides along so a crawler that reached the page anyway does not walk the
 *   download out of it.
 * - **`Referrer-Policy: no-referrer`** — the slug is IN the URL, so any `Referer` this page emits
 *   carries the credential to a third party. The platform default (`strict-origin-when-cross-origin`)
 *   would still send the full URL on a same-origin request, and the origin on a cross-origin one; on
 *   a page whose whole path is a secret, the only correct answer is to send nothing. The global
 *   middleware now DEFAULTS that header rather than setting it, so this stricter value survives (see
 *   `routes/_middleware.ts`).
 *
 * ## `?u=` is a hint, not a key
 *
 * The optional recipient reference is an opaque, server-minted token used to attribute a download to
 * the copy of the link that was actually opened — the verification hint for semi-private, link-only
 * sharing. It is **not** a credential: the slug alone resolves, and a `u` that is missing, stale or
 * fabricated changes nothing about whether the file is served. It is passed through to the service
 * untouched, never echoed into the response, and never rendered. It is also never a handle, a user id
 * or an email, because a share URL is forwarded and pasted into public places and personal data must
 * not travel in a query string (root CLAUDE.md §Privacy).
 *
 * Thin controller: parse, resolve, hand the result to the island. No redirect and no branch lives in
 * the page component — a `Response` returned from a Fresh `define.page` is dead code (Decision #61).
 */

// #region Response headers
/**
 * The headers BOTH outcomes carry.
 *
 * One frozen object rather than two literals, so the live page and the dead one cannot come to differ
 * in their header set — a difference between them is as good an oracle as a difference in the body.
 */
const SHARE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"x-robots-tag": "noindex, nofollow",
	"referrer-policy": "no-referrer",
});
// #endregion

export const handler = define.handlers({
	async GET(ctx) {
		const slug = ctx.params.slug ?? "";
		const resolution = await resolveShare(slug, ctx.url.searchParams.get("u"));
		const asset = resolution.state === "ok" ? resolution.asset : null;

		ctx.state.title = asset
			? `${asset.name} · Shared with you · Projective`
			: "Link not available · Projective";

		return page({ asset, slug }, {
			// A dead link answers 404 in the STATUS as well as the body: a soft 200 would tell a crawler
			// the URL is a real page worth revisiting, and tell a link checker the opposite of the truth.
			status: asset ? 200 : 404,
			headers: SHARE_HEADERS,
		});
	},
});

export default define.page<typeof handler>(function SharePage({ data }) {
	return <SharedAsset asset={data.asset} slug={data.slug} />;
});
