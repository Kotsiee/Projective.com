import { define } from "@web/utils/state.ts";
import { toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { toSort, toTypeFilter } from "@features/catalogue/core/catalogue-model.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";
import type {
	CatalogueListParams,
	CatalogueSortDir,
	ListingStatus,
	ServiceType,
} from "@projective/types/catalogue";

/**
 * `GET /api/catalogue/list?type=&status=&model=&search=&sort=&attention=1&promoted=1&cursor=&limit=`
 * — thin route: parse the console/lane filters, then delegate to the fat
 * {@link CatalogueBackendService.list} for a filtered, sorted, paged page + the rolled-up KPI stats. No
 * server-side capability guard — the Dev Context Switcher (client-side) must be able to reach the seller
 * surface; seller-ness is chrome + deferred RLS (matching every sibling `/api/*` read). Islands never
 * reach the backend — they fetch this via the dumb `CatalogueService`.
 */

const STATUSES: readonly ListingStatus[] = ["draft", "published", "paused", "archived"];
const MODELS: readonly ServiceType[] = [
	"Pipeline",
	"One-Off",
	"Direct Deliverable",
	"Session",
	"Group Session",
];

export const handler = define.handlers({
	GET(ctx) {
		const sp = ctx.url.searchParams;
		const statusRaw = sp.get("status");
		const modelRaw = sp.get("model");
		const limitRaw = sp.get("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

		const params: CatalogueListParams = {
			type: toTypeFilter(sp.get("type")),
			status: statusRaw && STATUSES.includes(statusRaw as ListingStatus)
				? (statusRaw as ListingStatus)
				: undefined,
			model: modelRaw && MODELS.includes(modelRaw as ServiceType)
				? (modelRaw as ServiceType)
				: undefined,
			search: sp.get("search") || undefined,
			sort: toSort(sp.get("sort")),
			dir: sp.get("dir") === "asc" || sp.get("dir") === "desc"
				? (sp.get("dir") as CatalogueSortDir)
				: undefined,
			needsAttention: sp.get("attention") === "1" ? true : undefined,
			promoted: sp.get("promoted") === "1" ? true : undefined,
			cursor: sp.get("cursor") || null,
			limit: Number.isFinite(limit) ? limit : undefined,
		};

		return toCatalogueResponse(CatalogueBackendService.list(params));
	},
});
