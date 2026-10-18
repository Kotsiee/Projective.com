import {
	HELP_CENTRE_RESULT_LIMIT,
	type HelpCentreSearchResponse,
	HelpCentreSearchResponseSchema,
} from "@projective/types/editorial";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import {
	type EditorialReadOptions,
	type EditorialSource,
	readEditorialTable,
} from "./editorial-source.ts";
import { HELP_ARTICLE_CONTENT, HELP_CATEGORY_CONTENT } from "./content/help.ts";
import { buildHelpLibrary, type HelpCentreLibrary } from "./help-library.ts";
import { buildHelpSearchIndex, type HelpSearchIndex, searchHelp } from "./help-search.ts";

/**
 * HelpBackendService — the FAT service behind `/help` and `/api/help/search` (P2, Decision #274).
 *
 * It reads the two help tables through the shared editorial reader (`readEditorialTable`): live, the
 * rows of `editorial.help_categories` / `editorial.help_articles` through the anon client; with
 * `EDITORIAL_BACKEND_LIVE` off, the content source (`content/help.ts`) through the same row parse and
 * mapping. Both roads apply the articles' visibility (published, not archived) at the same instant.
 * The records are organised once into a {@link HelpCentreLibrary} — topics, reading order, neighbours,
 * related reads, the role columns and the FAQ — and indexed once for search, then kept for
 * {@link HELP_CACHE_TTL_MS}: help content changes only when a migration lands, and a fresh read every
 * few minutes keeps a publication date honoured without a read per page view.
 *
 * Failures are answers: an unreachable or unexposed `editorial` schema is a 503, a row that fails its
 * schema a 500 (from the reader); neither is cached, so the next request tries again.
 */

// #region Cache
/** How long one read of the help tables is served before it is read again. */
export const HELP_CACHE_TTL_MS = 5 * 60_000;

/** The organised, indexed help centre one read produced. */
export interface HelpCentreSnapshot {
	library: HelpCentreLibrary;
	index: HelpSearchIndex;
	source: EditorialSource;
}

/** One cached read per road, so a gate flip in a test or a dev session never serves the other road. */
const cache = new Map<EditorialSource | "default", { at: number; snapshot: HelpCentreSnapshot }>();
// #endregion

// #region Seams
/** Overrides for the service's reads — tests pass them; routes pass none. */
export interface HelpReadOptions extends EditorialReadOptions {
	/** Skip the cache (and do not fill it). */
	fresh?: boolean;
}
// #endregion

export class HelpBackendService {
	/**
	 * The organised help centre and its search index. Cached for {@link HELP_CACHE_TTL_MS} unless the
	 * caller injects a road, a client or an instant (a test), which always reads fresh.
	 */
	static async snapshot(options: HelpReadOptions = {}): Promise<ServiceResult<HelpCentreSnapshot>> {
		const injected = options.fresh || options.client !== undefined || options.now !== undefined;
		const key = options.source ?? "default";
		const cached = cache.get(key);
		if (!injected && cached && Date.now() - cached.at < HELP_CACHE_TTL_MS) {
			return ok(cached.snapshot);
		}

		const [categories, articles] = await Promise.all([
			readEditorialTable(HELP_CATEGORY_CONTENT, options),
			readEditorialTable(HELP_ARTICLE_CONTENT, options),
		]);
		if (!categories.ok || !categories.data) return fail(categories.status, categories);
		if (!articles.ok || !articles.data) return fail(articles.status, articles);

		const library = buildHelpLibrary(categories.data.records, articles.data.records);
		const snapshot: HelpCentreSnapshot = {
			library,
			index: buildHelpSearchIndex(library),
			source: articles.data.source,
		};
		if (!injected) cache.set(key, { at: Date.now(), snapshot });
		return ok(snapshot);
	}

	/**
	 * Search the help centre. The query is the parsed `?q=` (trimmed, at most 120 characters); an
	 * empty one answers no results rather than everything.
	 */
	static async search(
		query: string,
		options: HelpReadOptions = {},
	): Promise<ServiceResult<HelpCentreSearchResponse>> {
		const read = await HelpBackendService.snapshot(options);
		if (!read.ok || !read.data) return fail(read.status, read);
		const results = query.trim().length === 0
			? []
			: searchHelp(read.data.index, query, HELP_CENTRE_RESULT_LIMIT);
		return ok(HelpCentreSearchResponseSchema.parse({ query, results }));
	}

	/** Forget the cached read — tests, and a process that wants the next request to read again. */
	static clearCache(): void {
		cache.clear();
	}
}
