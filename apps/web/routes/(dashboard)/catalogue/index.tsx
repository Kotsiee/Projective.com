import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import CatalogueScreen from "@features/catalogue/islands/CatalogueScreen.island.tsx";
import { resolveCataloguePage } from "@features/catalogue/core/catalogue-ssr.ts";
import { toSort, toTypeFilter } from "@features/catalogue/core/catalogue-model.ts";

/**
 * `/catalogue` — the seller Catalogue console. Thin controller: the guest bounce is the `(dashboard)`
 * middleware's job, and seller-ness is a CHROME concern (the dev-seam-reactive sidebar surfaces the
 * Catalogue rail only to sellers) + the deferred RLS gate — deliberately NOT a hard server-side
 * capability redirect, because the client-side **Dev Context Switcher** can flip an authed dev to a
 * seller persona at runtime and the server never sees that override; a hard `isFreelancer` bounce would
 * make the surface unreachable via the switcher (no other route gates on `isFreelancer` for this reason,
 * Decisions #14/#16/#48). The active `?type=` / `?sort=` / `?search=` scope the SSR page so the console
 * (and the lane) paint filtered in the first byte; the {@link CatalogueScreen} island then refines
 * client-side. A single unified surface — Products + Services are `?type=` segments, not two routes.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const type = toTypeFilter(ctx.url.searchParams.get("type"));
		const sort = toSort(ctx.url.searchParams.get("sort"));
		const search = ctx.url.searchParams.get("search") ?? "";
		const { page: pageData } = resolveCataloguePage(context, {
			type,
			sort,
			search: search || undefined,
		});
		ctx.state.title = "Catalogue · Projective";
		return page({ page: pageData, type, sort, search });
	},
});

export default define.page<typeof handler>(function CataloguePage({ data }) {
	return (
		<CatalogueScreen
			initial={data.page}
			type={data.type}
			initialSort={data.sort}
			initialSearch={data.search}
		/>
	);
});
