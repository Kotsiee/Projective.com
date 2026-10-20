/**
 * "Ways to work" as the server renders it (`flows/LANDING.md` §4.5, §2.1 notes 14–15): one section
 * labelled by its one h2; the three ways as columns of text, each with exactly one link to its exact
 * address; the small print; the live rails as named carousel regions of card links with sized, lazy,
 * decorative pictures and scroll buttons that hold their room until wired; and no rails at all when
 * there are none. `WaysToWork` mounts the RailScroll island, whose stylesheet cannot load under
 * `deno test`, so the section is rendered from the view it composes, and the mount is read from
 * source.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { Rail } from "../core/rails.ts";
import { WAYS, WAYS_COPY } from "../core/rails.ts";
import { WaysToWorkView } from "./WaysToWorkView.tsx";

// #region Fixtures
function rail(count = 5): Rail {
	return {
		id: "services",
		title: "Services",
		seeAllLabel: "See all services",
		seeAllHref: "/explore?category=services",
		items: Array.from({ length: count }, (_, i) => ({
			id: `svc-${i + 1}`,
			kind: "listing" as const,
			title: `Service ${i + 1}`,
			href: `/view/svc-${i + 1}?type=services`,
			ownerName: `Owner ${i + 1}`,
			avatar: "/test_images/profile_1.jpg",
			cover: i === 0 ? null : `/test_images/cover_${i + 1}.jpg`,
			summary: null,
			detail: null,
			price: i === 1 ? "from £47.50 / ticket" : null,
		})),
	};
}

const people: Rail = {
	id: "teams",
	title: "Ready-made teams",
	seeAllLabel: "See all teams",
	seeAllHref: "/explore?category=teams",
	items: Array.from({ length: 4 }, (_, i) => ({
		id: `team-${i + 1}`,
		kind: "profile" as const,
		title: `Team ${i + 1}`,
		href: `/@team${i + 1}`,
		ownerName: `Team ${i + 1}`,
		avatar: "/test_images/profile_2.webp",
		cover: "/test_images/banner.jpg",
		summary: null,
		detail: "Brand and web design",
		price: null,
	})),
};

const briefs: Rail = {
	id: "projects",
	title: "Open projects",
	seeAllLabel: "See all projects",
	seeAllHref: "/explore?category=projects",
	items: Array.from({ length: 4 }, (_, i) => ({
		id: `prj-${i + 1}`,
		kind: "brief" as const,
		title: `Project ${i + 1}`,
		href: `/view/prj-${i + 1}?type=projects`,
		ownerName: `Client ${i + 1}`,
		avatar: "/test_images/profile_1.jpg",
		cover: null,
		summary: "Ship the app on iOS and Android.",
		detail: "Architecture · iOS build · QA",
		price: "US$76,000",
	})),
};

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;
// #endregion

// #region The section and the three ways
Deno.test("ways: one section, labelled by its one h2", () => {
	const html = renderToString(<WaysToWorkView rails={[]} />);
	assertMatch(
		html,
		/^<section id="ways-to-work" class="lp-ways" aria-labelledby="ways-to-work-title">/,
	);
	assertEquals(count(html, /<h2\b/g), 1);
	assertMatch(html, /<h2 id="ways-to-work-title"[^>]*>Work the way you want\.<\/h2>/);
	assert(html.includes(WAYS_COPY.subline));
	assert(html.includes(WAYS_COPY.note));
});

Deno.test("ways: the three ways link exactly where §4.5 says, one link each", () => {
	const html = renderToString(<WaysToWorkView rails={[]} />);
	const links = [...html.matchAll(/<a class="lp-ways__link" href="([^"]+)">([^<]+)<\/a>/g)].map((
		m,
	) => [m[1], m[2]]);
	assertEquals(links, [
		["/projects?create=1", "Post a single job"],
		["/explore?category=services&amp;model=Pipeline", "Browse ongoing work"],
		[
			"/explore?category=services&amp;model=Session&amp;model=Group+Session",
			"Browse live sessions",
		],
	]);
	const columns = html.split('<li class="lp-ways__choice"').slice(1);
	assertEquals(columns.length, 3);
	for (const column of columns) {
		assertEquals(
			count(column.split("</li>")[0], /<a\b/g),
			1,
			"a column's link is its only control",
		);
	}
	for (const way of WAYS) {
		assert(html.includes(`>${way.title}</h3>`), way.title);
		assert(html.includes(way.body), way.body);
		assert(html.includes(way.money.replace("'", "&#39;")) || html.includes(way.money), way.money);
	}
});

Deno.test("ways: no rails, no rails block and no empty state", () => {
	const html = renderToString(<WaysToWorkView rails={[]} />);
	assertFalse(html.includes("lp-rails"));
	assertFalse(html.includes("carousel"));
	assertFalse(html.includes("<img"));
});

Deno.test("ways: the island slot renders inside the section", () => {
	const html = renderToString(
		<WaysToWorkView rails={[]}>
			<span class="slot" />
		</WaysToWorkView>,
	);
	assertMatch(html, /<span class="slot"><\/span><\/div><\/section>$/);
});

Deno.test("ways: WaysToWork mounts the RailScroll island whether or not a rail renders", () => {
	const src = Deno.readTextFileSync(new URL("./WaysToWork.tsx", import.meta.url));
	assertMatch(
		src,
		/import RailScroll from "@features\/landing\/islands\/RailScroll\.island\.tsx";/,
	);
	assertMatch(src, /<WaysToWorkView rails=\{rails\}>\s*<RailScroll \/>\s*<\/WaysToWorkView>/);
});
// #endregion

// #region Rails
Deno.test("rails: each rail is a named carousel region with its See all link", () => {
	const html = renderToString(<WaysToWorkView rails={[rail(5), people]} />);
	assertEquals(count(html, /aria-roledescription="carousel"/g), 2);
	assertMatch(
		html,
		/<div id="lp-rail-services" class="lp-rail__track" role="region" aria-roledescription="carousel" aria-label="Services, 5 items">/,
	);
	assertMatch(html, /aria-label="Ready-made teams, 4 items"/);
	assertMatch(html, /<h3 class="lp-heading lp-rail__title">Services<\/h3>/);
	assertMatch(
		html,
		/<a class="lp-ways__link lp-rail__all" href="\/explore\?category=services">See all services<\/a>/,
	);
});

Deno.test("rails: the scroll buttons control their scroller, named by §4.5, and start at the start", () => {
	const html = renderToString(<WaysToWorkView rails={[rail(5)]} />);
	assertMatch(
		html,
		/<button type="button" class="lp-rail__step lp-rail__step--back" data-rail-step="-1" aria-controls="lp-rail-services" aria-label="Scroll Services back" aria-disabled="true"><\/button>/,
	);
	assertMatch(
		html,
		/<button type="button" class="lp-rail__step lp-rail__step--forward" data-rail-step="1" aria-controls="lp-rail-services" aria-label="Scroll Services forward"><\/button>/,
	);
});

Deno.test("rails: every card is one link, its pictures sized, lazy and decorative", () => {
	const html = renderToString(<WaysToWorkView rails={[rail(5), people]} />);
	const cards = [...html.matchAll(/<a class="lp-rail-card" href="([^"]+)"/g)].map((m) => m[1]);
	assertEquals(cards.slice(0, 5), [1, 2, 3, 4, 5].map((n) => `/view/svc-${n}?type=services`));
	assertEquals(cards.slice(5), ["/@team1", "/@team2", "/@team3", "/@team4"]);
	const images = html.match(/<img\b[^>]*>/g) ?? [];
	assert(images.length > 0);
	for (const img of images) {
		assertMatch(img, /alt=""/);
		assertMatch(img, /width="\d+"/);
		assertMatch(img, /height="\d+"/);
		assertMatch(img, /loading="lazy"/);
	}
	const inner = html.split('<a class="lp-rail-card"').slice(1).map((card) => card.split("</a>")[0]);
	for (const card of inner) {
		assertFalse(/<(a|button)\b/.test(card), "nothing interactive in a card");
	}
});

Deno.test("rails: a listing prints its byline and a real price; a profile its headline", () => {
	const html = renderToString(<WaysToWorkView rails={[rail(5), people]} />);
	assert(html.includes('<span class="lp-meta lp-rail-card__meta">by Owner 1</span>'));
	assertEquals(count(html, /class="lp-rail-card__price"/g), 1, "only the card with a figure");
	assert(html.includes('<span class="lp-rail-card__price">from £47.50 / ticket</span>'));
	assert(html.includes('<span class="lp-meta lp-rail-card__meta">Brand and web design</span>'));
	assertMatch(
		html,
		/<span class="lp-rail-card__cover"\s*><span class="lp-rail-card__initials" aria-hidden="true">O1<\/span><\/span>/,
		"no picture and only the default avatar: the owner's initials, and no picture flag",
	);
	assertMatch(
		html,
		/<span class="lp-rail-card__cover" data-picture=""><img class="lp-rail-card__img" src="\/test_images\/cover_2\.jpg"[^>]*><span class="lp-rail-card__initials" aria-hidden="true">O2<\/span><\/span>/,
		"a picture keeps the initials beneath it, for when it fails",
	);
	assertFalse(
		/class="[^"]*(chip|pill|badge|tag)\b/.test(html),
		"metadata is inline text, never pills",
	);
});

Deno.test("rails: a brief is text — no picture frame, its stages inline and its budget at the foot", () => {
	const html = renderToString(<WaysToWorkView rails={[briefs]} />);
	assertEquals(count(html, /class="lp-rail-card lp-rail-card--brief"/g), 4);
	assertFalse(html.includes("lp-rail-card__cover"));
	assert(
		html.includes('<span class="lp-rail-card__summary">Ship the app on iOS and Android.</span>'),
	);
	assert(
		html.includes(
			'<span class="lp-meta lp-rail-card__stages">Architecture · iOS build · QA</span>',
		),
	);
	assert(html.includes('<span class="lp-rail-card__price">US$76,000</span>'));
	assert(html.includes('<span class="lp-meta lp-rail-card__meta">by Client 1</span>'));
	// The link's name opens with the title, not "by …" (the byline is drawn above it by CSS).
	const card = html.slice(html.indexOf('class="lp-rail-card lp-rail-card--brief"'));
	assert(card.indexOf("lp-rail-card__title") < card.indexOf("lp-rail-card__by"));
});
// #endregion
