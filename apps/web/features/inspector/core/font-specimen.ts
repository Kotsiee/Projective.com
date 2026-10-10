/**
 * font-specimen — a minimal, never-throwing reader for the facts a font file states about itself:
 * its container, the `name` table (family, style, version, designer…), the glyph count (`maxp`),
 * weight class and italic flag (`OS/2`), and which specimen characters it maps (`cmap` formats 4
 * and 12). Pure: it reads bytes only, so the specimen canvas and its tests share it.
 *
 * TrueType, CFF OpenType and the first face of a collection are read directly; WOFF tables are read
 * only when stored uncompressed, and WOFF2 (Brotli) is recognised but not read.
 */

// #region Contract
/** How the font's tables are packaged. */
export type FontContainer = "truetype" | "opentype" | "collection" | "woff" | "woff2";

/** The `name` table strings the specimen shows; `null` when absent or unreadable. */
export interface FontNames {
	family: string | null;
	subfamily: string | null;
	fullName: string | null;
	version: string | null;
	postScriptName: string | null;
	designer: string | null;
	manufacturer: string | null;
	copyright: string | null;
	license: string | null;
}

/** Everything {@link readFontSpecimen} could learn; unreadable parts stay `null`. */
export interface FontSpecimen {
	container: FontContainer | null;
	names: FontNames;
	glyphCount: number | null;
	unitsPerEm: number | null;
	weightClass: number | null;
	italic: boolean | null;
	/** The probed code points the font maps to a real glyph; `null` when `cmap` was not readable. */
	coverage: ReadonlySet<number> | null;
}

/** One labelled fact, shaped like the inspector shell's stage facts. */
export interface SpecimenFact {
	label: string;
	value: string;
}

/** One block of the specimen's glyph grid. */
export interface GlyphBlock {
	name: string;
	codepoints: readonly number[];
}
// #endregion

// #region Specimen characters
function range(from: number, to: number, skip: readonly number[] = []): number[] {
	const out: number[] = [];
	for (let cp = from; cp <= to; cp++) if (!skip.includes(cp)) out.push(cp);
	return out;
}

/** The glyph grid: printable Basic Latin and Latin-1 Supplement (no spaces or soft hyphen). */
export const GLYPH_BLOCKS: readonly GlyphBlock[] = [
	{ name: "Basic Latin", codepoints: range(0x21, 0x7e) },
	{ name: "Latin-1 Supplement", codepoints: range(0xa1, 0xff, [0xad]) },
];

/** Every code point in {@link GLYPH_BLOCKS}, in grid order. */
export const SPECIMEN_CODEPOINTS: readonly number[] = GLYPH_BLOCKS.flatMap((b) => b.codepoints);

/** `U+0041`-style label for a code point. */
export function codepointLabel(cp: number): string {
	return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}
// #endregion

// #region Byte reading
class FontBoundsError extends Error {
	constructor() {
		super("Font data ends early");
		this.name = "FontBoundsError";
	}
}

class Bytes {
	readonly view: DataView;
	constructor(readonly data: Uint8Array) {
		this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	}
	get length(): number {
		return this.data.byteLength;
	}
	private need(offset: number, size: number): void {
		if (!Number.isInteger(offset) || offset < 0 || offset + size > this.data.byteLength) {
			throw new FontBoundsError();
		}
	}
	u16(offset: number): number {
		this.need(offset, 2);
		return this.view.getUint16(offset);
	}
	i16(offset: number): number {
		this.need(offset, 2);
		return this.view.getInt16(offset);
	}
	u32(offset: number): number {
		this.need(offset, 4);
		return this.view.getUint32(offset);
	}
	tag(offset: number): string {
		this.need(offset, 4);
		return String.fromCharCode(...this.data.subarray(offset, offset + 4));
	}
	slice(offset: number, length: number): Uint8Array {
		this.need(offset, length);
		return this.data.subarray(offset, offset + length);
	}
}

interface TableSpan {
	offset: number;
	length: number;
}
// #endregion

