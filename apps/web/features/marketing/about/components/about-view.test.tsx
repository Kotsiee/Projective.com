/**
 * `/about` as the server renders it (Decision #277): the page composite with every metrics state,
 * the walkthrough diagram, and the structured data. The island-bound route module imports CSS and
 * cannot load under `deno test`, so the composite is rendered with a stand-in for the island.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { PublicMetrics } from "@projective/types/marketing";
import { AboutView } from "./AboutView.tsx";
import { TourFigure } from "./TourFigure.tsx";
import { tourSteps } from "../core/delivery-tour.ts";
import { aboutJsonLd } from "../core/about-seo.ts";
import type { Founder } from "../core/about-content.ts";

const FULL: PublicMetrics = {
	asOf: "2026-10-17T21:07:08.982Z",
	minN: 10,
	platformFeeBp: 500,
	totalValueProtected: { amountMinor: 15_100_000, currency: "USD", converted: false },
	stagesDelivered: 12,
	medianFundingToApprovalHours: 396,
};

const FEE_ONLY: PublicMetrics = {
	...FULL,
	totalValueProtected: null,
	stagesDelivered: null,
	medianFundingToApprovalHours: null,
};

/** A stand-in founder for the band's own tests — the page's list stays empty until real ones exist. */
const FOUNDER: Founder = {
	id: "ada",
	name: "Ada Example",
	role: "Co-founder · Engineering",
	bio: "Builds the escrow ledger.",
	avatar: { src: "/images/founders/ada.jpg", w: 480, h: 600 },
	links: [],
};

function render(
	metrics: PublicMetrics | null,
	isAuthenticated = false,
	founders?: readonly Founder[],
): string {
	return renderToString(
		<AboutView
			metrics={metrics}
			isAuthenticated={isAuthenticated}
			tour={<div id="tour-slot" />}
			founders={founders}
		/>,
	);
}

/** Each full-bleed band's tone in page order: `true` for a tinted (`--surface-1`) band. */
function bandTones(html: string): boolean[] {
	return [...html.matchAll(/class="(abt__band(?: [^"]*)?)"/g)].map((m) =>
		m[1].split(" ").includes("abt__band--tint")
	);
}

function count(hay: string, needle: string): number {
	return hay.split(needle).length - 1;
}

// #region Page
Deno.test("AboutView: one h1, no second <main>, every band named by its heading", () => {
	const html = render(FULL);
	assertEquals(count(html, "<h1"), 1);
	assertFalse(html.includes("<main"));
	for (
		const id of [
			"abt-metrics-heading",
			"abt-tour-heading",
			"abt-creds-heading",
			"abt-cta-heading",
		]
	) {
		assert(html.includes(`aria-labelledby="${id}"`), id);
		assert(html.includes(`id="${id}"`), id);
	}
	const withFounders = render(FULL, false, [FOUNDER]);
	assert(withFounders.includes('aria-labelledby="abt-founders-heading"'));
	assert(withFounders.includes('id="abt-founders-heading"'));
	// The contrast band holds both sides, so both headings name it.
	assert(html.includes('aria-labelledby="abt-friction abt-model"'));
	assert(html.includes('id="abt-friction"') && html.includes('id="abt-model"'));
	assert(html.includes('id="tour-slot"'));
});

Deno.test("AboutView: bands alternate solid tones, with or without founders, and nothing is a card", () => {
	for (const founders of [undefined, [FOUNDER]]) {
		const html = render(FULL, false, founders);
		const tones = bandTones(html);
		assertEquals(tones.length, founders ? 8 : 7);
		tones.forEach((tint, i) => assertEquals(tint, i % 2 === 1, `band ${i + 1}`));
		assertFalse(html.includes("ui-card"));
		assertFalse(html.includes("style="));
	}
});

Deno.test("AboutView: every published figure prints with its label and an as-of time", () => {
	const html = render(FULL);
	for (const key of ["protected", "stages", "median", "fee"]) {
		assert(html.includes(`data-metric="${key}"`), key);
	}
	assert(html.includes("US$151,000"));
	assert(html.includes("16.5 days"));
	assert(html.includes(">5%<"));
	assertEquals(
		count(html, '<time datetime="2026-10-17T21:07:08.982Z">17 Oct 2026, 21:07 UTC</time>'),
		4,
	);
	assert(html.includes("Updated hourly"));
	assertFalse(html.includes("records — we don't publish"));
});

Deno.test("AboutView: figures below the threshold have no tile, and one sentence says why", () => {
	const html = render(FEE_ONLY);
	assertEquals(count(html, 'class="abt-metric"'), 1);
	assert(html.includes('data-metric="fee"'));
	assertFalse(html.includes('data-metric="protected"'));
	assert(html.includes("at least 10 records"));
});

