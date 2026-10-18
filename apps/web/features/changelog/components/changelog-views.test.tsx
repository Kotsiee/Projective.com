/**
 * The changelog's pages as the server renders them, through the views with no islands (the routes
 * pass the real ones; the views import no stylesheet, so they load under `deno test`): one `<h1>`,
 * the timeline as an `<ol>` of `<article>`s with machine-readable dates, anchors that never repeat,
 * filter chips and pager links that are real addresses, pictures the lightbox can address, and the
 * release page's neighbours.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { ChangelogRelease } from "@projective/types/editorial";
import { ChangelogBackendService } from "@server/services/editorial/ChangelogBackendService.ts";
import { ChangelogFeedView } from "./ChangelogFeedView.tsx";
import { ChangelogReleaseView } from "./ChangelogReleaseView.tsx";
import { ChangelogNoticeView } from "./ChangelogNotice.tsx";

const NOW = new Date("2026-10-17T12:00:00Z");

/** Count of `needle` in `hay`. */
function count(hay: string, needle: string | RegExp): number {
	return typeof needle === "string"
		? hay.split(needle).length - 1
		: (hay.match(needle) ?? []).length;
}

/** Every `id="…"` on the page. */
function ids(html: string): string[] {
	return [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
}

async function feedHtml(categories: ChangelogRelease["categories"] = [], page = 1) {
	const result = await ChangelogBackendService.feed({ categories, page }, {
		source: "fixture",
		now: NOW,
	});
	assert(result.ok && result.data, result.message);
	return { html: renderToString(<ChangelogFeedView feed={result.data} />), feed: result.data };
}

// #region Feed
Deno.test("feed: one h1, an ol of article entries, dates as <time datetime>", async () => {
	const { html, feed } = await feedHtml();
	assertEquals(count(html, /<h1[\s>]/g), 1);
	assertMatch(html, /<h1 id="doc-title"[^>]*>Changelog<\/h1>/);
	assertMatch(
		html,
		/<ol id="chl-releases" class="chl-timeline" aria-label="Releases, newest first">/,
	);
	assertEquals(count(html, '<li class="chl-timeline__item">'), feed.releases.length);
	assertEquals(count(html, '<article class="chl-entry"'), feed.releases.length);
	for (const release of feed.releases) {
		assert(html.includes(`<time class="chl-entry__date" datetime="${release.releasedOn}">`));
	}
	assertEquals(feed.releases.length, 10);
});

Deno.test("feed: the gutter prints the short month and the facts read apart as text", async () => {
	const { html } = await feedHtml();
	// 0.17.0 is the newest: its facts are the date, a space, the version link, a space, "Latest".
	assertMatch(
		html,
		/<time class="chl-entry__date" datetime="2026-10-17">17 Oct 2026<\/time> <a class="chl-entry__version" href="\/changelog\/0\.17\.0">v0\.17\.0<span class="ui-visually-hidden">, release page<\/span><\/a> <span class="chl-entry__latest">Latest<\/span>/,
	);
	assert(html.includes('datetime="2026-09-23">23 Sept 2026</time>'));
	assertFalse(html.includes("September 2026</time> <a"), "no long month in the gutter");
});

Deno.test("feed: the header's figures are mono, the words around them are not", async () => {
	const { html } = await feedHtml();
	assertMatch(html, /Latest <span class="chl-mono">v0\.17\.0<\/span>/);
	assertMatch(html, /Updated <time class="chl-mono" datetime="2026-10-17">17 October 2026<\/time>/);
});

Deno.test("feed: each entry is named by its h2 anchor, whose text links to itself", async () => {
	const { html, feed } = await feedHtml();
	const first = feed.releases[0];
	const anchor = `v${first.version.replace(/\./g, "-")}`;
	assert(html.includes(`aria-labelledby="${anchor}"`));
	assertMatch(
		html,
		new RegExp(`<h2 id="${anchor}"[^>]*><a class="ui-anchor-heading__link" href="#${anchor}">`),
	);
	assert(html.includes(`href="/changelog/${first.version}"`), "the version links to its page");
});

Deno.test("feed: only the newest release is marked latest", async () => {
	const { html, feed } = await feedHtml();
	assertEquals(count(html, 'data-latest="true"'), 1);
	assertEquals(count(html, ">Latest</span>"), 1);
	const page2 = await feedHtml([], 2);
	assertEquals(count(page2.html, 'data-latest="true"'), 0);
	assertEquals(feed.latest?.version, feed.releases[0].version);
});

Deno.test("feed: no id on the page repeats, sub-headings included", async () => {
	const { html } = await feedHtml();
	const all = ids(html);
	assertEquals(
		all.length,
		new Set(all).size,
		`repeated: ${all.filter((id, i) => all.indexOf(id) !== i)}`,
	);
	assert(all.includes("under-the-hood"));
	assert(all.some((id) => /^under-the-hood-\d+$/.test(id)), "a repeated heading is suffixed");
});

Deno.test("feed: categories are inline meta text, not links", async () => {
	const { html } = await feedHtml();
	assertMatch(html, /<ul class="chl-entry__categories" role="list" aria-label="Categories">/);
	assertFalse(/<li\s+class="chl-entry__category"><a /.test(html));
	// The middot is drawn by CSS after each item, so a wrapped line never opens on one.
	assertFalse(html.includes("chl-entry__sep"));
	assertMatch(html, /<li\s+class="chl-entry__category">Teams &amp; businesses<\/li>/);
});

Deno.test("feed: the filter chips are links, the selected ones aria-current", async () => {
	const { html } = await feedHtml(["escrow"]);
	assertMatch(html, /<nav class="chl-filters" aria-labelledby="chl-filters-label"/);
	// "All releases" clears the filter and is not current; the selected chip toggles itself off.
	assertEquals(count(html, /<a class="chl-filter" href="\/changelog"\s*>/g), 1);
	assertEquals(count(html, '<a class="chl-filter" href="/changelog" aria-current="true">'), 1);
	assertMatch(
		html,
		/<a class="chl-filter" href="\/changelog\?category=escrow&amp;category=projects"\s*>/,
	);
	assertEquals(count(html, 'aria-current="true"'), 1);
});

Deno.test("feed: the pager links to page 2 and back, as real addresses", async () => {
	const one = await feedHtml();
	assertMatch(one.html, /href="\/changelog\?page=2" rel="next"/);
	assertFalse(one.html.includes('rel="prev"'));
	assert(one.html.includes("Page 1 of 2"));
	const two = await feedHtml([], 2);
	assertMatch(two.html, /href="\/changelog" rel="prev"/);
	assertFalse(two.html.includes('rel="next"'));
});

Deno.test("feed: pictures are real links the lightbox addresses, sized, lazy, captioned", async () => {
	const { html } = await feedHtml();
	assertMatch(
		html,
		/<a class="chl-shot__link" href="https:\/\/placehold\.co\/1600x1000\?text=[^"]+" data-chl-image="v0-17-0:1" aria-describedby="v0-17-0-pic-1"/,
	);
	assertMatch(
		html,
		/<img class="chl-shot__img" src="[^"]+" alt="[^"]+" width="1600" height="1000" loading="lazy"/,
	);
	const pictures = count(html, '<img class="chl-shot__img"');
	assert(pictures > 0);
	assertEquals(count(html, 'loading="lazy"'), pictures, "every picture is lazy");
	assertEquals(count(html, 'loading="eager"'), 0);
	assertEquals(count(html, '<figcaption id="'), pictures, "every picture has a caption");
});

