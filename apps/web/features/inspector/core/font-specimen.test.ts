import { assert, assertEquals } from "@std/assert";
import {
	codepointLabel,
	GLYPH_BLOCKS,
	readFontSpecimen,
	sniffFontContainer,
	SPECIMEN_CODEPOINTS,
	specimenFacts,
	specimenTitle,
	weightLabel,
} from "./font-specimen.ts";

// #region Synthetic font builder
class Writer {
	private bytes: number[] = [];
	get length(): number {
		return this.bytes.length;
	}
	u16(v: number): this {
		this.bytes.push((v >> 8) & 0xff, v & 0xff);
		return this;
	}
	u32(v: number): this {
		this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
		return this;
	}
	tag(t: string): this {
		for (const ch of t) this.bytes.push(ch.charCodeAt(0));
		return this;
	}
	raw(data: Uint8Array | number[]): this {
		this.bytes.push(...data);
		return this;
	}
	pad(to: number): this {
		while (this.bytes.length < to) this.bytes.push(0);
		return this;
	}
	done(): Uint8Array {
		return new Uint8Array(this.bytes);
	}
}

function utf16(text: string): number[] {
	const out: number[] = [];
	for (const ch of text) {
		const code = ch.charCodeAt(0);
		out.push(code >> 8, code & 0xff);
	}
	return out;
}

interface NameRecord {
	platform: number;
	encoding: number;
	language: number;
	id: number;
	text: string;
}

function nameTable(records: NameRecord[]): Uint8Array {
	const strings: number[] = [];
	const w = new Writer().u16(0).u16(records.length).u16(6 + records.length * 12);
	for (const r of records) {
		const encoded = r.platform === 1 ? [...r.text].map((c) => c.charCodeAt(0)) : utf16(r.text);
		w.u16(r.platform).u16(r.encoding).u16(r.language).u16(r.id).u16(encoded.length)
			.u16(strings.length);
		strings.push(...encoded);
	}
	return w.raw(strings).done();
}

function maxpTable(glyphs: number): Uint8Array {
	return new Writer().u32(0x00005000).u16(glyphs).done();
}

function headTable(unitsPerEm: number): Uint8Array {
	return new Writer().pad(18).u16(unitsPerEm).pad(54).done();
}

function os2Table(weight: number, fsSelection: number): Uint8Array {
	return new Writer().u16(4).u16(500).u16(weight).pad(62).u16(fsSelection).pad(96).done();
}

/** cmap with one (3,1) format-4 subtable mapping `from..to` to glyphs 1.. and a terminal segment. */
function cmapFormat4(from: number, to: number): Uint8Array {
	const segX2 = 4;
	const sub = new Writer()
		.u16(4).u16(16 + segX2 * 4).u16(0).u16(segX2).u16(4).u16(1).u16(0)
		.u16(to).u16(0xffff)
		.u16(0)
		.u16(from).u16(0xffff)
		.u16((1 - from) & 0xffff).u16(1)
		.u16(0).u16(0)
		.done();
	return new Writer().u16(0).u16(1).u16(3).u16(1).u32(12).raw(sub).done();
}

/** cmap with one (3,10) format-12 subtable mapping `from..to` to glyphs 1.. */
function cmapFormat12(from: number, to: number): Uint8Array {
	const sub = new Writer().u16(12).u16(0).u32(28).u32(0).u32(1).u32(from).u32(to).u32(1).done();
	return new Writer().u16(0).u16(1).u16(3).u16(10).u32(12).raw(sub).done();
}

function sfnt(signature: number | string, tables: Record<string, Uint8Array>): Uint8Array {
	const tags = Object.keys(tables).sort();
	const w = new Writer();
	if (typeof signature === "string") w.tag(signature);
	else w.u32(signature);
	w.u16(tags.length).u16(0).u16(0).u16(0);
	let offset = 12 + tags.length * 16;
	const placed: { tag: string; offset: number }[] = [];
	for (const tag of tags) {
		placed.push({ tag, offset });
		offset += Math.ceil(tables[tag].length / 4) * 4;
	}
	for (const p of placed) w.tag(p.tag).u32(0).u32(p.offset).u32(tables[p.tag].length);
	for (const p of placed) w.pad(p.offset).raw(tables[p.tag]);
	return w.done();
}

