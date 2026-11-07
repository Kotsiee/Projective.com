/// <reference lib="dom" />
import type { RemoteZip } from "./remote-zip.ts";
import { type ColorTransform, transformColor } from "./pptx-color.ts";

/**
 * pptx-model — a `.pptx` read into scenes a painter can draw. The file is a ZIP of XML parts, and a
 * slide is the sum of four of them: its own shapes, its layout's, its master's and the theme's colours
 * and fonts, with placeholders inheriting position and type from further up that chain. This resolves
 * all of it to absolute geometry and concrete colours, so `pptx-paint.ts` only has to draw.
 *
 * Only the parts a slide needs are fetched, through the ZIP's `Range` reader, so opening a 300 MB deck
 * full of video costs the XML. Nothing from a file ever becomes markup: a scene is plain data and a
 * canvas draws it, which is why a crafted deck has no route to the DOM.
 *
 * Not modelled, and drawn as a labelled box instead of being skipped silently: charts and embedded
 * images in a format canvases cannot decode (EMF, WMF, TIFF). Animations and transitions are ignored.
 */

// #region Scene
/** A picture's crop, as fractions of its own size. */
export interface SceneCrop {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** What a shape or the background is filled with. */
export type ScenePaint =
	| { kind: "solid"; color: string }
	| { kind: "gradient"; angle: number; stops: { at: number; color: string }[] }
	| { kind: "image"; media: string; crop: SceneCrop };

/** An outline. */
export interface SceneLine {
	color: string;
	width: number;
	dash: readonly number[] | null;
}

/** A run of text in one style. Sizes are points. */
export interface SceneRun {
	text: string;
	size: number;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	color: string;
	font: string;
}

/** One paragraph. Distances are points. */
export interface SceneParagraph {
	runs: SceneRun[];
	align: "left" | "center" | "right" | "justify";
	marginLeft: number;
	indent: number;
	bullet: string | null;
	bulletColor: string | null;
	/** Multiple of the font's natural line height. */
	lineHeight: number;
	before: number;
	after: number;
	/** The size an empty paragraph takes up. */
	emptySize: number;
}

/** A text body inside a box. */
export interface SceneText {
	paragraphs: SceneParagraph[];
	anchor: "top" | "middle" | "bottom";
	insets: { left: number; top: number; right: number; bottom: number };
	wrap: boolean;
}

/** Where something sits on the slide, in points, with its rotation in degrees. */
export interface SceneBox {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	flipH: boolean;
	flipV: boolean;
}

/** A shape's outline, in its own box. */
export type SceneGeometry =
	| { kind: "rect" }
	| { kind: "round"; radius: number }
	| { kind: "ellipse" }
	| { kind: "line" }
	| { kind: "polygon"; points: readonly (readonly [number, number])[] }
	| { kind: "path"; commands: readonly ScenePathCommand[] };

/** One step of a custom path, in fractions of the box. */
export type ScenePathCommand =
	| { op: "move" | "line"; x: number; y: number }
	| { op: "curve"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
	| { op: "close" };

/** A shape, a line or a text box. */
export interface SceneShape {
	kind: "shape";
	box: SceneBox;
	geometry: SceneGeometry;
	fill: ScenePaint | null;
	line: SceneLine | null;
	text: SceneText | null;
}

/** One table cell; a merged-away cell is null. */
export interface SceneCell {
	fill: ScenePaint | null;
	text: SceneText | null;
	columnSpan: number;
	rowSpan: number;
}

/** A table. */
export interface SceneTable {
	kind: "table";
	box: SceneBox;
	columns: number[];
	rows: { height: number; cells: (SceneCell | null)[] }[];
}

/** Something this viewer does not draw, so the reader knows the slide holds more than it shows. */
export interface SceneNote {
	kind: "note";
	box: SceneBox;
	label: string;
}

/** Anything on a slide, in paint order. */
export type SceneItem = SceneShape | SceneTable | SceneNote;

/** One slide, fully resolved. */
export interface SlideScene {
	width: number;
	height: number;
	background: ScenePaint | null;
	items: SceneItem[];
	/** The slide's text, one entry per paragraph, for assistive technology. */
	text: string[];
	/** Every media part the scene draws. */
	media: string[];
}

/** An opened deck. */
export interface Deck {
	readonly width: number;
	readonly height: number;
	readonly slideCount: number;
	slide(index: number): Promise<SlideScene>;
	media(path: string): Promise<Blob | null>;
}

/** Thrown for a ZIP that is not a presentation. */
export class DeckReadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DeckReadError";
	}
}
// #endregion

// #region XML
const EMU_PER_PT = 12_700;
const ANGLE_UNIT = 60_000;
const DEFAULT_TEXT_PT = 18;
const DEFAULT_INSET_PT = 7.2;
const DEFAULT_BLOCK_INSET_PT = 3.6;
const DRAWABLE = /\.(png|jpe?g|gif|bmp|webp)$/i;
const MEDIA_TYPES: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	bmp: "image/bmp",
	webp: "image/webp",
};

