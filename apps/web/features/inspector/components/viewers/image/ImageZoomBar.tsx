import type { JSX } from "preact";
import { ToolButton, ToolReadout } from "../../controls/mod.ts";
import { isFitted, quarterTurn, VIEWPORT_IDENTITY, zoomPercent } from "../../../core/viewport.ts";
import type { ViewerProps } from "../viewer.ts";
import type { ImageTools } from "./image-tools.ts";

/** Props for {@link ImageZoomBar}. */
export interface ImageZoomBarProps extends ViewerProps<ImageTools> {
	/**
	 * `"bar"` floats inside the canvas (out, level, in, fit); `"chips"` is the host's compact chip
	 * row, which adds rotate, reset and the rule-of-thirds toggle.
	 */
	mode?: "bar" | "chips";
}

/** The small zoom bar floating over the picture, or the embedding host's on-canvas chips. */
export function ImageZoomBar({ tools, mode = "bar" }: ImageZoomBarProps): JSX.Element {
	const view = tools.view.value;
	const limits = tools.limits.value;
	const chips = mode === "chips";
	const ready = tools.ready.value;
	const pristine = isFitted(view, tools.fitZoom.value) && quarterTurn(view.rotation) === 0 &&
		view.flipX === VIEWPORT_IDENTITY.flipX && view.flipY === VIEWPORT_IDENTITY.flipY;
	return (
		<div class={chips ? "ins-chips" : "ins-image__bar"} role="toolbar" aria-label="Zoom">
			<ToolButton
				icon="zoom-out"
				label="Zoom out"
				shortcut="-"
				disabled={!ready || view.zoom <= limits.min * 1.0001}
				onClick={() => tools.zoomStep(-1)}
			/>
			<span class={chips ? "ins-chips__readout" : "ins-image__level"}>
				<ToolReadout value={zoomPercent(view.zoom)} label="Zoom" />
			</span>
			<ToolButton
				icon="zoom-in"
				label="Zoom in"
				shortcut="+"
				disabled={!ready || view.zoom >= limits.max * 0.9999}
				onClick={() => tools.zoomStep(1)}
			/>
			<ToolButton
				icon="zoom-fit"
				label="Fit to screen"
				shortcut="0"
				disabled={!ready}
				onClick={tools.fitToStage}
			/>
			{chips
				? (
					<>
						<span class="ins-chips__sep" aria-hidden="true" />
						<ToolButton
							icon="rotate-cw"
							label="Rotate right"
							shortcut="R"
							disabled={!ready}
							onClick={() => tools.rotate(1)}
						/>
						<ToolButton
							icon="refresh"
							label="Reset view"
							disabled={!ready || pristine}
							onClick={tools.reset}
						/>
						<ToolButton
							icon="grid"
							label="Rule of thirds"
							shortcut="G"
							pressed={tools.grid.value}
							disabled={!ready}
							onClick={tools.toggleGrid}
						/>
					</>
				)
				: null}
		</div>
	);
}

/** The image canvas's on-canvas chips for an embedding host. */
export function ImageChips(props: ViewerProps<ImageTools>): JSX.Element | null {
	return props.tools.ready.value ? <ImageZoomBar {...props} mode="chips" /> : null;
}
