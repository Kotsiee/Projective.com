import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import CatalogueScreen from "@features/catalogue/islands/CatalogueScreen.island.tsx";
import { consoleParamsOf, resolveCataloguePage } from "@features/catalogue/core/catalogue-ssr.ts";
import { toSort, toTypeFilter } from "@features/catalogue/core/catalogue-model.ts";

/**
 * `/catalogue` — the seller Catalogue console. Thin controller: the guest bounce is the `(dashboard)`
 * middleware's job; the catalogue is read as the signed-in seller, so the catalogue policies are the
 * gate (a buyer simply has no listings). The active `?type=` / `?sort=` / `?search=` scope the SSR page
 * so the console (and the lane) paint filtered in the first byte; the {@link CatalogueScreen} island
 * then refines client-side. A single unified surface — Products + Services are `?type=` segments, not
 * two routes. A read that failed paints the console's error state, never an empty catalogue.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const type = toTypeFilter(ctx.url.searchParams.get("type"));
		const sort = toSort(ctx.url.searchParams.get("sort"));
		const search = ctx.url.searchParams.get("search") ?? "";
		const { page: pageData, error } = await resolveCataloguePage(
			context,
			ctx.url,
			readActor(ctx),
			consoleParamsOf(ctx.url),
		);
		ctx.state.title = "Catalogue · Projective";
		return page({ page: pageData, error, type, sort, search }, error ? { status: 503 } : undefined);
	},
});

export default define.page<typeof handler>(function CataloguePage({ data }) {
	return (
		<CatalogueScreen
			initial={data.page}
			initialError={data.error}
			type={data.type}
			initialSort={data.sort}
			initialSearch={data.search}
		/>
	);
});
