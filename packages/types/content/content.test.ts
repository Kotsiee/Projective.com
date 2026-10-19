/**
 * The content schemas' contract: what an editorial body may contain, and what it may not.
 *
 * Every refusal here is a defect that would otherwise reach a page silently — an unsafe link renders
 * as a working link, a short table row renders as a ragged table, a repeated anchor makes one of two
 * shared `#links` land on the wrong heading. None of them throws at render time.
 */
import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { z } from "zod";
import {
	checkDocAnchors,
	CONTENT_NODE_TYPES,
	ContentImageSchema,
	ContentNodeSchema,
	defineContent,
	DocBaseSchema,
	DocSchema,
	DocVersionSchema,
	isExternalHref,
	IsoDateSchema,
	isSafeHref,
	isSafeImageSrc,
	SemverSchema,
	TableNodeSchema,
} from "./mod.ts";
import { SAMPLE_DOC, SampleDocSchema } from "./fixtures.ts";

/** A minimal valid document, for mutation. */
function doc(sections: unknown[]): unknown {
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

const P = { type: "p", content: "x" };

// #region Links and images
Deno.test("links: internal paths, fragments, https, mailto and tel are allowed", () => {
	for (
		const href of [
			"/help/fees",
			"/",
			"#fees",
			"https://stripe.com/legal",
			"mailto:hi@x.io",
			"tel:+441234",
		]
	) {
		assert(isSafeHref(href), href);
	}
});

Deno.test("links: script schemes, protocol-relative and bare relative targets are refused", () => {
	for (
		const href of [
			"javascript:alert(1)",
			"JAVASCRIPT:alert(1)",
			"data:text/html,x",
			"vbscript:x",
			"//evil.example",
			"/\\evil.example",
			"fees",
			"",
			"#",
			"/a b",
		]
	) {
		assertFalse(isSafeHref(href), href);
	}
	const bad = ContentNodeSchema.safeParse({
		type: "p",
		content: [{ type: "link", href: "javascript:alert(1)", text: "x" }],
	});
	assertFalse(bad.success);
});

Deno.test("external hrefs are exactly the absolute http(s) ones", () => {
	assert(isExternalHref("https://placehold.co"));
	assertFalse(isExternalHref("/help"));
	assertFalse(isExternalHref("mailto:a@b.c"));
});

Deno.test("images: same-origin paths, https, and loopback http; dimensions and alt are required", () => {
	assert(isSafeImageSrc("/test_images/banner_1.jpg"));
	assert(isSafeImageSrc("https://placehold.co/600x400?text=Figure"));
	// A local Supabase storage URL (SUPABASE_PUBLIC_URL is http://127.0.0.1:54321 in development).
	assert(isSafeImageSrc("http://127.0.0.1:54321/storage/v1/object/public/catalogue/c.jpg"));
	assert(isSafeImageSrc("http://localhost:8000/a.png"));
	assert(isSafeImageSrc("http://[::1]/a.png"));
	assert(
		ContentImageSchema.safeParse({
			src: "http://127.0.0.1:54321/storage/v1/object/public/catalogue/c.jpg",
			alt: "A cover",
			w: 1200,
			h: 630,
		}).success,
	);
	assertFalse(isSafeImageSrc("http://example.com/a.png"), "plain http off loopback");
	assertFalse(isSafeImageSrc("http://localhost.evil.example/a.png"), "a lookalike host");
	assertFalse(isSafeImageSrc("data:image/png;base64,AAAA"));
	assertFalse(isSafeImageSrc("//cdn.example/a.png"));
	assertFalse(
		isSafeImageSrc("/\\evil.example/a.png"),
		"browsers read /\\host as protocol-relative",
	);
	assertFalse(isSafeImageSrc("https:/\\evil.example/a.png"));
	assertFalse(isSafeImageSrc(""));
	const base = { type: "image", src: "/a.png", alt: "A", w: 10, h: 10 };
	assert(ContentNodeSchema.safeParse(base).success);
	assertFalse(ContentNodeSchema.safeParse({ ...base, alt: "" }).success);
	assertFalse(ContentNodeSchema.safeParse({ ...base, w: undefined }).success);
	assertFalse(ContentNodeSchema.safeParse({ ...base, h: 0 }).success);
});
// #endregion

// #region Nodes
Deno.test("every node type parses, and the vocabulary is closed", () => {
	const samples: Record<(typeof CONTENT_NODE_TYPES)[number], unknown> = {
		p: P,
		h3: { type: "h3", text: "Sub" },
		list: {
			type: "list",
			items: ["a", { content: ["b"], list: { type: "list", ordered: true, items: ["c"] } }],
		},
		quote: { type: "quote", content: "q", cite: "c" },
		code: { type: "code", lang: "json", text: "{}" },
		image: { type: "image", src: "/a.png", alt: "A", w: 1, h: 1 },
		callout: { type: "callout", tone: "warning", body: [P] },
		table: { type: "table", head: ["a"], rows: [["1"]] },
		dl: {
			type: "dl",
			items: [{ term: "Stage", definition: ["One ", { type: "em", text: "unit" }] }],
		},
	};
	for (const [type, value] of Object.entries(samples)) {
		const parsed = ContentNodeSchema.safeParse(value);
		assert(parsed.success, `${type}: ${parsed.success ? "" : z.prettifyError(parsed.error)}`);
	}
	assertFalse(ContentNodeSchema.safeParse({ type: "html", html: "<b>x</b>" }).success);
	assertFalse(ContentNodeSchema.safeParse({ type: "h2", text: "Sections own the h2" }).success);
	assertFalse(ContentNodeSchema.safeParse({ type: "dl", items: [] }).success);
});

Deno.test("keys are a run; list markers style ordered lists only", () => {
	assert(
		ContentNodeSchema.safeParse({ type: "p", content: ["Press ", { type: "kbd", text: "/" }] })
			.success,
	);
	assertFalse(
		ContentNodeSchema.safeParse({ type: "p", content: [{ type: "kbd", text: "" }] }).success,
	);
	for (const marker of ["decimal", "lower-alpha", "lower-roman"]) {
		assert(
			ContentNodeSchema.safeParse({ type: "list", ordered: true, marker, items: ["a"] }).success,
			marker,
		);
	}
	const unordered = ContentNodeSchema.safeParse({
		type: "list",
		marker: "lower-alpha",
		items: ["a"],
	});
	assertFalse(unordered.success);
	assert(z.prettifyError(unordered.error).includes("ordered list only"));
	assertFalse(
		ContentNodeSchema.safeParse({
			type: "list",
			ordered: true,
			marker: "upper-greek",
			items: ["a"],
		})
			.success,
	);
});

Deno.test("a raw-HTML-shaped run is refused: runs have a closed vocabulary", () => {
	assertFalse(
		ContentNodeSchema.safeParse({ type: "p", content: [{ type: "html", text: "<i>x</i>" }] })
			.success,
	);
});

Deno.test("a table row must match the header's width", () => {
	assert(
		TableNodeSchema.safeParse({ type: "table", head: ["a", "b"], rows: [["1", "2"]] }).success,
	);
	const short = TableNodeSchema.safeParse({ type: "table", head: ["a", "b"], rows: [["1"]] });
	assertFalse(short.success);
	assert(z.prettifyError(short.error).includes("Row 1 has 1 cells; the header has 2"));
});

Deno.test("a callout holds only paragraphs and lists", () => {
	const nested = {
		type: "callout",
		tone: "tip",
		body: [{ type: "callout", tone: "tip", body: [P] }],
	};
	assertFalse(ContentNodeSchema.safeParse(nested).success);
	assertFalse(
		ContentNodeSchema.safeParse({ type: "callout", tone: "tip", body: [{ type: "h3", text: "x" }] })
			.success,
	);
	assertFalse(ContentNodeSchema.safeParse({ type: "callout", tone: "loud", body: [P] }).success);
});
// #endregion

// #region Document
Deno.test("the sample fixture parses and carries every node type", () => {
	assert(SampleDocSchema.safeParse(SAMPLE_DOC).success);
	const types = new Set(SAMPLE_DOC.sections.flatMap((s) => s.body.map((n) => n.type)));
	assertEquals([...types].sort(), [...CONTENT_NODE_TYPES].sort());
	assertEquals(SAMPLE_DOC.cover.src, "/test_images/banner_1.jpg");
	assert(
		SAMPLE_DOC.sections.some((s) =>
			s.body.some((n) => n.type === "image" && n.src.startsWith("https://placehold.co/"))
		),
	);
});

Deno.test("section ids and explicit heading ids must be unique", () => {
	assert(DocSchema.safeParse(doc([{ id: "a", heading: "A", body: [P] }])).success);
	const dupSections = DocSchema.safeParse(doc([
		{ id: "a", heading: "A", body: [P] },
		{ id: "a", heading: "Again", body: [P] },
	]));
	assertFalse(dupSections.success);
	const dupHeading = DocSchema.safeParse(doc([
		{ id: "a", heading: "A", body: [{ type: "h3", text: "B", id: "a" }] },
	]));
	assertFalse(dupHeading.success);
	assert(z.prettifyError(dupHeading.error).includes('Heading id "a" repeats'));
});

Deno.test("an anchor may not take an id the layout owns", () => {
	const r = DocSchema.safeParse(doc([{ id: "main-content", heading: "A", body: [P] }]));
	assertFalse(r.success);
	assert(z.prettifyError(r.error).includes("reserved by the layout"));
});

Deno.test("anchor ids are lower-case kebab", () => {
	for (const id of ["Fees", "fees_1", "-fees", "fees-", "fe--es", "f ees"]) {
		assertFalse(DocSchema.safeParse(doc([{ id, heading: "A", body: [P] }])).success, id);
	}
	assert(DocSchema.safeParse(doc([{ id: "1-4-0", heading: "A", body: [P] }])).success);
});

Deno.test("consumers extend the core and keep its anchor rule", () => {
	const Legal = DocSchema.extend({
		effectiveAt: IsoDateSchema,
		versions: z.array(DocVersionSchema),
	});
	const value = {
		...(doc([{ id: "a", heading: "A", body: [P] }]) as object),
		effectiveAt: "2026-11-01",
		versions: [{ version: "1", date: "2026-10-17", summary: "First published" }],
	};
	assert(Legal.safeParse(value).success);
	assertFalse(Legal.safeParse({ ...value, effectiveAt: "1 November" }).success);
	const repeated = {
		...value,
		sections: [{ id: "a", heading: "A", body: [P] }, { id: "a", heading: "B", body: [P] }],
	};
	assertFalse(Legal.safeParse(repeated).success, "the refinement survives .extend()");
	// The unrefined base still supports the reshaping operators a refined schema refuses.
	assert(DocBaseSchema.omit({ version: true }).safeParse(value).success);
});

Deno.test("overriding an existing key: .extend throws, .safeExtend keeps the anchor rule", () => {
	assertThrows(() => DocSchema.extend({ version: SemverSchema }), Error, "safeExtend");
	const Release = DocSchema.safeExtend({ version: SemverSchema });
	const base = doc([{ id: "a", heading: "A", body: [P] }]) as Record<string, unknown>;
	assert(Release.safeParse({ ...base, version: "1.4.0" }).success);
	assertFalse(Release.safeParse({ ...base, version: "1.4" }).success, "the override applies");
	const repeated = {
		...base,
		version: "1.4.0",
		sections: [{ id: "a", heading: "A", body: [P] }, { id: "a", heading: "B", body: [P] }],
	};
	assertFalse(Release.safeParse(repeated).success, "the refinement survives .safeExtend()");
	const Rebuilt = DocBaseSchema.extend({ version: SemverSchema }).superRefine(checkDocAnchors);
	assertFalse(Rebuilt.safeParse(repeated).success);
});

Deno.test("the anchor check refines a picked or partial shape without throwing", () => {
	const Listing = DocBaseSchema.pick({ id: true, slug: true, title: true, summary: true })
		.superRefine(checkDocAnchors);
	assert(Listing.safeParse({ id: "d", slug: "d", title: "D", summary: "S" }).success);
	const Patch = DocBaseSchema.partial().superRefine(checkDocAnchors);
	assert(Patch.safeParse({ title: "x" }).success);
	assertFalse(
		Patch.safeParse({
			sections: [{ id: "a", heading: "A", body: [P] }, { id: "a", heading: "B", body: [P] }],
		}).success,
		"sections, when present, are still checked",
	);
});

Deno.test("type level: defineContent checks body nodes at compile time", () => {
	const valid = doc([{ id: "a", heading: "A", body: [P] }]) as z.input<typeof DocSchema>;
	if (false as boolean) {
		defineContent(DocSchema, {
			...valid,
			// @ts-expect-error — a body node outside the vocabulary must not type-check.
			sections: [{ id: "a", heading: "A", body: [{ type: "paragraph-typo", text: 42 }] }],
		});
		defineContent(DocSchema, {
			...valid,
			// @ts-expect-error — a list item of the wrong shape must not type-check either.
			sections: [{ id: "a", heading: "A", body: [{ type: "list", items: [42] }] }],
		});
	}
	assert(true);
});

Deno.test("defineContent returns the parsed module and names a broken one", () => {
	const ok = defineContent(
		DocSchema,
		doc([{ id: "a", heading: "A", body: [P] }]) as z.input<typeof DocSchema>,
	);
	assertEquals(ok.sections[0].id, "a");
	const err = assertThrows(() =>
		defineContent(DocSchema, { ...(doc([]) as object), id: "broken" } as z.input<typeof DocSchema>)
	);
	assert(err instanceof Error && err.message.startsWith('Invalid content module "broken"'));
});

Deno.test("shared primitives: ISO dates and semantic versions", () => {
	assert(IsoDateSchema.safeParse("2026-10-17").success);
	assertFalse(IsoDateSchema.safeParse("2026-13-01").success);
	for (const v of ["1.0.0", "0.12.3", "2.0.0-beta.1"]) assert(SemverSchema.safeParse(v).success, v);
	for (const v of ["1.0", "01.0.0", "v1.0.0", "1.0.0-"]) {
		assertFalse(SemverSchema.safeParse(v).success, v);
	}
});
// #endregion
