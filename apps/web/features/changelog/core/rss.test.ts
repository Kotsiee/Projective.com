import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import type { ChangelogRelease } from "@projective/types/editorial";
import { buildChangelogRss, escapeXml, rfc822Day } from "./rss.ts";

/**
 * The RSS document is parsed back with a small, STRICT XML 1.0 reader (well-formedness: one root,
 * matched tags, quoted attributes, only the five named entities and character references, no raw
 * `<` or `&` in text), then checked against RSS 2.0's required elements.
 */

// #region A strict XML reader
interface XmlNode {
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	/** The decoded character data directly inside this element. */
	text: string;
}

const NAME = /^[A-Za-z_][\w:.-]*/;
const ENTITY: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

function decode(raw: string, where: string): string {
	if (raw.includes("<")) throw new SyntaxError(`raw < in ${where}`);
	return raw.replace(/&([^;]*);?/g, (match, body: string) => {
		if (!match.endsWith(";")) throw new SyntaxError(`unterminated entity in ${where}`);
		if (body in ENTITY) return ENTITY[body];
		const num = /^#(\d+)$/.exec(body) ?? /^#x([0-9a-fA-F]+)$/.exec(body);
		if (num) return String.fromCodePoint(Number.parseInt(num[1], body[1] === "x" ? 16 : 10));
		throw new SyntaxError(`unknown entity &${body}; in ${where}`);
	});
}

function parseXml(source: string): XmlNode {
	let i = 0;
	const prolog = /^<\?xml version="1\.0" encoding="UTF-8"\?>/.exec(source);
	if (!prolog) throw new SyntaxError("missing XML declaration");
	i = prolog[0].length;
	const skipSpace = () => {
		while (i < source.length && /\s/.test(source[i])) i++;
	};

	function element(): XmlNode {
		if (source[i] !== "<") throw new SyntaxError(`expected < at ${i}`);
		i++;
		const name = NAME.exec(source.slice(i))?.[0];
		if (!name) throw new SyntaxError(`expected a tag name at ${i}`);
		i += name.length;
		const node: XmlNode = { name, attrs: {}, children: [], text: "" };
		for (;;) {
			skipSpace();
			if (source.startsWith("/>", i)) {
				i += 2;
				return node;
			}
			if (source[i] === ">") {
				i++;
				break;
			}
			const attr = /^([A-Za-z_][\w:.-]*)="([^"]*)"/.exec(source.slice(i));
			if (!attr) throw new SyntaxError(`bad attribute in <${name}> at ${i}`);
			if (attr[1] in node.attrs) throw new SyntaxError(`duplicate attribute ${attr[1]}`);
			node.attrs[attr[1]] = decode(attr[2], `<${name} ${attr[1]}>`);
			i += attr[0].length;
		}
		for (;;) {
			if (i >= source.length) throw new SyntaxError(`<${name}> is never closed`);
			if (source.startsWith("</", i)) {
				i += 2;
				const close = NAME.exec(source.slice(i))?.[0];
				if (close !== name) throw new SyntaxError(`</${close}> closes <${name}>`);
				i += close.length;
				skipSpace();
				if (source[i] !== ">") throw new SyntaxError(`bad end tag </${name}`);
				i++;
				return node;
			}
			if (source[i] === "<") {
				node.children.push(element());
				continue;
			}
			const end = source.indexOf("<", i);
			const raw = source.slice(i, end < 0 ? source.length : end);
			node.text += decode(raw, `<${name}>`);
			i += raw.length;
		}
	}

	skipSpace();
	const root = element();
	skipSpace();
	if (i !== source.length) throw new SyntaxError("content after the root element");
	return root;
}

function child(node: XmlNode, name: string): XmlNode {
	const found = node.children.find((c) => c.name === name);
	if (!found) throw new Error(`<${node.name}> has no <${name}>`);
	return found;
}

function all(node: XmlNode, name: string): XmlNode[] {
	return node.children.filter((c) => c.name === name);
}
// #endregion

/** A release for the feed. */
function rel(version: string, releasedOn: string, extra: Partial<ChangelogRelease> = {}) {
	return {
		version,
		releasedOn,
		title: `Release ${version}`,
		summary: `What changed in ${version}.`,
		categories: ["escrow", "ux"],
		body: [{ type: "p", content: "x" }],
		images: [],
		withdrawn: false,
		...extra,
	} satisfies ChangelogRelease;
}

const origin = "https://projective.test";
const releases = [
	rel("0.12.0", "2026-10-11", { title: `Fees <b>& "quotes"</b> — 'it's'` }),
	rel("0.11.0", "2026-10-08", { summary: "Summary with a & b < c > d." }),
];

