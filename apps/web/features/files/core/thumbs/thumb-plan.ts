import { type AssetItem, inspectable, resolveViewer } from "@projective/types/files";
import { assetMediaSrc } from "../asset-media.ts";
import type { ThumbLane } from "./thumb-queue.ts";

/**
 * thumb-plan — what a card can show for a file, decided without touching a byte. Anything already on
 * the row wins (a poster or a waveform captured at upload costs nothing), then what can be rendered
 * here from the stored bytes, within limits that keep a preview cheaper than opening the file. The
 * card's tile stays in place for everything else, so no file is ever worse off for having a plan.
 *
 * Reads through the inspector's own {@link resolveViewer}, so a card and its inspector agree on what
 * a file is.
 */

// #region Contract
/** The renderers, each its own lazily loaded module. */
export type ThumbRenderer =
	| "text"
	| "csv"
	| "sheet"
	| "pdf"
	| "docx"
	| "pptx"
	| "video"
	| "model"
	| "texture";

/** A job for a renderer. */
export interface ThumbJob {
	kind: "render";
	renderer: ThumbRenderer;
	lane: ThumbLane;
	/** The cache key: the same file at the same version always draws the same picture. */
	key: string;
	src: string;
	sizeBytes: number;
	/** The file's extension, lower-cased. */
	ext: string;
	/** The first-row and delimiter hints the renderer needs. */
	delimiter: "," | "\t" | null;
	modelFormat: ReturnType<typeof resolveViewer>["modelFormat"];
}

/** What a card does for a file. */
export type ThumbPlan =
	/** Draws its own picture, or nothing beyond its tile: the card's default. */
	| { kind: "none" }
	/** A picture already on the row. */
	| { kind: "picture"; src: string }
	/** A waveform already on the row. */
	| { kind: "wave"; peaks: readonly number[] }
	| ThumbJob;

/** The slice of a row {@link thumbPlan} reads. */
export type ThumbAsset =
	& Pick<
		AssetItem,
		| "id"
		| "name"
		| "kind"
		| "ext"
		| "source"
		| "status"
		| "url"
		| "thumbnailUrl"
		| "sizeBytes"
		| "contentHash"
		| "metadata"
	>
	& { assetId?: string | null };
// #endregion

// #region Limits
/** Bump to redraw every cached thumbnail after a renderer changes. */
export const THUMB_VERSION = 1;

/** Largest file each renderer reads whole. PDF and Office read in ranges, so they have no limit here. */
const WHOLE_FILE_LIMITS: Readonly<Partial<Record<ThumbRenderer, number>>> = {
	sheet: 12_000_000,
	model: 32_000_000,
	texture: 48_000_000,
};
// #endregion

// #region Plan
interface Choice {
	renderer: ThumbRenderer;
	lane: ThumbLane;
}

function rendererFor(viewer: ReturnType<typeof resolveViewer>["viewer"]): Choice | null {
	switch (viewer) {
		case "code":
		case "text":
		case "markdown":
			return { renderer: "text", lane: "net" };
		case "table":
			return { renderer: "csv", lane: "net" };
		case "sheet":
			return { renderer: "sheet", lane: "decode" };
		case "pdf":
			return { renderer: "pdf", lane: "decode" };
		case "docx":
			return { renderer: "docx", lane: "decode" };
		case "presentation":
			return { renderer: "pptx", lane: "decode" };
		case "video":
			return { renderer: "video", lane: "decode" };
		case "model":
			return { renderer: "model", lane: "gpu" };
		case "panorama":
			return { renderer: "texture", lane: "decode" };
		default:
			return null;
	}
}

/** Decide what a card shows. `engines` says whether this page's policy admits the 3D decoders. */
export function thumbPlan(asset: ThumbAsset, engines: boolean): ThumbPlan {
	const media = asset.metadata?.media;
	if (media?.kind === "audio" && media.peaks.length > 0) {
		return { kind: "wave", peaks: media.peaks };
	}
	if (asset.kind === "video" && asset.thumbnailUrl) return { kind: "none" };
	if ((media?.kind === "video" || media?.kind === "document") && media.posterDataUrl) {
		return { kind: "picture", src: media.posterDataUrl };
	}

	const stored = inspectable(asset);
	if (!stored) {
		// A connector's own preview of a document: the card's default only draws images and video.
		return asset.thumbnailUrl && asset.kind !== "image"
			? { kind: "picture", src: asset.thumbnailUrl }
			: { kind: "none" };
	}

	const choice = resolveViewer(asset.name, null);
	const plan = rendererFor(choice.viewer);
	const src = assetMediaSrc(asset);
	if (!plan || !src) return { kind: "none" };
	if (plan.renderer === "model" && !engines) return { kind: "none" };
	const limit = WHOLE_FILE_LIMITS[plan.renderer];
	if (limit !== undefined && asset.sizeBytes > limit) return { kind: "none" };
	if (asset.sizeBytes === 0) return { kind: "none" };

	return {
		kind: "render",
		...plan,
		key: `${asset.assetId ?? asset.id}:${asset.contentHash ?? asset.sizeBytes}:v${THUMB_VERSION}`,
		src,
		sizeBytes: asset.sizeBytes,
		ext: asset.ext.toLowerCase(),
		delimiter: choice.delimiter,
		modelFormat: choice.modelFormat,
	};
}
// #endregion

// #region Waveform
const WAVE_BARS = 56;
const WAVE_MIN_HEIGHT = 0.06;

/**
 * An SVG path for a waveform in a `bars × 1` box, one stroke per bar: a single path element, however
 * many bars, because a page of audio cards should not cost hundreds of nodes.
 */
export function wavePath(peaks: readonly number[], bars: number = WAVE_BARS): string {
	const count = Math.min(bars, peaks.length);
	let path = "";
	for (let i = 0; i < count; i++) {
		const from = Math.floor(i * peaks.length / count);
		const to = Math.max(from + 1, Math.floor((i + 1) * peaks.length / count));
		let peak = 0;
		for (let p = from; p < to; p++) peak = Math.max(peak, peaks[p]);
		const half = Math.max(WAVE_MIN_HEIGHT, Math.min(1, peak)) / 2;
		path += `M${i + 0.5} ${(0.5 - half).toFixed(3)}V${(0.5 + half).toFixed(3)}`;
	}
	return path;
}
// #endregion
