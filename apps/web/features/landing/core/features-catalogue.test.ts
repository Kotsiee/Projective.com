/**
 * features-catalogue.test — the `/features` catalogue against its sources: `flows/LANDING.md` §4.12
 * (every row's title and one-line description word for word, its claim tags, its chapter), §5 (every
 * tag a claims row), the L3 demos (every "Try it" a built demo) and the help centre (every "Learn
 * more" a real, visible, seeded article — never a guessed slug).
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { HELP_ARTICLES } from "@server/services/editorial/content/help.ts";
import {
	chapterFeatures,
	chapterNumber,
	COMING_SOON_LEAD,
	comingSoonParts,
	FEATURE_CATALOGUE,
	FEATURE_CHAPTERS,
	featureDemo,
	featureHelpHref,
	FEATURES_COPY,
	featureTryHref,
	parseSection,
	printedFeatures,
	tryLabel,
	wordCount,
} from "./features-catalogue.ts";
import { DEMO_IDS, isDemoId } from "./demo-stage.ts";

// #region Sources
/** The repository root, from `apps/web/features/landing/core/`. */
const ROOT = new URL("../../../../../", import.meta.url);

const LANDING_MD = Deno.readTextFileSync(new URL("documentation/flows/LANDING.md", ROOT));

/** The generated seed the DB-backed help centre is built from. */
const HELP_SEED = Deno.readTextFileSync(
	new URL("supabase/migrations/00005071_seed_editorial_help.sql", ROOT),
);

