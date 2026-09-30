/**
 * pdf — a dependency-free writer for simple, text-only PDF documents (invoices, statements).
 *
 * Deliberately small: one standard font (Helvetica / Helvetica-Bold, which every PDF reader ships, so
 * nothing is embedded), A4 pages, left- or right-aligned lines, and hairline rules. That is all a
 * financial document needs, and it keeps a charting/layout library out of a server package whose job
 * is money. Text is encoded as WinAnsi (the standard fonts' encoding), which covers `£`, `€`, `—` and
 * Western accents; anything outside it is written as `?` rather than corrupting the stream.
 *
 * The writer computes the cross-reference table from the exact byte offsets it emits, so the output is
 * a valid PDF 1.4 file that opens in any reader without a repair pass.
 */

// #region Model
/** One line of a page, in points from the top-left of the printable area. */
export interface PdfLine {
	text: string;
	/** Font size in points. */
	size: number;
	bold?: boolean;
	/** `right` aligns the text's end to the right margin (figures in a column). */
	align?: "left" | "right";
	/** Horizontal offset from the left margin, in points (ignored for `right`). */
	x?: number;
}

/** A document: a title (the PDF's own metadata) and its pages of blocks. */
export interface PdfDocument {
	title: string;
	blocks: PdfBlock[];
}

/** A block flows down the page: a row of up to two text runs, a rule, or vertical space. */
export type PdfBlock =
	| { kind: "row"; left: PdfLine; right?: PdfLine }
	| { kind: "rule" }
	| { kind: "space"; points: number };
// #endregion

// #region Metrics
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;

/**
 * Helvetica advance widths (per 1000 em) for WinAnsi 32–126 — enough to right-align figures. Characters
 * outside the table use the average width; alignment of prose is left-only, so it never matters there.
 */
const HELVETICA_WIDTHS: Record<number, number> = {
	32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333, 42: 389,
	43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556,
	54: 556, 55: 556, 56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556, 64: 1015,
	65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778, 72: 722, 73: 278, 74: 500, 75: 667,
	76: 556, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667,
	87: 944, 88: 667, 89: 667, 90: 611, 91: 278, 92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 97: 556,
	98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556, 104: 556, 105: 222, 106: 222, 107: 500,
	108: 222, 109: 833, 110: 556, 111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556,
	118: 500, 119: 722, 120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584,
	128: 556, 151: 1000, 163: 556, 165: 556,
};

function textWidth(bytes: Uint8Array, size: number, bold: boolean): number {
	let units = 0;
	for (const b of bytes) units += HELVETICA_WIDTHS[b] ?? 556;
	// Helvetica-Bold is ~5% wider on figures and capitals; close enough to right-align a column.
	return (units / 1000) * size * (bold ? 1.05 : 1);
}
// #endregion

// #region Encoding
/** Unicode → WinAnsi for the characters a financial document uses; others become `?`. */
const WIN_ANSI: Record<string, number> = { "€": 0x80, "—": 0x97, "–": 0x96, "•": 0x95, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "…": 0x85 };

function winAnsi(text: string): Uint8Array {
	const out: number[] = [];
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 63;
		if (WIN_ANSI[ch] !== undefined) out.push(WIN_ANSI[ch]);
		else if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) out.push(code);
		else out.push(63);
	}
	return new Uint8Array(out);
}

/** A PDF literal string from WinAnsi bytes, with `(`, `)` and `\` escaped. */
function literal(bytes: Uint8Array): string {
	let s = "(";
	for (const b of bytes) {
		if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
		else if (b < 32 || b > 126) s += "\\" + b.toString(8).padStart(3, "0");
		else s += String.fromCharCode(b);
	}
	return s + ")";
}
// #endregion

// #region Layout
/** Lay blocks out into page content streams. */
function layout(blocks: readonly PdfBlock[]): string[] {
	const pages: string[] = [];
	let ops: string[] = [];
	let y = PAGE_H - MARGIN;
	const flush = () => {
		pages.push(ops.join("\n"));
		ops = [];
		y = PAGE_H - MARGIN;
	};
	const draw = (line: PdfLine, baseline: number) => {
		const bytes = winAnsi(line.text);
		const bold = line.bold === true;
		const x = line.align === "right"
			? PAGE_W - MARGIN - textWidth(bytes, line.size, bold)
			: MARGIN + (line.x ?? 0);
		ops.push(`BT /${bold ? "F2" : "F1"} ${line.size} Tf ${x.toFixed(2)} ${baseline.toFixed(2)} Td ${literal(bytes)} Tj ET`);
	};
	for (const block of blocks) {
		if (block.kind === "space") {
			y -= block.points;
			continue;
		}
		if (block.kind === "rule") {
			if (y - 8 < MARGIN) flush();
			y -= 6;
			ops.push(`0.8 G 0.5 w ${MARGIN} ${y.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${y.toFixed(2)} l S 0 G`);
			y -= 8;
			continue;
		}
		const height = Math.max(block.left.size, block.right?.size ?? 0) * 1.45;
		if (y - height < MARGIN) flush();
		y -= height;
		draw(block.left, y);
		if (block.right) draw({ ...block.right, align: "right" }, y);
	}
	if (ops.length > 0 || pages.length === 0) flush();
	return pages;
}
// #endregion

// #region Writer
/** Render a document to the bytes of a PDF 1.4 file. */
export function renderPdf(doc: PdfDocument): Uint8Array<ArrayBuffer> {
	const pages = layout(doc.blocks);
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const offsets: number[] = [];
	let length = 0;
	const push = (bytes: Uint8Array) => {
		chunks.push(bytes);
		length += bytes.length;
	};
	const text = (s: string) => push(encoder.encode(s));
	const object = (n: number, body: string | Uint8Array[]) => {
		offsets[n] = length;
		text(`${n} 0 obj\n`);
		if (typeof body === "string") text(body);
		else for (const part of body) push(part);
		text("\nendobj\n");
	};

	// 1 catalog · 2 pages · 3 regular font · 4 bold font · 5 info · then (page, content) pairs.
	const first = 6;
	const kids = pages.map((_, i) => `${first + i * 2} 0 R`).join(" ");
	text("%PDF-1.4\n%âãÏÓ\n");
	object(1, "<< /Type /Catalog /Pages 2 0 R >>");
	object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
	object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
	object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
	object(5, `<< /Title ${literal(winAnsi(doc.title))} /Producer (Projective) >>`);
	pages.forEach((content, i) => {
		const pageNo = first + i * 2;
		object(
			pageNo,
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
				`/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageNo + 1} 0 R >>`,
		);
		const stream = winAnsiStream(content);
		object(pageNo + 1, [
			encoder.encode(`<< /Length ${stream.length} >>\nstream\n`),
			stream,
			encoder.encode("\nendstream"),
		]);
	});

	const count = first + pages.length * 2;
	const xref = length;
	text(`xref\n0 ${count}\n0000000000 65535 f \n`);
	for (let n = 1; n < count; n++) text(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
	text(`trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

	const out = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

/** A content stream is ASCII (every string was escaped by {@link literal}), one byte per char. */
function winAnsiStream(content: string): Uint8Array {
	const out = new Uint8Array(content.length);
	for (let i = 0; i < content.length; i++) out[i] = content.charCodeAt(i) & 0xff;
	return out;
}
// #endregion
