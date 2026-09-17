import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Button, Knob, NumberInput, Slider } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import {
	centreBounds,
	centreFromOffset,
	clampState,
	CROP_OUTPUT_PX,
	CROP_ROTATION_MAX,
	CROP_ROTATION_MIN,
	CROP_ZOOM_MAX,
	CROP_ZOOM_MIN,
	type CropImage,
	type CropState,
	dragCentre,
	exportTransform,
	INITIAL_CROP,
	offsetOf,
	stageTransform,
	wheelZoom,
} from "../core/crop-model.ts";

/**
 * AvatarEditor — the two-column "Edit profile photo" dialog.
 *
 * LEFT is the crop canvas: the picture behind a circular viewport, the surround darkened and
 * blurred (a `::before` scrim over photography, §B.4.3) so the circle reads as the result. Press and
 * drag to pan — the scrim lifts while the pointer is down so the whole picture can be judged — and
 * Ctrl + wheel to zoom. Beneath it the manual controls: a zoom slider, a rotation dial, and an X/Y
 * offset pair (a slider beside a number box, bound to one value). RIGHT is where a different
 * picture comes from: this device, or the person's own file library through the shared Asset
 * Picker, mounted INSIDE the dialog so the overlay registry names the dialog as its opener.
 *
 * # One invariant, one implementation
 *
 * Every gesture and every control writes through `clampState` (`crop-model.ts`), so the circle can
 * never show empty space or leave the picture — the pan, the wheel, the dial and the typed number
 * all land in the same legal region, and there is no second arithmetic path to disagree. The stage
 * only DRAWS the state; it decides nothing.
 *
 * # What Save produces
 *
 * A {@link CROP_OUTPUT_PX}-square PNG drawn with the same transform the stage showed, handed back
 * as an object URL. Drawing needs the picture's pixels, which a cross-origin host only grants with
 * CORS: the picture is loaded once in CORS mode for that purpose and, where the host refuses,
 * loaded plainly for the PREVIEW alone — Save then applies the picture uncropped and says so,
 * because a crop the browser will not let us read cannot be honestly claimed to have been applied.
 *
 * The dialog is controlled by the host's `open` signal and resets to the current picture on every
 * open; nothing here persists — the host owns the optimistic edit, pending the profile write path.
 */
export interface AvatarEditorProps {
	open: Signal<boolean>;
	/** The picture the dialog opens on — the current avatar. */
	source: string;
	/** The entity's name, for the accessible descriptions. */
	name: string;
	/**
	 * The edited picture as a URL to adopt, and a note when the result is NOT the crop that was
	 * shown (the host would not release its pixels). `null` note = the crop was applied.
	 */
	onSave: (url: string, note: string | null) => void;
}

const PICKER_ID = "profile-avatar-source";
/** The stage's diameter before it has been measured — the sheet's `min(100%, 20rem)` at 16px. */
const FALLBACK_DIAMETER = 320;
const UNCROPPED_NOTE =
	"Saved without cropping — this picture's host doesn't allow editing it here. Upload it from your device to crop it.";

interface LoadedPicture {
	/** The element the export draws from; `null` while nothing has loaded. */
	element: HTMLImageElement;
	image: CropImage;
	/** Whether the pixels can be read back (a same-origin or CORS-granted load). */
	exportable: boolean;
}

