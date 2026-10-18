import { assert, assertEquals, assertMatch } from "@std/assert";
import type { SupabaseClient } from "supabaseClient";
import type { ChangelogRelease } from "@projective/types/editorial";
import { ChangelogBackendService } from "./ChangelogBackendService.ts";
import { editorialContent } from "./editorial-source.ts";
import { compareSemver } from "./changelog-feed.ts";
import {
	CHANGELOG_CONTENT,
	CHANGELOG_RECORDS,
	CHANGELOG_RELEASE_CONTENT,
	CHANGELOG_RELEASES,
	changelogDay,
} from "./content/changelog.ts";

/**
 * The changelog service, on the fixture road (the content source itself, through the same row parse
 * and mapping the live read uses) and on a stubbed live road; plus the authored releases' own rules.
 */

/** A release for the injected tables. */
function rel(version: string, releasedOn: string, extra: Partial<ChangelogRelease> = {}) {
	return {
		version,
		releasedOn,
		title: `Release ${version}`,
		summary: "s",
		categories: ["ux"],
		body: [{ type: "p", content: "x" }],
		images: [],
		withdrawn: false,
		...extra,
	} satisfies ChangelogRelease;
}

const today = new Date("2026-10-17T12:00:00Z");

const content = editorialContent(CHANGELOG_RELEASES, [
	rel("0.1.0", "2026-07-15", { categories: ["escrow"] }),
	rel("0.2.0", "2026-07-17"),
	rel("0.3.0", "2026-10-16", { withdrawn: true }),
	rel("0.4.0", "2026-10-17", { categories: ["escrow", "ux"] }),
	rel("0.5.0", "2026-10-18"),
]);

// #region Visibility and order
Deno.test("releases: newest first, withdrawn and future-dated hidden", async () => {
	const result = await ChangelogBackendService.releases({ content, source: "fixture", now: today });
	assert(result.ok);
	assertEquals(result.data?.releases.map((r) => r.version), ["0.4.0", "0.2.0", "0.1.0"]);
	assertEquals(result.data?.source, "fixture");
});

Deno.test("a release dated today is shown from the start of its UTC day", async () => {
	const early = new Date("2026-10-17T00:00:00Z");
	const late = new Date("2026-10-16T23:59:59Z");
	const shown = await ChangelogBackendService.releases({ content, source: "fixture", now: early });
	const hidden = await ChangelogBackendService.releases({ content, source: "fixture", now: late });
	assertEquals(shown.data?.releases[0].version, "0.4.0");
	assertEquals(hidden.data?.releases[0].version, "0.2.0");
	assertEquals(changelogDay(early), "2026-10-17");
});

Deno.test("the live road serves the same releases from the seeded rows", async () => {
	const seeded = content.rows();
	const client = {
		schema: () => ({
			from: () => ({ select: () => Promise.resolve({ data: seeded, error: null }) }),
		}),
	} as unknown as SupabaseClient;
	const live = await ChangelogBackendService.releases({
		content,
		source: "live",
		client,
		now: today,
	});
	const fixture = await ChangelogBackendService.releases({
		content,
		source: "fixture",
		now: today,
	});
	assertEquals(live.data?.releases, fixture.data?.releases);
	assertEquals(live.data?.source, "live");
});

Deno.test("an unreachable database is a 503 on every method", async () => {
	const client = {
		schema: () => ({
			from: () => ({
				select: () =>
					Promise.resolve({ data: null, error: { code: "PGRST106", message: "not exposed" } }),
			}),
		}),
	} as unknown as SupabaseClient;
	const options = { content, source: "live" as const, client, now: today };
	assertEquals((await ChangelogBackendService.releases(options)).status, 503);
	assertEquals(
		(await ChangelogBackendService.feed({ categories: [], page: 1 }, options)).status,
		503,
	);
	assertEquals((await ChangelogBackendService.release("0.4.0", options)).status, 503);
});
// #endregion

// #region Feed
Deno.test("feed: page one, the latest release and counts over every visible release", async () => {
	const result = await ChangelogBackendService.feed({ categories: [], page: 1 }, {
		content,
		source: "fixture",
		now: today,
	});
	assert(result.ok && result.data);
	assertEquals(result.data.releases.map((r) => r.version), ["0.4.0", "0.2.0", "0.1.0"]);
	assertEquals(result.data.latest, { version: "0.4.0", releasedOn: "2026-10-17" });
	assertEquals(result.data.allCount, 3);
	assertEquals(result.data.pageCount, 1);
	const counts = Object.fromEntries(result.data.categories.map((c) => [c.category, c.count]));
	assertEquals(counts.escrow, 2);
	assertEquals(counts.ux, 2);
});

