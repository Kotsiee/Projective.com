/**
 * sitemap-sources — the public marketplace's share of the sitemap (Decision #452), read off the
 * anonymous discovery catalogue (`loadCatalog`, RLS as `anon`). Pure over a {@link Catalog}.
 *
 * Listed:
 * - every published service, product and member post, by its slug (`/view/:slug` is its one
 *   canonical page);
 * - every public person, team and business profile, by its `@handle`.
 *
 * Never listed:
 * - a row whose own status is not `published` (draft, paused, archived). The anonymous read asks for
 *   published rows only; this holds the line whatever catalogue it is handed;
 * - anything whose owner is not public in the directory (`listed`): an unlisted or private owner chose
 *   not to be listed, and a 13–17 account is never public (Decision #208,
 *   `org.trg_users_public_minor_visibility`), so neither is anything it wrote;
 * - project briefs, which close once hired.
 *
 * @module
 */
import type { ExploreItem } from "@projective/types/explore";
import type { Catalog } from "./live-catalog.ts";

// #region Types
/** One listing page a search engine may index. */
export interface PublicSitemapListing {
	/** The item's slug (`svc-…`, `prd-…`, `art-…`). */
	slug: string;
	/** When its row last changed (ISO date-time). */
	updatedAt: string;
}

/** One public profile a search engine may index. */
export interface PublicSitemapProfile {
	/** The profile's `@handle`. */
	handle: string;
}

/** The marketplace's sitemap sources, in catalogue order. */
export interface PublicSitemapSources {
	listings: PublicSitemapListing[];
	profiles: PublicSitemapProfile[];
}
// #endregion

// #region Selection
const LISTING_TYPES: ReadonlySet<ExploreItem["type"]> = new Set([
	"services",
	"products",
	"articles",
]);
const PROFILE_TYPES: ReadonlySet<ExploreItem["type"]> = new Set([
	"users",
	"freelancers",
	"teams",
	"businesses",
]);

/** Every published listing and post with a public owner, and every public profile, in `catalog`. */
export function sitemapSourcesOf(catalog: Catalog): PublicSitemapSources {
	const listings: PublicSitemapListing[] = [];
	const profiles: PublicSitemapProfile[] = [];
	for (const item of catalog.items) {
		if (catalog.profileByHandle.get(item.owner.handle)?.listed !== true) continue;
		if (PROFILE_TYPES.has(item.type)) {
			profiles.push({ handle: item.owner.handle });
			continue;
		}
		if (!LISTING_TYPES.has(item.type)) continue;
		const publication = catalog.publicationById.get(item.id);
		if (publication?.status !== "published") continue;
		listings.push({ slug: item.id, updatedAt: publication.updatedAt });
	}
	return { listings, profiles };
}
// #endregion