function parseXml(text: string): Document | null {
	const doc = new DOMParser().parseFromString(text, "application/xml");
	return doc.getElementsByTagName("parsererror").length > 0 ? null : doc;
}

function kids(el: Element | null | undefined, name?: string): Element[] {
	if (!el) return [];
	const all = Array.from(el.children);
	return name ? all.filter((child) => child.localName === name) : all;
}

function kid(el: Element | null | undefined, name: string): Element | null {
	if (!el) return null;
	for (const child of Array.from(el.children)) if (child.localName === name) return child;
	return null;
}

function path(el: Element | null | undefined, ...names: string[]): Element | null {
	let node = el ?? null;
	for (const name of names) node = kid(node, name);
	return node;
}

function num(el: Element | null | undefined, name: string): number | null {
	const raw = el?.getAttribute(name);
	if (raw === null || raw === undefined || raw === "") return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

function flag(el: Element | null | undefined, name: string): boolean | null {
	const raw = el?.getAttribute(name);
	if (raw === null || raw === undefined) return null;
	return raw === "1" || raw === "true";
}

/**
 * A relationship attribute by its local name: its prefix is the file's own choice, but it is always
 * namespaced, which is what tells `r:id` from the plain `id` beside it on a `sldId`.
 */
function relId(el: Element | null | undefined, local: string): string | null {
	if (!el) return null;
	for (const attr of Array.from(el.attributes)) {
		if (attr.localName === local && attr.namespaceURI) return attr.value;
	}
	return null;
}

function joinPath(base: string, target: string): string {
	if (target.startsWith("/")) return target.slice(1);
	const parts = base.split("/").slice(0, -1);
	for (const piece of target.split("/")) {
		if (piece === "..") parts.pop();
		else if (piece !== ".") parts.push(piece);
	}
	return parts.join("/");
}

function relsPathOf(part: string): string {
	const slash = part.lastIndexOf("/");
	return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
}
// #endregion

// #region Parts
interface Part {
	path: string;
	root: Element;
	/** Relationship id → part path. */
	rels: Map<string, { path: string; type: string }>;
}

interface Theme {
	colors: Record<string, string>;
	major: string;
	minor: string;
}

/** The colour and font scope one slide resolves against. */
interface Scope {
	theme: Theme;
	/** `bg1` → `lt1`, the master's mapping of roles to theme slots. */
	map: Record<string, string>;
}

function parseTheme(root: Element): Theme {
	const colors: Record<string, string> = {};
	const elements = path(root, "themeElements");
	for (const slot of kids(kid(elements, "clrScheme"))) {
		const value = slot.firstElementChild;
		colors[slot.localName] = value?.getAttribute("lastClr") ?? value?.getAttribute("val") ??
			"000000";
	}
	const fonts = kid(elements, "fontScheme");
	return {
		colors,
		major: path(fonts, "majorFont", "latin")?.getAttribute("typeface") ?? "",
		minor: path(fonts, "minorFont", "latin")?.getAttribute("typeface") ?? "",
	};
}

const COLOR_ELEMENTS = new Set(["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr"]);

const NAMED_COLORS: Readonly<Record<string, string>> = {
	black: "000000",
	white: "ffffff",
	red: "ff0000",
	green: "008000",
	blue: "0000ff",
	yellow: "ffff00",
	gray: "808080",
	grey: "808080",
};

function colorValue(el: Element, scope: Scope): string | null {
	const value = el.getAttribute("val") ?? "";
	switch (el.localName) {
		case "srgbClr":
			return value;
		case "sysClr":
			return el.getAttribute("lastClr") ?? "000000";
		case "prstClr":
			return NAMED_COLORS[value.toLowerCase()] ?? "808080";
		case "scrgbClr":
			return ["r", "g", "b"].map((c) =>
				Math.round((num(el, c) ?? 0) / 100_000 * 255).toString(16).padStart(2, "0")
			).join("");
		case "schemeClr":
			return scope.theme.colors[scope.map[value] ?? value] ?? null;
		default:
			return null;
	}
}

/** The concrete colour inside a fill-like element, its transforms applied. */
function readColor(holder: Element | null | undefined, scope: Scope): string | null {
	const el = kids(holder).find((child) => COLOR_ELEMENTS.has(child.localName));
	if (!el) return null;
	const value = colorValue(el, scope);
	if (value === null) return null;
	const transforms: ColorTransform[] = kids(el).map((mod) => ({
		name: mod.localName,
		value: num(mod, "val") ?? 100_000,
	}));
	return transformColor(value, transforms);
}

function readCrop(fill: Element): SceneCrop {
	const rect = kid(fill, "srcRect");
	const at = (name: string) => (num(rect, name) ?? 0) / 100_000;
	return { left: at("l"), top: at("t"), right: at("r"), bottom: at("b") };
}

/** A fill found directly under `holder`: `null` when it says nothing, `"none"` for an explicit none. */
function readFill(
	holder: Element | null | undefined,
	scope: Scope,
	part: Part,
	media: Set<string>,
): ScenePaint | "none" | null {
	if (!holder) return null;
	if (kid(holder, "noFill")) return "none";
	const solid = kid(holder, "solidFill");
	if (solid) {
		const color = readColor(solid, scope);
		return color ? { kind: "solid", color } : null;
	}
	const gradient = kid(holder, "gradFill");
	if (gradient) {
		const stops = kids(kid(gradient, "gsLst"), "gs").flatMap((stop) => {
			const color = readColor(stop, scope);
			return color ? [{ at: (num(stop, "pos") ?? 0) / 100_000, color }] : [];
		});
		if (stops.length === 0) return null;
		const angle = (num(kid(gradient, "lin"), "ang") ?? 0) / ANGLE_UNIT;
		return { kind: "gradient", angle, stops };
	}
	const blip = kid(holder, "blipFill");
	if (blip) {
		const target = part.rels.get(relId(kid(blip, "blip"), "embed") ?? "")?.path;
		if (!target || !DRAWABLE.test(target)) return null;
		media.add(target);
		return { kind: "image", media: target, crop: readCrop(blip) };
	}
	return null;
}

const DASHES: Readonly<Record<string, readonly number[]>> = {
	dash: [4, 3],
	lgDash: [8, 3],
	sysDash: [3, 1],
	dot: [1, 3],
	sysDot: [1, 1],
};

function readLine(
	spPr: Element | null,
	style: Element | null,
	scope: Scope,
): SceneLine | null {
	const ln = kid(spPr, "ln");
	if (kid(ln, "noFill")) return null;
	const color = readColor(kid(ln, "solidFill"), scope);
	const width = (num(ln, "w") ?? 9_525) / EMU_PER_PT;
	const dash = DASHES[kid(ln, "prstDash")?.getAttribute("val") ?? ""] ?? null;
	const scaledDash = dash?.map((d) => d * Math.max(width, 1)) ?? null;
	if (color) return { color, width, dash: scaledDash };
	const reference = kid(style, "lnRef");
	if ((num(reference, "idx") ?? 0) === 0) return null;
	const referenced = readColor(reference, scope);
	return referenced ? { color: referenced, width, dash: scaledDash } : null;
}
// #endregion

// #region Geometry
const POLYGONS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
	triangle: [[0.5, 0], [1, 1], [0, 1]],
	rtTriangle: [[0, 0], [1, 1], [0, 1]],
	diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
	parallelogram: [[0.25, 0], [1, 0], [0.75, 1], [0, 1]],
	trapezoid: [[0.2, 0], [0.8, 0], [1, 1], [0, 1]],
	pentagon: [[0.5, 0], [1, 0.38], [0.81, 1], [0.19, 1], [0, 0.38]],
	hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
	octagon: [[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]],
	chevron: [[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]],
	homePlate: [[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1]],
	rightArrow: [[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]],
	leftArrow: [[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]],
	upArrow: [[0.25, 1], [0.25, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.75, 0.4], [0.75, 1]],
	downArrow: [[0.25, 0], [0.25, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.75, 0.6], [0.75, 0]],
};

