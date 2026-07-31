import type { JSX, VNode } from "preact";
import "../styles/view-zoom-rig.css";
import { ZoomSlider } from "@projective/ui/fields";
import type { ZoomStore } from "@web/utils/zoom-store.ts";

/**
 * ViewZoomRig — the ONE view-control rig every zoom-driven workspace mounts in the middle-nav FOOTER
 * band (`ui-middle-nav__footer`): a NON-interactive current-view glyph, then the minus button · a thin
 * segmented track with a centred transition marker · the plus button (the reusable `@projective/ui`
 * {@link ZoomSlider}).
 *
 * The leading glyph is deliberately **not** a toggle: crossing the centre marker is what transitions
 * list ⇄ grid, so a button beside the slider would offer a second, competing way to do the same thing.
 * It is a read-out, marked `aria-hidden` — the slider itself carries the accessible name.
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
			<span class="ui-viewrig__mode" data-mode={mode} aria-hidden="true">
				{mode === "grid" ? props.gridIcon : props.listIcon}
			</span>
			<ZoomSlider
				value={store.zoom}
				onValueChange={store.setZoom}
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
