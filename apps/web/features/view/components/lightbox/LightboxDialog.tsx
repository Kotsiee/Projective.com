import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { BodyPortal, type PresenceState } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useId, useOverlayStack } from "@projective/ui/hooks";
import { ZOOM_STEP } from "@features/inspector/core/viewport.ts";
import type { LightboxMedia } from "../../types/lightbox-types.ts";
import { clampIndex, stepIndex } from "../../core/lightbox-model.ts";
import { useLightboxViewport } from "../../hooks/useLightboxViewport.ts";
import { LightboxStage } from "./LightboxStage.tsx";
import { LightboxTray } from "./LightboxTray.tsx";

/** Props for {@link LightboxDialog}. */
export interface LightboxDialogProps {
	/** `usePresence`'s phase, driving the enter and exit transitions. */
	state: PresenceState;
	active: Signal<number>;
	gallery: readonly LightboxMedia[];
	title: string;
	onClose: () => void;
}

/**
 * The mounted lightbox: one full-viewport dialog holding the stage above the tray. It is only
 * rendered while the lightbox is present, so its stage exists before the viewport binds to it.
 */
export function LightboxDialog(
	{ state, active, gallery, title, onClose }: LightboxDialogProps,
): JSX.Element {
	const panelRef = useRef<HTMLDivElement>(null);
	const captionBase = useId(undefined, "vw-lightbox");
	const stack = useOverlayStack({ active: true, lockScroll: true, layer: "modal" });
	useFocusTrap({ active: true, containerRef: panelRef });
	useDismiss({
		open: true,
		enabled: stack.isTop,
		onDismiss: onClose,
		panelRef,
		closeOnOutside: false,
	});

	const idx = clampIndex(active.value, gallery.length);
	const current = gallery[idx];
	const multi = gallery.length > 1;

	function step(delta: number): void {
		active.value = stepIndex(active.peek(), delta, gallery.length);
	}

	const viewport = useLightboxViewport({ src: current.src, onStep: step, onDismiss: onClose });

	const keys = useRef<(e: KeyboardEvent) => void>(() => {});
	keys.current = (e: KeyboardEvent) => {
		if (!stack.isTop || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
		if (e.target instanceof HTMLVideoElement) return;
		const last = gallery.length - 1;
		if (e.key === "ArrowLeft" && multi) step(-1);
		else if (e.key === "ArrowRight" && multi) step(1);
		else if (e.key === "Home" && multi) active.value = 0;
		else if (e.key === "End" && multi) active.value = last;
		else if (e.key === "+" || e.key === "=") viewport.zoomBy(ZOOM_STEP);
		else if (e.key === "-") viewport.zoomBy(1 / ZOOM_STEP);
		else if (e.key === "0") viewport.reset();
		else return;
		e.preventDefault();
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => keys.current(e);
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, []);

	const captionId = current.caption ? `${captionBase}-caption` : undefined;

	return (
		<BodyPortal>
			<div class="vw-lightbox" data-state={state} style={`z-index:${stack.zIndex}`}>
				<div
					ref={panelRef}
					class="vw-lightbox__panel"
					data-state={state}
					role="dialog"
					aria-modal="true"
					aria-label={`${title} — ${idx + 1} of ${gallery.length}`}
					aria-describedby={captionId}
					aria-roledescription="lightbox"
					tabIndex={-1}
				>
					<LightboxStage media={current} title={title} viewport={viewport} onClose={onClose} />
					{current.caption
						? <p id={captionId} class="vw-lightbox__caption">{current.caption}</p>
						: null}
					{multi
						? (
							<LightboxTray
								gallery={gallery}
								active={idx}
								onSelect={(i) => (active.value = i)}
								onStep={step}
							/>
						)
						: null}
				</div>
			</div>
		</BodyPortal>
	);
}
