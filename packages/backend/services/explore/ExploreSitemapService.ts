import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { loadCatalog } from "./live-catalog.ts";
import { type PublicSitemapSources, sitemapSourcesOf } from "./sitemap-sources.ts";

/**
 * ExploreSitemapService — the public listings and profiles `/sitemap.xml` may list (Decision #452).
 *
 * Read from the shared discovery catalogue, which is loaded as `anon`: one answer for every caller,
 * with no session and no service role. The selection rules live in {@link sitemapSourcesOf}.
 */
export const ExploreSitemapService = {
	/** The marketplace's sitemap sources; `503` when the catalogue cannot be read. */
	async sources(): Promise<ServiceResult<PublicSitemapSources>> {
		try {
			return ok(sitemapSourcesOf(await loadCatalog()));
		} catch (error) {
			console.error("[explore] sitemap sources unavailable", error);
			return fail(503, { message: "The marketplace is unavailable right now." });
		}
	},
};
