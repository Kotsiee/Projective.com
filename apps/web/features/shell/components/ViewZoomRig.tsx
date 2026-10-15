import type { JSX, VNode } from "preact";
import "../styles/view-zoom-rig.css";
import { Button, ZoomSlider } from "@projective/ui/fields";
import type { ZoomStore } from "@web/utils/zoom-store.ts";

/**
 * ViewZoomRig — the ONE view-control rig every zoom-driven workspace mounts in the middle-nav FOOTER
 * band (`ui-middle-nav__footer`): a list ⇄ grid mode toggle, then the shared `@projective/ui`
 * {@link ZoomSlider} (zoom-out lens · muted track with a centred transition marker · zoom-in lens).
 *
 * The toggle and the slider are one control over one value (Decision #223): pressing the mode button
 * mirrors the zoom to the same relative density in the other half, so the handle jumps across the
 * centre marker and the slider never contradicts the view.
 *
 * It is a plain component rather than an island because each surface owns its own hydration root (its
 * rig island imports its own feature stylesheet and its own {@link ZoomStore}); the markup, the
 * keyboard behaviour and the token vocabulary are what must not fork, and those live here.
 */
export interface ViewZoomRigProps {
	/** The surface's shared zoom store — the same instance its body island reads. */
	store: ZoomStore;
	/** Accessible name for the slider, e.g. `"File view zoom"`. */
	label: string;
	/** Glyph shown while the zoom selects the LIST half. */
	listIcon: VNode;
	/** Glyph shown while the zoom selects the GRID half. */
	gridIcon: VNode;
	/**
	 * Extra class on the rig root, so a feature can keep its own BEM hook alongside the shared
	 * `ui-viewrig` base (the base owns layout; the feature class is for scoped overrides only).
	 */
	class?: string;
	/** Trailing controls rendered after the slider, e.g. a mode that sits off the zoom axis. */
	children?: JSX.Element | JSX.Element[] | null;
}

export function ViewZoomRig(props: ViewZoomRigProps): JSX.Element {
	const { store } = props;
	const mode = store.viewMode.value;

	return (
		<div class={props.class ? `ui-viewrig ${props.class}` : "ui-viewrig"}>
			<Button
				iconOnly
				rounded
				size="sm"
				variant="text"
				severity="secondary"
				class="ui-viewrig__mode ui-hit"
				data-mode={mode}
				icon={mode === "grid" ? props.gridIcon : props.listIcon}
				aria-label={mode === "grid" ? "Switch to list view" : "Switch to grid view"}
				onClick={store.toggleViewMode}
			/>
			<ZoomSlider
				value={store.zoom}
				onValueChange={(v, source) => store.setZoom(v, source === "drag" ? "instant" : "animate")}
				min={store.ZOOM_MIN}
				max={store.ZOOM_MAX}
				step={store.ZOOM_STEP}
				segments={store.ZOOM_SEGMENTS}
				center={store.ZOOM_CENTER}
				size="sm"
				aria-label={props.label}
			/>
			{props.children}
		</div>
	);
}
