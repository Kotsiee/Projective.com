/**
 * The whole of `/` as the server renders it (`flows/LANDING.md` §2, §4.0, §4.10, §4.11): exactly one
 * h1; every section after the hero a landmark labelled by its one h2, in the §2 order; no id twice
 * (the two searches included); the header's anchors present; the questions as native `<details>`
 * with the FAQPage JSON-LD repeating their text word for word beside the WebSite search action and
 * the Organization; the final call to action's quiet second search and its calls to action per
 * viewer; and no fee figure anywhere once the fee is unavailable — nor a hard-coded one when the
 * rate differs.
 *
 * The page controller (`routes/LandingPage.tsx`) mounts islands whose stylesheets cannot load under
 * `deno test`, so it hands them to `LandingPageView` as slots and this renders the view with the
 * parts those islands paint on the server: the search's own markup (`HeroSearchForm`, exactly what
 * the island's first paint is), Ways to work's and Pricing's server views (`WaysToWorkView`,
 * `PricingSection`) and the demo stage's real header. How it works draws the product's MoneyView
 * (its stylesheet is an island's too), so it stands in as its labelled section; its own tests pin
 * its parts.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { PublicMetrics } from "@projective/types/marketing";
import { formatFeePercent } from "@features/marketing/about/core/metric-format.ts";
import { explorePath } from "@features/marketing/core/megamenu-data.ts";
import { landingFeeBp, type LandingIslands, LandingPageView } from "./LandingPageView.tsx";
import { HeroSearchForm, heroSearchIds } from "./HeroSearchForm.tsx";
import { DEMO_TITLE_ID, DemoStageHeader } from "./DemoStageView.tsx";
import { WaysToWorkView } from "./WaysToWorkView.tsx";
import { PricingSection } from "./PricingView.tsx";
import { FINAL_COPY, FINAL_SEARCH_SUFFIX } from "./FinalCta.tsx";
import { DEMO_SECTION_ID } from "../core/demo-stage.ts";
import { DEFAULT_HERO_CATEGORY, GUEST_VIEWER, type HeroViewer } from "../core/hero-search.ts";
import { FAQ_COPY, faqEntries, faqMoney, teamReceivesMinor } from "../core/faq.ts";
import { LANDING_JSONLD_ID } from "../core/landing-seo.ts";
import { landingNavAnchors } from "../core/header.ts";
import type { Rail } from "../core/rails.ts";

// #region HTML reading
/** One element of the rendered markup. */
interface Node {
	tag: string;
	attrs: Record<string, string>;
	children: Node[];
	/** Its text as a reader gets it: entities decoded, whitespace collapsed. */
	text: string;
	/** Raw text (a `<script>`'s body). */
	raw: string;
}

const VOID = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
]);

const TAG =
	/<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function decode(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&amp;/g, "&");
}

/** The rendered markup as a tree under a synthetic root (preact's output is well formed). */
function parse(html: string): Node {
	const root: Node = { tag: "#root", attrs: {}, children: [], text: "", raw: "" };
	const stack: Node[] = [root];
	const texts: string[][] = [[]];
	let at = 0;
	for (const match of html.matchAll(TAG)) {
		const between = html.slice(at, match.index);
		for (const list of texts) list.push(between);
		stack[stack.length - 1].raw += between;
		at = match.index! + match[0].length;
		const [, closing, name, rawAttrs, selfClosing] = match;
		const tag = name.toLowerCase();
		if (closing) {
			const node = stack.pop()!;
			const own = texts.pop()!;
			node.text = decode(own.join("")).replace(/\s+/g, " ").trim();
			assertEquals(node.tag, tag, `mismatched </${tag}>`);
			continue;
		}
		const attrs: Record<string, string> = {};
		for (const a of rawAttrs.matchAll(ATTR)) attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? "");
		const node: Node = { tag, attrs, children: [], text: "", raw: "" };
		stack[stack.length - 1].children.push(node);
		if (!VOID.has(tag) && !selfClosing) {
			stack.push(node);
			texts.push([]);
		}
	}
	return root;
}