// #region Container
/** Recognise a font container from its first four bytes. */
export function sniffFontContainer(data: Uint8Array): FontContainer | null {
	if (data.byteLength < 4) return null;
	const sig = String.fromCharCode(data[0], data[1], data[2], data[3]);
	if (sig === "OTTO") return "opentype";
	if (sig === "true" || sig === "\u0000\u0001\u0000\u0000") return "truetype";
	if (sig === "ttcf") return "collection";
	if (sig === "wOFF") return "woff";
	if (sig === "wOF2") return "woff2";
	return null;
}

/** A human label for a container, e.g. "OpenType (CFF)". */
export function fontContainerLabel(container: FontContainer): string {
	switch (container) {
		case "truetype":
			return "TrueType";
		case "opentype":
			return "OpenType (CFF)";
		case "collection":
			return "TrueType collection";
		case "woff":
			return "WOFF";
		case "woff2":
			return "WOFF2";
	}
}

function sfntTables(bytes: Bytes, base: number): Map<string, TableSpan> {
	const tables = new Map<string, TableSpan>();
	const count = bytes.u16(base + 4);
	for (let i = 0; i < count; i++) {
		const rec = base + 12 + i * 16;
		tables.set(bytes.tag(rec), { offset: bytes.u32(rec + 8), length: bytes.u32(rec + 12) });
	}
	return tables;
}

function woffTables(bytes: Bytes): Map<string, TableSpan> {
	const tables = new Map<string, TableSpan>();
	const count = bytes.u16(12);
	for (let i = 0; i < count; i++) {
		const rec = 44 + i * 20;
		const compLength = bytes.u32(rec + 8);
		const origLength = bytes.u32(rec + 12);
		if (compLength === origLength) {
			tables.set(bytes.tag(rec), { offset: bytes.u32(rec + 4), length: origLength });
		}
	}
	return tables;
}

function tableDirectory(bytes: Bytes, container: FontContainer): Map<string, TableSpan> {
	switch (container) {
		case "truetype":
		case "opentype":
			return sfntTables(bytes, 0);
		case "collection":
			return bytes.u32(8) > 0 ? sfntTables(bytes, bytes.u32(12)) : new Map();
		case "woff":
			return woffTables(bytes);
		case "woff2":
			return new Map();
	}
}

function table(bytes: Bytes, tables: Map<string, TableSpan>, tag: string): Bytes | null {
	const span = tables.get(tag);
	if (!span || span.length === 0) return null;
	return new Bytes(bytes.slice(span.offset, span.length));
}
// #endregion

// #region name
const NAME_IDS = {
	copyright: 0,
	family: 1,
	subfamily: 2,
	fullName: 4,
	version: 5,
	postScriptName: 6,
	manufacturer: 8,
	designer: 9,
	license: 13,
	typographicFamily: 16,
	typographicSubfamily: 17,
} as const;

const EMPTY_NAMES: FontNames = {
	family: null,
	subfamily: null,
	fullName: null,
	version: null,
	postScriptName: null,
	designer: null,
	manufacturer: null,
	copyright: null,
	license: null,
};

function decodeName(platform: number, encoding: number, raw: Uint8Array): string | null {
	let text: string;
	if (platform === 0 || (platform === 3 && (encoding === 0 || encoding === 1 || encoding === 10))) {
		text = new TextDecoder("utf-16be").decode(raw);
	} else if (platform === 1 && encoding === 0) {
		text = new TextDecoder("macintosh").decode(raw);
	} else {
		return null;
	}
	const clean = text.replaceAll("\u0000", "").trim();
	return clean.length > 0 ? clean : null;
}

function nameRank(platform: number, language: number): number {
	if (platform === 3) return language === 0x0409 ? 4 : 3;
	if (platform === 0) return 2;
	if (platform === 1) return language === 0 ? 1 : 0;
	return -1;
}

