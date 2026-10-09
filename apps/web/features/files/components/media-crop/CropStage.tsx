import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	CROP_ZOOM_MAX,
	CROP_ZOOM_MIN,
	type CropState,
	dragCentre,
	RENDITION_ASPECT,
	RENDITION_SHAPE,
	type RenditionPurpose,
	stageTransform,
	wheelZoom,
} from "@projective/types/files";
import {
	pinchDelta,
	type PinchFrame,
	pinchFrame,
	type PointerPoint,
} from "../../core/media/pinch-gesture.ts";

/** A still the stage can frame: a display URL and the source's natural size. */
export interface CropSource {
	src: string;
	width: number;
	height: number;
}

/**
 * CropStage — the fixed-size framing canvas of the crop editor. Empty, it is a drop zone whose crop
 * outline fades in while a file is dragged over it; loaded, the picture pans under the frame (drag or
 * arrow keys), zooms (Ctrl + wheel, +/−), and with two fingers pans, pinch-zooms and twists at once;
 * rule-of-thirds guides strengthen while it is being moved. It is the same size in both states. It never clamps: every gesture is reported
 * through `onChange`, and the owner clamps it.
 */
export interface CropStageProps {
	target: RenditionPurpose;
	image: CropSource | null;
	crop: Signal<CropState>;
	onChange: (patch: Partial<CropState>) => void;
	/** Names the frame for assistive technology. */
	label: string;
	/** Files dropped on the stage, or chosen through its button. */
	onFiles: (files: FileList) => void;
	/** Open the device file chooser. */
	onBrowse: () => void;
	/** What the empty stage asks for. */
	emptyTitle: string;
	/** A transient status shown on the empty stage, such as an upload's progress. */
	status?: string | null;
	/** Driven from outside (the rotation ruler) so the guides strengthen for any adjustment. */
	adjusting?: boolean;
}

/** Margin of context around the frame, as a fraction of the stage width. */
const STAGE_MARGIN = 0.07;
const NUDGE_PX = 8;
const NUDGE_PX_LARGE = 40;

/** The stage's width ÷ height, constant per target, so every state of the stage is the same size. */
export function stageRatioFor(target: RenditionPurpose): number {
	const aspect = RENDITION_SHAPE[target] === "circle" ? 1 : RENDITION_ASPECT[target];
	return 1 / ((1 - 2 * STAGE_MARGIN) / aspect + 2 * STAGE_MARGIN);
}

