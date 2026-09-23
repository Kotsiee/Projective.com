import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Button, InputText, Knob, SelectButton, Slider } from "@projective/ui/fields";
import { ProgressiveImage } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import {
	clampCrop,
	CROP_ROTATION_MAX,
	CROP_ROTATION_MIN,
	CROP_ZOOM_MAX,
	CROP_ZOOM_MIN,
	type CropImage,
	type CropState,
	dragCentre,
	formatLimit,
	INITIAL_CROP,
	type LibraryAsset,
	type LibraryKind,
	libraryLimitFor,
	RENDITION_ASPECT,
	stageTransform,
	wheelZoom,
} from "@projective/types/files";
import { extractMetadata } from "@web/features/files/core/media/extract.ts";
import { MediaService, putToTicket } from "../../core/MediaService.ts";
import { type ProfileMediaState, ProfileService } from "../../core/ProfileService.ts";

/**
 * MediaCropModal — the Media Selection & Crop dialog behind every profile image: the profile photo
 * and each of the six showcase slots.
 *
 * RIGHT is the person's own media library — stills by default, videos behind a filter where the
 * target can take one (showcase slots 2–6; the photo and slot 1 are always stills) — plus Upload,
 * which runs the quarantine flow (`/api/media/upload-*`): the bytes go straight to storage, the server
 * inspects and processes them, and the finished asset lands at the top of the grid, selected.
 *
 * LEFT is the cropper for the selected still, locked to the target's aspect (1:1 for the photo,
 * 16:10 for a showcase slot): drag to move, Ctrl + wheel or the slider to zoom, the dial to rotate,
 * arrow keys and +/− from the keyboard, and **Reset** back to the whole picture. The crop is not
 * drawn into pixels here — it is sent as the four numbers of the shared crop model
 * (`@projective/types/files` `crop.ts`) and the server cuts the rendition from the ORIGINAL with the
 * same arithmetic, so what was framed is what is published, at full resolution. A selected video is
 * shown, not cropped: it is published as uploaded.
 *
 * Every gesture and control writes through `clampCrop`, so the box can never show empty space.
 */
export interface MediaCropModalProps {
	open: Signal<boolean>;
	/** The profile's `@handle` — where the result is applied. */
	handle: string;
	target: "avatar" | "showcase";
	/** The showcase slot (1–6) being filled. */
	position?: number;
	/** The slot's current alternative text, when replacing. */
	initialAlt?: string;
	/** Called with the profile's media as stored after a successful apply. */
	onApplied: (state: ProfileMediaState) => void;
}

interface UploadRow {
	key: string;
	name: string;
	progress: number;
	error: string | null;
}

/** Margin of context shown around the crop box, as a fraction of the stage width. */
const STAGE_MARGIN = 0.07;
/** Keyboard nudge, in stage pixels (Shift for a larger step). */
const NUDGE_PX = 8;
const NUDGE_PX_LARGE = 40;