function woff(tables: Record<string, Uint8Array>, compressed: readonly string[] = []): Uint8Array {
	const tags = Object.keys(tables).sort();
	const w = new Writer().tag("wOFF").u32(0x00010000).u32(0).u16(tags.length).u16(0).pad(44);
	let offset = 44 + tags.length * 20;
	const placed: { tag: string; offset: number; comp: number }[] = [];
	for (const tag of tags) {
		const comp = compressed.includes(tag)
			? Math.max(1, tables[tag].length - 1)
			: tables[tag].length;
		placed.push({ tag, offset, comp });
		offset += Math.ceil(comp / 4) * 4;
	}
	for (const p of placed) {
		w.tag(p.tag).u32(p.offset).u32(p.comp).u32(tables[p.tag].length).u32(0);
	}
	for (const p of placed) w.pad(p.offset).raw(tables[p.tag].subarray(0, p.comp));
	return w.done();
}

const NAMES: NameRecord[] = [
	{ platform: 1, encoding: 0, language: 0, id: 1, text: "Mac Family" },
	{ platform: 3, encoding: 1, language: 0x0409, id: 1, text: "Specimen Sans" },
	{ platform: 3, encoding: 1, language: 0x040c, id: 2, text: "Gras" },
	{ platform: 3, encoding: 1, language: 0x0409, id: 2, text: "Bold" },
	{ platform: 3, encoding: 1, language: 0x0409, id: 4, text: "Specimen Sans Bold" },
	{ platform: 3, encoding: 1, language: 0x0409, id: 5, text: "Version 2.010" },
	{ platform: 0, encoding: 3, language: 0, id: 9, text: "Ada Type" },
];

function sampleTables(): Record<string, Uint8Array> {
	return {
		name: nameTable(NAMES),
		maxp: maxpTable(42),
		head: headTable(1000),
		"OS/2": os2Table(700, 0x0001),
		cmap: cmapFormat4(0x41, 0x5a),
	};
}
// #endregion

Deno.test("sniffFontContainer recognises every container signature", () => {
	const sig = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
	assertEquals(sniffFontContainer(new Uint8Array([0, 1, 0, 0])), "truetype");
	assertEquals(sniffFontContainer(sig("true")), "truetype");
	assertEquals(sniffFontContainer(sig("OTTO")), "opentype");
	assertEquals(sniffFontContainer(sig("ttcf")), "collection");
	assertEquals(sniffFontContainer(sig("wOFF")), "woff");
	assertEquals(sniffFontContainer(sig("wOF2")), "woff2");
	assertEquals(sniffFontContainer(sig("PK\u0003\u0004")), null);
	assertEquals(sniffFontContainer(new Uint8Array([0, 1])), null);
});

Deno.test("readFontSpecimen reads name, maxp, head, OS/2 and cmap from a TrueType font", () => {
	const spec = readFontSpecimen(sfnt(0x00010000, sampleTables()));
	assertEquals(spec.container, "truetype");
	assertEquals(spec.names.family, "Specimen Sans");
	assertEquals(spec.names.subfamily, "Bold");
	assertEquals(spec.names.fullName, "Specimen Sans Bold");
	assertEquals(spec.names.version, "Version 2.010");
	assertEquals(spec.names.designer, "Ada Type");
	assertEquals(spec.names.license, null);
	assertEquals(spec.glyphCount, 42);
	assertEquals(spec.unitsPerEm, 1000);
	assertEquals(spec.weightClass, 700);
	assertEquals(spec.italic, true);
	assert(spec.coverage);
	assertEquals(spec.coverage.size, 26);
	assert(spec.coverage.has(0x41) && spec.coverage.has(0x5a));
	assert(!spec.coverage.has(0x61));
});

Deno.test("readFontSpecimen prefers typographic family names and falls back to Mac Roman", () => {
	const typographic = readFontSpecimen(sfnt("OTTO", {
		name: nameTable([
			...NAMES,
			{ platform: 3, encoding: 1, language: 0x0409, id: 16, text: "Specimen" },
			{ platform: 3, encoding: 1, language: 0x0409, id: 17, text: "Condensed Bold" },
		]),
	}));
	assertEquals(typographic.container, "opentype");
	assertEquals(typographic.names.family, "Specimen");
	assertEquals(typographic.names.subfamily, "Condensed Bold");

	const mac = readFontSpecimen(sfnt(0x00010000, { name: nameTable([NAMES[0]]) }));
	assertEquals(mac.names.family, "Mac Family");
	assertEquals(mac.glyphCount, null);
	assertEquals(mac.coverage, null);
});