/** Every element under `node`, depth first, in document order. */
function all(node: Node): Node[] {
	return node.children.flatMap((child) => [child, ...all(child)]);
}

/** The elements under `node` that match `test`. */
function find(node: Node, test: (n: Node) => boolean): Node[] {
	return all(node).filter(test);
}

/** The outermost `<section>` elements under `node`. */
function topSections(node: Node): Node[] {
	return node.children.flatMap((child) => child.tag === "section" ? [child] : topSections(child));
}
// #endregion

// #region Fixtures
const ORIGIN = "https://projective.test";

/** A live read: the fee at 5%, every figure above its threshold. */
function liveMetrics(platformFeeBp = 500): PublicMetrics {
	return {
		asOf: "2026-10-17T00:00:00Z",
		minN: 10,
		platformFeeBp,
		totalValueProtected: { amountMinor: 12_000_000, currency: "GBP", converted: false },
		stagesDelivered: 120,
		medianFundingToApprovalHours: 46,
	};
}

const RESTRICTED: HeroViewer = { authenticated: true, isFreelancer: false, restricted: true };

/** One rail of four cards, as `sliceRails` shapes a live feed. */
const SERVICES_RAIL: Rail = {
	id: "services",
	title: "Services",
	seeAllLabel: "See all services",
	seeAllHref: explorePath("services"),
	items: [1, 2, 3, 4].map((n) => ({
		id: `svc-${n}`,
		kind: "listing",
		title: `Service ${n}`,
		href: `/view/svc-${n}?type=services`,
		ownerName: `Owner ${n}`,
		avatar: "/test_images/profile_1.jpg",
		cover: `/test_images/cover_${n}.jpg`,
		summary: null,
		detail: null,
		price: "from £150",
	})),
};

/** A search instance's first paint, exactly as `HeroSearch` renders it on the server. */
function searchPaint(suffix: string, slashFocus: boolean) {
	return (
		<HeroSearchForm
			ids={heroSearchIds(suffix)}
			query=""
			category={DEFAULT_HERO_CATEGORY}
			hydrated={false}
			scopeButton={false}
			typewriter={null}
			slashFocus={slashFocus}
			open={false}
			sections={[]}
			active={-1}
			status="idle"
			announcement=""
			sheetOpen={false}
			avatarFallback="/test_images/profile_1.jpg"
			glyph={(name) => <i data-glyph={name} />}
		/>
	);
}

/** The islands' server paint, as `LandingPage` slots them. */
function islands(metrics: PublicMetrics | null, rails: readonly Rail[]): LandingIslands {
	const feeBp = landingFeeBp(metrics);
	return {
		heroBackground: <div class="lp-bg lp-bg--hero" aria-hidden="true" role="none" />,
		heroSearch: searchPaint("", true),
		theatre: <div class="lp-theatre-standin" />,
		howItWorks: (
			<section id="how-it-works" class="lp-mf" aria-labelledby="how-it-works-title">
				<h2 id="how-it-works-title">How it works</h2>
			</section>
		),
		demo: (
			<section id={DEMO_SECTION_ID} class="lp-demo" aria-labelledby={DEMO_TITLE_ID}>
				<DemoStageHeader />
			</section>
		),
		waysToWork: <WaysToWorkView rails={rails} />,
		pricing: (
			<PricingSection
				fee={feeBp === null ? null : { bp: feeBp, label: formatFeePercent(feeBp) }}
				calculator={<div class="lp-calc-standin" />}
			/>
		),
		finalBackground: <div class="lp-bg lp-bg--final" aria-hidden="true" role="none" />,
		finalSearch: searchPaint(FINAL_SEARCH_SUFFIX, false),
	};
}

