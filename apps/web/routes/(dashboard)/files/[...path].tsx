import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import type { AssetListParams } from "@projective/types/files";
import { readActor } from "@web/utils/api-session.ts";
import { cspHeaderFor } from "@web/utils/csp.ts";
import { resolveFilesBootstrap } from "@web/features/files/core/files-ssr.ts";
import { facetsOfSearch } from "@web/features/files/core/asset-model.ts";
import { isPurchasesView, isSharedView } from "@web/features/files/core/files-lane-slot.tsx";
import FilesHub from "@web/features/files/islands/FilesHub.island.tsx";
import PurchasesView from "@web/features/files/islands/PurchasesView.island.tsx";
import SharedWithMe from "@web/features/files/islands/SharedWithMe.island.tsx";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { EntitlementSlug } from "@projective/types/catalogue";
import { DeliveryBackendService } from "@server/services/catalogue/DeliveryBackendService.ts";
import ReviewDialog from "@features/reviews/islands/ReviewDialog.island.tsx";
import {
	applyReviewStateSim,
	parseReviewStateSim,
	REVIEW_STATE_SIM_COOKIE,
} from "@features/reviews/core/review-state-sim.ts";
import { ReviewsBackendService } from "@server/services/reviews/ReviewsBackendService.ts";
import { isDevelopmentEnv } from "@web/utils/app-env.ts";
import { readCookies } from "@web/utils/auth-cookies.ts";

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
 * Thin controller. The guest bounce is the `(dashboard)` middleware's job; RLS under the caller's JWT
 * is the real gate.
 *
 * **The owner is derived, never accepted.** The library is the one the session's acting context owns,
 * so "whose files are these?" is answered server-side rather than by whatever the URL asked for. A
 * location that could not be read says so rather than rendering as an empty library.
 *
 * The page and the tree are resolved TOGETHER (`resolveFilesBootstrap` issues both at once — they are
 * independent, and awaiting the tree behind the page would add its latency to every navigation), so
 * the lane, the header band and the body all ship resolved in the first byte.
 *
 * No redirect lives in the page component: a `Response` returned from a Fresh `define.page` is DEAD
 * CODE — the exact bug that left every gated workspace module rendering a blank body (Decision #61).
 * Anything conditional belongs in `define.handlers`, which is where this route's whole resolution is.
 *
 * **The page answers with the `inspector` CSP profile** (Decision #396): its previews and thumbnails
 * draw 3D models here, and those decoders need WebAssembly and `blob:` reads.
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
		// What the acting account bought (Decision #488): a page state of `/files`, not a folder.
		if (isPurchasesView(ctx.url)) {
			const actor = readActor(ctx);
			const focus = EntitlementSlug.safeParse(ctx.url.searchParams.get("entitlement")).data ?? null;
			// `&review=ent-…` opens the review dialog on that purchase (Decision #487 RV1, ROUTING.md).
			const reviewSlug = EntitlementSlug.safeParse(ctx.url.searchParams.get("review")).data ?? null;
			const [result, reviewables] = await Promise.all([
				DeliveryBackendService.purchases(actor),
				reviewSlug ? ReviewsBackendService.reviewables(reviewSlug, actor) : null,
			]);
			// The Dev Context Switcher's review state, honoured in development only (review-state-sim.ts).
			const reviewSim = isDevelopmentEnv()
				? parseReviewStateSim(readCookies(ctx.req)[REVIEW_STATE_SIM_COOKIE])
				: null;
			ctx.state.title = "Purchases · Files · Projective";
			return page({
				kind: "purchases" as const,
				purchases: result.data?.purchases ?? [],
				error: result.ok ? null : result.message ?? "We couldn't load your purchases just now.",
				focus,
				review: reviewSlug && reviewables?.ok
					? {
						slug: reviewSlug,
						items: applyReviewStateSim(reviewables.data ?? [], reviewSim),
					}
					: null,
			}, { status: result.ok ? 200 : result.status });
		}

		// What other people shared with the viewer (Decision #570): a page state of `/files`, not a folder.
		if (isSharedView(ctx.url)) {
			const result = await FilesBackendService.sharedWithMe(readActor(ctx));
			ctx.state.title = "Shared with me · Files · Projective";
			return page({
				kind: "shared" as const,
				files: result.data?.files ?? [],
				error: result.ok
					? null
					: result.message ?? "We couldn't load what was shared with you just now.",
			}, { status: result.ok ? 200 : result.status });
		}

		const path = segmentsOf(ctx.params.path);
		const params: AssetListParams = {
			scope: "hub",
			// Omitted rather than sent as `[]`, so the root read and a deep read differ in the one field
			// that actually means something to the resolver.
			path: path.length > 0 ? path : undefined,
			sort: "date",
			dir: "desc",
			// `?categories=` · `?sources=` · `?visibility=`, so a filtered link paints filtered.
			...facetsOfSearch(ctx.url.search),
		};

		const { page: listing, tree, error, status } = await resolveFilesBootstrap(params, readActor(ctx));

		const here = path.length > 0 ? listing.crumbs.at(-1)?.label : null;
		ctx.state.title = here ? `${here} · Files · Projective` : "Files · Projective";

		return page({ kind: "library" as const, listing, tree, path, error }, {
			status: error ? status : 200,
			headers: { "content-security-policy": cspHeaderFor("inspector") },
		});
	},
});

export default define.page<typeof handler>(function FilesHubPage({ data }) {
	if (data.kind === "shared") return <SharedWithMe files={data.files} error={data.error} />;
	if (data.kind === "purchases") {
		return (
			<>
				<PurchasesView purchases={data.purchases} error={data.error} focus={data.focus} />
				{data.review && data.review.items.length > 0 && (
					<ReviewDialog slug={data.review.slug} items={data.review.items} initialOpen />
				)}
			</>
		);
	}
	return (
		<FilesHub
			initial={data.listing}
			initialError={data.error}
			tree={data.tree}
			path={data.path}
			base="/files"
		/>
	);
});
