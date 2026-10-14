import type {
	AnalyticsPeriod,
	AnalyticsScope,
	CatalogueAnalytics,
} from "@projective/types/catalogue";
import { isCatalogueBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import {
	type CatalogueAnalyticsSim,
	fixtureOverview,
	isCatalogueAnalyticsSim,
} from "./analytics-fixtures.ts";
import { liveOverview } from "./live-catalogue-analytics.ts";

/**
 * CatalogueAnalyticsBackendService — the FAT read behind the console's Analytics view and the item
 * workspace's Analytics tab (plan §4.7): tiles, the revenue series, the funnel, the booking heatmap,
 * keywords and top listings for one scope and window.
 *
 * LIVE, it reads `analytics.daily_rollups` (through `catalogue.get_listing_rollups`) as the signed-in seller and assembles them with the pure
 * `analytics-model`. With `CATALOGUE_BACKEND_LIVE=false` it answers deterministic fixtures, shaped by
 * the `catalogueAnalytics` dev axis (`sim`), through the same assembler. A guest gets a 401 either way.
 */

const SIGNED_OUT = "Sign in to manage your catalogue.";
const UNREACHABLE = "We couldn't load your analytics just now. Try again in a moment.";
const NO_LISTING = "No such listing.";

/** The dev axis value a request may use; anything unknown is `auto`. */
export function effectiveAnalyticsSim(raw: string | null | undefined): CatalogueAnalyticsSim {
	return raw && isCatalogueAnalyticsSim(raw) ? raw : "auto";
}

export class CatalogueAnalyticsBackendService {
	/**
	 * The analytics for `scope` over `period`, ending on the last rolled-up day (today is never in
	 * the window). `display` is the viewer's display currency, used only when gross spans currencies.
	 * A listing scope the caller does not manage is a 404 worded as a missing one.
	 */
	static async overview(
		scope: AnalyticsScope,
		period: AnalyticsPeriod,
		actor: ReadActor,
		display: string,
		options: { sim?: string | null; now?: Date } = {},
	): Promise<ServiceResult<CatalogueAnalytics>> {
		const now = options.now ?? new Date();
		if (!isCatalogueBackendLive()) {
			if (!actor.userId) return fail(401, { message: SIGNED_OUT });
			const data = fixtureOverview(scope, period, effectiveAnalyticsSim(options.sim), display, now);
			return data ? ok(data) : fail(404, { message: NO_LISTING });
		}
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const data = await liveOverview(scope, period, actor, display, now);
			return data ? ok(data) : fail(404, { message: NO_LISTING });
		} catch (error) {
			console.error("[catalogue:analytics]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}
}