Deno.test("feed: a category filter narrows the list but not the counts or the latest", async () => {
	const result = await ChangelogBackendService.feed({ categories: ["escrow"], page: 1 }, {
		content,
		source: "fixture",
		now: today,
	});
	assertEquals(result.data?.releases.map((r) => r.version), ["0.4.0", "0.1.0"]);
	assertEquals(result.data?.total, 2);
	assertEquals(result.data?.allCount, 3);
	assertEquals(result.data?.selected, ["escrow"]);
	assertEquals(result.data?.latest?.version, "0.4.0");
});

Deno.test("feed: a page past the last is a 404", async () => {
	const result = await ChangelogBackendService.feed({ categories: [], page: 2 }, {
		content,
		source: "fixture",
		now: today,
	});
	assertEquals(result.status, 404);
	assertEquals(result.details?.pageCount, 1);
});

Deno.test("feed: the authored changelog pages ten at a time", async () => {
	const first = await ChangelogBackendService.feed({ categories: [], page: 1 }, {
		source: "fixture",
		now: today,
	});
	const visible = CHANGELOG_RECORDS.filter((r) => !r.withdrawn && r.releasedOn <= "2026-10-17");
	assertEquals(first.data?.releases.length, Math.min(10, visible.length));
	assertEquals(first.data?.pageCount, Math.ceil(visible.length / 10));
});
// #endregion

// #region Release
Deno.test("release: found with its neighbours; hidden and unknown versions are one 404", async () => {
	const options = { content, source: "fixture" as const, now: today };
	const middle = await ChangelogBackendService.release("0.2.0", options);
	assertEquals(middle.data?.newer?.version, "0.4.0");
	assertEquals(middle.data?.older?.version, "0.1.0");
	assertEquals(middle.data?.latest, false);
	assertEquals((await ChangelogBackendService.release("0.4.0", options)).data?.latest, true);

	for (const hidden of ["0.3.0", "0.5.0", "9.9.9", "v0.2.0"]) {
		const result = await ChangelogBackendService.release(hidden, options);
		assertEquals(result.status, 404, hidden);
		assertEquals(result.message, "There is no release with that version.");
	}
});
// #endregion

// #region The authored releases
Deno.test("every authored release passes its row schema (the generator's own check)", () => {
	assertEquals(CHANGELOG_RELEASE_CONTENT.rows().length, CHANGELOG_RECORDS.length);
	assertEquals(CHANGELOG_CONTENT.tables.length, 1);
	assertEquals(CHANGELOG_CONTENT.tables[0].table.table, "editorial.changelog_releases");
});

Deno.test("authored versions are unique, and so are their anchors on the feed", () => {
	const versions = CHANGELOG_RECORDS.map((r) => r.version);
	assertEquals(new Set(versions).size, versions.length);
	const anchors = versions.map((v) => `v${v.replace(/\./g, "-")}`);
	assertEquals(new Set(anchors).size, anchors.length);
});

Deno.test("authored releases are in order: a later version never ships earlier", () => {
	for (let i = 1; i < CHANGELOG_RECORDS.length; i++) {
		const prev = CHANGELOG_RECORDS[i - 1];
		const next = CHANGELOG_RECORDS[i];
		assertEquals(
			compareSemver(prev.version, next.version),
			-1,
			`${prev.version} → ${next.version}`,
		);
		assert(prev.releasedOn <= next.releasedOn, `${next.version} ships before ${prev.version}`);
	}
});

Deno.test("authored pictures are placeholders or shipped static images, sized at 16:10", () => {
	for (const release of CHANGELOG_RECORDS) {
		for (const image of release.images) {
			assertMatch(image.src, /^(https:\/\/placehold\.co\/1600x1000\?text=|\/test_images\/)/);
			assertEquals(image.w * 10, image.h * 16, `${release.version}: ${image.src}`);
			assert(image.alt.length > 10, `${release.version}: alt text "${image.alt}"`);
		}
	}
});

Deno.test("every authored picture has its own caption, distinct from its alt text", () => {
	for (const release of CHANGELOG_RECORDS) {
		for (const image of release.images) {
			assert(image.caption.trim().length > 0, `${release.version}: ${image.src} has no caption`);
			assert(image.caption !== image.alt, `${release.version}: the caption repeats the alt`);
		}
	}
});

Deno.test("no authored release is withdrawn or dated after today's build", () => {
	for (const release of CHANGELOG_RECORDS) {
		assertEquals(release.withdrawn, false, release.version);
		assert(release.releasedOn <= "2026-10-17", release.version);
	}
});
// #endregion