Deno.test("the strict reader refuses malformed XML (it is a real check)", () => {
	assertThrows(() => parseXml(`<?xml version="1.0" encoding="UTF-8"?><a><b></a>`), SyntaxError);
	assertThrows(() => parseXml(`<?xml version="1.0" encoding="UTF-8"?><a>x & y</a>`), SyntaxError);
	assertThrows(() => parseXml(`<?xml version="1.0" encoding="UTF-8"?><a>&nbsp;</a>`), SyntaxError);
	assertThrows(() => parseXml(`<?xml version="1.0" encoding="UTF-8"?><a/><b/>`), SyntaxError);
	assertThrows(() => parseXml(`<a></a>`), SyntaxError);
});

Deno.test("the feed is well-formed RSS 2.0 with the Atom self link", () => {
	const root = parseXml(buildChangelogRss(releases, { origin }));
	assertEquals(root.name, "rss");
	assertEquals(root.attrs.version, "2.0");
	assertEquals(root.attrs["xmlns:atom"], "http://www.w3.org/2005/Atom");
	const channel = child(root, "channel");
	assertEquals(child(channel, "title").text, "Projective changelog");
	assertEquals(child(channel, "link").text, "https://projective.test/changelog");
	assert(child(channel, "description").text.length > 0);
	assertEquals(child(channel, "language").text, "en");
	assertEquals(child(channel, "lastBuildDate").text, "Sun, 11 Oct 2026 00:00:00 GMT");
	const self = child(channel, "atom:link");
	assertEquals(self.attrs, {
		href: "https://projective.test/changelog/rss.xml",
		rel: "self",
		type: "application/rss+xml",
	});
});

Deno.test("one item per release: canonical link and guid, RFC-822 date, summary, categories", () => {
	const channel = child(parseXml(buildChangelogRss(releases, { origin })), "channel");
	const items = all(channel, "item");
	assertEquals(items.length, 2);
	const [first, second] = items;
	assertEquals(child(first, "link").text, "https://projective.test/changelog/0.12.0");
	const guid = child(first, "guid");
	assertEquals(guid.text, "https://projective.test/changelog/0.12.0");
	assertEquals(guid.attrs.isPermaLink, "true");
	assertMatch(
		child(second, "pubDate").text,
		/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} 00:00:00 GMT$/,
	);
	assertEquals(child(second, "pubDate").text, "Thu, 08 Oct 2026 00:00:00 GMT");
	assertEquals(all(first, "category").map((c) => c.text), [
		"Escrow & payments",
		"Design & accessibility",
	]);
});

Deno.test("text is escaped and parses back to exactly what was written", () => {
	const channel = child(parseXml(buildChangelogRss(releases, { origin })), "channel");
	const [first, second] = all(channel, "item");
	assertEquals(child(first, "title").text, `v0.12.0 — Fees <b>& "quotes"</b> — 'it's'`);
	assertEquals(child(second, "description").text, "Summary with a & b < c > d.");
});

Deno.test("every URL is absolute on the given origin", () => {
	const xml = buildChangelogRss(releases, { origin: "https://www.example.org/" });
	for (const m of xml.matchAll(/<(link|guid)[^>]*>([^<]*)</g)) {
		assert(m[2].startsWith("https://www.example.org/changelog"), m[2]);
	}
});

Deno.test("an empty changelog is a valid channel with no items and no lastBuildDate", () => {
	const channel = child(parseXml(buildChangelogRss([], { origin })), "channel");
	assertEquals(all(channel, "item").length, 0);
	assertEquals(all(channel, "lastBuildDate").length, 0);
});

Deno.test("limit caps the items, newest first as given", () => {
	const many = Array.from({ length: 60 }, (_, i) => rel(`0.${60 - i}.0`, "2026-10-01"));
	const channel = child(parseXml(buildChangelogRss(many, { origin })), "channel");
	assertEquals(all(channel, "item").length, 50);
	const capped = child(parseXml(buildChangelogRss(many, { origin, limit: 3 })), "channel");
	assertEquals(all(capped, "item").map((item) => child(item, "link").text.split("/").pop()), [
		"0.60.0",
		"0.59.0",
		"0.58.0",
	]);
});

Deno.test("escapeXml covers the five entities and drops characters XML cannot carry", () => {
	assertEquals(
		escapeXml(`<a href="x">&'</a>`),
		"&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
	);
	assertEquals(escapeXml("a\u0001b\u000Bc\td\ne"), "abc\td\ne");
	assertEquals(rfc822Day("2026-07-15"), "Wed, 15 Jul 2026 00:00:00 GMT");
});
