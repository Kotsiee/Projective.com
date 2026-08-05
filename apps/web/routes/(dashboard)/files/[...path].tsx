import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { type AssetListParams, simFromParams } from "@projective/types/files";
import { actorFromContext, fixtureOwner } from "@server/services/files/acting-principal.ts";
import { resolveFilesBootstrap } from "@web/features/files/core/files-ssr.ts";
import FilesHub from "@web/features/files/islands/FilesHub.island.tsx";

/**
 * `/files/…` — the personal/entity asset library, at any depth.
 *
 * A **wildcard** route (the `/submissions` precedent, Decision #33) so every folder is a real,
 * deep-linkable, shareable URL that the tree, the breadcrumbs and the address bar all address
 * identically. `/files` itself matches with zero trailing segments; `./index.tsx` re-exports this
 * module so the root and a deep folder resolve through ONE code path and cannot drift.
 *
 * **The hub is not only the library.** A project channel's attachments and a connected drive appear
 * here as MOUNTED sections, and `AssetListPage.readOnly` — a fact about the LOCATION, distinct from
 * the per-asset `canManage` — is what tells the body to withhold the write affordances rather than
 * offer them and refuse each attempt.
 *
 * Thin controller. The guest bounce is the `(dashboard)` middleware's job and there is no capability
 * gate here: the Dev Context Switcher is a CLIENT seam the server cannot see, so a capability bounce
 * would make every dev axis inert (Decision #53(b)). RLS under the caller's JWT is the real gate once
 * `FILES_BACKEND_LIVE` is on.
 *
 * **The owner is derived, never accepted.** `actorFromContext` reads the session the middleware
 * already hydrated and `fixtureOwner` resolves the library a read is attributed to, so "whose files
 * are these?" is answered server-side rather than by whatever the URL asked for.
 *
 * The page and the tree are resolved TOGETHER (`resolveFilesBootstrap` issues both at once — they are
 * independent, and awaiting the tree behind the page would add its latency to every navigation), so
 * the lane, the header band and the body all ship resolved in the first byte.
 *
 * No redirect lives in the page component: a `Response` returned from a Fresh `define.page` is DEAD
 * CODE — the exact bug that left every gated workspace module rendering a blank body (Decision #61).
 * Anything conditional belongs in `define.handlers`, which is where this route's whole resolution is.
 */

// #region Path
/**
 * Decode the wildcard tail into path SEGMENTS.
 *
 * Each was encoded independently by `folderHref`/`pathKey`, so a folder literally named `a/b` cannot
 * be read back as the nested pair `["a", "b"]`. A segment that will not decode is kept verbatim: a
 * malformed crumb should resolve to "no such folder", not to a 500.
 */
function segmentsOf(raw: string | undefined): string[] {
	return (raw ?? "")
		.split("/")
		.filter((part) => part.length > 0)
		.map((part) => {
			try {
				return decodeURIComponent(part);
			} catch {
				return part;
			}
		});
}
// #endregion

export const handler = define.handlers({
	async GET(ctx) {
		const path = segmentsOf(ctx.params.path);
		const owner = fixtureOwner(actorFromContext(ctx.state.userContext));

		const params: AssetListParams = {
			scope: "hub",
			subjectId: owner.ownerId,
			// Omitted rather than sent as `[]`, so the root read and a deep read differ in the one field
			// that actually means something to the resolver.
			path: path.length > 0 ? path : undefined,
			sort: "date",
			dir: "desc",
		};

		// Parsed from the QUERY, never from the client seam the server cannot see — so a developer who
		// arrives on a `sim*` URL sees the simulated projection in the first byte instead of watching the
		// real data flash past on the way to the axis they are exercising.
		const sim = simFromParams(ctx.url.searchParams);

		const { page: listing, tree } = await resolveFilesBootstrap(params, owner, sim);

		ctx.state.title = path.length > 0
			? `${path[path.length - 1]} · Files · Projective`
			: "Files · Projective";

		return page({ listing, tree, path });
	},
});

export default define.page<typeof handler>(function FilesHubPage({ data }) {
	return <FilesHub initial={data.listing} tree={data.tree} path={data.path} base="/files" />;
});