function carriesFiles(e: DragEvent): boolean {
	return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function CropStage(props: CropStageProps): JSX.Element {
	const { target, image, crop } = props;
	const aspect = RENDITION_ASPECT[target];
	const shape = RENDITION_SHAPE[target];
	const size = useSignal({ w: 0, h: 0 });
	const dragging = useSignal(false);
	const over = useSignal(false);
	const stageRef = useRef<HTMLDivElement>(null);
	const pointers = useRef(new Map<number, PointerPoint>());
	const pinch = useRef<PinchFrame | null>(null);
	const latest = useRef(props);
	latest.current = props;

	useEffect(() => {
		const el = stageRef.current;
		if (!el) return;
		const measure = () => {
			const r = el.getBoundingClientRect();
			const prev = size.peek();
			if (r.width !== prev.w || r.height !== prev.h) size.value = { w: r.width, h: r.height };
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		const el = stageRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			const p = latest.current;
			if (!(e.ctrlKey || e.metaKey) || !p.image) return;
			e.preventDefault();
			p.onChange({ zoom: wheelZoom(p.crop.peek().zoom, e.deltaY, e.deltaMode) });
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	const { w: W, h: H } = size.value;
	const margin = Math.round(W * STAGE_MARGIN);
	const boxW = Math.max(1, W - 2 * margin);
	const boxH = boxW / (shape === "circle" ? 1 : aspect);
	const insetBlock = Math.max(0, (H - boxH) / 2);

	function move(dx: number, dy: number): void {
		if (!image) return;
		props.onChange(dragCentre(crop.peek(), image, aspect, boxW, dx, dy, shape));
	}

	/** The first two live pointers as a pinch frame, or `null` with fewer than two down. */
	function currentPinch(): PinchFrame | null {
		const [a, b] = [...pointers.current.values()];
		return a && b ? pinchFrame(a, b) : null;
	}

	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (!image || (e.pointerType === "mouse" && e.button !== 0)) return;
		if (pointers.current.size >= 2) return;
		e.preventDefault();
		e.currentTarget.focus();
		try {
			e.currentTarget.setPointerCapture(e.pointerId);
		} catch {
			return;
		}
		pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		pinch.current = currentPinch();
		dragging.value = true;
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const last = pointers.current.get(e.pointerId);
		if (!last || !image) return;
		const dx = e.clientX - last.x;
		const dy = e.clientY - last.y;
		pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		const prev = pinch.current;
		if (!prev) {
			move(dx, dy);
			return;
		}
		const next = currentPinch();
		if (!next) return;
		pinch.current = next;
		const d = pinchDelta(prev, next);
		const cur = crop.peek();
		const turned = {
			...cur,
			zoom: Math.min(CROP_ZOOM_MAX, Math.max(CROP_ZOOM_MIN, cur.zoom * d.scale)),
			rotation: cur.rotation + d.rotation,
		};
		props.onChange({
			zoom: turned.zoom,
			rotation: turned.rotation,
			...dragCentre(turned, image, aspect, boxW, d.dx, d.dy, shape),
		});
	}

	function onPointerUp(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (!pointers.current.delete(e.pointerId)) return;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		pinch.current = currentPinch();
		if (pointers.current.size === 0) dragging.value = false;
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		if (!image || e.target !== e.currentTarget) return;
		const step = e.shiftKey ? NUDGE_PX_LARGE : NUDGE_PX;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [step, 0],
			ArrowRight: [-step, 0],
			ArrowUp: [0, step],
			ArrowDown: [0, -step],
		};
		const delta = moves[e.key];
		if (delta) {
			e.preventDefault();
			move(delta[0], delta[1]);
		} else if (e.key === "+" || e.key === "=") {
			e.preventDefault();
			props.onChange({ zoom: crop.peek().zoom * 1.1 });
		} else if (e.key === "-" || e.key === "_") {
			e.preventDefault();
			props.onChange({ zoom: crop.peek().zoom / 1.1 });
		}
	}

	function onDragOver(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
		if (!carriesFiles(e)) return;
		e.preventDefault();
		if (!over.peek()) over.value = true;
	}

	function onDragLeave(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
		const next = e.relatedTarget as Node | null;
		if (next && e.currentTarget.contains(next)) return;
		over.value = false;
	}

	function onDrop(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
		if (!carriesFiles(e)) return;
		e.preventDefault();
		over.value = false;
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) props.onFiles(files);
	}

	const transform = image && W > 0 ? stageTransform(crop.value, image, aspect, boxW, shape) : null;
	const imgStyle = image && transform
		? `inline-size:${image.width}px;block-size:${image.height}px;` +
			`margin-left:${-image.width / 2}px;margin-top:${-image.height / 2}px;` +
			`transform:translate(${transform.tx}px,${transform.ty}px) rotate(${transform.rotation}deg) scale(${transform.scale})`
		: undefined;

	return (
		<div
			ref={stageRef}
			class={`pf-media__stage pf-media__stage--${target}`}
			style={`--pf-stage-ratio:${stageRatioFor(target)}`}
			tabIndex={image ? 0 : undefined}
			role={image ? "img" : "group"}
			aria-label={image
				? `${props.label}: crop preview. Drag or use the arrow keys to move, plus and minus to zoom.`
				: `${props.label}: drop a picture here`}
			data-state={image ? "loaded" : "empty"}
			data-over={over.value ? "true" : undefined}
			data-dragging={dragging.value || props.adjusting ? "true" : undefined}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onKeyDown={onKeyDown}
			onDragEnter={onDragOver}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			{imgStyle && image && (
				<img class="pf-media__img" src={image.src} alt="" draggable={false} style={imgStyle} />
			)}
			{W > 0 && (
				<span
					class="pf-media__window"
					aria-hidden="true"
					style={`inset:${insetBlock}px ${margin}px`}
				>
					<span class="pf-media__thirds">
						<span class="pf-media__third pf-media__third--v1" />
						<span class="pf-media__third pf-media__third--v2" />
						<span class="pf-media__third pf-media__third--h1" />
						<span class="pf-media__third pf-media__third--h2" />
					</span>
				</span>
			)}
			{!image && (
				<div class="pf-media__drop">
					<Icon name="upload" size="lg" class="pf-media__drop-icon" />
					<p class="pf-media__drop-title">{props.emptyTitle}</p>
					{props.status
						? <p class="pf-media__drop-note" role="status">{props.status}</p>
						: <p class="pf-media__drop-note">Drop it here, or</p>}
					<Button
						size="sm"
						severity="neutral"
						variant="outlined"
						icon={<Icon name="upload" size="sm" />}
						onClick={props.onBrowse}
					>
						Choose from this device
					</Button>
				</div>
			)}
		</div>
	);
}
