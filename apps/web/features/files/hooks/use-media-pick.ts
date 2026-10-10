import { type ReadonlySignal, type Signal, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	clampCrop,
	type CropState,
	formatLimit,
	INITIAL_CROP,
	type LibraryAsset,
	libraryLimitFor,
	RENDITION_ASPECT,
	RENDITION_SHAPE,
} from "@projective/types/files";
import type { OAuthAvatarSource } from "@projective/types/user";
import { MediaService, putToTicket } from "../core/MediaService.ts";
import { extractMetadata } from "../core/media/extract.ts";
import {
	assignSlots,
	type CropCandidate,
	cycleIndex,
	type MediaCropChoice,
	type MediaPickConfig,
	type PickItem,
	toggleSelection,
} from "../core/media/media-pick.ts";

/** The media mode's state and actions, as the File Picker and its crop workspace share them. */
export interface MediaPickState {
	/** The chosen sources, in the order they were chosen. */
	items: Signal<PickItem[]>;
	/** The item being framed, in the crop phase. */
	active: Signal<number>;
	phase: Signal<"browse" | "crop">;
	/** The active item's source while cropping; `null` while browsing. */
	candidate: ReadonlySignal<CropCandidate | null>;
	/** The active item's working crop and description. */
	crop: Signal<CropState>;
	alt: Signal<string>;
	/** Staging or saving in progress, in words; `null` when idle. */
	status: Signal<string | null>;
	/** The last refusal or failure, in words. */
	error: Signal<string | null>;
	saving: Signal<boolean>;
	/** The rotation ruler or a readout is being dragged (the thirds guides strengthen). */
	adjusting: Signal<boolean>;
	signIn: Signal<OAuthAvatarSource | null>;
	signInLoaded: Signal<boolean>;
	/** Choose or un-choose a source; answers the refusal sentence, or `null`. */
	toggle: (candidate: CropCandidate) => string | null;
	remove: (id: string) => void;
	/** Hold device files in memory as choices — nothing is uploaded until {@link save}. */
	stageFiles: (files: File[]) => Promise<void>;
	/** Choose the sign-in picture (a preview; it is copied in only on {@link save}). */
	pickSignIn: () => Promise<void>;
	/** Browse → Crop. Answers a refusal sentence, or `null`. */
	proceed: () => string | null;
	/** Crop → Browse, keeping the choices and their framing. */
	back: () => void;
	go: (index: number) => void;
	step: (dir: 1 | -1) => void;
	update: (patch: Partial<CropState>) => void;
	reset: () => void;
	loadSignIn: () => Promise<void>;
	/** Send every staged source through the pipeline, then apply. `true` when the picker may close. */
	save: () => Promise<boolean>;
}

/** A source that now exists in the library: its id, a previewable URL and its decoded size. */
interface Materialized {
	id: string;
	preview: string;
	width: number;
	height: number;
}

const SIGN_IN_ID = "signin";

/**
 * The File Picker's media mode: up to `config.max` sources, chosen in Browse and framed one by one
 * in Crop. Device files and the sign-in picture are held as PREVIEWS — object URLs in this tab — and
 * reach `files.items` only when Save & Apply sends them through the quarantine pipeline; closing the
 * picker revokes them and leaves nothing behind. Every open starts fresh. Inert while `config` is
 * `null`.
 */