const LINES = new Set(["line", "straightConnector1", "bentConnector2", "bentConnector3"]);
const ELLIPSES = new Set(["ellipse", "flowChartConnector"]);

function readPath(custom: Element): ScenePathCommand[] {
	const commands: ScenePathCommand[] = [];
	for (const shape of kids(kid(custom, "pathLst"), "path")) {
		const w = num(shape, "w") || 1;
		const h = num(shape, "h") || 1;
		const point = (el: Element) => ({ x: (num(el, "x") ?? 0) / w, y: (num(el, "y") ?? 0) / h });
		for (const step of kids(shape)) {
			const points = kids(step, "pt").map(point);
			switch (step.localName) {
				case "moveTo":
					if (points[0]) commands.push({ op: "move", ...points[0] });
					break;
				case "lnTo":
					if (points[0]) commands.push({ op: "line", ...points[0] });
					break;
				case "cubicBezTo":
					if (points.length === 3) {
						const [a, b, c] = points;
						commands.push({ op: "curve", x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: c.x, y: c.y });
					}
					break;
				case "quadBezTo":
					if (points.length === 2) {
						const [a, b] = points;
						commands.push({ op: "curve", x1: a.x, y1: a.y, x2: a.x, y2: a.y, x: b.x, y: b.y });
					}
					break;
				case "close":
					commands.push({ op: "close" });
					break;
			}
		}
	}
	return commands;
}