function readNames(name: Bytes): FontNames {
	const count = name.u16(2);
	const storage = name.u16(4);
	const best = new Map<number, { rank: number; text: string }>();
	for (let i = 0; i < count; i++) {
		const rec = 6 + i * 12;
		const platform = name.u16(rec);
		const encoding = name.u16(rec + 2);
		const language = name.u16(rec + 4);
		const id = name.u16(rec + 6);
		const rank = nameRank(platform, language);
		const held = best.get(id);
		if (rank < 0 || (held && held.rank >= rank)) continue;
		const length = name.u16(rec + 8);
		const offset = storage + name.u16(rec + 10);
		if (offset + length > name.length) continue;
		const text = decodeName(platform, encoding, name.slice(offset, length));
		if (text) best.set(id, { rank, text });
	}
	const pick = (...ids: number[]): string | null => {
		for (const id of ids) {
			const hit = best.get(id);
			if (hit) return hit.text;
		}
		return null;
	};
	return {
		family: pick(NAME_IDS.typographicFamily, NAME_IDS.family),
		subfamily: pick(NAME_IDS.typographicSubfamily, NAME_IDS.subfamily),
		fullName: pick(NAME_IDS.fullName),
		version: pick(NAME_IDS.version),
		postScriptName: pick(NAME_IDS.postScriptName),
		designer: pick(NAME_IDS.designer),
		manufacturer: pick(NAME_IDS.manufacturer),
		copyright: pick(NAME_IDS.copyright),
		license: pick(NAME_IDS.license),
	};
}
// #endregion

// #region cmap
function format4Covers(sub: Bytes, cp: number): boolean {
	if (cp > 0xffff) return false;
	const segX2 = sub.u16(6);
	const ends = 14;
	const starts = ends + segX2 + 2;
	const deltas = starts + segX2;
	const rangeOffsets = deltas + segX2;
	for (let s = 0; s < segX2; s += 2) {
		const end = sub.u16(ends + s);
		if (end < cp) continue;
		const start = sub.u16(starts + s);
		if (start > cp) return false;
		const delta = sub.i16(deltas + s);
		const rangeOffset = sub.u16(rangeOffsets + s);
		if (rangeOffset === 0) return ((cp + delta) & 0xffff) !== 0;
		const glyph = sub.u16(rangeOffsets + s + rangeOffset + 2 * (cp - start));
		return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
	}
	return false;
}

function format12Covers(sub: Bytes, cp: number): boolean {
	const groups = sub.u32(12);
	for (let g = 0; g < groups; g++) {
		const rec = 16 + g * 12;
		const start = sub.u32(rec);
		const end = sub.u32(rec + 4);
		if (cp < start || cp > end) continue;
		return sub.u32(rec + 8) + (cp - start) !== 0;
	}
	return false;
}

function subtableRank(platform: number, encoding: number, format: number): number {
	if (format !== 4 && format !== 12) return -1;
	const wide = format === 12 ? 1 : 0;
	if (platform === 3 && (encoding === 10 || encoding === 1)) return 4 + wide;
	if (platform === 0) return 2 + wide;
	return -1;
}

function readCoverage(cmap: Bytes, probe: readonly number[]): ReadonlySet<number> | null {
	const count = cmap.u16(2);
	let chosen: { rank: number; sub: Bytes; format: number } | null = null;
	for (let i = 0; i < count; i++) {
		const rec = 4 + i * 8;
		const offset = cmap.u32(rec + 4);
		const format = cmap.u16(offset);
		const rank = subtableRank(cmap.u16(rec), cmap.u16(rec + 2), format);
		if (rank < 0 || (chosen && chosen.rank >= rank)) continue;
		const length = format === 12 ? cmap.u32(offset + 4) : cmap.u16(offset + 2);
		const span = Math.min(length, cmap.length - offset);
		chosen = { rank, sub: new Bytes(cmap.slice(offset, span)), format };
	}
	if (!chosen) return null;
	const covers = chosen.format === 12 ? format12Covers : format4Covers;
	const hit = new Set<number>();
	for (const cp of probe) if (covers(chosen.sub, cp)) hit.add(cp);
	return hit;
}
// #endregion