Deno.test("readFontSpecimen reads cmap format 12", () => {
	const spec = readFontSpecimen(sfnt(0x00010000, { cmap: cmapFormat12(0x20, 0x7e) }));
	assert(spec.coverage);
	assertEquals(spec.coverage.size, 0x7e - 0x21 + 1);
	assert(!spec.coverage.has(0xe9));
});

Deno.test("readFontSpecimen reads the first face of a collection", () => {
	const header = new Writer().tag("ttcf").u16(1).u16(0).u32(1).u32(16).done();
	const shifted = sfnt(0x00010000, sampleTables());
	const view = new DataView(shifted.buffer);
	const count = view.getUint16(4);
	for (let i = 0; i < count; i++) {
		const rec = 12 + i * 16 + 8;
		view.setUint32(rec, view.getUint32(rec) + header.length);
	}
	const ttc = new Writer().raw(header).raw(shifted).done();
	const spec = readFontSpecimen(ttc);
	assertEquals(spec.container, "collection");
	assertEquals(spec.names.family, "Specimen Sans");
	assertEquals(spec.glyphCount, 42);
});

Deno.test("readFontSpecimen reads uncompressed WOFF tables and skips compressed ones", () => {
	const spec = readFontSpecimen(woff(sampleTables(), ["name"]));
	assertEquals(spec.container, "woff");
	assertEquals(spec.names.family, null);
	assertEquals(spec.glyphCount, 42);
	assertEquals(spec.weightClass, 700);
});

Deno.test("readFontSpecimen recognises WOFF2 without reading it", () => {
	const data = new Writer().tag("wOF2").pad(64).done();
	const spec = readFontSpecimen(data);
	assertEquals(spec.container, "woff2");
	assertEquals(spec.names.family, null);
	assertEquals(spec.glyphCount, null);
});

Deno.test("readFontSpecimen never throws on truncated or foreign data", () => {
	const full = sfnt(0x00010000, sampleTables());
	for (const cut of [4, 12, 40, 90, 200, full.length - 30]) {
		const spec = readFontSpecimen(full.slice(0, cut));
		assertEquals(spec.container, "truetype");
	}
	const truncated = readFontSpecimen(full.slice(0, 12));
	assertEquals(truncated.names.family, null);
	assertEquals(readFontSpecimen(new Uint8Array(0)).container, null);
	assertEquals(readFontSpecimen(new TextEncoder().encode("<html></html>")).glyphCount, null);
});

Deno.test("specimen helpers label code points, weights and titles", () => {
	assertEquals(codepointLabel(0x41), "U+0041");
	assertEquals(codepointLabel(0xff), "U+00FF");
	assertEquals(weightLabel(700), "700 · Bold");
	assertEquals(weightLabel(350), "350");
	assertEquals(specimenTitle(null, "Brand-Regular.woff2"), "Brand-Regular");
	assertEquals(GLYPH_BLOCKS[0].codepoints.length, 94);
	assert(!SPECIMEN_CODEPOINTS.includes(0xad));
	assertEquals(SPECIMEN_CODEPOINTS.length, 94 + 94);
});

Deno.test("specimenFacts lists known facts in reading order", () => {
	const spec = readFontSpecimen(sfnt(0x00010000, sampleTables()));
	assertEquals(specimenFacts(spec), [
		{ label: "Family", value: "Specimen Sans" },
		{ label: "Style", value: "Bold" },
		{ label: "Version", value: "2.010" },
		{ label: "Container", value: "TrueType" },
		{ label: "Glyphs", value: "42" },
		{ label: "Weight", value: "700 · Bold" },
		{ label: "Latin coverage", value: `26 of ${SPECIMEN_CODEPOINTS.length}` },
		{ label: "Designer", value: "Ada Type" },
	]);
});

const LIBERATION = new URL(
	"../../../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf",
	import.meta.url,
);

function hasFile(url: URL): boolean {
	try {
		return Deno.statSync(url).isFile;
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return false;
		throw error;
	}
}

Deno.test({
	name: "readFontSpecimen reads a real OFL font (Liberation Sans from pdfjs-dist)",
	ignore: !hasFile(LIBERATION),
	fn() {
		const spec = readFontSpecimen(Deno.readFileSync(LIBERATION));
		assertEquals(spec.container, "truetype");
		assertEquals(spec.names.family, "Liberation Sans");
		assertEquals(spec.names.subfamily, "Regular");
		assertEquals(spec.weightClass, 400);
		assertEquals(spec.italic, false);
		assert(spec.glyphCount !== null && spec.glyphCount > 600);
		assert(spec.coverage !== null && spec.coverage.size === SPECIMEN_CODEPOINTS.length);
	},
});