export function useMediaPick(config: MediaPickConfig | null, open: boolean): MediaPickState {
	const items = useSignal<PickItem[]>([]);
	const active = useSignal(0);
	const phase = useSignal<"browse" | "crop">("browse");
	const crop = useSignal<CropState>(INITIAL_CROP);
	const alt = useSignal("");
	const status = useSignal<string | null>(null);
	const error = useSignal<string | null>(null);
	const saving = useSignal(false);
	const adjusting = useSignal(false);
	const signIn = useSignal<OAuthAvatarSource | null>(null);
	const signInLoaded = useSignal(false);
	const seq = useRef(0);
	const configRef = useRef(config);
	configRef.current = config;
	const objectUrls = useRef(new Set<string>());

	const candidate = useComputed(() =>
		phase.value === "crop" ? items.value[active.value]?.candidate ?? null : null
	);

	function revokeAll(): void {
		for (const url of objectUrls.current) URL.revokeObjectURL(url);
		objectUrls.current.clear();
	}

	useEffect(() => {
		seq.current++;
		revokeAll();
		if (!open || !config) return;
		items.value = [];
		active.value = 0;
		phase.value = "browse";
		crop.value = INITIAL_CROP;
		alt.value = config.initialAlt ?? "";
		status.value = null;
		error.value = null;
		saving.value = false;
		adjusting.value = false;
		signIn.value = null;
		signInLoaded.value = false;
	}, [open, config !== null]);

	useEffect(() => () => revokeAll(), []);

	// #region Selection
	function release(item: PickItem | undefined): void {
		if (item?.candidate.origin.kind !== "staged") return;
		URL.revokeObjectURL(item.candidate.src);
		objectUrls.current.delete(item.candidate.src);
	}

	function toggle(next: CropCandidate): string | null {
		const c = configRef.current;
		if (!c) return null;
		const before = items.peek();
		const result = toggleSelection(before, next, c.max, c.initialAlt ?? "");
		if ("refusal" in result) return result.refusal;
		for (const gone of before) {
			if (!result.items.some((i) => i.candidate.id === gone.candidate.id)) release(gone);
		}
		items.value = result.items;
		error.value = null;
		return c.max <= 1 && result.items.length === 1 ? proceed() : null;
	}

	function remove(id: string): void {
		const gone = items.peek().find((i) => i.candidate.id === id);
		if (!gone) return;
		release(gone);
		items.value = items.peek().filter((i) => i.candidate.id !== id);
		if (active.peek() >= items.peek().length) active.value = Math.max(0, items.peek().length - 1);
		if (items.peek().length === 0) phase.value = "browse";
	}

	async function stageFiles(files: File[]): Promise<void> {
		const c = configRef.current;
		if (!c) return;
		const my = seq.current;
		error.value = null;
		for (const file of files) {
			if (c.max > 1 && items.peek().length >= c.max) {
				error.value = `You have ${c.max} empty slots — the rest of those files were left out.`;
				break;
			}
			const isVideo = file.type.startsWith("video/");
			const limit = libraryLimitFor(file.type);
			if (limit === null || (isVideo && !c.allowVideo)) {
				error.value = isVideo ? "This takes a still picture." : "Choose a picture or a video.";
				continue;
			}
			if (file.size > limit) {
				error.value = `${file.name} is larger than ${formatLimit(limit)}.`;
				continue;
			}
			const url = URL.createObjectURL(file);
			const size = isVideo ? await videoSize(url) : await imageSize(url);
			if (my !== seq.current) {
				URL.revokeObjectURL(url);
				return;
			}
			if (!size) {
				URL.revokeObjectURL(url);
				error.value = `${file.name} couldn't be read. Upload a JPG, PNG, WebP or GIF.`;
				continue;
			}
			objectUrls.current.add(url);
			toggle({
				id: `staged:${crypto.randomUUID()}`,
				name: file.name,
				kind: isVideo ? "video" : "image",
				src: url,
				width: size.width,
				height: size.height,
				poster: null,
				origin: { kind: "staged", file },
			});
			if (c.max <= 1) break;
		}
	}

	async function pickSignIn(): Promise<void> {
		const c = configRef.current;
		const url = signIn.peek()?.url;
		if (!c || !url) return;
		if (items.peek().some((i) => i.candidate.id === SIGN_IN_ID)) {
			remove(SIGN_IN_ID);
			return;
		}
		const size = await imageSize(url);
		if (!size) {
			error.value = "Your sign-in picture couldn't be loaded. Upload one instead.";
			return;
		}
		const refusal = toggle({
			id: SIGN_IN_ID,
			name: `${signIn.peek()?.label ?? "Sign-in"} picture`,
			kind: "image",
			src: url,
			width: size.width,
			height: size.height,
			poster: null,
			origin: { kind: "signin" },
		});
		if (refusal) error.value = refusal;
	}
	// #endregion

	// #region Phases + carousel
	function commit(): void {
		const i = active.peek();
		const list = items.peek();
		if (phase.peek() !== "crop" || !list[i]) return;
		items.value = list.map((
			item,
			n,
		) => (n === i ? { ...item, crop: crop.peek(), alt: alt.peek() } : item));
	}

	function load(index: number): void {
		const item = items.peek()[index];
		active.value = index;
		crop.value = item?.crop ?? INITIAL_CROP;
		alt.value = item?.alt ?? "";
	}

	function proceed(): string | null {
		const c = configRef.current;
		const list = items.peek();
		if (!c || list.length === 0) return null;
		if (c.target === "showcase") {
			const slots = assignSlots(list, c.positions);
			if ("refusal" in slots) {
				error.value = slots.refusal;
				return slots.refusal;
			}
		}
		phase.value = "crop";
		load(0);
		error.value = null;
		return null;
	}

	/** Multi-select keeps the choices and their framing; a single pick is let go, to choose again. */
	function back(): void {
		if ((configRef.current?.max ?? 1) <= 1) {
			for (const item of items.peek()) release(item);
			items.value = [];
		} else {
			commit();
		}
		phase.value = "browse";
		error.value = null;
	}

	function go(index: number): void {
		if (index === active.peek() || !items.peek()[index]) return;
		commit();
		load(index);
	}

	function step(dir: 1 | -1): void {
		go(cycleIndex(active.peek(), items.peek().length, dir));
	}

	function update(patch: Partial<CropState>): void {
		const c = configRef.current;
		const pick = candidate.peek();
		if (!c || !pick || pick.kind !== "image") return;
		crop.value = clampCrop(
			{ ...crop.peek(), ...patch },
			{ width: pick.width, height: pick.height },
			RENDITION_ASPECT[c.target],
			RENDITION_SHAPE[c.target],
		);
	}

	function reset(): void {
		update(INITIAL_CROP);
	}
	// #endregion

	// #region Sign-in source
	async function loadSignIn(): Promise<void> {
		if (signInLoaded.peek()) return;
		const my = seq.current;
		const res = await MediaService.oauthAvatar();
		if (my !== seq.current) return;
		signInLoaded.value = true;
		if (res.ok && res.data) signIn.value = res.data;
		else error.value = res.message ?? "Your sign-in account couldn't be read.";
	}
	// #endregion

	// #region Save
	async function uploadStaged(
		file: File,
		label: string,
		my: number,
	): Promise<Materialized | string> {
		const isVideo = file.type.startsWith("video/");
		const posterRead = isVideo ? extractMetadata(file) : null;
		const init = await MediaService.uploadInit({
			name: file.name,
			mimeType: file.type || "application/octet-stream",
			sizeBytes: file.size,
		});
		if (!init.ok || !init.data) return init.message ?? "The upload couldn't start.";
		const sent = await putToTicket(init.data, file, (f) => {
			if (my === seq.current) status.value = `${label} — ${Math.round(f * 100)}%`;
		});
		if (!sent) return "The upload didn't finish. Check your connection and try again.";
		let posterDataUrl: string | null = null;
		let durationMs: number | null = null;
		if (posterRead) {
			const meta = await posterRead;
			if (meta.media.kind === "video") {
				posterDataUrl = meta.media.posterDataUrl;
				durationMs = meta.media.durationMs;
			}
		}
		const done = await MediaService.uploadComplete({
			assetId: init.data.assetId,
			posterDataUrl,
			durationMs,
		});
		return done.ok && done.data
			? fromLibrary(done.data)
			: done.message ?? `${file.name} couldn't be used.`;
	}

	async function materialize(
		item: PickItem,
		label: string,
		my: number,
	): Promise<Materialized | string> {
		const origin = item.candidate.origin;
		if (origin.kind === "library") {
			const { id, src, width, height } = item.candidate;
			return { id, preview: src, width, height };
		}
		status.value = label;
		if (origin.kind === "staged") return await uploadStaged(origin.file, label, my);
		const res = await MediaService.syncOAuthAvatar();
		return res.ok && res.data
			? fromLibrary(res.data)
			: res.message ?? "Your sign-in picture couldn't be brought in.";
	}

	async function save(): Promise<boolean> {
		const c = configRef.current;
		if (!c || saving.peek() || items.peek().length === 0) return false;
		commit();
		const my = seq.current;
		const slots = c.target === "showcase" ? assignSlots(items.peek(), c.positions) : null;
		if (slots && "refusal" in slots) {
			error.value = slots.refusal;
			return false;
		}
		saving.value = true;
		error.value = null;
		const choices: MediaCropChoice[] = [];
		const list = items.peek();
		for (let i = 0; i < list.length; i++) {
			const item = list[i];
			const label = list.length > 1 ? `Uploading ${i + 1} of ${list.length}` : "Uploading";
			const made = await materialize(item, label, my);
			if (my !== seq.current) return false;
			if (typeof made === "string") {
				status.value = null;
				saving.value = false;
				error.value = made;
				return false;
			}
			if (item.candidate.origin.kind !== "library") {
				release(item);
				items.value = items.peek().map((it, n) =>
					n === i
						? {
							...it,
							candidate: {
								...it.candidate,
								id: made.id,
								src: made.preview,
								width: made.width,
								height: made.height,
								origin: { kind: "library" },
							},
							crop: rescale(it.crop, it.candidate, made),
						}
						: it
				);
			}
			const saved = items.peek()[i];
			choices.push({
				sourceAssetId: made.id,
				crop: saved.candidate.kind === "image" ? saved.crop : undefined,
				alt: c.target === "showcase" ? saved.alt.trim() : undefined,
				previewUrl: made.preview,
				position: slots && "slots" in slots ? slots.slots[i] : undefined,
			});
		}
		status.value = list.length > 1 ? "Applying…" : null;
		const message = await c.onSave(choices);
		status.value = null;
		saving.value = false;
		if (message) {
			error.value = message;
			return false;
		}
		return true;
	}
	// #endregion

	return {
		items,
		active,
		phase,
		candidate,
		crop,
		alt,
		status,
		error,
		saving,
		adjusting,
		signIn,
		signInLoaded,
		toggle,
		remove,
		stageFiles,
		pickSignIn,
		proceed,
		back,
		go,
		step,
		update,
		reset,
		loadSignIn,
		save,
	};
}

// #region Helpers
function fromLibrary(asset: LibraryAsset): Materialized {
	return {
		id: asset.id,
		preview: asset.kind === "image" ? asset.preview || asset.src : asset.src,
		width: asset.width,
		height: asset.height,
	};
}

/** Carry a crop framed on the browser's decode over to the size the server decoded. */
function rescale(
	state: CropState,
	from: { width: number; height: number },
	to: Materialized,
): CropState {
	if (from.width === to.width || from.width <= 0) return state;
	const k = to.width / from.width;
	return { ...state, cx: state.cx * k, cy: state.cy * k };
}

function imageSize(url: string): Promise<{ width: number; height: number } | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () =>
			resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
		img.onerror = () => resolve(null);
		img.src = url;
	});
}

function videoSize(url: string): Promise<{ width: number; height: number } | null> {
	return new Promise((resolve) => {
		const video = document.createElement("video");
		video.preload = "metadata";
		video.muted = true;
		video.onloadedmetadata = () =>
			resolve(video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : null);
		video.onerror = () => resolve(null);
		video.src = url;
	});
}
// #endregion
