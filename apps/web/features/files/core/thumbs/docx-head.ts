import type { SceneParagraph, SceneRun, SceneText } from "@features/inspector/core/pptx-model.ts";

/**
 * docx-head — the first page of a Word file as text a painter can lay out. It reads the head of
 * `document.xml` with patterns rather than a parser, because the head of an XML file is not a
 * well-formed document, and a thumbnail needs only paragraphs, their sizes and their weight. Images
 * and table geometry are left out: the card shows the page's text and rhythm, a facsimile rather than
 * a layout engine's output. The inspector's Word canvas is the exact one.
 */

const MAX_PARAGRAPHS = 60;
const BODY_PT = 11;
const INK = "#202124";
const HEADING_INK = "#1f3864";
const FONT = "Calibri";

/** Word's built-in heading sizes, for a document that leaves them to its styles. */
const STYLE_SIZES: Readonly<Record<string, number>> = {
	title: 28,
	subtitle: 15,
	heading1: 20,
	heading2: 16,
	heading3: 14,
	heading4: 12,
};

const ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

function decode(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
		if (ref[0] !== "#") return ENTITIES[ref] ?? whole;
		const code = ref[1] === "x" || ref[1] === "X"
			? parseInt(ref.slice(2), 16)
			: parseInt(ref.slice(1), 10);
		return Number.isFinite(code) && code > 0 && code <= 0x10ffff
			? String.fromCodePoint(code)
			: whole;
	});
}

function value(xml: string, tag: string): string | null {
	return xml.match(new RegExp(`<w:${tag}\\b[^>]*\\bw:val="([^"]*)"`))?.[1] ?? null;
}

/** On, when the element is present and not switched off (`<w:b w:val="0"/>`). */
function toggled(xml: string, tag: string): boolean {
	const match = xml.match(new RegExp(`<w:${tag}(\\s[^>]*)?/>`));
	if (!match) return false;
	return !/w:val="(0|false|none)"/.test(match[1] ?? "");
}

function readRun(run: string, headingSize: number | null): SceneRun | null {
	const text = decode(
		[...run.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br)\b[^>]*\/>/g)]
			.map((part) => part[1] ?? (part[2] === "br" ? "\n" : "    "))
			.join(""),
	);
	if (text.length === 0) return null;
	const size = value(run, "sz");
	const color = value(run, "color");
	return {
		text,
		size: size ? Number(size) / 2 : headingSize ?? BODY_PT,
		bold: toggled(run, "b") || headingSize !== null,
		italic: toggled(run, "i"),
		underline: value(run, "u") !== null && value(run, "u") !== "none",
		color: color && /^[0-9a-f]{6}$/i.test(color)
			? `#${color}`
			: headingSize !== null
			? HEADING_INK
			: INK,
		font: FONT,
	};
}

const ALIGNS: Readonly<Record<string, SceneParagraph["align"]>> = {
	center: "center",
	right: "right",
	end: "right",
	both: "justify",
};

function readParagraph(xml: string): SceneParagraph {
	const style = value(xml, "pStyle")?.toLowerCase() ?? "";
	const headingSize = STYLE_SIZES[style] ?? null;
	const runs = [...xml.matchAll(/<w:r[\s>][\s\S]*?<\/w:r>/g)]
		.flatMap((match) => readRun(match[0], headingSize) ?? []);
	const list = xml.includes("<w:numPr>");
	return {
		runs,
		align: ALIGNS[value(xml, "jc") ?? ""] ?? "left",
		marginLeft: list ? 18 : 0,
		indent: -12,
		bullet: list ? "•" : null,
		bulletColor: null,
		lineHeight: 1.1,
		before: headingSize === null ? 0 : 10,
		after: 6,
		emptySize: BODY_PT,
	};
}

/** Paragraphs from the head of `word/document.xml`, ready for `paintText`. */
export function docxHead(xml: string, margin: number): SceneText | null {
	const paragraphs = [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)]
		.slice(0, MAX_PARAGRAPHS)
		.map((match) => readParagraph(match[0]));
	if (!paragraphs.some((paragraph) => paragraph.runs.length > 0)) return null;
	return {
		paragraphs,
		anchor: "top",
		insets: { left: margin, right: margin, top: margin, bottom: margin },
		wrap: true,
	};
}