function readGeometry(spPr: Element | null, box: SceneBox): SceneGeometry {
	const custom = kid(spPr, "custGeom");
	if (custom) return { kind: "path", commands: readPath(custom) };
	const preset = kid(spPr, "prstGeom");
	const name = preset?.getAttribute("prst") ?? "rect";
	if (LINES.has(name)) return { kind: "line" };
	if (ELLIPSES.has(name)) return { kind: "ellipse" };
	if (name === "roundRect") {
		const adjust = kids(kid(preset, "avLst"))[0]?.getAttribute("fmla")?.match(/\d+/)?.[0];
		const ratio = (adjust ? Number(adjust) : 16_667) / 100_000;
		return { kind: "round", radius: Math.min(box.width, box.height) * ratio };
	}
	const points = POLYGONS[name];
	return points ? { kind: "polygon", points } : { kind: "rect" };
}

/** Maps a group's child coordinates onto the slide. */
interface GroupMap {
	scaleX: number;
	scaleY: number;
	offsetX: number;
	offsetY: number;
}

const NO_GROUP: GroupMap = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

function readBox(xfrm: Element | null, map: GroupMap): SceneBox | null {
	const off = kid(xfrm, "off");
	const ext = kid(xfrm, "ext");
	if (!off || !ext) return null;
	return {
		x: map.offsetX + (num(off, "x") ?? 0) * map.scaleX / EMU_PER_PT,
		y: map.offsetY + (num(off, "y") ?? 0) * map.scaleY / EMU_PER_PT,
		width: (num(ext, "cx") ?? 0) * map.scaleX / EMU_PER_PT,
		height: (num(ext, "cy") ?? 0) * map.scaleY / EMU_PER_PT,
		rotation: (num(xfrm, "rot") ?? 0) / ANGLE_UNIT,
		flipH: flag(xfrm, "flipH") === true,
		flipV: flag(xfrm, "flipV") === true,
	};
}

function groupMap(xfrm: Element | null, parent: GroupMap): GroupMap {
	const off = kid(xfrm, "off");
	const ext = kid(xfrm, "ext");
	const childOff = kid(xfrm, "chOff");
	const childExt = kid(xfrm, "chExt");
	const scaleX = (num(ext, "cx") ?? 1) / (num(childExt, "cx") || 1);
	const scaleY = (num(ext, "cy") ?? 1) / (num(childExt, "cy") || 1);
	return {
		scaleX: parent.scaleX * scaleX,
		scaleY: parent.scaleY * scaleY,
		offsetX: parent.offsetX +
			((num(off, "x") ?? 0) - (num(childOff, "x") ?? 0) * scaleX) * parent.scaleX / EMU_PER_PT,
		offsetY: parent.offsetY +
			((num(off, "y") ?? 0) - (num(childOff, "y") ?? 0) * scaleY) * parent.scaleY / EMU_PER_PT,
	};
}
// #endregion

// #region Text
/** What one list-style level says; everything absent falls through to the level beneath. */
interface LevelStyle {
	size?: number;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	color?: string;
	font?: string;
	align?: SceneParagraph["align"];
	marginLeft?: number;
	indent?: number;
	bullet?: string | null;
	bulletColor?: string;
	number?: boolean;
	lineHeight?: number;
	before?: number;
	after?: number;
}

function clean<T extends object>(value: T): T {
	for (const key of Object.keys(value) as (keyof T)[]) {
		if (value[key] === undefined) delete value[key];
	}
	return value;
}

function fontOf(name: string | null | undefined, scope: Scope): string | undefined {
	if (!name) return undefined;
	if (name === "+mj-lt" || name === "+mj-ea" || name === "+mj-cs") return scope.theme.major;
	if (name === "+mn-lt" || name === "+mn-ea" || name === "+mn-cs") return scope.theme.minor;
	return name;
}

function readRunStyle(rPr: Element | null | undefined, scope: Scope): LevelStyle {
	if (!rPr) return {};
	const size = num(rPr, "sz");
	const underline = rPr.getAttribute("u");
	return clean({
		size: size === null ? undefined : size / 100,
		bold: flag(rPr, "b") ?? undefined,
		italic: flag(rPr, "i") ?? undefined,
		underline: underline === null ? undefined : underline !== "none",
		color: readColor(kid(rPr, "solidFill"), scope) ?? undefined,
		font: fontOf(kid(rPr, "latin")?.getAttribute("typeface"), scope),
	});
}

const ALIGNS: Readonly<Record<string, SceneParagraph["align"]>> = {
	l: "left",
	ctr: "center",
	r: "right",
	just: "justify",
	dist: "justify",
};

function spacing(el: Element | null, base: number): number | undefined {
	const points = num(kid(el, "spcPts"), "val");
	if (points !== null) return points / 100;
	const percent = num(kid(el, "spcPct"), "val");
	return percent === null ? undefined : base * percent / 100_000;
}