Deno.test("AboutView: a failed read shows no figures and says so — never a stale guess", () => {
	const html = render(null);
	assertEquals(count(html, 'class="abt-metric"'), 0);
	assert(html.includes("Live figures can"));
	assertFalse(html.includes("Updated hourly"));
	// The rest of the page still renders.
	assert(html.includes("How delivery works"));
});

Deno.test("AboutView: the walkthrough's band ends with one plain link to the features index", () => {
	const html = render(FULL);
	assertEquals(count(html, 'href="/features"'), 1);
	const tour = html.indexOf('id="tour-slot"');
	const link = html.indexOf(
		'<a class="abt__more" href="/features">See everything Projective does</a>',
	);
	assert(tour > 0 && link > tour, "after the walkthrough");
	assert(link < html.indexOf('id="abt-creds-heading"'), "inside the walkthrough's band");
});

Deno.test("AboutView: the closing band — the escape first, the one filled action last", () => {
	const guest = render(FULL);
	const outlined = guest.indexOf("ui-button--neutral ui-button--outlined");
	const filled = guest.indexOf("ui-button--primary ui-button--filled");
	assert(outlined > 0 && filled > outlined);
	assertEquals(count(guest, "ui-button--filled"), 1);
	assert(guest.includes('href="/join"'));
	assert(guest.includes('href="/contact?intent=sales"'));
	assert(render(FULL, true).includes('href="/projects?create=1"'));
});

Deno.test("AboutView: no founders band — and no portrait — until real founders exist", () => {
	const html = render(FULL);
	assertFalse(html.includes("abt-founder"));
	assertFalse(html.includes("The people building it"));
	assertEquals(html.match(/<img [^>]+>/g) ?? [], []);
});

Deno.test("AboutView: founder avatars are sized, decorative and lazy", () => {
	const html = render(FULL, false, [FOUNDER, { ...FOUNDER, id: "bo", name: "Bo Example" }]);
	const imgs = html.match(/<img [^>]+>/g) ?? [];
	assertEquals(imgs.length, 2);
	for (const img of imgs) {
		assert(/width="\d+"/.test(img) && /height="\d+"/.test(img), img);
		assert(img.includes('alt=""'), img);
		assert(img.includes('loading="lazy"'), img);
	}
	assert(html.includes("Ada Example") && html.includes("Bo Example"));
});
// #endregion

// #region Diagram
Deno.test("TourFigure: eight nodes, the active one marked, a title and a description", () => {
	const steps = tourSteps("5%");
	for (const layout of ["wide", "narrow"] as const) {
		const svg = renderToString(<TourFigure layout={layout} steps={steps} active={2} idBase="t" />);
		assertEquals(count(svg, 'class="abt-tour__node '), 8);
		assertEquals(count(svg, "abt-tour__node--done"), 2);
		assertEquals(count(svg, "abt-tour__node--active"), 1);
		assertEquals(count(svg, "abt-tour__node--next"), 5);
		assertEquals(count(svg, "abt-tour__seg--done"), 2);
		assert(svg.includes(`data-step="2"`));
		assert(svg.includes('role="img"'));
		// The title names the image; the long description describes it (not folded into the name).
		assert(svg.includes(`aria-labelledby="t-${layout}-title"`));
		assert(svg.includes(`aria-describedby="t-${layout}-desc"`));
		assert(svg.includes("Step 3, Claim, is selected."));
		assertFalse(/fill="#|stroke="#|style=/.test(svg), "no literal colour or inline style");
	}
});

Deno.test("TourFigure: the narrow layout splits the escrow bracket across its two rows", () => {
	const steps = tourSteps("5%");
	const wide = renderToString(<TourFigure layout="wide" steps={steps} active={0} idBase="t" />);
	const narrow = renderToString(<TourFigure layout="narrow" steps={steps} active={0} idBase="t" />);
	assertEquals(count(wide, ">Escrow</text>"), 1);
	assertEquals(count(narrow, ">Escrow</text>"), 2);
	assertEquals(count(wide, "abt-tour__zone--active"), 1);
});
// #endregion

// #region Structured data
Deno.test("aboutJsonLd: AboutPage about the Organization, inside the WebSite, with a breadcrumb", () => {
	const graph = aboutJsonLd("https://projective.app");
	const parsed = JSON.parse(JSON.stringify(graph));
	const types = parsed["@graph"].map((n: { "@type": string }) => n["@type"]);
	assertEquals(types, ["Organization", "WebSite", "AboutPage", "BreadcrumbList"]);
	const about = parsed["@graph"][2];
	assertEquals(about.url, "https://projective.app/about");
	assertEquals(about.mainEntity, { "@id": "https://projective.app/#org" });
	assertEquals(about.isPartOf, { "@id": "https://projective.app/#site" });
	assertEquals(about.breadcrumb, { "@id": "https://projective.app/about#breadcrumb" });
	// Placeholder founders are never published as structured data.
	assertFalse(JSON.stringify(graph).includes("XXXX"));
	assertFalse(JSON.stringify(graph).includes("founder"));
});
// #endregion
