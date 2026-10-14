import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { CataloguePeriod } from "@projective/types/catalogue";
import { readActor } from "@web/utils/api-session.ts";
import { toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { toSort, toTypeFilter } from "@features/catalogue/core/catalogue-model.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";
import { ListingStatus, ServiceType } from "@projective/types/catalogue";
import { CreateCategory } from "@projective/types/org";
import type { CatalogueListParams, CatalogueSortDir } from "@projective/types/catalogue";

/**
 * `GET /api/catalogue/list?type=&status=&model=&createCategory=&search=&sort=&period=&attention=1&promoted=1&bestSelling=1&cursor=&limit=`
 * — thin route: parse the console/lane filters, then delegate to the fat
 * {@link CatalogueBackendService.list} for a filtered, sorted, paged page + the KPI roll-up for the
 * window. Read as the signed-in seller; the catalogue policies are the gate, and a guest gets a 401.
 * Islands never reach the backend — they fetch this via the dumb `CatalogueService`.
 */


export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const sp = ctx.url.searchParams;
		const period = CataloguePeriod.safeParse(sp.get("period"));
		const statusRaw = sp.get("status");
		const modelRaw = sp.get("model");
		const limitRaw = sp.get("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

		const params: CatalogueListParams = {
			type: toTypeFilter(sp.get("type")),
			status: ListingStatus.safeParse(statusRaw).data,
			model: ServiceType.safeParse(modelRaw).data,
			createCategory: CreateCategory.safeParse(sp.get("createCategory")).data,
			search: sp.get("search") || undefined,
			sort: toSort(sp.get("sort")),
			dir: sp.get("dir") === "asc" || sp.get("dir") === "desc"
				? (sp.get("dir") as CatalogueSortDir)
				: undefined,
			period: period.success ? period.data : undefined,
			needsAttention: sp.get("attention") === "1" ? true : undefined,
			promoted: sp.get("promoted") === "1" ? true : undefined,
			bestSelling: sp.get("bestSelling") === "1" ? true : undefined,
			cursor: sp.get("cursor") || null,
			limit: Number.isFinite(limit) ? limit : undefined,
		};

		return toCatalogueResponse(
			await CatalogueBackendService.list(params, readActor(ctx), context.displayCurrency),
		);
	},
});