// #region Reader
function attempt<T>(read: () => T, fallback: T): T {
	try {
		return read();
	} catch (error) {
		if (error instanceof FontBoundsError) return fallback;
		throw error;
	}
}

/**
 * Read a font's self-described facts. Never throws on malformed data: whatever cannot be read is
 * `null`, and a file that is not a font at all yields an all-`null` specimen.
 */
export function readFontSpecimen(
	input: ArrayBuffer | Uint8Array,
	probe: readonly number[] = SPECIMEN_CODEPOINTS,
): FontSpecimen {
	const data = input instanceof Uint8Array ? input : new Uint8Array(input);
	const container = sniffFontContainer(data);
	const empty: FontSpecimen = {
		container,
		names: EMPTY_NAMES,
		glyphCount: null,
		unitsPerEm: null,
		weightClass: null,
		italic: null,
		coverage: null,
	};
	if (!container) return empty;
	const bytes = new Bytes(data);
	const tables = attempt(() => tableDirectory(bytes, container), new Map<string, TableSpan>());
	const get = (tag: string) => attempt(() => table(bytes, tables, tag), null);

	const name = get("name");
	const maxp = get("maxp");
	const head = get("head");
	const os2 = get("OS/2");
	const cmap = get("cmap");
	return {
		container,
		names: name ? attempt(() => readNames(name), EMPTY_NAMES) : EMPTY_NAMES,
		glyphCount: maxp ? attempt<number | null>(() => maxp.u16(4), null) : null,
		unitsPerEm: head ? attempt<number | null>(() => head.u16(18), null) : null,
		weightClass: os2 ? attempt<number | null>(() => os2.u16(4), null) : null,
		italic: os2 ? attempt<boolean | null>(() => (os2.u16(62) & 0x0201) !== 0, null) : null,
		coverage: cmap ? attempt(() => readCoverage(cmap, probe), null) : null,
	};
}
// #endregion

// #region Facts
const WEIGHT_NAMES: Readonly<Record<number, string>> = {
	100: "Thin",
	200: "Extra Light",
	300: "Light",
	400: "Regular",
	500: "Medium",
	600: "Semibold",
	700: "Bold",
	800: "Extra Bold",
	900: "Black",
};

/** `"700 · Bold"` for a standard weight class, the bare number otherwise. */
export function weightLabel(weightClass: number): string {
	const name = WEIGHT_NAMES[weightClass];
	return name ? `${weightClass} · ${name}` : String(weightClass);
}

/** The display name: the font's own family, else the file name without its extension. */
export function specimenTitle(specimen: FontSpecimen | null, fileName: string): string {
	const family = specimen?.names.family;
	if (family) return family;
	const dot = fileName.lastIndexOf(".");
	return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** The facts the Details panel lists for a font, in reading order; unknowns are left out. */
export function specimenFacts(specimen: FontSpecimen): SpecimenFact[] {
	const facts: SpecimenFact[] = [];
	const add = (label: string, value: string | null) => {
		if (value) facts.push({ label, value });
	};
	const { names } = specimen;
	add("Family", names.family);
	add("Style", names.subfamily);
	const styled = names.family && names.subfamily ? `${names.family} ${names.subfamily}` : null;
	if (names.fullName && names.fullName !== styled && names.fullName !== names.family) {
		add("Full name", names.fullName);
	}
	add("Version", names.version?.replace(/^Version\s+/i, "") ?? null);
	add("Container", specimen.container ? fontContainerLabel(specimen.container) : null);
	add("Glyphs", specimen.glyphCount !== null ? specimen.glyphCount.toLocaleString("en-GB") : null);
	add("Weight", specimen.weightClass !== null ? weightLabel(specimen.weightClass) : null);
	if (specimen.coverage) {
		add("Latin coverage", `${specimen.coverage.size} of ${SPECIMEN_CODEPOINTS.length}`);
	}
	add("Designer", names.designer);
	add("Foundry", names.manufacturer);
	return facts;
}
// #endregion