function readParagraphStyle(pPr: Element | null | undefined, scope: Scope): LevelStyle {
	if (!pPr) return {};
	const marginLeft = num(pPr, "marL");
	const indent = num(pPr, "indent");
	const line = num(kid(kid(pPr, "lnSpc"), "spcPct"), "val");
	const bulletText = kid(pPr, "buChar")?.getAttribute("char");
	return clean({
		...readRunStyle(kid(pPr, "defRPr"), scope),
		align: ALIGNS[pPr.getAttribute("algn") ?? ""],
		marginLeft: marginLeft === null ? undefined : marginLeft / EMU_PER_PT,
		indent: indent === null ? undefined : indent / EMU_PER_PT,
		lineHeight: line === null ? undefined : line / 100_000,
		before: spacing(kid(pPr, "spcBef"), DEFAULT_TEXT_PT),
		after: spacing(kid(pPr, "spcAft"), DEFAULT_TEXT_PT),
		bullet: kid(pPr, "buNone") ? null : bulletText ?? undefined,
		number: kid(pPr, "buAutoNum") ? true : kid(pPr, "buNone") ? false : undefined,
		bulletColor: readColor(kid(pPr, "buClr"), scope) ?? undefined,
	});
}

/** The `lvlNpPr` styles of every list-style element in the chain, lowest priority first. */
function levelChain(lists: readonly (Element | null)[], level: number, scope: Scope): LevelStyle {
	let merged: LevelStyle = {};
	for (const list of lists) {
		merged = { ...merged, ...readParagraphStyle(kid(list, `lvl${level + 1}pPr`), scope) };
	}
	return merged;
}

/** Everything a body inherits: the list styles beneath it and the body properties above it. */
interface TextInheritance {
	lists: (Element | null)[];
	bodies: (Element | null)[];
}

function firstAttr(bodies: readonly (Element | null)[], name: string): string | null {
	for (const body of bodies) {
		const value = body?.getAttribute(name);
		if (value !== null && value !== undefined) return value;
	}
	return null;
}

function inset(bodies: readonly (Element | null)[], name: string, fallback: number): number {
	const value = firstAttr(bodies, name);
	return value === null ? fallback : Number(value) / EMU_PER_PT;
}

function readText(
	txBody: Element | null,
	inherited: TextInheritance,
	baseColor: string,
	scope: Scope,
	out: string[],
): SceneText | null {
	if (!txBody) return null;
	const bodyPr = kid(txBody, "bodyPr");
	const bodies = [bodyPr, ...inherited.bodies];
	const lists = [...inherited.lists, kid(txBody, "lstStyle")];
	const autofit = bodies.map((body) => kid(body, "normAutofit")).find(Boolean) ?? null;
	const fontScale = (num(autofit, "fontScale") ?? 100_000) / 100_000;
	const lineReduce = (num(autofit, "lnSpcReduction") ?? 0) / 100_000;
	const counters = new Map<number, number>();

	const paragraphs = kids(txBody, "p").map((p): SceneParagraph => {
		const pPr = kid(p, "pPr");
		const level = Math.min(num(pPr, "lvl") ?? 0, 8);
		const style: LevelStyle = {
			...levelChain(lists, level, scope),
			...readParagraphStyle(pPr, scope),
		};
		const runs: SceneRun[] = [];
		const push = (text: string, rPr: Element | null) => {
			const run = { ...style, ...readRunStyle(rPr, scope) };
			runs.push({
				text,
				size: (run.size ?? DEFAULT_TEXT_PT) * fontScale,
				bold: run.bold ?? false,
				italic: run.italic ?? false,
				underline: run.underline ?? false,
				color: run.color ?? baseColor,
				font: run.font ?? scope.theme.minor,
			});
		};
		for (const child of kids(p)) {
			if (child.localName === "r" || child.localName === "fld") {
				push(kid(child, "t")?.textContent ?? "", kid(child, "rPr"));
			} else if (child.localName === "br") {
				push("\n", kid(child, "rPr"));
			}
		}
		const written = runs.map((run) => run.text).join("").trim();
		if (written) out.push(written);

		let bullet = style.bullet ?? null;
		if (style.number && written) {
			const next = (counters.get(level) ?? 0) + 1;
			counters.set(level, next);
			bullet = `${next}.`;
		} else if (!style.number) counters.delete(level);
		return {
			runs,
			align: style.align ?? "left",
			marginLeft: style.marginLeft ?? 0,
			indent: style.indent ?? 0,
			bullet: written ? bullet : null,
			bulletColor: style.bulletColor ?? null,
			lineHeight: Math.max(0.5, (style.lineHeight ?? 1) - lineReduce),
			before: (style.before ?? 0) * fontScale,
			after: (style.after ?? 0) * fontScale,
			emptySize: (style.size ?? DEFAULT_TEXT_PT) * fontScale,
		};
	});
	if (!paragraphs.some((p) => p.runs.some((run) => run.text.trim().length > 0))) return null;

	const anchor = firstAttr(bodies, "anchor");
	return {
		paragraphs,
		anchor: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
		insets: {
			left: inset(bodies, "lIns", DEFAULT_INSET_PT),
			right: inset(bodies, "rIns", DEFAULT_INSET_PT),
			top: inset(bodies, "tIns", DEFAULT_BLOCK_INSET_PT),
			bottom: inset(bodies, "bIns", DEFAULT_BLOCK_INSET_PT),
		},
		wrap: firstAttr(bodies, "wrap") !== "none",
	};
}
// #endregion

