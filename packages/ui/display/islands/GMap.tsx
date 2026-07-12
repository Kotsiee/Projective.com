import type { JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import "../styles/gmap.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useIntersectionObserver } from "../../hooks/useIntersectionObserver.ts";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Types
/** A geographic centre point passed through to the URL builder. */
export interface GMapCenter {
	lat: number;
	lng: number;
}

/**
 * An overlay marker. `x`/`y` are caller-projected positions as percentages (0–100) of the frame — the
 * app owns the lat/lng → pixel projection since this island is provider-agnostic and never loads an
 * SDK.
 */
export interface GMapMarker<T = unknown> {
	/** Stable id. */
	id: string;
	/** Horizontal position as a 0–100 percentage of the frame width. */
	x: number;
	/** Vertical position as a 0–100 percentage of the frame height. */
	y: number;
	/** Optional pin label. */
	label?: string;
	/** Accent colour token reference for the pin (e.g. `"var(--danger)"`). */
	color?: string;
	/** Arbitrary payload echoed on click. */
	data?: T;
}

/** Inputs to a custom embed-URL builder. */
export interface GMapUrlContext {
	/** Base embed URL supplied by the caller (provider-specific). */
	embedUrl?: string;
	center?: GMapCenter;
	zoom: number;
}

/** Props for {@link GMap}. */
export interface GMapProps<T = unknown> {
	/**
	 * Provider embed URL (e.g. an OpenStreetMap/Google Maps embed). The real tile provider + any key
	 * is plugged in by the app; this island only frames it. Use `XXXX-XXXX` for placeholder keys.
	 */
	embedUrl?: string;
	/** Fully-formed iframe `src` — overrides `embedUrl` + the URL builder when given. */
	src?: string;
	/** Builds the iframe `src` from `embedUrl` + `center`/`zoom`; defaults to appending query params. */
	urlBuilder?: (ctx: GMapUrlContext) => string;
	/** Map centre, forwarded to the URL builder. */
	center?: GMapCenter;
	/** Zoom level — bound value, driven by the +/- controls. */
	zoom?: Bindable<number>;
	/** Fired when zoom changes via the controls. */
	onZoomChange?: (zoom: number) => void;
	/** Overlay markers projected by the caller. */
	markers?: GMapMarker<T>[];
	/** Fired when a marker pin is activated. */
	onMarkerClick?: (marker: GMapMarker<T>) => void;
	/** Map frame height (any CSS length; default `24rem`). */
	height?: string;
	/** Show the +/- zoom controls chrome (default true). */
	controls?: boolean;
	/** Title attribute for the iframe (accessibility). */
	title?: string;
	/** Shown until the frame lazy-mounts / while it loads. */
	loadingTemplate?: () => VNode;
	class?: string;
}
// #endregion

/** Default builder: append `center`/`zoom` as query params onto the provider embed URL. */
function defaultUrlBuilder(ctx: GMapUrlContext): string {
	if (!ctx.embedUrl) return "";
	try {
		const url = new URL(ctx.embedUrl);
		if (ctx.center) url.searchParams.set("center", `${ctx.center.lat},${ctx.center.lng}`);
		url.searchParams.set("zoom", String(ctx.zoom));
		return url.toString();
	} catch {
		return ctx.embedUrl;
	}
}

/**
 * GMap — a dumb, provider-agnostic interactive map wrapper. Frames a caller-supplied embed URL in a
 * lazy-mounted `<iframe>` (mounted only once scrolled into view) and overlays caller-projected
 * `markers` as absolutely-positioned pins. `center`/`zoom` flow through a pluggable `urlBuilder`;
 * token-styled chrome provides zoom controls. Holds no API keys or SDK — the app plugs in a real tile
 * provider via `embedUrl`/`src` (use `XXXX-XXXX` for placeholder keys). Provider tiles handle their
 * own a11y; markers are focusable buttons with accessible names.
 */
export function GMap<T = unknown>(props: GMapProps<T>): JSX.Element {
	const {
		embedUrl,
		src,
		urlBuilder = defaultUrlBuilder,
		center,
		zoom,
		onZoomChange,
		markers,
		onMarkerClick,
		height = "24rem",
		controls = true,
		title = "Map",
		loadingTemplate,
		class: className,
	} = props;

	const zoomCtrl = useControllable<number>(zoom, 12, onZoomChange);
	const rootRef = useRef<HTMLDivElement>(null);
	const { hasBeenVisible } = useIntersectionObserver({
		targetRef: rootRef,
		rootMargin: "200px",
		once: true,
	});

	const currentZoom = zoomCtrl.signal.value;
	const resolvedSrc = src ?? urlBuilder({ embedUrl, center, zoom: currentZoom });
	const mounted = hasBeenVisible.value;

	const setZoom = (delta: number) => zoomCtrl.set(Math.max(0, currentZoom + delta));

	return (
		<div
			ref={rootRef}
			class={cx("ui-gmap", className)}
			style={styleVars({ "--gmap-height": height })}
			role="group"
			aria-label={title}
		>
			{mounted && resolvedSrc
				? (
					<iframe
						class="ui-gmap__frame"
						src={resolvedSrc}
						title={title}
						loading="lazy"
						referrerpolicy="no-referrer-when-downgrade"
					/>
				)
				: (
					<div class="ui-gmap__placeholder" role="status" aria-live="polite">
						{loadingTemplate ? loadingTemplate() : "Loading map…"}
					</div>
				)}

			{markers && markers.length > 0 && (
				<div class="ui-gmap__markers">
					{markers.map((m) => (
						<button
							key={m.id}
							type="button"
							class="ui-gmap__marker"
							style={styleVars({
								"--marker-x": `${m.x}%`,
								"--marker-y": `${m.y}%`,
								"--marker-color": m.color,
							})}
							aria-label={m.label ?? `Marker ${m.id}`}
							onClick={() => onMarkerClick?.(m)}
						>
							<span class="ui-gmap__marker-pin" aria-hidden="true" />
							{m.label && <span class="ui-gmap__marker-label">{m.label}</span>}
						</button>
					))}
				</div>
			)}

			{controls && (
				<div class="ui-gmap__chrome">
					<button
						type="button"
						class="ui-gmap__control"
						aria-label="Zoom in"
						onClick={() => setZoom(1)}
					>
						+
					</button>
					<button
						type="button"
						class="ui-gmap__control"
						aria-label="Zoom out"
						onClick={() => setZoom(-1)}
					>
						−
					</button>
				</div>
			)}
		</div>
	);
}
