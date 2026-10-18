/**
 * Anchors and the table of contents.
 *
 * A heading id is a public address: once `/legal/terms#fees` is shared it must keep landing on the
 * same heading. So the properties pinned here are stability (the same document always yields the
 * same ids), uniqueness (two headings never share one) and precedence (an author's explicit id is
 * never displaced by a generated one).
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
	anchorDoc,
	anchorNodes,
	createAnchorRegistry,
	type Doc,
	docToc,
	flattenToc,
	RESERVED_ANCHOR_IDS,
	slugify,
} from "./mod.ts";
import { SAMPLE_DOC } from "./fixtures.ts";

const P = { type: "p" as const, content: "x" };

function doc(sections: Doc["sections"]): Doc {
	return {
		id: "d",
		slug: "d",
		title: "D",
		summary: "S",
		updatedAt: "2026-10-17",
		version: "1",
		sections,
	};
}

// #region slugify
Deno.test("slugify: lower-case kebab, accents folded, & read as and", () => {
	assertEquals(slugify("Fees & Payouts"), "fees-and-payouts");
	assertEquals(slugify("  Résumé — Ünïcode!  "), "resume-unicode");
	assertEquals(slugify("1.4.0 — What's new"), "1-4-0-what-s-new");
	assertEquals(slugify("Fair Exit (tiers)"), "fair-exit-tiers");
});

Deno.test("slugify: text with nothing usable becomes `section`", () => {
	assertEquals(slugify("—"), "section");
	assertEquals(slugify(""), "section");
	assertEquals(slugify("日本語"), "section");
});

Deno.test("slugify: long text is cut on a word boundary and never ends in a hyphen", () => {
	const long = slugify(
		"This heading is far too long to be a comfortable anchor in any shared link at all",
		32,
	);
	assert(long.length <= 32, long);
	assert(!long.endsWith("-"), long);
	assertEquals(long, "this-heading-is-far-too-long-to");
});
// #endregion

// #region Registry
Deno.test("the registry suffixes repeats -2, -3 and skips taken ids", () => {
	const r = createAnchorRegistry(["intro-2"]);
	assertEquals(r.claim("intro"), "intro");
	assertEquals(r.claim("intro"), "intro-3");
	assertEquals(r.claim("intro"), "intro-4");
	assert(r.has("intro-2"));
});

Deno.test("the default registry never hands out a layout id", () => {
	const r = createAnchorRegistry();
	for (const id of RESERVED_ANCHOR_IDS) assertNotEquals(r.claim(id), id);
});
// #endregion

// #region anchorDoc
Deno.test("duplicate sub-heading text yields unique, stable ids", () => {
	const a = anchorDoc(SAMPLE_DOC);
	const ids = a.sections.flatMap((
		s,
	) => [s.anchor, ...s.body.flatMap((n) => n.type === "h3" ? [n.id] : [])]);
	assertEquals(ids, [
		"overview",
		"an-example",
		"an-example-2",
		"fees",
		"worked-numbers",
		"releases",
		"releases-2",
	]);
	assertEquals(new Set(ids).size, ids.length);
	assertEquals(anchorDoc(SAMPLE_DOC), a, "anchoring is deterministic");
});

Deno.test("an explicit id wins over a generated one that would have taken it", () => {
	const d = doc([
		{ id: "intro", heading: "Intro", body: [{ type: "h3", text: "Details" }, P] },
		{ id: "more", heading: "More", body: [{ type: "h3", text: "Elsewhere", id: "details" }] },
	]);
	const a = anchorDoc(d);
	const first = a.sections[0].body[0];
	const second = a.sections[1].body[0];
	assert(first.type === "h3" && second.type === "h3");
	assertEquals(second.id, "details", "the explicit id is kept");
	assertEquals(first.id, "details-2", "the generated id steps aside");
});

Deno.test("numbered documents carry clause numbers on sections and sub-headings", () => {
	const a = anchorDoc(SAMPLE_DOC, { numbered: true });
	assertEquals(a.sections.map((s) => s.number), ["1", "2", "3"]);
	const subs = a.sections.flatMap((s) => s.body.flatMap((n) => n.type === "h3" ? [n.number] : []));
	assertEquals(subs, ["1.1", "1.2", "2.1", "3.1"]);
	assertEquals(anchorDoc(SAMPLE_DOC).sections[0].number, undefined, "unnumbered by default");
});

Deno.test("page-level reserved ids are honoured for generated anchors", () => {
	const a = anchorDoc(
		doc([{ id: "intro", heading: "Intro", body: [{ type: "h3", text: "Comments" }] }]),
		{
			reserved: ["comments"],
		},
	);
	const h = a.sections[0].body[0];
	assert(h.type === "h3");
	assertEquals(h.id, "comments-2");
});

Deno.test("an explicit id is never suffixed, even when the page reserved it", () => {
	const a = anchorDoc(
		doc([{
			id: "versions",
			heading: "Versions",
			body: [{ type: "h3", text: "x", id: "history" }, { type: "h3", text: "Versions" }],
		}]),
		{ reserved: ["versions", "history"] },
	);
	assertEquals(a.sections[0].anchor, "versions", "a shared /legal/terms#versions keeps working");
	const [pinned, generated] = a.sections[0].body;
	assert(pinned.type === "h3" && generated.type === "h3");
	assertEquals(pinned.id, "history");
	assertEquals(generated.id, "versions-2", "only the GENERATED id steps aside");
});
// #endregion

// #region anchorNodes
Deno.test("anchorNodes: bodies anchored against one registry never share an id", () => {
	const registry = createAnchorRegistry([...RESERVED_ANCHOR_IDS, "release-1-4-0", "release-1-3-0"]);
	const first = anchorNodes(
		[{ type: "h3", text: "Fixes" }, P, { type: "h3", text: "New" }],
		registry,
	);
	const second = anchorNodes(
		[{ type: "h3", text: "Fixes" }, { type: "h3", text: "Pinned", id: "fixes-3" }],
		registry,
	);
	const idsOf = (nodes: typeof first) => nodes.flatMap((n) => n.type === "h3" ? [n.id] : []);
	assertEquals(idsOf(first), ["fixes", "new"]);
	assertEquals(idsOf(second), ["fixes-2", "fixes-3"], "the explicit id is reserved, then kept");
	assert(registry.has("fixes-3"));
});

Deno.test("anchorNodes: with no registry, one list is de-duplicated on its own", () => {
	const nodes = anchorNodes([{ type: "h3", text: "Same" }, { type: "h3", text: "Same" }]);
	assertEquals(nodes.map((n) => n.type === "h3" ? n.id : ""), ["same", "same-2"]);
});

Deno.test("registry.reserve marks an id used exactly as given", () => {
	const r = createAnchorRegistry([]);
	assertEquals(r.reserve("intro"), "intro");
	assertEquals(r.reserve("intro"), "intro", "reserving twice never suffixes");
	assertEquals(r.claim("intro"), "intro-2");
});
// #endregion

// #region TOC
Deno.test("the TOC tree mirrors sections and their sub-headings", () => {
	const toc = docToc(anchorDoc(SAMPLE_DOC, { numbered: true }));
	assertEquals(toc.map((e) => [e.id, e.level, e.number]), [
		["overview", 2, "1"],
		["fees", 2, "2"],
		["releases", 2, "3"],
	]);
	assertEquals(toc[0].children.map((e) => [e.id, e.text, e.level, e.number]), [
		["an-example", "An example", 3, "1.1"],
		["an-example-2", "An example", 3, "1.2"],
	]);
	assertEquals(toc[0].children[0].children, []);
});

Deno.test("depth 2 lists sections only; flattenToc walks in document order", () => {
	const anchored = anchorDoc(SAMPLE_DOC);
	assert(docToc(anchored, { depth: 2 }).every((e) => e.children.length === 0));
	assertEquals(flattenToc(docToc(anchored)).map((e) => e.id), [
		"overview",
		"an-example",
		"an-example-2",
		"fees",
		"worked-numbers",
		"releases",
		"releases-2",
	]);
});
// #endregion
