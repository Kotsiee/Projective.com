import { assert, assertEquals } from "@std/assert";
import {
	classifyLink,
	exitHref,
	externalLinkHref,
	extractLinks,
	isFlaggedVerdict,
	LinkPreviewRequestSchema,
	normalizeLink,
	segmentLinks,
} from "./links.ts";

const HOSTS = ["localhost:4000"];

// #region Segmenting
Deno.test("a body with no links is one text run", () => {
	assertEquals(segmentLinks("No links here, just example.com in prose."), [
		{ kind: "text", text: "No links here, just example.com in prose." },
	]);
});

Deno.test("links split the body; a sentence's trailing punctuation stays text", () => {
	assertEquals(segmentLinks("See https://figma.com/file/abc, then www.example.org."), [
		{ kind: "text", text: "See " },
		{ kind: "link", text: "https://figma.com/file/abc", href: "https://figma.com/file/abc" },
		{ kind: "text", text: ", then " },
		{ kind: "link", text: "www.example.org", href: "https://www.example.org/" },
		{ kind: "text", text: "." },
	]);
});

Deno.test("a parenthesised link keeps its own parenthesis and drops the sentence's", () => {
	const runs = segmentLinks("(see https://en.wikipedia.org/wiki/Gantt_(chart))");
	assertEquals(runs[1], {
		kind: "link",
		text: "https://en.wikipedia.org/wiki/Gantt_(chart)",
		href: "https://en.wikipedia.org/wiki/Gantt_(chart)",
	});
	assertEquals(runs[2], { kind: "text", text: ")" });
});

Deno.test("credentials in a link and non-web schemes are never linked", () => {
	assertEquals(normalizeLink("https://user:pw@evil.example/login"), null);
	assertEquals(normalizeLink("javascript:alert(1)"), null);
	assertEquals(segmentLinks("ftp://files.example/x").every((s) => s.kind === "text"), true);
});

Deno.test("a masked placeholder is not a link", () => {
	assertEquals(segmentLinks("Pay me at [link hidden]").length, 1);
});

Deno.test("extractLinks dedupes and caps", () => {
	assertEquals(
		extractLinks(
			"https://a.example https://a.example https://b.example https://c.example https://d.example",
		),
		["https://a.example/", "https://b.example/", "https://c.example/"],
	);
});
// #endregion

// #region Classifying
Deno.test("a profile, a workspace project and an entity view are internal cards", () => {
	assertEquals(classifyLink("http://localhost:4000/@juno", HOSTS), {
		kind: "profile",
		url: "http://localhost:4000/@juno",
		handle: "juno",
	});
	assertEquals(classifyLink("https://projective.io/projects/prj-bttceo692s/stg-42xm6ngfbo", []), {
		kind: "project",
		url: "https://projective.io/projects/prj-bttceo692s/stg-42xm6ngfbo",
		slug: "prj-bttceo692s",
	});
	assertEquals(classifyLink("http://localhost:4000/view/svc-23456789ab", HOSTS).kind, "listing");
	assertEquals(classifyLink("http://localhost:4000/@juno/view/sv-juno-0", HOSTS), {
		kind: "listing",
		url: "http://localhost:4000/@juno/view/sv-juno-0",
		id: "sv-juno-0",
	});
});

Deno.test("an internal page with no card, and a malformed project slug, are plain internal links", () => {
	assertEquals(classifyLink("http://localhost:4000/explore?q=brand", HOSTS).kind, "internal");
	assertEquals(classifyLink("http://localhost:4000/projects/not-a-slug", HOSTS).kind, "internal");
});

Deno.test("another host is external, even on the same port or a lookalike name", () => {
	assertEquals(classifyLink("http://localhost:5000/@juno", HOSTS).kind, "external");
	assertEquals(classifyLink("https://projective.io.evil.example/@juno", []), {
		kind: "external",
		url: "https://projective.io.evil.example/@juno",
		host: "projective.io.evil.example",
	});
});
// #endregion

// #region Leaving
Deno.test("only a safe verdict links straight out; everything else goes through /exit", () => {
	const url = "https://example.com/a?b=c&d=e";
	assertEquals(exitHref(url), "/exit?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc%26d%3De");
	assertEquals(externalLinkHref(url, "safe"), url);
	for (const verdict of ["pending", "suspicious", "blocked", "unscannable", null] as const) {
		assertEquals(externalLinkHref(url, verdict), exitHref(url));
	}
});

Deno.test("suspicious and blocked are flagged; unscannable is not", () => {
	assert(isFlaggedVerdict("suspicious"));
	assert(isFlaggedVerdict("blocked"));
	assert(!isFlaggedVerdict("unscannable"));
	assert(!isFlaggedVerdict("safe"));
	assert(!isFlaggedVerdict(null));
});

Deno.test("a preview request names at least one and at most twenty links", () => {
	assert(!LinkPreviewRequestSchema.safeParse({ urls: [] }).success);
	assert(LinkPreviewRequestSchema.safeParse({ urls: ["https://a.example"] }).success);
	assert(
		!LinkPreviewRequestSchema.safeParse({ urls: Array(21).fill("https://a.example") }).success,
	);
});
// #endregion
