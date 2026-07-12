import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import "../styles/image.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Portal } from "../../overlay/components/Portal.tsx";
import { Backdrop } from "../../overlay/islands/Backdrop.tsx";
import { usePresence } from "../../overlay/core/usePresence.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useId } from "../../hooks/useId.ts";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export interface ImageProps {
	src: string;
	alt: string;
	/** Enable the click-to-open full-screen preview (zoom/rotate/pan). Default `false`. */
	preview?: boolean;
	/** Inline (non-preview) rendered width. */
	width?: string | number;
	/** Inline (non-preview) rendered height. */
	height?: string | number;
	class?: string;
}

/**
 * Image — an `<img>` with an optional full-screen preview overlay. Built on the shared overlay
 * primitives ({@link Portal}, {@link Backdrop}, {@link usePresence}, {@link useOverlayStack}) exactly
 * like `Dialog`: focus-trapped (`useFocusTrap`) while open, Escape/top-most dismissal (`useDismiss`),
 * and a managed z-index. The preview toolbar offers zoom in/out (`+`/`-` keys too), 90°-step rotate
 * (`r`), and pointer-drag panning once zoomed past 1×; all three are token-duration CSS transforms, so
 * `prefers-reduced-motion` (styles/index.css) collapses them to an instant jump automatically. The
 * trigger is a `<button aria-haspopup="dialog">`; the overlay is `role="dialog"` `aria-modal` with
 * `aria-label={alt}`.
 */
export function Image(props: ImageProps): JSX.Element {
	const { src, alt, preview = false, width, height, class: className } = props;

	const rootId = useId(undefined, "image");
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

	const [open, setOpen] = useState(false);
	const [zoom, setZoom] = useState(1);
	const [rotation, setRotation] = useState(0);
	const [pan, setPan] = useState({ x: 0, y: 0 });

	const { mounted, state } = usePresence(open);
	const stack = useOverlayStack({ active: mounted, lockScroll: true });

	const close = () => {
		setOpen(false);
		triggerRef.current?.focus();
	};
	const openPreview = () => {
		if (!preview) return;
		setZoom(1);
		setRotation(0);
		setPan({ x: 0, y: 0 });
		setOpen(true);
	};

	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({
		open: mounted,
		onDismiss: () => {
			if (stack.isTop) close();
		},
		panelRef,
		closeOnOutside: false,
	});

	// #region Toolbar actions
	const zoomBy = (delta: number) => {
		setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z + delta).toFixed(2))));
	};
	const rotate = () => setRotation((r) => (r + 90) % 360);
	// #endregion

	// #region Pan (pointer drag once zoomed in) — `panning` suppresses the transform transition so
	// the image tracks the pointer 1:1 instead of chasing it.
	const [panning, setPanning] = useState(false);
	const onStagePointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (zoom <= 1) return;
		drag.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y };
		setPanning(true);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};
	const onStagePointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (!drag.current) return;
		setPan({ x: drag.current.ox + (e.clientX - drag.current.px), y: drag.current.oy + (e.clientY - drag.current.py) });
	};
	const endDrag = () => {
		drag.current = null;
		setPanning(false);
	};
	// #endregion

	const onOverlayKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (e.key === "+" || e.key === "=") {
			e.preventDefault();
			zoomBy(ZOOM_STEP);
		} else if (e.key === "-") {
			e.preventDefault();
			zoomBy(-ZOOM_STEP);
		} else if (e.key === "r" || e.key === "R") {
			e.preventDefault();
			rotate();
		}
	};

	return (
		<span class={cx("ui-image", className)}>
			{preview
				? (
					<button
						ref={triggerRef}
						type="button"
						class="ui-image__trigger"
						aria-haspopup="dialog"
						aria-label={`Open full-screen preview of ${alt}`}
						onClick={openPreview}
					>
						<img class="ui-image__img" src={src} alt={alt} width={width} height={height} />
					</button>
				)
				: <img class="ui-image__img" src={src} alt={alt} width={width} height={height} />}

			{preview && mounted && (
				<Portal zIndex={stack.zIndex}>
					<Backdrop visible={state === "open"} />
					<div
						ref={panelRef}
						id={rootId}
						role="dialog"
						aria-modal="true"
						aria-label={alt}
						data-state={state}
						tabIndex={-1}
						class="ui-image__preview"
						onKeyDown={onOverlayKeyDown}
					>
						<div class="ui-image__toolbar">
							<button
								type="button"
								class="ui-image__tool"
								aria-label="Zoom in"
								disabled={zoom >= MAX_ZOOM}
								onClick={() => zoomBy(ZOOM_STEP)}
							>
								+
							</button>
							<button
								type="button"
								class="ui-image__tool"
								aria-label="Zoom out"
								disabled={zoom <= MIN_ZOOM}
								onClick={() => zoomBy(-ZOOM_STEP)}
							>
								−
							</button>
							<button type="button" class="ui-image__tool" aria-label="Rotate" onClick={rotate}>
								⟳
							</button>
							<button
								type="button"
								class="ui-image__tool ui-image__tool--close"
								aria-label="Close preview"
								onClick={close}
							>
								×
							</button>
						</div>
						<div
							class={cx("ui-image__stage", zoom > 1 && "ui-image__stage--pannable")}
							onPointerDown={onStagePointerDown}
							onPointerMove={onStagePointerMove}
							onPointerUp={endDrag}
							onPointerLeave={endDrag}
						>
							<img
								class={cx("ui-image__preview-img", panning && "ui-image__preview-img--panning")}
								src={src}
								alt={alt}
								style={styleVars({
									"--image-zoom": `${zoom}`,
									"--image-rotate": `${rotation}deg`,
									"--image-pan-x": `${pan.x}px`,
									"--image-pan-y": `${pan.y}px`,
								})}
							/>
						</div>
					</div>
				</Portal>
			)}
		</span>
	);
}