export function MediaCropModal(props: MediaCropModalProps): JSX.Element {
	const { open, handle, target, position } = props;
	const aspect = RENDITION_ASPECT[target];
	const allowVideo = target === "showcase" && position !== 1;

	const kind = useSignal<LibraryKind>("image");
	const items = useSignal<LibraryAsset[]>([]);
	const cursor = useSignal<string | null>(null);
	const loading = useSignal(false);
	const listError = useSignal<string | null>(null);
	const selected = useSignal<LibraryAsset | null>(null);
	const crop = useSignal<CropState>(INITIAL_CROP);
	const alt = useSignal(props.initialAlt ?? "");
	const uploads = useSignal<UploadRow[]>([]);
	const saving = useSignal(false);
	const saveError = useSignal<string | null>(null);
	const stageWidth = useSignal(0);
	const dragging = useSignal(false);
	const zoomCtl = useSignal(INITIAL_CROP.zoom);
	const rotationCtl = useSignal(INITIAL_CROP.rotation);

	const stageRef = useRef<HTMLDivElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
	const loadSeq = useRef(0);

	const isOpen = open.value;
	const pick = selected.value;
	const still = pick?.kind === "image" ? pick : null;
	const image: CropImage | null = still ? { width: still.width, height: still.height } : null;

	// #region Library
	async function loadPage(reset: boolean): Promise<void> {
		const seq = ++loadSeq.current;
		loading.value = true;
		listError.value = null;
		const res = await MediaService.library(kind.peek(), reset ? null : cursor.peek());
		if (seq !== loadSeq.current) return;
		loading.value = false;
		if (!res.ok || !res.data) {
			listError.value = res.message ?? "Your library couldn't be loaded.";
			return;
		}
		items.value = reset ? res.data.items : [...items.peek(), ...res.data.items];
		cursor.value = res.data.nextCursor;
	}

	// Every open starts fresh: stills first, nothing selected, the crop at rest.
	useEffect(() => {
		if (!isOpen) return;
		kind.value = "image";
		selected.value = null;
		crop.value = INITIAL_CROP;
		alt.value = props.initialAlt ?? "";
		saveError.value = null;
		uploads.value = [];
		void loadPage(true);
		return () => {
			loadSeq.current++;
		};
	}, [isOpen]);

	function switchKind(next: LibraryKind): void {
		if (next === kind.peek()) return;
		kind.value = next;
		items.value = [];
		cursor.value = null;
		void loadPage(true);
	}

	function choose(asset: LibraryAsset): void {
		selected.value = asset;
		crop.value = INITIAL_CROP;
		saveError.value = null;
	}
	// #endregion

	// #region Upload
	function patchRow(key: string, patch: Partial<UploadRow>): void {
		uploads.value = uploads.peek().map((r) => (r.key === key ? { ...r, ...patch } : r));
	}

	async function upload(file: File): Promise<void> {
		const key = crypto.randomUUID();
		uploads.value = [...uploads.peek(), { key, name: file.name, progress: 0, error: null }];
		const isVideo = file.type.startsWith("video/");
		const limit = libraryLimitFor(file.type);
		if (limit === null || (isVideo && !allowVideo)) {
			patchRow(key, {
				error: isVideo ? "This slot takes a still image." : "Choose a picture or a video.",
			});
			return;
		}
		if (file.size > limit) {
			patchRow(key, { error: `This file is larger than ${formatLimit(limit)}.` });
			return;
		}
		// A video's poster is the one thing the server cannot read for itself; capture it alongside.
		const posterRead = isVideo ? extractMetadata(file) : null;
		const init = await MediaService.uploadInit({
			name: file.name,
			mimeType: file.type || "application/octet-stream",
			sizeBytes: file.size,
		});
		if (!init.ok || !init.data) {
			patchRow(key, { error: init.message ?? "The upload couldn't start." });
			return;
		}
		const sent = await putToTicket(init.data, file, (f) => patchRow(key, { progress: f }));
		if (!sent) {
			patchRow(key, { error: "The upload didn't finish. Check your connection and try again." });
			return;
		}
		patchRow(key, { progress: 1 });
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
		if (!done.ok || !done.data) {
			patchRow(key, { error: done.message ?? "That file couldn't be used." });
			return;
		}
		uploads.value = uploads.peek().filter((r) => r.key !== key);
		const asset = done.data;
		// The new asset joins the grid it belongs in, at the top, and becomes the selection.
		if (asset.kind === kind.peek() || kind.peek() === "all") {
			items.value = [asset, ...items.peek().filter((a) => a.id !== asset.id)];
		} else {
			kind.value = asset.kind;
			items.value = [asset];
			cursor.value = null;
			void loadPage(true);
		}
		choose(asset);
	}

	function onFiles(files: FileList | null): void {
		if (!files) return;
		for (const file of Array.from(files).slice(0, 6)) void upload(file);
	}

	function onDrop(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
		e.preventDefault();
		onFiles(e.dataTransfer?.files ?? null);
	}
	// #endregion

	// #region Stage geometry + gestures
	const W = stageWidth.value;
	const margin = Math.round(W * STAGE_MARGIN);
	const boxW = Math.max(1, W - 2 * margin);
	const boxH = boxW / aspect;
	const stageH = boxH + 2 * margin;

	useEffect(() => {
		const el = stageRef.current;
		if (!el || !isOpen) return;
		const measure = () => {
			const w = el.getBoundingClientRect().width;
			if (w > 0 && w !== stageWidth.peek()) stageWidth.value = w;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [isOpen, still?.id]);

	function update(patch: Partial<CropState>): void {
		if (!image) return;
		crop.value = clampCrop({ ...crop.peek(), ...patch }, image, aspect);
	}

	useSignalEffect(() => {
		const s = crop.value;
		if (zoomCtl.peek() !== s.zoom) zoomCtl.value = s.zoom;
		if (rotationCtl.peek() !== s.rotation) rotationCtl.value = s.rotation;
	});

	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (!image || e.button !== 0) return;
		e.preventDefault();
		try {
			e.currentTarget.setPointerCapture(e.pointerId);
		} catch {
			return;
		}
		pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
		dragging.value = true;
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const p = pointer.current;
		if (!p || p.id !== e.pointerId || !image) return;
		const dx = e.clientX - p.x;
		const dy = e.clientY - p.y;
		p.x = e.clientX;
		p.y = e.clientY;
		update(dragCentre(crop.peek(), image, aspect, boxW, dx, dy));
	}

	function onPointerUp(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const p = pointer.current;
		if (!p || p.id !== e.pointerId) return;
		pointer.current = null;
		dragging.value = false;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		if (!image) return;
		const step = e.shiftKey ? NUDGE_PX_LARGE : NUDGE_PX;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [step, 0],
			ArrowRight: [-step, 0],
			ArrowUp: [0, step],
			ArrowDown: [0, -step],
		};
		const move = moves[e.key];
		if (move) {
			e.preventDefault();
			update(dragCentre(crop.peek(), image, aspect, boxW, move[0], move[1]));
			return;
		}
		if (e.key === "+" || e.key === "=") {
			e.preventDefault();
			update({ zoom: crop.peek().zoom * 1.1 });
		} else if (e.key === "-" || e.key === "_") {
			e.preventDefault();
			update({ zoom: crop.peek().zoom / 1.1 });
		}
	}

	// Attached by hand so `{ passive: false }` is explicit: a wheel listener that cannot cancel the
	// event zooms the page instead of the picture.
	useEffect(() => {
		const el = stageRef.current;
		if (!el || !isOpen) return;
		const onWheel = (e: WheelEvent) => {
			if (!(e.ctrlKey || e.metaKey) || !image) return;
			e.preventDefault();
			update({ zoom: wheelZoom(crop.peek().zoom, e.deltaY, e.deltaMode) });
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [isOpen, still?.id]);
	// #endregion

	// #region Save
	async function save(): Promise<void> {
		const asset = selected.peek();
		if (!asset || saving.peek()) return;
		saving.value = true;
		saveError.value = null;
		const res = await ProfileService.applyMedia(handle, {
			target,
			position: target === "showcase" ? position : undefined,
			sourceAssetId: asset.id,
			crop: asset.kind === "image" ? crop.peek() : undefined,
			alt: target === "showcase" ? alt.peek().trim() : undefined,
		});
		saving.value = false;
		if (!res.ok || !res.data) {
			saveError.value = res.message ?? "That couldn't be applied. Try again.";
			return;
		}
		props.onApplied(res.data);
		open.value = false;
	}
	// #endregion

	const transform = image && W > 0 ? stageTransform(crop.value, image, aspect, boxW) : null;
	const imgStyle = image && transform
		? `inline-size:${image.width}px;block-size:${image.height}px;` +
			`margin-left:${-image.width / 2}px;margin-top:${-image.height / 2}px;` +
			`transform:translate(${transform.tx}px,${transform.ty}px) rotate(${transform.rotation}deg) scale(${transform.scale})`
		: undefined;
	const changed = crop.value.zoom !== INITIAL_CROP.zoom || crop.value.rotation !== INITIAL_CROP.rotation ||
		crop.value.cx !== INITIAL_CROP.cx || crop.value.cy !== INITIAL_CROP.cy;
	const title = target === "avatar" ? "Profile photo" : `Showcase slot ${position ?? 1}`;

	const footer = (
		<>
			<Button variant="text" class="pf-media__ghost" onClick={() => (open.value = false)}>
				Cancel
			</Button>
			<Button
				class="pf-media__save"
				disabled={!pick || saving.value}
				loading={saving.value}
				onClick={() => void save()}
			>
				{target === "avatar" ? "Save photo" : "Save to slot"}
			</Button>
		</>
	);

	return (
		<Dialog
			visible={open}
			header={title}
			footer={footer}
			dismissableMask={false}
			class="pf-mediadlg"
		>
			<div class="pf-mediascope">
				<div class="pf-media">
					{/* #region The selected item */}
					<div class="pf-media__edit">
						{!pick && (
							<div class="pf-media__empty">
								<Icon name="image" size="lg" class="pf-media__empty-icon" />
								<p class="pf-media__empty-text">
									Choose {allowVideo ? "a picture or a video" : "a picture"} from your library, or
									upload one.
								</p>
							</div>
						)}

						{pick?.kind === "video" && (
							<div class="pf-media__video">
								<video
									class="pf-media__videoel"
									src={pick.src}
									poster={pick.preview || undefined}
									controls
									muted
									playsInline
									preload="metadata"
								/>
								<p class="pf-media__hint">Videos are shown as uploaded — no cropping.</p>
							</div>
						)}

						{still && (
							<>
								<div
									ref={stageRef}
									class={`pf-media__stage pf-media__stage--${target}`}
									style={W > 0 ? `block-size:${stageH}px` : undefined}
									tabIndex={0}
									role="img"
									aria-label={`${title}: crop preview. Drag or use the arrow keys to move, plus and minus to zoom.`}
									data-dragging={dragging.value ? "true" : undefined}
									onPointerDown={onPointerDown}
									onPointerMove={onPointerMove}
									onPointerUp={onPointerUp}
									onPointerCancel={onPointerUp}
									onKeyDown={onKeyDown}
								>
									{imgStyle && (
										<img
											class="pf-media__img"
											src={still.preview}
											alt=""
											draggable={false}
											style={imgStyle}
										/>
									)}
									<span
										class="pf-media__window"
										aria-hidden="true"
										style={`inset:${margin}px`}
									/>
								</div>
								<p class="pf-media__hint">Drag to move · Ctrl + scroll to zoom</p>

								<div class="pf-media__controls">
									<div class="pf-media__row">
										<span class="pf-media__label">Zoom</span>
										<Slider
											size="sm"
											class="pf-media__slider"
											value={zoomCtl}
											min={CROP_ZOOM_MIN}
											max={CROP_ZOOM_MAX}
											step={0.01}
											aria-label="Zoom"
											formatValue={(v) => `${v.toFixed(2)}×`}
											onValueChange={(v) => {
												if (typeof v === "number") update({ zoom: v });
											}}
										/>
										<span class="pf-media__value" aria-hidden="true">
											{crop.value.zoom.toFixed(2)}×
										</span>
									</div>
									<div class="pf-media__row pf-media__row--dial">
										<span class="pf-media__label">Rotate</span>
										<Knob
											class="pf-media__dial"
											value={rotationCtl}
											min={CROP_ROTATION_MIN}
											max={CROP_ROTATION_MAX}
											step={1}
											diameter={64}
											strokeWidth={9}
											valueColor="var(--on-surface)"
											rangeColor="var(--surface-2)"
											valueTemplate="{value}°"
											aria-label="Rotation"
											onValueChange={(v) => update({ rotation: v })}
										/>
										<Button
											size="sm"
											variant="text"
											class="pf-media__ghost pf-media__reset"
											disabled={!changed}
											icon={<Icon name="refresh" size="sm" />}
											onClick={() => update(INITIAL_CROP)}
										>
											Reset
										</Button>
									</div>
								</div>
							</>
						)}

						{pick && target === "showcase" && (
							<label class="pf-media__alt">
								<span class="pf-media__label">Description</span>
								<InputText
									value={alt}
									maxLength={200}
									placeholder="What does this show? (for people who can't see it)"
									fluid
									size="sm"
									onValueChange={(v) => (alt.value = v)}
								/>
							</label>
						)}
						{saveError.value && <p class="pf-media__error" role="alert">{saveError.value}</p>}
					</div>
					{/* #endregion */}

					{/* #region The library */}
					<div
						class="pf-media__library"
						onDragOver={(e) => e.preventDefault()}
						onDrop={onDrop}
					>
						<div class="pf-media__bar">
							{allowVideo
								? (
									<SelectButton
										size="sm"
										options={[
											{ label: "Images", value: "image" },
											{ label: "Videos", value: "video" },
										]}
										value={kind.value}
										aria-label="Show"
										onValueChange={(v) => {
											if (typeof v === "string") switchKind(v as LibraryKind);
										}}
									/>
								)
								: <h3 class="pf-media__h">Your images</h3>}
							<Button
								size="sm"
								variant="outlined"
								class="pf-media__upload"
								icon={<Icon name="upload" size="sm" />}
								onClick={() => fileRef.current?.click()}
							>
								Upload
							</Button>
							<input
								ref={fileRef}
								type="file"
								accept={allowVideo ? "image/*,video/mp4,video/webm,video/quicktime" : "image/*"}
								multiple
								class="ui-visually-hidden"
								tabIndex={-1}
								aria-hidden="true"
								onChange={(e) => {
									onFiles(e.currentTarget.files);
									e.currentTarget.value = "";
								}}
							/>
						</div>

						{uploads.value.length > 0 && (
							<ul class="pf-media__uploads" role="list" aria-live="polite">
								{uploads.value.map((u) => (
									<li class="pf-media__uploadrow" key={u.key} data-state={u.error ? "error" : "busy"}>
										<span class="pf-media__uploadname">{u.name}</span>
										{u.error
											? <span class="pf-media__uploaderr">{u.error}</span>
											: (
												<span class="pf-media__uploadmeter" aria-label={`Uploading ${Math.round(u.progress * 100)}%`}>
													<span
														class="pf-media__uploadfill"
														style={`inline-size:${Math.round(u.progress * 100)}%`}
													/>
												</span>
											)}
									</li>
								))}
							</ul>
						)}

						{listError.value && <p class="pf-media__error" role="alert">{listError.value}</p>}

						{items.value.length === 0 && !loading.value && !listError.value
							? (
								<p class="pf-media__note">
									Nothing here yet — upload {kind.value === "video" ? "a video" : "a picture"} or drop it
									here.
								</p>
							)
							: (
								<ul class="pf-media__grid" role="list" aria-label="Your library">
									{items.value.map((a) => (
										<li key={a.id} class="pf-media__cell">
											<button
												type="button"
												aria-pressed={pick?.id === a.id ? "true" : "false"}
												class="pf-media__tile"
												aria-label={a.kind === "video" ? `${a.name}, video` : a.name}
												onClick={() => choose(a)}
											>
												<ProgressiveImage
													src={a.thumb}
													alt=""
													placeholder={a.placeholder ?? null}
													loading="lazy"
												/>
												{a.kind === "video" && (
													<span class="pf-media__tilemark" aria-hidden="true">
														<Icon name="play" size="xs" filled />
													</span>
												)}
											</button>
										</li>
									))}
								</ul>
							)}

						{cursor.value && (
							<Button
								size="sm"
								variant="text"
								class="pf-media__ghost pf-media__more"
								loading={loading.value}
								onClick={() => void loadPage(false)}
							>
								Show more
							</Button>
						)}
					</div>
					{/* #endregion */}
				</div>
			</div>
		</Dialog>
	);
}