// #region Slide
/** The layout and master placeholders a slide's shapes inherit from. */
interface Chain {
	scope: Scope;
	layout: Part;
	master: Part;
	masterStyles: Element | null;
	defaults: Element | null;
}

interface Placeholder {
	type: string;
	index: string | null;
}

function placeholderOf(shape: Element): Placeholder | null {
	const ph = path(shape, "nvSpPr", "nvPr", "ph");
	if (!ph) return null;
	return { type: ph.getAttribute("type") ?? "body", index: ph.getAttribute("idx") };
}

const TITLE_TYPES = new Set(["title", "ctrTitle"]);
const BODY_TYPES = new Set(["body", "subTitle", "obj", "tbl", "chart", "dgm", "media"]);

function sameFamily(a: string, b: string): boolean {
	return a === b || (TITLE_TYPES.has(a) && TITLE_TYPES.has(b)) ||
		(BODY_TYPES.has(a) && BODY_TYPES.has(b));
}

/** The placeholder a shape inherits from: the same index, else the same type, else the same family. */
function findPlaceholder(part: Part, wanted: Placeholder): Element | null {
	const found = kids(path(part.root, "cSld", "spTree"), "sp").flatMap((shape) => {
		const ph = placeholderOf(shape);
		return ph ? [{ shape, ph }] : [];
	});
	const match =
		(wanted.index === null ? undefined : found.find(({ ph }) => ph.index === wanted.index)) ??
			found.find(({ ph }) => ph.type === wanted.type) ??
			found.find(({ ph }) => sameFamily(ph.type, wanted.type));
	return match?.shape ?? null;
}

function masterListFor(type: string, chain: Chain): Element | null {
	if (TITLE_TYPES.has(type)) return kid(chain.masterStyles, "titleStyle");
	if (BODY_TYPES.has(type)) return kid(chain.masterStyles, "bodyStyle");
	return kid(chain.masterStyles, "otherStyle");
}

/** Walks a shape tree into scene items. */
class SlideBuilder {
	readonly items: SceneItem[] = [];
	readonly text: string[] = [];
	readonly media = new Set<string>();

	constructor(
		private readonly chain: Chain,
		private readonly readPart: (path: string) => Promise<Part | null>,
	) {}

	async walk(
		tree: Element | null,
		part: Part,
		map: GroupMap,
		keepPlaceholders: boolean,
	): Promise<void> {
		for (const child of kids(tree)) await this.visit(child, part, map, keepPlaceholders);
	}

	private async visit(
		el: Element,
		part: Part,
		map: GroupMap,
		keepPlaceholders: boolean,
	): Promise<void> {
		switch (el.localName) {
			case "sp":
				this.shape(el, part, map, keepPlaceholders);
				break;
			case "cxnSp":
				this.shape(el, part, map, true);
				break;
			case "pic":
				this.picture(el, part, map);
				break;
			case "grpSp":
				await this.walk(
					el,
					part,
					groupMap(kid(kid(el, "grpSpPr"), "xfrm"), map),
					keepPlaceholders,
				);
				break;
			case "graphicFrame":
				await this.frame(el, part, map);
				break;
			case "AlternateContent": {
				const branch = kid(el, "Fallback") ?? kid(el, "Choice");
				for (const child of kids(branch)) await this.visit(child, part, map, keepPlaceholders);
				break;
			}
		}
	}