Deno.test("feed: the subscribe row links the RSS feed", async () => {
	const { html } = await feedHtml();
	assertMatch(html, /href="\/changelog\/rss\.xml" type="application\/rss\+xml"/);
});
// #endregion

// #region Release
Deno.test("release page: one h1 (its title), a breadcrumb, neighbours both ways", async () => {
	const result = await ChangelogBackendService.release("0.9.0", { source: "fixture", now: NOW });
	assert(result.ok && result.data);
	const html = renderToString(<ChangelogReleaseView data={result.data} />);
	assertEquals(count(html, /<h1[\s>]/g), 1);
	assertMatch(html, /<h1 id="doc-title"[^>]*>Profiles, hiring and invitations<\/h1>/);
	assertMatch(html, /<nav class="chl-crumbs" aria-label="Breadcrumb">/);
	assertMatch(
		html,
		/Released <time class="chl-mono" datetime="2026-09-23">23 September 2026<\/time>/,
	);
	assertMatch(html, /Version <span class="chl-mono">0\.9\.0<\/span>/);
	assertMatch(html, /href="\/changelog\/0\.8\.0" rel="prev"/);
	assertMatch(html, /href="\/changelog\/0\.10\.0" rel="next"/);
	assertMatch(html, /data-chl-image="v0-9-0:2"/);
	assertFalse(html.includes('loading="eager"'), "the gallery follows the body, below the fold");
	const all = ids(html);
	assertEquals(all.length, new Set(all).size);
});

Deno.test("release page: the heading outline never skips a level", async () => {
	for (const version of ["0.12.0", "0.9.0", "0.1.0"]) {
		const result = await ChangelogBackendService.release(version, { source: "fixture", now: NOW });
		const html = renderToString(<ChangelogReleaseView data={result.data!} />);
		const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
		assertEquals(levels[0], 1, version);
		for (let i = 1; i < levels.length; i++) {
			assert(levels[i] <= levels[i - 1] + 1, `${version}: h${levels[i - 1]} → h${levels[i]}`);
		}
		const id = `v${version.replace(/\./g, "-")}-changes`;
		assertMatch(
			html,
			new RegExp(
				`<section class="chl-release__changes" aria-labelledby="${id}"><h2 id="${id}" class="ui-visually-hidden">What changed in v${
					version.replace(/\./g, "\.")
				}</h2>`,
			),
		);
	}
});

Deno.test("release page: the oldest has no previous, the newest says Latest release", async () => {
	const oldest = await ChangelogBackendService.release("0.1.0", { source: "fixture", now: NOW });
	const oldestHtml = renderToString(<ChangelogReleaseView data={oldest.data!} />);
	assertFalse(oldestHtml.includes('rel="prev"'));
	assert(oldestHtml.includes('rel="next"'));
	const newest = await ChangelogBackendService.release("0.17.0", { source: "fixture", now: NOW });
	const newestHtml = renderToString(<ChangelogReleaseView data={newest.data!} />);
	assert(newestHtml.includes("Latest release"));
	assertFalse(newestHtml.includes('rel="next"'));
});
// #endregion

// #region Notices
Deno.test("notices: one h1 and the way out", () => {
	const missing = renderToString(<ChangelogNoticeView kind="release-missing" />);
	assertEquals(count(missing, /<h1[\s>]/g), 1);
	assert(missing.includes("That release doesn"));
	assertMatch(missing, /href="\/changelog"/);
	const down = renderToString(
		<ChangelogNoticeView kind="unavailable" retryHref="/changelog?page=2" />,
	);
	assertMatch(down, /href="\/changelog\?page=2"[^>]*>.*Try again/);
});
// #endregion
