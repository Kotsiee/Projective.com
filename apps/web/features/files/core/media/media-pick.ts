import {
	type AssetItem,
	type CropState,
	fileObjectHref,
	INITIAL_CROP,
	type RenditionPurpose,
} from "@projective/types/files";

/**
 * media-pick — the pure rules behind the File Picker's media mode: what a host asks for, what it is
 * handed back, and which library rows may be framed at all.
 *
 * A row is a crop CANDIDATE only when the server's cut would accept it as a source: an uploaded file
 * on the platform's own storage, a still (or a video where the target takes one) with known
 * dimensions. Refusing here, at the click, beats letting a person frame a picture the rendition step
 * will then turn down.
 */

// #region Contract

/** What a host hands back to the person's choice. */
export interface MediaCropChoice {
	sourceAssetId: string;
	/** The crop, for a still; a video is published as uploaded. */
	crop?: CropState;
	/** The slot's alternative text, for a showcase target. */
	alt?: string;
	/** A short-lived URL of the uncropped source, for previewing the choice before it is applied. */
	previewUrl: string;
	/** The showcase slot this choice fills; absent for the photo and group targets. */
	position?: number;
}

/** How a host configures the picker's media mode. */
export interface MediaPickConfig {
	target: RenditionPurpose;
	/** Whether a video may be chosen at all (a showcase with a slot other than 1 to fill). */
	allowVideo: boolean;
	/** How many sources may be chosen — the empty showcase slots being filled, else 1. */
	max: number;
	/** The showcase slots the choices fill, in order of preference; `[]` for other targets. */
	positions: number[];
	/** The slot's current alternative text, when replacing a showcase picture. */
	initialAlt?: string;
	/** Offer the sign-in provider's picture as a source (a person's own photo). */
	offerSignInPicture: boolean;
	title: string;
	saveLabel: string;
	/**
	 * Apply the choices, every source already in the library. Resolve `null` to close the picker, or
	 * a sentence to keep it open and show it beside the save action.
	 */
	onSave: (choices: MediaCropChoice[]) => Promise<string | null>;
}

/**
 * Where a candidate's bytes are. Only `library` exists in `files.items`: a `staged` device file and
 * the `signin` picture are previews until Save & Apply sends them through the pipeline.
 */
export type CandidateOrigin =
	| { kind: "library" }
	| { kind: "staged"; file: File }
	| { kind: "signin" };

/** One source the stage can show: a still to frame, or a video to preview. */
export interface CropCandidate {
	id: string;
	name: string;
	kind: "image" | "video";
	/** The display URL — the upright `lg` tier, an object URL for a staged file, the original video. */
	src: string;
	/** Natural size in the upright frame the crop is expressed in. */
	width: number;
	height: number;
	poster: string | null;
	origin: CandidateOrigin;
}

/** A chosen candidate with its own framing and description. */
export interface PickItem {
	candidate: CropCandidate;
	crop: CropState;
	alt: string;
}

// #endregion

// #region Candidates

const NOT_READY = "That file is still being processed. Choose it again in a moment.";

/** A library row as a crop candidate, or the sentence that says why it cannot be one. */
export function candidateFromAsset(
	asset: AssetItem,
	allowVideo: boolean,
): CropCandidate | { refusal: string } {
	if (asset.kind !== "image" && asset.kind !== "video") {
		return { refusal: allowVideo ? "Choose a picture or a video." : "Choose a picture." };
	}
	if (asset.kind === "video" && !allowVideo) return { refusal: "This takes a still picture." };
	if (asset.source !== "supabase") {
		return {
			refusal: "Files from a connected drive can't be used here. Upload the picture instead.",
		};
	}
	if (asset.status !== "uploaded") return { refusal: NOT_READY };
	if (!asset.width || !asset.height) {
		return { refusal: "That picture's size couldn't be read. Upload it again to use it here." };
	}
	return {
		id: asset.id,
		name: asset.name,
		kind: asset.kind,
		src: asset.kind === "image" ? fileObjectHref(asset.id, { tier: "lg" }) : asset.url,
		width: asset.width,
		height: asset.height,
		poster: asset.thumbnailUrl,
		origin: { kind: "library" },
	};
}

/** The `accept` kinds a media target browses with. */
export function mediaKinds(config: Pick<MediaPickConfig, "allowVideo">): Array<"image" | "video"> {
	return config.allowVideo ? ["image", "video"] : ["image"];
}

/** The file input's `accept` for a media target. */
export function mediaAcceptAttr(config: Pick<MediaPickConfig, "allowVideo">): string {
	return config.allowVideo ? "image/*,video/mp4,video/webm,video/quicktime" : "image/*";
}

// #endregion

// #region Selection

/** The outcome of a click on a source: the next selection, or why it was refused. */
export type SelectionResult = { items: PickItem[] } | { refusal: string };

/**
 * Toggle a source in the selection: a chosen one is removed; with room it is added; with a single
 * slot it REPLACES the choice; at a larger cap it is refused with a sentence saying so.
 */
export function toggleSelection(
	items: readonly PickItem[],
	candidate: CropCandidate,
	max: number,
	initialAlt = "",
): SelectionResult {
	if (items.some((i) => i.candidate.id === candidate.id)) {
		return { items: items.filter((i) => i.candidate.id !== candidate.id) };
	}
	const added: PickItem = { candidate, crop: INITIAL_CROP, alt: initialAlt };
	if (max <= 1) return { items: [added] };
	if (items.length >= max) {
		return { refusal: `You have ${max} empty slots — remove one to choose another.` };
	}
	return { items: [...items, added] };
}

/** The index `dir` steps from `index` in a list of `length`, wrapping at both ends. */
export function cycleIndex(index: number, length: number, dir: 1 | -1): number {
	if (length <= 0) return 0;
	return ((index + dir) % length + length) % length;
}

const SLOT_ONE_STILL = "Slot 1 is your thumbnail, so it takes a picture — choose at least one.";

/**
 * Which showcase slot each chosen item fills, in selection order. Slot 1 is the thumbnail every card
 * leads with and takes a still only, so the first still is moved there; with no still and slot 1 to
 * fill, the assignment is refused.
 */
export function assignSlots(
	items: readonly Pick<PickItem, "candidate">[],
	positions: readonly number[],
): { slots: number[] } | { refusal: string } {
	const slots = positions.slice(0, items.length);
	const one = slots.indexOf(1);
	if (one === -1) return { slots };
	if (items[one].candidate.kind === "image") return { slots };
	const still = items.findIndex((i) => i.candidate.kind === "image");
	if (still === -1) return { refusal: SLOT_ONE_STILL };
	slots[one] = slots[still];
	slots[still] = 1;
	return { slots };
}

// #endregion