interface Render {
	html: string;
	root: Node;
}

function render(
	{ metrics = liveMetrics(), viewer = GUEST_VIEWER, rails = [SERVICES_RAIL] }: {
		metrics?: PublicMetrics | null;
		viewer?: HeroViewer;
		rails?: readonly Rail[];
	} = {},
): Render {
	const html = renderToString(
		<main>
			<LandingPageView
				origin={ORIGIN}
				hero={{ terms: ["brand identity"], trending: ["logo"], chips: ["UX", "Figma"], viewer }}
				metrics={metrics}
				islands={islands(metrics, rails)}
			/>
		</main>,
	);
	return { html, root: parse(html) };
}

function byId(root: Node, id: string): Node | undefined {
	return find(root, (n) => n.attrs.id === id)[0];
}

/** The page's structured data: the graph's nodes by type. */
function graphOf(root: Node): Record<string, Record<string, unknown>> {
	const script = byId(root, LANDING_JSONLD_ID);
	assert(script, "no landing JSON-LD");
	assertEquals(script.attrs.type, "application/ld+json");
	const graph = JSON.parse(script.raw) as {
		"@context": string;
		"@graph": Record<string, unknown>[];
	};
	assertEquals(graph["@context"], "https://schema.org");
	return Object.fromEntries(graph["@graph"].map((node) => [node["@type"] as string, node]));
}
// #endregion

// #region Structure
/** The §2 order: the hero, then every section in the wireframes' order. */
const ORDER = [
	"hero",
	"why-different",
	"how-it-works",
	"demo",
	"ways-to-work",
	"payment-protection",
	"numbers",
	"for-freelancers",
	"pricing",
	"faq",
	"get-started",
];

Deno.test("the page has exactly one h1, in the hero", () => {
	const { root } = render();
	const h1 = find(root, (n) => n.tag === "h1");
	assertEquals(h1.length, 1);
	const hero = byId(root, "hero")!;
	assert(all(hero).includes(h1[0]), "the h1 sits in #hero");
});

Deno.test("the sections follow the §2 order", () => {
	assertEquals(topSections(render().root).map((s) => s.attrs.id), ORDER);
});

Deno.test("every section after the hero is labelled by its one h2", () => {
	for (const metrics of [liveMetrics(), null]) {
		const { root } = render({ metrics });
		const sections = topSections(root).filter((s) => s.attrs.id !== "hero");
		// Every section but the hero; the numbers are omitted with no metrics.
		assertEquals(sections.length, metrics ? ORDER.length - 1 : ORDER.length - 2);
		for (const section of sections) {
			const id = section.attrs.id;
			const labelledby = section.attrs["aria-labelledby"];
			assert(labelledby, `#${id} has no aria-labelledby`);
			const h2 = find(section, (n) => n.tag === "h2");
			assertEquals(h2.length, 1, `#${id} holds ${h2.length} h2s`);
			assertEquals(h2[0].attrs.id, labelledby, `#${id} is not labelled by its h2`);
			assert(h2[0].text.length > 0, `#${id}'s h2 is empty`);
		}
	}
});

Deno.test("no id appears twice: the two searches keep their own", () => {
	const { root } = render();
	const ids = find(root, (n) => n.attrs.id !== undefined).map((n) => n.attrs.id);
	const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
	assertEquals(repeated, []);
	for (const id of ["lp-q", `lp-q${FINAL_SEARCH_SUFFIX}`]) assert(byId(root, id), id);
});

Deno.test("the header bar's in-page links land on sections the page renders", () => {
	for (const metrics of [liveMetrics(), null]) {
		const { root } = render({ metrics });
		const anchors = landingNavAnchors();
		assertEquals(anchors, ["how-it-works", "pricing"]);
		for (const anchor of anchors) {
			assertEquals(byId(root, anchor)?.tag, "section", `#${anchor}`);
		}
	}
});

