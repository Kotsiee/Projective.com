import { assert, assertEquals } from "@std/assert";
import type { ChangelogCategory, ChangelogRelease } from "@projective/types/editorial";
import {
	categoryCounts,
	CHANGELOG_PAGE_SIZE,
	compareSemver,
	filterReleasesByCategory,
	pageCountOf,
	paginate,
	releaseNeighbours,
	sortReleasesNewestFirst,
} from "./changelog-feed.ts";

/** A minimal release. */
function rel(version: string, releasedOn: string, categories: ChangelogCategory[] = ["ux"]) {
	return {
		version,
		releasedOn,
		title: `Release ${version}`,
		summary: "s",
		categories,
		body: [{ type: "p" as const, content: "x" }],
		images: [],
		withdrawn: false,
	} satisfies ChangelogRelease;
}

// #region Semantic versions
Deno.test("compareSemver orders by precedence, numerically", () => {
	const ordered = [
		"0.1.0",
		"0.2.0",
		"0.10.0",
		"1.0.0-alpha",
		"1.0.0-alpha.1",
		"1.0.0-alpha.beta",
		"1.0.0-beta",
		"1.0.0-beta.2",
		"1.0.0-beta.11",
		"1.0.0-rc.1",
		"1.0.0",
		"1.0.1",
		"2.0.0",
	];
	for (let i = 0; i < ordered.length - 1; i++) {
		assertEquals(
			compareSemver(ordered[i], ordered[i + 1]),
			-1,
			`${ordered[i]} < ${ordered[i + 1]}`,
		);
		assertEquals(compareSemver(ordered[i + 1], ordered[i]), 1, `${ordered[i + 1]} > ${ordered[i]}`);
	}
	assertEquals(compareSemver("0.12.0", "0.12.0"), 0);
});

Deno.test("a malformed version sorts below every real one", () => {
	assertEquals(compareSemver("nonsense", "0.0.1"), -1);
	assertEquals(compareSemver("0.0.1", "nonsense"), 1);
	assertEquals(compareSemver("a", "b"), 0);
});
// #endregion

// #region Order
Deno.test("newest first by release day, then by version on the same day", () => {
	const sorted = sortReleasesNewestFirst([
		rel("0.2.0", "2026-07-17"),
		rel("0.14.0", "2026-10-13"),
		rel("0.15.0", "2026-10-13"),
		rel("0.10.0", "2026-10-01"),
	]);
	assertEquals(sorted.map((r) => r.version), ["0.15.0", "0.14.0", "0.10.0", "0.2.0"]);
});

Deno.test("sorting returns a new array and leaves the input alone", () => {
	const input = [rel("0.1.0", "2026-07-15"), rel("0.2.0", "2026-07-17")];
	const sorted = sortReleasesNewestFirst(input);
	assert(sorted !== input);
	assertEquals(input.map((r) => r.version), ["0.1.0", "0.2.0"]);
});
// #endregion

// #region Category filter
const feed = [
	rel("0.3.0", "2026-07-21", ["projects", "ux"]),
	rel("0.2.0", "2026-07-17", ["escrow"]),
	rel("0.1.0", "2026-07-15", ["ux", "infrastructure"]),
];

Deno.test("no category selected keeps every release, in order", () => {
	assertEquals(filterReleasesByCategory(feed, []).map((r) => r.version), [
		"0.3.0",
		"0.2.0",
		"0.1.0",
	]);
});

Deno.test("one category keeps the releases that carry it", () => {
	assertEquals(filterReleasesByCategory(feed, ["ux"]).map((r) => r.version), ["0.3.0", "0.1.0"]);
	assertEquals(filterReleasesByCategory(feed, ["security"]), []);
});

Deno.test("several categories keep a release carrying ANY of them, once", () => {
	assertEquals(
		filterReleasesByCategory(feed, ["escrow", "ux"]).map((r) => r.version),
		["0.3.0", "0.2.0", "0.1.0"],
	);
});

Deno.test("category counts cover every category in filter order, zeros included", () => {
	const counts = categoryCounts(feed);
	assertEquals(counts.map((c) => c.category)[0], "escrow");
	assertEquals(Object.fromEntries(counts.map((c) => [c.category, c.count])), {
		escrow: 1,
		projects: 1,
		discovery: 0,
		messaging: 0,
		workspaces: 0,
		ux: 2,
		security: 0,
		infrastructure: 1,
	});
});
// #endregion

// #region Pagination
const items = Array.from({ length: 23 }, (_, i) => i + 1);

Deno.test("ten to a page; the last page holds the remainder", () => {
	assertEquals(CHANGELOG_PAGE_SIZE, 10);
	assertEquals(paginate(items, 1)?.items, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	assertEquals(paginate(items, 3)?.items, [21, 22, 23]);
	assertEquals(paginate(items, 3)?.pageCount, 3);
	assertEquals(paginate(items, 2)?.total, 23);
});

Deno.test("a page that does not exist is null", () => {
	assertEquals(paginate(items, 4), null);
	assertEquals(paginate(items, 0), null);
	assertEquals(paginate(items, -1), null);
	assertEquals(paginate(items, 1.5), null);
	assertEquals(paginate(items, Number.NaN), null);
});

Deno.test("an empty list has one empty page", () => {
	assertEquals(paginate([], 1), { items: [], page: 1, pageCount: 1, total: 0 });
	assertEquals(paginate([], 2), null);
	assertEquals(pageCountOf(0), 1);
	assertEquals(pageCountOf(10), 1);
	assertEquals(pageCountOf(11), 2);
});
// #endregion

// #region Neighbours
Deno.test("a release's neighbours: newer before it, older after it", () => {
	const middle = releaseNeighbours(feed, "0.2.0");
	assertEquals(middle?.newer?.version, "0.3.0");
	assertEquals(middle?.older?.version, "0.1.0");
	assertEquals(middle?.latest, false);

	const newest = releaseNeighbours(feed, "0.3.0");
	assertEquals(newest?.newer, null);
	assertEquals(newest?.latest, true);

	const oldest = releaseNeighbours(feed, "0.1.0");
	assertEquals(oldest?.older, null);

	assertEquals(releaseNeighbours(feed, "9.9.9"), null);
});
// #endregion