/** The lines of `markdown` from the heading that starts with `heading` to the next `##`/`###`. */
function sectionOf(markdown: string, heading: string): string[] {
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	const start = lines.findIndex((line) => line.startsWith(heading));
	assert(start !== -1, `LANDING.md has no "${heading}"`);
	const end = lines.findIndex((line, i) => i > start && /^#{2,3} /.test(line));
	return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** One §4.12 table row as the spec writes it. */
interface SpecRow {
	chapter: string;
	visualizer: string | null;
	title: string;
	description: string;
	smallPrint: string | null;
	claims: string[];
	held: boolean;
}

const TAG = /`\[([A-Z]\d+)\]`/g;

/** A cell's sentence with its claim tags and any trailing note in brackets dropped. */
function sentenceOf(cell: string): string {
	return cell.replace(TAG, "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim();
}

/** §4.12's table, parsed: the chapter cell carries down until the next one. */
function specRows(): SpecRow[] {
	const rows: SpecRow[] = [];
	let chapter = "";
	for (const line of sectionOf(LANDING_MD, "### 4.12")) {
		if (!line.startsWith("|") || /^\|\s*:?-/.test(line) || line.includes("One-line description")) {
			continue;
		}
		const [chapterCell, tileCell, descCell] = line.split("|").slice(1, 4).map((c) => c.trim());
		if (chapterCell) chapter = chapterCell.replace(/\s*\(static\)$/, "");
		const tile = tileCell.match(/^(V\d+)\s+(.*)$/);
		const [main, small] = descCell.split(/\s*Small print:\s*/);
		rows.push({
			chapter,
			visualizer: tile ? tile[1] : null,
			title: tile ? tile[2] : tileCell,
			description: sentenceOf(main),
			smallPrint: small === undefined ? null : sentenceOf(small),
			claims: [...descCell.matchAll(TAG)].map((match) => match[1]),
			held: descCell.includes("**HELD**"),
		});
	}
	return rows;
}

/** Every tag §5's claims table has a row for. */
function claimRows(): Set<string> {
	const tags = new Set<string>();
	for (const line of sectionOf(LANDING_MD, "## 5. Claims table")) {
		const match = line.match(/^\|\s*([A-Z]\d+)\s*\|/);
		if (match) tags.add(match[1]);
	}
	return tags;
}
// #endregion

// #region The spec
Deno.test("the catalogue is §4.12's table: every row's chapter, title, words and tags, in order", () => {
	const spec = specRows();
	assertEquals(spec.length, FEATURE_CATALOGUE.length);
	FEATURE_CATALOGUE.forEach((entry, i) => {
		const row = spec[i];
		const chapter = FEATURE_CHAPTERS.find((c) => c.id === entry.chapter)!;
		assertEquals(chapter.title, row.chapter, entry.id);
		assertEquals(entry.visualizer, row.visualizer, entry.id);
		assertEquals(entry.title, row.title, entry.id);
		assertEquals(entry.status === "held", row.held, entry.id);
		if (row.held) return;
		assertEquals(entry.description, row.description, entry.id);
		assertEquals(entry.smallPrint, row.smallPrint, entry.id);
		assertEquals([...entry.claims], row.claims, entry.id);
	});
});

Deno.test("every claim tag a row carries resolves to a §5 claims row", () => {
	const tags = claimRows();
	assert(tags.size > 50, "the claims table was not read");
	for (const entry of FEATURE_CATALOGUE) {
		for (const tag of entry.claims) assert(tags.has(tag), `${entry.id}: [${tag}] has no §5 row`);
	}
});

Deno.test("every live row's description is under 15 words (§4.12)", () => {
	for (const entry of FEATURE_CATALOGUE.filter((e) => e.status === "live")) {
		const words = wordCount(entry.description);
		assert(words > 0 && words < 15, `${entry.id}: ${words} words`);
	}
	assertEquals(
		wordCount("Book a live session. Your payment is held until 24 hours after it ends."),
		14,
	);
});
// #endregion

// #region Status
Deno.test("V11 and V10 are held: catalogued with no control, never printed", () => {
	const held = FEATURE_CATALOGUE.filter((entry) => entry.status === "held");
	assertEquals(held.map((entry) => entry.visualizer), ["V11", "V10"]);
	for (const entry of held) {
		assertEquals(featureDemo(entry), null, entry.id);
		assertEquals(featureHelpHref(entry), null, entry.id);
		assertEquals(entry.helpSlug, null, `${entry.id}: no article explains it`);
	}
	assertFalse(printedFeatures().some((entry) => entry.status === "held"));
	assertFalse(chapterFeatures("money").some((entry) => entry.visualizer === "V10"));
	assertFalse(chapterFeatures("find-and-hire").some((entry) => entry.visualizer === "V11"));
});

Deno.test("Coming soon rows are static: no demo, no help link, and their own lead labels them", () => {
	const soon = FEATURE_CATALOGUE.filter((entry) => entry.status === "coming_soon");
	assertEquals(soon.map((entry) => entry.title), [
		"Sell your best work",
		"Connected tools",
		"Tax pot",
	]);
	for (const entry of soon) {
		assertEquals(entry.chapter, "coming-soon");
		assertEquals(entry.demo, null, entry.id);
		assertEquals(entry.helpSlug, null, entry.id);
		assertEquals(featureDemo(entry), null);
		assertEquals(featureHelpHref(entry), null);
		const [lead, rest] = comingSoonParts(entry.description);
		assertEquals(lead, COMING_SOON_LEAD);
		assertEquals(lead + rest, entry.description);
	}
	for (const entry of FEATURE_CATALOGUE.filter((e) => e.chapter === "coming-soon")) {
		assertEquals(entry.status, "coming_soon", entry.id);
	}
	assertEquals(comingSoonParts("Work starts once it's paid for."), [
		"",
		"Work starts once it's paid for.",
	]);
});
// #endregion

// #region Controls
Deno.test("Try it only where a demo was built: V1, V2, V4 and V5, each a DemoId, each once", () => {
	const tried = FEATURE_CATALOGUE.flatMap((entry) => {
		const demo = featureDemo(entry);
		return demo === null ? [] : [[entry.visualizer, demo]];
	});
	assertEquals(tried, [["V1", "board"], ["V4", "booking"], ["V2", "payments"], ["V5", "splits"]]);
	for (const [, demo] of tried) assert(isDemoId(demo));
	assertEquals(tried.map(([, demo]) => demo).sort(), [...DEMO_IDS].sort());
	assertEquals(featureTryHref("board"), "/?demo=board#demo");
	assertEquals(FEATURES_COPY.tryIt, "Try it");
	assertEquals(tryLabel("Work board"), "Try it: Work board");
	for (const entry of FEATURE_CATALOGUE) {
		assert(tryLabel(entry.title).startsWith(FEATURES_COPY.tryIt), "the name holds the label");
	}
});

Deno.test("every Learn more is a real help article: in the content source, seeded, visible, in its category", () => {
	const linked = FEATURE_CATALOGUE.filter((entry) => entry.helpSlug !== null);
	assert(linked.length >= 8, "the help links were not read");
	for (const entry of linked) {
		const [category, slug, extra] = entry.helpSlug!.split("/");
		assertEquals(extra, undefined, `${entry.id}: a help slug is <category>/<article>`);
		const article = HELP_ARTICLES.find((a) => a.slug === slug);
		assert(article, `${entry.id}: no help article "${slug}"`);
		assertEquals(article.category, category, `${entry.id}: "${slug}" is not in "${category}"`);
		assertEquals(article.archivedOn, null, `${entry.id}: "${slug}" is archived`);
		assert(
			HELP_SEED.includes(`('${slug}', '${category}'`),
			`${entry.id}: "${slug}" is not seeded in ${category}`,
		);
		assertEquals(featureHelpHref(entry), `/help/${category}/${slug}`);
	}
});
// #endregion

// #region Chapters and anchors
Deno.test("chapters: five, in order, each printing at least one row, the catalogue grouped by them", () => {
	assertEquals(FEATURE_CHAPTERS.map((chapter) => chapter.id), [
		"find-and-hire",
		"run-the-work",
		"money",
		"trust",
		"coming-soon",
	]);
	assertEquals(FEATURE_CHAPTERS.map((chapter) => chapterNumber(chapter.id)), [
		"01",
		"02",
		"03",
		"04",
		"05",
	]);
	const order = FEATURE_CHAPTERS.map((chapter) => chapter.id);
	const seen = FEATURE_CATALOGUE.map((entry) => order.indexOf(entry.chapter));
	assertEquals(seen, [...seen].sort((a, b) => a - b), "the catalogue is not in chapter order");
	for (const chapter of FEATURE_CHAPTERS) {
		assert(chapterFeatures(chapter.id).length > 0, chapter.id);
	}
});

Deno.test("row anchors are unique, never a chapter's slug, and every printed row has one", () => {
	const ids = FEATURE_CATALOGUE.map((entry) => entry.id);
	assertEquals(ids.length, new Set(ids).size);
	for (const id of ids) {
		assert(/^[a-z][a-z0-9-]*$/.test(id), id);
		assertFalse(FEATURE_CHAPTERS.some((chapter) => chapter.id === id), id);
	}
});

Deno.test("parseSection: an exact chapter slug, forgiving case and space; anything else opens nothing", () => {
	assertEquals(parseSection("money"), "money");
	assertEquals(parseSection(" Run-The-Work "), "run-the-work");
	assertEquals(parseSection("payment-protection"), null);
	assertEquals(parseSection(""), null);
	assertEquals(parseSection(null), null);
	assertEquals(parseSection(undefined), null);
});
// #endregion