	private shape(el: Element, part: Part, map: GroupMap, keepPlaceholders: boolean): void {
		const hidden = path(el, "nvSpPr", "cNvPr")?.getAttribute("hidden") === "1";
		const ph = placeholderOf(el);
		if (hidden || (ph && !keepPlaceholders)) return;

		const { chain } = this;
		const { scope } = chain;
		const layoutShape = ph ? findPlaceholder(chain.layout, ph) : null;
		const masterShape = ph ? findPlaceholder(chain.master, ph) : null;
		const spPr = kid(el, "spPr");
		const box = readBox(kid(spPr, "xfrm"), map) ??
			readBox(kid(kid(layoutShape, "spPr"), "xfrm"), NO_GROUP) ??
			readBox(kid(kid(masterShape, "spPr"), "xfrm"), NO_GROUP);
		if (!box) return;

		const style = kid(el, "style");
		const fillRef = kid(style, "fillRef");
		let fill = readFill(spPr, scope, part, this.media);
		if (fill === null && layoutShape) {
			fill = readFill(kid(layoutShape, "spPr"), scope, chain.layout, this.media);
		}
		if (fill === null && (num(fillRef, "idx") ?? 0) > 0) {
			const color = readColor(fillRef, scope);
			if (color) fill = { kind: "solid", color };
		}

		const type = ph?.type ?? "other";
		const base = readColor(kid(style, "fontRef"), scope) ??
			transformColor(scope.theme.colors[scope.map.tx1 ?? "dk1"] ?? "000000", []);
		const text = readText(
			kid(el, "txBody"),
			{
				lists: ph
					? [
						masterListFor(type, chain),
						kid(kid(masterShape, "txBody"), "lstStyle"),
						kid(kid(layoutShape, "txBody"), "lstStyle"),
					]
					: [chain.defaults, masterListFor("other", chain)],
				bodies: [
					kid(kid(layoutShape, "txBody"), "bodyPr"),
					kid(kid(masterShape, "txBody"), "bodyPr"),
				],
			},
			base,
			scope,
			this.text,
		);
		this.items.push({
			kind: "shape",
			box,
			geometry: readGeometry(spPr, box),
			fill: fill === "none" ? null : fill,
			line: readLine(spPr, style, scope),
			text,
		});
	}

	private picture(el: Element, part: Part, map: GroupMap): void {
		const spPr = kid(el, "spPr");
		const box = readBox(kid(spPr, "xfrm"), map);
		if (!box) return;
		const blip = kid(el, "blipFill");
		const target = part.rels.get(relId(kid(blip, "blip"), "embed") ?? "")?.path;
		if (!target || !DRAWABLE.test(target)) {
			this.items.push({ kind: "note", box, label: "Image" });
			return;
		}
		this.media.add(target);
		this.items.push({
			kind: "shape",
			box,
			geometry: readGeometry(spPr, box),
			fill: { kind: "image", media: target, crop: blip ? readCrop(blip) : NO_CROP },
			line: readLine(spPr, null, this.chain.scope),
			text: null,
		});
	}

	private async frame(el: Element, part: Part, map: GroupMap): Promise<void> {
		const box = readBox(kid(el, "xfrm"), map);
		if (!box) return;
		const data = path(el, "graphic", "graphicData");
		const table = kid(data, "tbl");
		if (table) {
			this.table(table, box, part);
			return;
		}
		// SmartArt ships its own drawn fallback; its shapes sit in the frame's coordinates.
		const relIds = kid(data, "relIds");
		if (relIds) {
			const drawing = [...part.rels.values()].find((rel) => /diagramDrawing/.test(rel.type));
			const parsed = drawing ? await this.readPart(drawing.path) : null;
			if (parsed) {
				const inner: GroupMap = {
					...map,
					offsetX: box.x,
					offsetY: box.y,
				};
				await this.walk(kid(parsed.root, "spTree"), parsed, inner, true);
				return;
			}
		}
		this.items.push({ kind: "note", box, label: kid(data, "chart") ? "Chart" : "Object" });
	}

	private table(table: Element, box: SceneBox, part: Part): void {
		const { scope } = this.chain;
		const columns = kids(kid(table, "tblGrid"), "gridCol").map((col) =>
			(num(col, "w") ?? 0) / EMU_PER_PT
		);
		const base = transformColor(scope.theme.colors[scope.map.tx1 ?? "dk1"] ?? "000000", []);
		const rows = kids(table, "tr").map((row) => ({
			height: (num(row, "h") ?? 0) / EMU_PER_PT,
			cells: kids(row, "tc").map((tc): SceneCell | null => {
				if (flag(tc, "hMerge") || flag(tc, "vMerge")) return null;
				const fill = readFill(kid(tc, "tcPr"), scope, part, this.media);
				return {
					fill: fill === "none" ? null : fill,
					text: readText(
						kid(tc, "txBody"),
						{ lists: [this.chain.defaults], bodies: [] },
						base,
						scope,
						this.text,
					),
					columnSpan: num(tc, "gridSpan") ?? 1,
					rowSpan: num(tc, "rowSpan") ?? 1,
				};
			}),
		}));
		this.items.push({ kind: "table", box, columns, rows });
	}
}

const NO_CROP: SceneCrop = { left: 0, top: 0, right: 0, bottom: 0 };

