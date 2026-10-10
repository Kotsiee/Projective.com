import type { ModelFormat } from "@projective/types/files";
import type { StageFact } from "./inspector-shell.ts";
import type { Vec3 } from "./model-camera.ts";

/**
 * model-scene — the pure side of the 3D canvas: bounds arithmetic, the scene statistics the panel
 * reports, the labels and figures it shows, and the notices for resources a single uploaded file
 * cannot carry. No three.js and no DOM; the canvas samples the scene and hands plain numbers here.
 */

// #region Limits
/** Largest model the canvas will download and parse in the browser. */
export const MODEL_BYTES_LIMIT = 256 * 1024 * 1024;
// #endregion

// #region Bounds
/** An axis-aligned box as two corners. */
export interface Bounds {
	min: Vec3;
	max: Vec3;
}

/** Whether a box is finite and has some extent (an empty scene's box is infinite and inverted). */
export function usableBounds(b: Bounds): boolean {
	for (let i = 0; i < 3; i++) {
		if (!Number.isFinite(b.min[i]) || !Number.isFinite(b.max[i]) || b.max[i] < b.min[i]) {
			return false;
		}
	}
	return boundsRadius(b) > 0;
}

/** Width, height and depth of a box. */
export function boundsSize(b: Bounds): Vec3 {
	return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

/** Centre of a box. */
export function boundsCenter(b: Bounds): Vec3 {
	return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/** Radius of the sphere that encloses a box (half its diagonal). */
export function boundsRadius(b: Bounds): number {
	const [x, y, z] = boundsSize(b);
	return Math.hypot(x, y, z) / 2;
}

/** A "nice" grid cell (1, 2 or 5 × 10ⁿ) that splits `span` into roughly `cells` squares. */
export function gridStep(span: number, cells = 10): number {
	if (!(span > 0) || !Number.isFinite(span)) return 1;
	const raw = span / cells;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const unit = raw / magnitude;
	const nice = unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10;
	return nice * magnitude;
}
// #endregion

// #region Statistics
/** What the canvas learned about one drawable object. */
export interface DrawableSample {
	/** Vertex count of the geometry (times the instance count for instanced meshes). */
	vertices: number;
	/** Triangle count; zero for points and lines. */
	triangles: number;
	/** Stable ids of the materials it uses. */
	materials: readonly string[];
	/** Stable ids of the textures those materials sample. */
	textures: readonly string[];
}

/** Totals for the whole scene. */
export interface ModelStats {
	meshes: number;
	vertices: number;
	triangles: number;
	materials: number;
	textures: number;
	animations: number;
	cameras: number;
	lights: number;
}

/** Triangles drawn by one geometry, from its index (or vertex) count and instance count. */
export function triangleCount(
	indexCount: number | null,
	vertexCount: number,
	instances = 1,
): number {
	const elements = indexCount ?? vertexCount;
	return Math.floor(Math.max(0, elements) / 3) * Math.max(1, Math.floor(instances));
}

/** Sum the per-object samples, counting shared materials and textures once. */
export function aggregateStats(
	samples: readonly DrawableSample[],
	extras: { animations: number; cameras: number; lights: number },
): ModelStats {
	const materials = new Set<string>();
	const textures = new Set<string>();
	let vertices = 0;
	let triangles = 0;
	for (const s of samples) {
		vertices += s.vertices;
		triangles += s.triangles;
		for (const m of s.materials) materials.add(m);
		for (const t of s.textures) textures.add(t);
	}
	return {
		meshes: samples.length,
		vertices,
		triangles,
		materials: materials.size,
		textures: textures.size,
		animations: extras.animations,
		cameras: extras.cameras,
		lights: extras.lights,
	};
}
// #endregion

// #region Formatting
const COUNT = new Intl.NumberFormat("en-GB");

/** A whole-number count with digit grouping. */
export function formatCount(n: number): string {
	return COUNT.format(Math.max(0, Math.round(n)));
}

/** A length to three significant figures, without trailing zeros or exponent notation. */
export function formatLength(n: number): string {
	if (!Number.isFinite(n) || n === 0) return "0";
	const abs = Math.abs(n);
	const decimals = Math.max(0, Math.min(6, 2 - Math.floor(Math.log10(abs))));
	return Number(n.toFixed(decimals)).toLocaleString("en-GB", { maximumFractionDigits: decimals });
}

/** glTF is metres by specification; the other formats carry no reliable unit. */
export function modelUnit(format: ModelFormat | null): string | null {
	return format === "glb" || format === "gltf" ? "m" : null;
}

/** `W × H × D` with the unit when known, else "units". */
export function formatDimensions(size: Vec3, unit: string | null): string {
	const figures = size.map(formatLength).join(" × ");
	return `${figures} ${unit ?? "units"}`;
}

/** Seconds as `m:ss.s` for animation scrubbing. */
export function formatClipTime(seconds: number): string {
	const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
	const minutes = Math.floor(s / 60);
	const rest = s - minutes * 60;
	return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** Display name of each model format. */
export const MODEL_FORMAT_LABELS: Readonly<Record<ModelFormat, string>> = {
	glb: "glTF binary (GLB)",
	gltf: "glTF",
	obj: "Wavefront OBJ",
	stl: "STL",
	ply: "PLY",
	fbx: "FBX",
	"3mf": "3MF",
	dae: "COLLADA",
	usdz: "USDZ",
};

/** The canvas facts for the panel's Details, in reading order; zero counts that say nothing are omitted. */
export function modelFacts(
	format: ModelFormat | null,
	stats: ModelStats,
	size: Vec3 | null,
	unit: string | null,
): StageFact[] {
	const facts: StageFact[] = [];
	if (format) facts.push({ label: "Model format", value: MODEL_FORMAT_LABELS[format] });
	facts.push({ label: "Meshes", value: formatCount(stats.meshes) });
	if (stats.triangles > 0) facts.push({ label: "Triangles", value: formatCount(stats.triangles) });
	facts.push({ label: "Vertices", value: formatCount(stats.vertices) });
	facts.push({ label: "Materials", value: formatCount(stats.materials) });
	if (stats.textures > 0) facts.push({ label: "Textures", value: formatCount(stats.textures) });
	if (stats.animations > 0) {
		facts.push({ label: "Animations", value: formatCount(stats.animations) });
	}
	if (stats.cameras > 0) facts.push({ label: "Cameras", value: formatCount(stats.cameras) });
	if (stats.lights > 0) facts.push({ label: "Lights", value: formatCount(stats.lights) });
	if (size) facts.push({ label: "Bounding size", value: formatDimensions(size, unit) });
	return facts;
}
// #endregion

// #region Labels
/** A clip or camera name, or a numbered stand-in when the file left it blank. */
export function itemLabel(name: string | null | undefined, kind: string, index: number): string {
	const trimmed = (name ?? "").trim();
	return trimmed.length > 0 ? trimmed : `${kind} ${index + 1}`;
}
// #endregion

// #region Missing resources
/** The file name a loader asked for, decoded and without its directory or query. */
export function resourceName(url: string): string {
	const bare = url.split(/[?#]/, 1)[0] ?? "";
	const last = bare.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? bare;
	try {
		return decodeURIComponent(last);
	} catch {
		return last;
	}
}

/** A decoded `data:` URL. */
export interface DataUrlPayload {
	type: string;
	bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Decode a `data:` URL into its media type and bytes, or `null` when it is malformed. The canvas
 * turns embedded glTF buffers and images into `blob:` URLs with this, because the page's
 * `connect-src` admits `blob:` but not `data:`.
 */
export function decodeDataUrl(url: string): DataUrlPayload | null {
	if (!url.startsWith("data:")) return null;
	const comma = url.indexOf(",");
	if (comma < 0) return null;
	const header = url.slice(5, comma);
	const body = url.slice(comma + 1);
	const base64 = /;base64$/i.test(header);
	const type = header.replace(/;base64$/i, "").split(";", 1)[0]?.trim() ||
		"application/octet-stream";
	try {
		if (!base64) return { type, bytes: new TextEncoder().encode(decodeURIComponent(body)) };
		const binary = atob(body.replace(/\s+/g, ""));
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return { type, bytes };
	} catch {
		return null;
	}
}

/** Material libraries an OBJ file references (`mtllib a.mtl b.mtl`). */
export function objMaterialLibraries(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/gm)) {
		for (const name of match[1].split(/[ \t]+/)) {
			if (name.length > 0) found.add(resourceName(name));
		}
	}
	return [...found];
}

function listNames(names: readonly string[], limit = 3): string {
	const shown = names.slice(0, limit).join(", ");
	const more = names.length - limit;
	return more > 0 ? `${shown} and ${more} more` : shown;
}

/** The non-fatal notice for referenced files that weren't uploaded with this one, or `null`. */
export function missingNotice(names: readonly string[]): string | null {
	const unique = [...new Set(names)].filter((n) => n.length > 0);
	if (unique.length === 0) return null;
	const noun = unique.length === 1 ? "file" : "files";
	return `This model refers to ${unique.length} separate ${noun} that ${
		unique.length === 1 ? "isn't" : "aren't"
	} part of this upload (${listNames(unique)}), so some materials or textures may be missing.`;
}

/** The failure reason when the geometry itself lives in files that weren't uploaded. */
export function missingGeometryReason(names: readonly string[]): string {
	const unique = [...new Set(names)].filter((n) => n.length > 0);
	if (unique.length === 0) return "This 3D file couldn't be read.";
	return `This model keeps its geometry in separate files (${
		listNames(unique)
	}) that aren't part of this upload. Upload a single .glb to preview it.`;
}
// #endregion