Deno.test("with no feed the rails are left out; the three ways still render", () => {
	const withRails = render().root;
	const without = render({ rails: [] }).root;
	const ways = byId(without, "ways-to-work")!;
	assert(ways);
	assertFalse(ways.text.includes("See all services"));
	assert(byId(withRails, "ways-to-work")!.text.includes("See all services"));
});

Deno.test("the numbers section is omitted when the metrics read failed", () => {
	assert(byId(render().root, "numbers"));
	assertEquals(byId(render({ metrics: null }).root, "numbers"), undefined);
});
// #endregion

// #region Questions and structured data
Deno.test("the questions are native disclosures, the first open, then More answers in Help", () => {
	const { root, html } = render();
	const faq = byId(root, "faq")!;
	const items = find(faq, (n) => n.tag === "details");
	assertEquals(items.length, 8);
	assertEquals(items.map((d) => "open" in d.attrs), [
		true,
		false,
		false,
		false,
		false,
		false,
		false,
		false,
	]);
	for (const item of items) {
		assertEquals(item.children[0].tag, "summary");
		assertEquals(find(item, (n) => n.tag === "button").length, 0);
	}
	const more = find(faq, (n) => n.tag === "a" && n.attrs.href === FAQ_COPY.moreHref);
	assertEquals(more.map((a) => a.text), [FAQ_COPY.more]);
	assertMatch(
		html,
		/<summary class="lp-faq__q"><span>Is my money safe\? \(How escrow works\)<\/span>/,
	);
});

Deno.test("the JSON-LD graph carries the Organization, the WebSite search and the visible FAQ", () => {
	for (const metrics of [liveMetrics(), liveMetrics(250), null]) {
		const { root } = render({ metrics });
		const graph = graphOf(root);
		assert(graph.Organization, "Organization");
		const site = graph.WebSite as { potentialAction: Record<string, unknown> };
		assertEquals(site.potentialAction["@type"], "SearchAction");
		assertEquals(
			(site.potentialAction.target as { urlTemplate: string }).urlTemplate,
			`${ORIGIN}/explore?q={search_term_string}`,
		);
		assertEquals(site.potentialAction["query-input"], "required name=search_term_string");

		const page = graph.FAQPage as {
			"@id": string;
			mainEntity: { "@type": string; name: string; acceptedAnswer: { text: string } }[];
		};
		assertEquals(page["@id"], `${ORIGIN}/#faq`);
		const items = find(byId(root, "faq")!, (n) => n.tag === "details");
		const visible = items.map((item) => ({
			name: find(item, (n) => n.tag === "summary")[0].text,
			text: find(item, (n) => n.tag === "p")[0].text,
		}));
		assertEquals(page.mainEntity.map((q) => q["@type"]), Array(8).fill("Question"));
		assertEquals(
			page.mainEntity.map((q) => ({ name: q.name, text: q.acceptedAnswer.text })),
			visible,
		);
		assertEquals(
			visible,
			faqEntries(landingFeeBp(metrics)).map((e) => ({ name: e.question, text: e.answer })),
		);
		assert(visible[0].name.includes("escrow") && visible[0].text.includes("(escrow)"));
		assertFalse(/^Yes\b/.test(visible[0].text), "FAQ 1 never opens with an unconditional Yes");
	}
});
// #endregion

// #region Fee
/** The fee as a percentage literal, not inside a larger figure (25%, 75% are Fair Exit's tiers). */
function feeLiteral(label: string): RegExp {
	return new RegExp(`(?<![\\d.,])${label.replace(".", "\\.")}`);
}

