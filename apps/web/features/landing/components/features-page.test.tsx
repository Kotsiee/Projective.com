/**
 * The whole of `/features` as the server renders it (`flows/LANDING.md` §2.5, §2.6, §4.12): exactly
 * one h1; the chapter navigation; five chapters, each a landmark labelled by its one h2; an h3 per
 * printed feature in catalogue order (V10 and V11 held, never printed); "Try it" only on the four
 * rows with a demo, named "Try it: {title}" (its visible words first), a working link with no
 * JavaScript; "Learn more" only where a help article exists; Coming soon rows with no control at
 * all; real stills only, a chapter with none printed bare; the JSON-LD ItemList naming exactly the
 * visible rows with their visible words; `?section=` marking its chapter; no id twice.
 *
 * The page controller (`routes/FeaturesPage.tsx`) mounts islands whose stylesheets cannot load under
 * `deno test`, so this renders `FeaturesPageView` with the parts those islands paint on the server:
 * the final search's own markup (`HeroSearchForm`), the Booking and Work board real stills
 * (`BookingPoster`, `BoardPicture`), and stand-ins for the dialog (it renders nothing until pressed)
 * and the Payment protection still (its MoneyView figures carry an island stylesheet).
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { FEATURES_TITLE_ID, FeaturesPageView } from "./FeaturesPageView.tsx";
import { HeroSearchForm, heroSearchIds } from "./HeroSearchForm.tsx";
import { FINAL_SEARCH_SUFFIX, FINAL_SECTION_ID } from "./FinalCta.tsx";
import { BoardPicture } from "./demos/BoardPicture.tsx";
import { BookingPoster } from "./demos/BookingPicture.tsx";
import { BOARD_LANES, createBoard, scriptFrames } from "../core/demos/board-model.ts";
import { DEMO_BOARD } from "../core/demos/board-fixtures.ts";
import { DEFAULT_HERO_CATEGORY, GUEST_VIEWER } from "../core/hero-search.ts";
import {
	chapterTitleId,
	FEATURE_CHAPTERS,
	type FeatureChapterId,
	featureDemo,
	featureHelpHref,
	FEATURES_COPY,
	featureTryHref,
	printedFeatures,
	tryLabel,
} from "../core/features-catalogue.ts";
import { SECTION_TARGET_ATTR, TRY_DEMO_ATTR, TRY_FEATURE_ATTR } from "../core/feature-dialog.ts";
import { FEATURES_JSONLD_ID } from "../core/features-seo.ts";

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

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta"]);

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

const hasClass = (name: string) => (n: Node) => (n.attrs.class ?? "").split(/\s+/).includes(name);
// #endregion

// #region Fixtures
const ORIGIN = "https://projective.test";

/** The final search's first paint, exactly as `HeroSearch` renders it on the server. */
function finalSearch() {
	return (
		<HeroSearchForm
			ids={heroSearchIds(FINAL_SEARCH_SUFFIX)}
			query=""
			category={DEFAULT_HERO_CATEGORY}
			hydrated={false}
			scopeButton={false}
			typewriter={null}
			slashFocus
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

/** The page as the controller composes it, with `section` asked for. */
function render(section: FeatureChapterId | null = null): Node {
	const board = createBoard(DEMO_BOARD, { feeBp: 500 });
	const [still] = scriptFrames(board, []);
	const html = renderToString(
		<FeaturesPageView
			origin={ORIGIN}
			viewer={GUEST_VIEWER}
			section={section}
			islands={{
				dialog: <div data-standin="dialog" />,
				stills: {
					"find-and-hire": <BookingPoster />,
					"run-the-work": (
						<BoardPicture
							frame={still}
							title={board.title}
							walletMinor={board.walletMinor}
							currency={board.currency}
							lane={BOARD_LANES.indexOf("todo")}
						/>
					),
					"money": <div role="img" aria-label="Payment protection example." />,
				},
				finalBackground: <div class="lp-bg lp-bg--final" aria-hidden="true" role="none" />,
				finalSearch: finalSearch(),
			}}
		/>,
	);
	return parse(html);
}

/** The chapter sections, in document order. */
function chapters(page: Node): Node[] {
	return find(page, (n) => n.tag === "section" && hasClass("lp-features__chapter")(n));
}

/** The rows of the index, in document order. */
function rows(page: Node): Node[] {
	return find(page, (n) => n.tag === "li" && hasClass("lp-features__row")(n));
}
// #endregion

// #region Headings and landmarks
Deno.test("one h1: the page's title and its subline", () => {
	const page = render();
	const h1 = find(page, (n) => n.tag === "h1");
	assertEquals(h1.length, 1);
	assertEquals(h1[0].text, FEATURES_COPY.title);
	assertEquals(h1[0].attrs.id, FEATURES_TITLE_ID);
	assert(find(page, (n) => n.tag === "p" && n.text === FEATURES_COPY.lead).length === 1);
});

Deno.test("five chapters, each a section labelled by its one h2, in order, with the index linking each", () => {
	const page = render();
	const sections = chapters(page);
	assertEquals(sections.map((s) => s.attrs.id), FEATURE_CHAPTERS.map((c) => c.id));
	sections.forEach((section, i) => {
		const chapter = FEATURE_CHAPTERS[i];
		const h2 = find(section, (n) => n.tag === "h2");
		assertEquals(h2.length, 1, chapter.id);
		assertEquals(h2[0].text, chapter.title);
		assertEquals(h2[0].attrs.id, chapterTitleId(chapter.id));
		assertEquals(section.attrs["aria-labelledby"], h2[0].attrs.id);
	});
	const nav = find(page, (n) => n.tag === "nav" && n.attrs["aria-label"] === FEATURES_COPY.nav);
	assertEquals(nav.length, 1);
	assertEquals(
		find(nav[0], (n) => n.tag === "a").map((a) => a.attrs.href),
		FEATURE_CHAPTERS.map((c) => `#${c.id}`),
	);
	const editorial = sections.filter(hasClass("lp-section--band")).map((s) => s.attrs.id);
	assertEquals(editorial, ["money", "trust"]);
});

Deno.test("an h3 per printed feature, in catalogue order; V10 and V11 are held and never printed", () => {
	const page = render();
	const printed = printedFeatures();
	const list = rows(page);
	assertEquals(list.map((row) => row.attrs.id), printed.map((entry) => entry.id));
	list.forEach((row, i) => {
		const h3 = find(row, (n) => n.tag === "h3");
		assertEquals(h3.length, 1);
		assertEquals(h3[0].text, printed[i].title);
		assert(find(row, (n) => n.tag === "p" && n.text === printed[i].description).length === 1);
	});
	for (const held of ["Your currency", "Team builder"]) {
		assertFalse(find(page, (n) => n.tag === "h3").some((h3) => h3.text === held), held);
	}
	const v13 = list.find((row) => row.attrs.id === "services-and-sessions")!;
	assert(
		find(v13, (n) => n.text === "Coming soon: digital products with instant download.").length >
			0,
	);
});
// #endregion

// #region Controls
Deno.test("Try it only on the demo rows: named Try it: {title}, a working link to the demo with no script", () => {
	const page = render();
	const printed = printedFeatures();
	const isTry = (n: Node) => n.tag === "a" && hasClass("lp-features__try")(n);
	assertEquals(find(page, isTry).length, 4);
	for (const row of rows(page)) {
		const entry = printed.find((e) => e.id === row.attrs.id)!;
		const demo = featureDemo(entry);
		const own = find(row, isTry);
		assertEquals(own.length, demo === null ? 0 : 1, entry.id);
		if (demo === null) continue;
		assertEquals(own[0].text, tryLabel(entry.title), "its name: the visible words, then the title");
		assertFalse("aria-label" in own[0].attrs, "no aria-label replaces the visible words");
		const hidden = find(own[0], hasClass("ui-visually-hidden"));
		assertEquals(hidden.map((n) => n.text), [`: ${entry.title}`]);
		assert(own[0].text.startsWith(FEATURES_COPY.tryIt), "the name starts with the label");
		assertEquals(own[0].attrs.href, featureTryHref(demo));
		assertEquals(own[0].attrs[TRY_DEMO_ATTR], demo);
		assertEquals(own[0].attrs[TRY_FEATURE_ATTR], entry.id);
		assert(hasClass("lp-btn--outlined")(own[0]), "Try it is tier 4 outlined");
	}
});

Deno.test("Learn more only where a help article exists, named with the feature", () => {
	const page = render();
	const printed = printedFeatures();
	for (const row of rows(page)) {
		const entry = printed.find((e) => e.id === row.attrs.id)!;
		const help = featureHelpHref(entry);
		const links = find(row, (n) => n.tag === "a" && n.text.startsWith(FEATURES_COPY.learnMore));
		assertEquals(links.length, help === null ? 0 : 1, entry.id);
		if (help === null) continue;
		assertEquals(links[0].attrs.href, help);
		assertEquals(links[0].text, `${FEATURES_COPY.learnMore}: ${entry.title}`);
	}
});

Deno.test("Coming soon rows are static text: no link, no button, their own words labelling them", () => {
	const page = render();
	const soon = chapters(page).find((s) => s.attrs.id === "coming-soon")!;
	assertEquals(find(soon, (n) => n.tag === "a" || n.tag === "button").length, 0);
	const texts = find(soon, (n) => n.tag === "p" && hasClass("lp-features__row-desc")(n))
		.map((p) => p.text);
	assertEquals(texts, [
		"Coming soon: turn great work into a template you can sell, with a share for the client who commissioned it.",
		"Coming soon: link the tools your team already uses.",
		"Coming soon: set money aside for tax automatically.",
	]);
	assertFalse(find(soon, (n) => n.tag === "img").length > 0, "Coming soon has no picture");
});

Deno.test("stills: real components only, each a named picture; a chapter with none prints bare", () => {
	const page = render();
	const placeholders = find(
		page,
		(n) => n.tag === "img" && /placehold\.co/.test(n.attrs.src ?? ""),
	);
	assertEquals(placeholders.length, 0, "no placeholder image");
	const stillOf = (id: FeatureChapterId) => {
		const section = chapters(page).find((s) => s.attrs.id === id)!;
		return find(section, hasClass("lp-features__still"));
	};
	const named = (id: FeatureChapterId) =>
		find(stillOf(id)[0], (n) => n.attrs.role === "img").map((n) => n.attrs["aria-label"]);
	assertEquals(named("find-and-hire"), ["Booking example."]);
	assertEquals(named("run-the-work"), ["Example work board with five columns."]);
	assertEquals(named("money"), ["Payment protection example."]);
	for (const bare of ["trust", "coming-soon"] as const) {
		assertEquals(stillOf(bare).length, 0, bare);
		const section = chapters(page).find((s) => s.attrs.id === bare)!;
		assert(hasClass("lp-features__chapter--bare")(section), bare);
	}
});
// #endregion

// #region Structured data, section, ids
Deno.test("JSON-LD: the WebPage's ItemList names exactly the visible rows, with their visible words", () => {
	const page = render();
	const script = find(page, (n) => n.tag === "script" && n.attrs.id === FEATURES_JSONLD_ID);
	assertEquals(script.length, 1);
	const graph = JSON.parse(script[0].raw) as { "@graph": Array<Record<string, unknown>> };
	const webPage = graph["@graph"].find((node) => node["@type"] === "WebPage")!;
	const list = graph["@graph"].find((node) => node["@type"] === "ItemList")!;
	assertEquals(webPage.name, FEATURES_COPY.title);
	assertEquals(webPage.mainEntity, { "@id": list["@id"] });
	const items = list.itemListElement as Array<{ name: string; description: string; url: string }>;
	const visible = rows(page).map((row) => ({
		name: find(row, (n) => n.tag === "h3")[0].text,
		description: find(row, (n) => n.tag === "p" && hasClass("lp-features__row-desc")(n))[0].text,
		url: `${ORIGIN}/features#${row.attrs.id}`,
	}));
	assertEquals(items.map(({ name, description, url }) => ({ name, description, url })), visible);
	assertEquals(list.numberOfItems, visible.length);
});

Deno.test("?section= marks its chapter for the island: the target, a focusable h2, the index's place", () => {
	const plain = render();
	assertEquals(find(plain, (n) => SECTION_TARGET_ATTR in n.attrs).length, 0);
	assertEquals(find(plain, (n) => "aria-current" in n.attrs).length, 0);
	const page = render("money");
	const marked = find(page, (n) => SECTION_TARGET_ATTR in n.attrs);
	assertEquals(marked.map((n) => n.attrs.id), ["money"]);
	assertEquals(find(marked[0], (n) => n.tag === "h2")[0].attrs.tabindex, "-1");
	const current = find(page, (n) => n.attrs["aria-current"] === "location");
	assertEquals(current.map((n) => n.attrs.href), ["#money"]);
});

Deno.test("the page ends with the final call to action and its search; no id twice", () => {
	const page = render("trust");
	const final = find(page, (n) => n.tag === "section" && n.attrs.id === FINAL_SECTION_ID);
	assertEquals(final.length, 1);
	assert(find(final[0], (n) => n.tag === "form").length === 1, "the final search");
	const ids = find(page, (n) => typeof n.attrs.id === "string").map((n) => n.attrs.id);
	const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
	assertEquals(twice, []);
});
// #endregion
