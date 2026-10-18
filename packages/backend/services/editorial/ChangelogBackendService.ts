import type {
	ChangelogCategory,
	ChangelogRelease,
	ChangelogReleaseRow,
} from "@projective/types/editorial";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import {
	type EditorialContent,
	type EditorialReadOptions,
	type EditorialSource,
	readEditorialTable,
} from "./editorial-source.ts";
import { CHANGELOG_RELEASE_CONTENT } from "./content/changelog.ts";
import {
	categoryCounts,
	CHANGELOG_PAGE_SIZE,
	type ChangelogNeighbours,
	filterReleasesByCategory,
	pageCountOf,
	paginate,
	releaseNeighbours,
	sortReleasesNewestFirst,
} from "./changelog-feed.ts";

/**
 * ChangelogBackendService — the FAT read behind `/changelog`, `/changelog/[version]` and the RSS feed
 * (P5, Decisions #274 / #278).
 *
 * Releases are rows of `editorial.changelog_releases`, read through {@link readEditorialTable}: the
 * anon client when `EDITORIAL_BACKEND_LIVE` is on, otherwise the content source's own records pushed
 * through the same row parse and mapping. Either way the table's `visible` predicate has already
 * dropped a withdrawn release and one dated after today (UTC), so nothing here filters visibility
 * again. The table is small (one row per milestone), so the service reads it whole and orders,
 * filters and pages it in TypeScript (`changelog-feed.ts`) — one code path for both roads.
 *
 * Every method answers a {@link ServiceResult}: a 503 when the database is unreachable or the schema
 * is not exposed, a 500 when a row fails its schema, a 404 for a release or a page that does not
 * exist. No method throws for an expected outcome.
 */

// #region Types
/** Overrides for every method — tests inject them; routes pass none. */
export interface ChangelogReadOptions extends EditorialReadOptions {
	/** The release table and its records; defaults to the changelog's content source. */
	content?: EditorialContent<ChangelogReleaseRow, ChangelogRelease>;
}

/** The feed's query: the selected categories (any of them) and a 1-based page. */
export interface ChangelogFeedQuery {
	categories: readonly ChangelogCategory[];
	page: number;
}

/** Every visible release, newest first. */
export interface ChangelogReleases {
	releases: ChangelogRelease[];
	source: EditorialSource;
}

/** One page of the feed. */
export interface ChangelogFeed {
	/** This page's releases, newest first. */
	releases: ChangelogRelease[];
	page: number;
	pageCount: number;
	/** Releases matching the filter, across every page. */
	total: number;
	/** Every visible release, filter or not. */
	allCount: number;
	pageSize: number;
	/** The categories selected, in the order given. */
	selected: ChangelogCategory[];
	/** How many visible releases carry each category (unfiltered), in filter order. */
	categories: Array<{ category: ChangelogCategory; count: number }>;
	/** The newest visible release (marked on the timeline), whatever the filter or page. */
	latest: Pick<ChangelogRelease, "version" | "releasedOn"> | null;
	source: EditorialSource;
}

/** One release with its neighbours. */
export interface ChangelogReleaseView extends ChangelogNeighbours {
	source: EditorialSource;
}
// #endregion

export class ChangelogBackendService {
	/** Every visible release, newest first (release day, then version precedence). */
	static async releases(
		options: ChangelogReadOptions = {},
	): Promise<ServiceResult<ChangelogReleases>> {
		const { content = CHANGELOG_RELEASE_CONTENT, ...read } = options;
		const result = await readEditorialTable(content, read);
		if (!result.ok || !result.data) {
			return fail(result.status, { message: result.message, details: result.details });
		}
		return ok({
			releases: sortReleasesNewestFirst(result.data.records),
			source: result.data.source,
		});
	}

	/**
	 * One page of the feed: the releases in ANY of `query.categories` (all when none), ten to a page,
	 * newest first, with the per-category counts over every visible release. A page past the last —
	 * or any page but 1 of an empty result — is a 404.
	 */
	static async feed(
		query: ChangelogFeedQuery,
		options: ChangelogReadOptions = {},
	): Promise<ServiceResult<ChangelogFeed>> {
		const all = await ChangelogBackendService.releases(options);
		if (!all.ok || !all.data) {
			return fail(all.status, { message: all.message, details: all.details });
		}
		const { releases, source } = all.data;
		const matching = filterReleasesByCategory(releases, query.categories);
		const page = paginate(matching, query.page, CHANGELOG_PAGE_SIZE);
		if (!page) {
			return fail(404, {
				message: "There is no such page of releases.",
				details: { page: query.page, pageCount: pageCountOf(matching.length) },
			});
		}
		const latest = releases[0] ?? null;
		return ok({
			releases: page.items,
			page: page.page,
			pageCount: page.pageCount,
			total: page.total,
			allCount: releases.length,
			pageSize: CHANGELOG_PAGE_SIZE,
			selected: [...query.categories],
			categories: categoryCounts(releases),
			latest: latest ? { version: latest.version, releasedOn: latest.releasedOn } : null,
			source,
		});
	}

	/**
	 * One release by its exact version, with the releases either side of it. A version that is not
	 * visible — unknown, withdrawn or not out yet — is a 404, the same answer for all three.
	 */
	static async release(
		version: string,
		options: ChangelogReadOptions = {},
	): Promise<ServiceResult<ChangelogReleaseView>> {
		const all = await ChangelogBackendService.releases(options);
		if (!all.ok || !all.data) {
			return fail(all.status, { message: all.message, details: all.details });
		}
		const found = releaseNeighbours(all.data.releases, version);
		if (!found) return fail(404, { message: "There is no release with that version." });
		return ok({ ...found, source: all.data.source });
	}
}
