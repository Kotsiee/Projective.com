import {
	CHANGELOG_CATEGORIES,
	type ChangelogCategory,
	type ChangelogRelease,
} from "@projective/types/editorial";

/**
 * changelog-feed.ts — the changelog's pure rules (P5, Decision #278): release order, the category
 * filter, pagination, the per-category counts and a release's neighbours. No I/O: the service reads
 * the releases (`readEditorialTable`) and composes these, and the unit tests pin them.
 */

// #region Constants
/** Releases per feed page. */
export const CHANGELOG_PAGE_SIZE = 10;
// #endregion

// #region Semantic versions
/** A parsed semantic version. */
interface ParsedVersion {
	core: [number, number, number];
	/** Pre-release identifiers (`["beta", "1"]`); empty for a release version. */
	pre: string[];
}

const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Parse `MAJOR.MINOR.PATCH[-pre]`; `null` for anything else. */
function parseVersion(version: string): ParsedVersion | null {
	const m = SEMVER.exec(version);
	if (!m) return null;
	return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

/** Compare two pre-release identifiers by semver §11: numeric < alphanumeric, numbers by value. */
function compareIdentifier(a: string, b: string): number {
	const an = /^\d+$/.test(a);
	const bn = /^\d+$/.test(b);
	if (an && bn) return Number(a) - Number(b);
	if (an) return -1;
	if (bn) return 1;
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Semantic-version precedence (semver §11): `-1` when `a` is lower than `b`, `1` when higher, `0`
 * when equal. A pre-release is lower than its release (`1.0.0-rc.1` < `1.0.0`). A string that is not
 * a semantic version sorts below every one that is, so a bad record can never lead the feed.
 */
export function compareSemver(a: string, b: string): number {
	const pa = parseVersion(a);
	const pb = parseVersion(b);
	if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
	for (let i = 0; i < 3; i++) {
		if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
	}
	if (pa.pre.length === 0 || pb.pre.length === 0) {
		return pa.pre.length === pb.pre.length ? 0 : pa.pre.length === 0 ? 1 : -1;
	}
	for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
		if (i >= pa.pre.length) return -1;
		if (i >= pb.pre.length) return 1;
		const c = compareIdentifier(pa.pre[i], pb.pre[i]);
		if (c !== 0) return c < 0 ? -1 : 1;
	}
	return 0;
}
// #endregion

// #region Order, filter, counts
/**
 * The feed order, newest first: by release day, then by version precedence (two milestones that
 * closed on the same day keep their version order). Returns a new array.
 */
export function sortReleasesNewestFirst(
	releases: readonly ChangelogRelease[],
): ChangelogRelease[] {
	return [...releases].sort((a, b) =>
		a.releasedOn !== b.releasedOn
			? (a.releasedOn < b.releasedOn ? 1 : -1)
			: compareSemver(b.version, a.version)
	);
}

/**
 * Releases in ANY of `categories` (a release about escrow OR UX passes `["escrow", "ux"]`); every
 * release when none is selected. Order is kept.
 */
export function filterReleasesByCategory(
	releases: readonly ChangelogRelease[],
	categories: readonly ChangelogCategory[],
): ChangelogRelease[] {
	if (categories.length === 0) return [...releases];
	const wanted = new Set(categories);
	return releases.filter((release) => release.categories.some((c) => wanted.has(c)));
}

/** How many of `releases` carry each category, in {@link CHANGELOG_CATEGORIES} order. */
export function categoryCounts(
	releases: readonly ChangelogRelease[],
): Array<{ category: ChangelogCategory; count: number }> {
	return CHANGELOG_CATEGORIES.map((category) => ({
		category,
		count: releases.filter((release) => release.categories.includes(category)).length,
	}));
}
// #endregion

// #region Pagination
/** One page of a list. */
export interface ChangelogPage<T> {
	items: T[];
	/** 1-based page number. */
	page: number;
	/** At least 1, even for an empty list (its one page is empty). */
	pageCount: number;
	/** Items across every page. */
	total: number;
}

/** How many pages `total` items fill at `size` per page — at least one. */
export function pageCountOf(total: number, size = CHANGELOG_PAGE_SIZE): number {
	return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

/**
 * Page `page` (1-based) of `items`, or `null` when there is no such page — page 0, a fraction, or
 * past the last page. Page 1 of an empty list exists and is empty.
 */
export function paginate<T>(
	items: readonly T[],
	page: number,
	size = CHANGELOG_PAGE_SIZE,
): ChangelogPage<T> | null {
	const pageCount = pageCountOf(items.length, size);
	if (!Number.isInteger(page) || page < 1 || page > pageCount) return null;
	const start = (page - 1) * size;
	return { items: items.slice(start, start + size), page, pageCount, total: items.length };
}
// #endregion

// #region Neighbours
/** A release's place in the feed: the release itself and the ones either side of it. */
export interface ChangelogNeighbours {
	release: ChangelogRelease;
	/** The next release after it (more recent); `null` for the newest. */
	newer: ChangelogRelease | null;
	/** The release before it; `null` for the oldest. */
	older: ChangelogRelease | null;
	/** Whether it is the newest release. */
	latest: boolean;
}

/**
 * Find `version` in releases ordered newest first and return it with its neighbours; `null` when it
 * is not there.
 */
export function releaseNeighbours(
	newestFirst: readonly ChangelogRelease[],
	version: string,
): ChangelogNeighbours | null {
	const i = newestFirst.findIndex((release) => release.version === version);
	if (i < 0) return null;
	return {
		release: newestFirst[i],
		newer: i > 0 ? newestFirst[i - 1] : null,
		older: i < newestFirst.length - 1 ? newestFirst[i + 1] : null,
		latest: i === 0,
	};
}
// #endregion