Deno.test("no fee figure renders anywhere when the fee is unavailable", () => {
	const live = render().html;
	assert(feeLiteral("5%").test(live), "control: the live page prints its fee");
	assert(live.includes("£1,900"), "control: the live page prints the team's share");
	const { html, root } = render({ metrics: null });
	assertFalse(feeLiteral("5%").test(html), "a 5% fee rendered");
	assertFalse(
		html.includes(faqMoney(teamReceivesMinor(200_000, 500))),
		"the team's £1,900 rendered",
	);
	const faq = faqEntries(null);
	assertEquals(faq[1].question, "Who pays the fee?");
	assert(faq[1].answer.includes("and the team is paid."));
	assertFalse(faq[2].answer.includes("minus"));
	assert(byId(root, "pricing"), "Pricing still renders (its fee clauses drop)");
});

Deno.test("every fee figure follows the server's rate: none is hard-coded", () => {
	const { html, root } = render({ metrics: liveMetrics(250) });
	assertFalse(feeLiteral("5%").test(html), "a 5% literal survived a 2.5% rate");
	assert(html.includes("2.5%"));
	const faq = byId(root, "faq-fee")!;
	assertEquals(find(faq, (n) => n.tag === "summary")[0].text, "Who pays the 2.5% fee?");
	assert(faq.text.includes("the team receives £1,950."));
});

Deno.test("the FAQ's team share truncates the fee like SQL", () => {
	assertEquals(teamReceivesMinor(200_000, 500), 190_000);
	assertEquals(faqMoney(teamReceivesMinor(200_000, 500)), "£1,900");
	assertEquals(teamReceivesMinor(200_000, 333), 193_340);
	assertEquals(faqMoney(teamReceivesMinor(200_000, 333)), "£1,933.40");
	assertEquals(teamReceivesMinor(1_050, 500), 998);
	assert(
		faqEntries(500)[1].answer.includes(
			"On a £2,000 stage you pay £2,000, and the team receives £1,900.",
		),
	);
	assertEquals(
		faqEntries(500)[2].answer,
		"End the stage with Fair Exit. You pick how much was done: 25%, 50% or 75%. The team is paid " +
			"that share, minus the 5% fee. The rest comes straight back to you, with no fee.",
	);
});
// #endregion

// #region Final call to action
Deno.test("the final call to action: its h2, a quiet second search, the hero's calls to action", () => {
	const { root } = render();
	const final = byId(root, "get-started")!;
	assertEquals(find(final, (n) => n.tag === "h2")[0].text, FINAL_COPY.title);
	assert(final.text.includes(FINAL_COPY.lead));
	const form = find(final, (n) => n.tag === "form")[0];
	assertEquals(form.attrs.role, "search");
	assertEquals(form.attrs.action, "/explore");
	const input = byId(final, `lp-q${FINAL_SEARCH_SUFFIX}`)!;
	assertEquals(input.attrs.name, "q");
	assertFalse("aria-keyshortcuts" in input.attrs, "the final search never takes /");
	assertEquals(find(final, (n) => n.tag === "kbd").length, 0, "no / hint");
	assertEquals(find(final, (n) => n.attrs.class === "lp-chips").length, 0, "no Try: line");
	const links = find(final, (n) => n.tag === "a").map((a) => [a.text, a.attrs.href]);
	assertEquals(links, [["Hire a team", explorePath("teams")], [
		"Offer your skills",
		"/join?intent=freelancer",
	]]);
	// Nothing here moves money: no amber, one fill (the search's submit).
	assertEquals(find(final, (n) => /\blp-btn--accent\b/.test(n.attrs.class ?? "")).length, 0);
	assertEquals(
		find(final, (n) => /\blp-btn--(brand|structural)\b/.test(n.attrs.class ?? "")).length,
		1,
	);
});

Deno.test("a 13–17 account is offered no second call to action, in the hero or at the end", () => {
	const { root } = render({ viewer: RESTRICTED });
	for (const id of ["hero", "get-started"]) {
		const texts = find(byId(root, id)!, (n) => n.tag === "a").map((a) => a.text);
		assertFalse(texts.includes("Offer your skills"), id);
		assert(texts.includes("Hire a team"), id);
	}
});
// #endregion
