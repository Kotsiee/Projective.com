/**
 * @projective/ui/calendar — the grid backdrop: one canvas pinned over the time-grid viewport, plus
 * the hidden swatch subtree its palette is resolved from.
 *
 * It replaces four families of absolutely-positioned DOM layers — the hour rules, the day-boundary
 * rules, the day-column separators, the working-hours bands and the blacked-out-day tint — with a
 * single element that paints all of them.
 *
 * THIS COMPONENT IS THE LATTICE-ONLY DEPTH, and its one consumer is the hybrid Day `DayTimeline`,
 * whose event cards, hour labels and chrome stay HTML over it. The Week `TimeGrid` does not use it:
 * it is a pure immediate-mode canvas that paints its own cards and scale through `paintScene`, with
 * a parallel accessible layer beside the viewport carrying the role, name, focus and activation that
 * pixels cannot. Both depths share one lattice renderer, which is why `paintScene` calls `paintGrid`
 * first rather than reimplementing it.
 *
 * ACCESSIBILITY. The canvas is `aria-hidden` and takes no pointer, exactly like the `aria-hidden`
 * line layer it replaces. Everything it draws is already spoken elsewhere — the hour by the gutter's
 * text labels, the day by the column header, the working window and the blackout by the availability
 * panel — so hiding it removes nothing and spares a screen reader a graphic with no name. The Day
 * timeline's hour LABELS stay in the DOM gutter for the same reason: at this depth there is no
 * parallel layer to carry them, and canvas text has no find-in-page, no selection and no text cursor.
 */
import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import type { GridScene } from "../core/grid-paint.ts";
import type { FrameStats } from "../core/scene-paint.ts";
import { useGridCanvas } from "../hooks/useGridCanvas.ts";
import { GridProbe } from "./GridProbe.tsx";

export interface GridCanvasProps {
	/** Everything to paint for this frame. Rebuilt by the owning view on each render. */
	scene: GridScene;
	class?: string;
	/** Optional per-frame cost report. Absent by default; see `UseGridCanvasOptions.onFrame`. */
	onFrame?: (stats: FrameStats) => void;
}

export function GridCanvas(props: GridCanvasProps): JSX.Element {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const probeRef = useRef<HTMLDivElement>(null);
	useGridCanvas({ canvasRef, probeRef, scene: () => props.scene, onFrame: props.onFrame });

	return (
		<>
			<canvas ref={canvasRef} class={cx("cal-grid", props.class)} aria-hidden="true" />
			{/* The palette probe — see `GridProbe`. Lattice swatches only: this backdrop draws no text. */}
			<GridProbe probeRef={probeRef} />
		</>
	);
}