function backgroundOf(
	root: Element,
	scope: Scope,
	part: Part,
	media: Set<string>,
): ScenePaint | null {
	const bg = path(root, "cSld", "bg");
	if (!bg) return null;
	const fill = readFill(kid(bg, "bgPr"), scope, part, media);
	if (fill === "none") return null;
	if (fill) return fill;
	const color = readColor(kid(bg, "bgRef"), scope);
	return color ? { kind: "solid", color } : null;
}

function colorMap(el: Element | null): Record<string, string> {
	const map: Record<string, string> = {};
	if (!el) return map;
	for (const attr of Array.from(el.attributes)) map[attr.localName] = attr.value;
	return map;
}
// #endregion

// #region Deck
/** Open a deck: its size and slide order. Slides are read as they are asked for. */
export async function openDeck(zip: RemoteZip): Promise<Deck> {
	const parts = new Map<string, Promise<Part | null>>();

	const readRels = async (part: string): Promise<Part["rels"]> => {
		const rels: Part["rels"] = new Map();
		const entry = zip.find(relsPathOf(part));
		if (!entry) return rels;
		const doc = parseXml(await zip.text(entry));
		for (const rel of Array.from(doc?.documentElement.children ?? [])) {
			const id = rel.getAttribute("Id");
			const target = rel.getAttribute("Target");
			if (!id || !target || rel.getAttribute("TargetMode") === "External") continue;
			rels.set(id, { path: joinPath(part, target), type: rel.getAttribute("Type") ?? "" });
		}
		return rels;
	};

	const readPart = (part: string): Promise<Part | null> => {
		const known = parts.get(part);
		if (known) return known;
		const pending = (async () => {
			const entry = zip.find(part);
			if (!entry) return null;
			const doc = parseXml(await zip.text(entry));
			if (!doc) return null;
			return { path: part, root: doc.documentElement, rels: await readRels(part) };
		})();
		parts.set(part, pending);
		return pending;
	};

	const relOfType = (part: Part, type: RegExp): string | null =>
		[...part.rels.values()].find((rel) => type.test(rel.type))?.path ?? null;

	const presentation = await readPart("ppt/presentation.xml");
	if (!presentation) throw new DeckReadError("This file isn't a readable presentation.");
	const size = kid(presentation.root, "sldSz");
	const width = (num(size, "cx") ?? 9_144_000) / EMU_PER_PT;
	const height = (num(size, "cy") ?? 5_143_500) / EMU_PER_PT;
	const order = kids(kid(presentation.root, "sldIdLst"), "sldId").flatMap((slide) => {
		const target = presentation.rels.get(relId(slide, "id") ?? "")?.path;
		return target ? [target] : [];
	});
	if (order.length === 0) throw new DeckReadError("This presentation has no slides.");
	const defaults = kid(presentation.root, "defaultTextStyle");

	const slide = async (index: number): Promise<SlideScene> => {
		const part = await readPart(order[index]);
		const layoutPath = part && relOfType(part, /slideLayout$/);
		const layout = layoutPath ? await readPart(layoutPath) : null;
		const masterPath = layout && relOfType(layout, /slideMaster$/);
		const master = masterPath ? await readPart(masterPath) : null;
		const themePath = master && relOfType(master, /theme$/);
		const themePart = themePath ? await readPart(themePath) : null;
		if (!part || !layout || !master || !themePart) {
			throw new DeckReadError("This slide couldn't be read.");
		}
		const override = path(part.root, "clrMapOvr", "overrideClrMapping");
		const scope: Scope = {
			theme: parseTheme(themePart.root),
			map: colorMap(override ?? kid(master.root, "clrMap")),
		};
		const chain: Chain = {
			scope,
			layout,
			master,
			masterStyles: kid(master.root, "txStyles"),
			defaults,
		};
		const builder = new SlideBuilder(chain, readPart);
		if (part.root.getAttribute("showMasterSp") !== "0") {
			if (layout.root.getAttribute("showMasterSp") !== "0") {
				await builder.walk(path(master.root, "cSld", "spTree"), master, NO_GROUP, false);
			}
			await builder.walk(path(layout.root, "cSld", "spTree"), layout, NO_GROUP, false);
		}
		builder.text.length = 0;
		await builder.walk(path(part.root, "cSld", "spTree"), part, NO_GROUP, true);
		const background = backgroundOf(part.root, scope, part, builder.media) ??
			backgroundOf(layout.root, scope, layout, builder.media) ??
			backgroundOf(master.root, scope, master, builder.media);
		return {
			width,
			height,
			background,
			items: builder.items,
			text: builder.text,
			media: [...builder.media],
		};
	};

	return {
		width,
		height,
		slideCount: order.length,
		slide,
		media: async (target) => {
			const entry = zip.find(target);
			if (!entry) return null;
			const extension = target.split(".").pop()?.toLowerCase() ?? "";
			const bytes = await zip.bytes(entry);
			return new Blob([bytes as BlobPart], { type: MEDIA_TYPES[extension] ?? "" });
		},
	};
}
// #endregion