export function AvatarEditor({ open, source, name, onSave }: AvatarEditorProps): JSX.Element {
	const picture = useSignal<string>(source);
	const loaded = useSignal<LoadedPicture | null>(null);
	const failed = useSignal(false);
	const crop = useSignal<CropState>(INITIAL_CROP);
	const diameter = useSignal(FALLBACK_DIAMETER);
	const dragging = useSignal(false);
	const saving = useSignal(false);

	// The manual controls' own signals — each control is controlled through one, and the model is
	// pushed into all of them below, so a drag, a wheel or a clamp shows up on every control at once.
	const zoomCtl = useSignal(INITIAL_CROP.zoom);
	const rotationCtl = useSignal(INITIAL_CROP.rotation);
	const xCtl = useSignal(0);
	const yCtl = useSignal(0);
	const xBox = useSignal<number | null>(0);
	const yBox = useSignal<number | null>(0);

	const stageRef = useRef<HTMLDivElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
	const loadSeq = useRef(0);
	const objectUrls = useRef<string[]>([]);

	const isOpen = open.value;
	const current = loaded.value;
	const image = current?.image ?? null;
	const D = diameter.value;

	// #region Picture loading
	function adopt(seq: number, element: HTMLImageElement, exportable: boolean): void {
		if (seq !== loadSeq.current) return;
		const image = { width: element.naturalWidth, height: element.naturalHeight };
		loaded.value = { element, image, exportable };
		failed.value = false;
		crop.value = clampState(crop.peek(), image, diameter.peek());
	}

	/**
	 * Load in CORS mode first — the only mode whose pixels a canvas may read back — and fall back to
	 * a plain load for the preview when the host declines. A stale load (the picture changed while
	 * one was in flight) is dropped by its sequence number rather than adopted late.
	 */
	function load(url: string): void {
		const seq = ++loadSeq.current;
		loaded.value = null;
		failed.value = false;
		const cors = new Image();
		cors.crossOrigin = "anonymous";
		cors.decoding = "async";
		cors.onload = () => adopt(seq, cors, true);
		cors.onerror = () => {
			if (seq !== loadSeq.current) return;
			const plain = new Image();
			plain.decoding = "async";
			plain.onload = () => adopt(seq, plain, false);
			plain.onerror = () => {
				if (seq === loadSeq.current) failed.value = true;
			};
			plain.src = url;
		};
		cors.src = url;
	}

	function setPicture(url: string): void {
		picture.value = url;
		crop.value = INITIAL_CROP;
		load(url);
	}

	// Every open starts from the picture as it currently is, at rest.
	useEffect(() => {
		if (!isOpen) return;
		setPicture(source);
		return () => {
			loadSeq.current++;
			releaseObjectUrls();
		};
	}, [isOpen]);

	function releaseObjectUrls(): void {
		for (const url of objectUrls.current) URL.revokeObjectURL(url);
		objectUrls.current = [];
	}
	// #endregion

	// #region Stage measurement
	useEffect(() => {
		const el = stageRef.current;
		if (!el || !isOpen) return;
		const measure = () => {
			const size = el.getBoundingClientRect().width;
			if (size > 0 && size !== diameter.peek()) {
				diameter.value = size;
				const img = loaded.peek()?.image;
				if (img) crop.value = clampState(crop.peek(), img, size);
			}
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [isOpen, current]);
	// #endregion

	// #region Model ⇄ controls
	function update(patch: Partial<CropState>): void {
		const img = loaded.peek()?.image;
		const next = { ...crop.peek(), ...patch };
		crop.value = img ? clampState(next, img, diameter.peek()) : next;
	}

	useSignalEffect(() => {
		const s = crop.value;
		const off = offsetOf(s);
		const x = Math.round(off.x);
		const y = Math.round(off.y);
		if (zoomCtl.peek() !== s.zoom) zoomCtl.value = s.zoom;
		if (rotationCtl.peek() !== s.rotation) rotationCtl.value = s.rotation;
		if (xCtl.peek() !== x) xCtl.value = x;
		if (yCtl.peek() !== y) yCtl.value = y;
		if (xBox.peek() !== x) xBox.value = x;
		if (yBox.peek() !== y) yBox.value = y;
	});

	function setOffset(x: number | null, y: number | null): void {
		const off = offsetOf(crop.peek());
		update(centreFromOffset(x ?? off.x, y ?? off.y));
	}
	// #endregion

	// #region Stage gestures — drag to pan, Ctrl + wheel to zoom
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
		update(dragCentre(crop.peek(), image, diameter.peek(), dx, dy));
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

	// Attached by hand so `{ passive: false }` is explicit: a wheel listener that cannot cancel the
	// event zooms the browser page instead of the picture.
	useEffect(() => {
		const el = stageRef.current;
		if (!el || !isOpen) return;
		const onWheel = (e: WheelEvent) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			update({ zoom: wheelZoom(crop.peek().zoom, e.deltaY, e.deltaMode) });
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [isOpen, current]);
	// #endregion

	// #region Sources
	function onFileChosen(e: JSX.TargetedEvent<HTMLInputElement>): void {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = "";
		if (!file || !file.type.startsWith("image/")) return;
		const url = URL.createObjectURL(file);
		objectUrls.current.push(url);
		setPicture(url);
	}

	function chooseFromLibrary(): void {
		openPicker({
			requesterId: PICKER_ID,
			title: "Choose a profile picture",
			kinds: ["image"],
			multiple: false,
		});
	}

	function onPicked(assets: AssetItem[]): void {
		const picked = assets[0];
		if (picked) setPicture(picked.url);
	}
	// #endregion

	// #region Save
	async function save(): Promise<void> {
		const cur = loaded.peek();
		if (!cur || saving.value) return;
		saving.value = true;
		try {
			if (!cur.exportable) {
				onSave(picture.peek(), UNCROPPED_NOTE);
				return;
			}
			const size = CROP_OUTPUT_PX;
			const canvas = document.createElement("canvas");
			canvas.width = size;
			canvas.height = size;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("no 2d context");
			const t = exportTransform(crop.peek(), cur.image, diameter.peek(), size);
			ctx.translate(size / 2, size / 2);
			ctx.rotate((t.rotation * Math.PI) / 180);
			ctx.scale(t.scale, t.scale);
			ctx.translate(-t.cx, -t.cy);
			ctx.drawImage(cur.element, -cur.image.width / 2, -cur.image.height / 2);
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
			if (!blob) throw new Error("export produced no image");
			onSave(URL.createObjectURL(blob), null);
		} catch {
			// A tainted canvas throws on read-back despite the CORS attempt; the honest result is the
			// uncropped picture, said out loud.
			onSave(picture.peek(), UNCROPPED_NOTE);
		} finally {
			saving.value = false;
			open.value = false;
		}
	}
	// #endregion

	const transform = image ? stageTransform(crop.value, image, D) : null;
	const bounds = image ? centreBounds(image, D, crop.value.zoom) : { x: 0, y: 0 };
	const xMax = Math.floor(bounds.x);
	const yMax = Math.floor(bounds.y);
	const imgStyle = image && transform
		? `inline-size:${image.width}px;block-size:${image.height}px;` +
			`margin-inline-start:${-image.width / 2}px;margin-block-start:${-image.height / 2}px;` +
			`transform:translate(${transform.tx}px,${transform.ty}px) rotate(${transform.rotation}deg) scale(${transform.scale})`
		: undefined;

	const footer = (
		<>
			<Button variant="text" class="pf-crop__cancel" onClick={() => (open.value = false)}>
				Cancel
			</Button>
			<Button
				class="pf-crop__save"
				disabled={!image || saving.value}
				loading={saving.value}
				onClick={() => void save()}
			>
				Save photo
			</Button>
		</>
	);

	return (
		<Dialog
			visible={open}
			header="Edit profile photo"
			footer={footer}
			dismissableMask={false}
			initialFocusRef={controlsRef}
			class="pf-cropdlg"
		>
			{
				/* The scope carries the container so `.pf-crop` can be queried — a container cannot query
			    itself, and without this wrapper the two columns never stacked on a phone. */
			}
			<div class="pf-cropscope">
				<div class="pf-crop">
					{/* #region Crop canvas */}
					<div class="pf-crop__edit">
						<div
							ref={stageRef}
							class="pf-crop__stage"
							role="img"
							aria-label={`Preview of ${name}'s profile photo`}
							data-dragging={dragging.value ? "true" : undefined}
							data-state={failed.value ? "failed" : image ? "ready" : "loading"}
							onPointerDown={onPointerDown}
							onPointerMove={onPointerMove}
							onPointerUp={onPointerUp}
							onPointerCancel={onPointerUp}
						>
							{image && (
								<img
									class="pf-crop__img"
									src={picture.value}
									alt=""
									draggable={false}
									style={imgStyle}
								/>
							)}
							<span class="pf-crop__ring" aria-hidden="true" />
							{!image && (
								<span class="pf-crop__note pf-crop__note--stage" role="status">
									{failed.value ? "This picture couldn't be loaded." : "Loading picture…"}
								</span>
							)}
						</div>
						<p class="pf-crop__hint">Drag to move · Ctrl + scroll to zoom</p>

						<div class="pf-crop__controls" ref={controlsRef}>
							<div class="pf-crop__row">
								<span class="pf-crop__label" id="pf-crop-zoom">Zoom</span>
								<Slider
									size="sm"
									class="pf-crop__slider"
									value={zoomCtl}
									min={CROP_ZOOM_MIN}
									max={CROP_ZOOM_MAX}
									step={0.01}
									disabled={!image}
									aria-label="Zoom"
									formatValue={(v) => `${v.toFixed(2)}×`}
									onValueChange={(v) => {
										if (typeof v === "number") update({ zoom: v });
									}}
								/>
								<span class="pf-crop__value" aria-hidden="true">
									{crop.value.zoom.toFixed(2)}×
								</span>
							</div>

							<div class="pf-crop__row pf-crop__row--dial">
								<span class="pf-crop__label" id="pf-crop-rotation">Rotation</span>
								<Knob
									class="pf-crop__dial"
									value={rotationCtl}
									min={CROP_ROTATION_MIN}
									max={CROP_ROTATION_MAX}
									step={1}
									diameter={72}
									strokeWidth={10}
									valueColor="var(--on-surface)"
									rangeColor="var(--surface-2)"
									valueTemplate="{value}°"
									disabled={!image}
									aria-label="Rotation"
									onValueChange={(v) => update({ rotation: v })}
								/>
							</div>

							<div class="pf-crop__row">
								<span class="pf-crop__label">Offset X</span>
								<Slider
									size="sm"
									class="pf-crop__slider"
									value={xCtl}
									min={-xMax}
									max={xMax}
									step={1}
									disabled={!image || xMax === 0}
									aria-label="Horizontal offset"
									formatValue={(v) => `${v} pixels`}
									onValueChange={(v) => {
										if (typeof v === "number") setOffset(v, null);
									}}
								/>
								<NumberInput
									size="sm"
									class="pf-crop__num"
									value={xBox}
									min={-xMax}
									max={xMax}
									step={1}
									maxFractionDigits={0}
									hideSteppers
									disabled={!image || xMax === 0}
									aria-label="Horizontal offset in pixels"
									onValueChange={(v) => setOffset(v, null)}
								/>
							</div>

							<div class="pf-crop__row">
								<span class="pf-crop__label">Offset Y</span>
								<Slider
									size="sm"
									class="pf-crop__slider"
									value={yCtl}
									min={-yMax}
									max={yMax}
									step={1}
									disabled={!image || yMax === 0}
									aria-label="Vertical offset"
									formatValue={(v) => `${v} pixels`}
									onValueChange={(v) => {
										if (typeof v === "number") setOffset(null, v);
									}}
								/>
								<NumberInput
									size="sm"
									class="pf-crop__num"
									value={yBox}
									min={-yMax}
									max={yMax}
									step={1}
									maxFractionDigits={0}
									hideSteppers
									disabled={!image || yMax === 0}
									aria-label="Vertical offset in pixels"
									onValueChange={(v) => setOffset(null, v)}
								/>
							</div>

							{image && xMax === 0 && yMax === 0 && (
								<p class="pf-crop__note">Zoom in to move the picture.</p>
							)}
							<div class="pf-crop__reset">
								<Button
									size="sm"
									variant="text"
									class="pf-crop__resetbtn"
									disabled={!image}
									onClick={() => update(INITIAL_CROP)}
								>
									Reset
								</Button>
							</div>
						</div>
					</div>
					{/* #endregion */}

					{/* #region Sources */}
					<div class="pf-crop__source">
						<h3 class="pf-crop__h">Replace photo</h3>
						<button
							type="button"
							class="pf-crop__option"
							onClick={() => fileRef.current?.click()}
						>
							<Icon name="upload" size="md" class="pf-crop__option-icon" />
							<span class="pf-crop__option-text">
								<span class="pf-crop__option-title">Upload from this device</span>
								<span class="pf-crop__option-note">JPG, PNG, WebP or GIF</span>
							</span>
						</button>
						<button type="button" class="pf-crop__option" onClick={chooseFromLibrary}>
							<Icon name="folder" size="md" class="pf-crop__option-icon" />
							<span class="pf-crop__option-text">
								<span class="pf-crop__option-title">Choose from your files</span>
								<span class="pf-crop__option-note">Anything already in your library</span>
							</span>
						</button>
						<p class="pf-crop__note">
							The crop you see is what everyone sees, at every size — a square is stored and shown
							as a circle.
						</p>
						<input
							ref={fileRef}
							type="file"
							accept="image/*"
							class="ui-visually-hidden"
							tabIndex={-1}
							aria-hidden="true"
							onChange={onFileChosen}
						/>
						<AssetPicker requesterId={PICKER_ID} onPick={onPicked} />
					</div>
					{/* #endregion */}
				</div>
			</div>
		</Dialog>
	);
}
