/**
 * Ribbon — a viewport-pinned, full-width status strip along the bottom edge (the YouTube "You're
 * offline" bar), for a fact about the WHOLE session rather than about one control: connectivity, a
 * maintenance window, a read-only mode. It slides in and out, and while it is open it reserves its
 * own height for every other bottom-pinned surface, so a footer band or a toast stack moves up with
 * it instead of being covered.
 *
 * Fully controlled and network-agnostic: the consumer decides `visible` and what it says. The strip
 * itself knows nothing about `navigator.onLine`, which is what keeps it portable and what keeps the
 * one source of truth for "are we offline" in the app that owns that answer.
 *
 * ## Hidden means EMPTY, not merely styled away
 *
 * The strip's box is always in the DOM, but its content — glyph, statement, action — is rendered
 * only while it is visible or on its way out. A hidden strip that still carried its words relied on
 * the stylesheet to keep them off screen, and the stylesheet arrives with the island bundle: on
 * every load there is a window before it applies in which a closed strip painted as a plain line of
 * text at the bottom of the page. An empty element paints nothing with no CSS at all, so the
 * hidden state is invisible by construction rather than by timing.
 *
 * The box stays mounted, rather than the whole strip unmounting, because it is a `role="status"`
 * live region: assistive tech announces content ADDED to a region that already exists, and is
 * inconsistent about a region that appears with its text already inside it. So the region is
 * always there, and a notice is an insertion into it.
 *
 * ## The fill is the page's ink, not a severity
 *
 * The bar draws `--on-surface` on `--surface` inverted — the same idiom `Tooltip` uses — so it is
 * legible in every theme/contrast state by construction (≥ 14:1 measured), and it is the one strip
 * on screen that reads as "chrome" rather than as content. A severity fill was tried and rejected
 * for the same reason the status chips mix toward `--on-surface` (§B.8.3 note): four of the theme's
 * `--on-<role>` pairs measure ~3.2:1 in light mode, under the floor for a one-line notice that is
 * read at a glance. The FACT is carried by the icon and the words, never by colour alone (§A.5).
 *
 * ## `:root[data-ribbon]` and the measured inset
 *
 * While open, the island writes `data-ribbon="open"` onto the document element, which is what
 * `--ribbon-inset` keys off (see `styles/index.css`). It is written by this component rather than by
 * the consumer so a Ribbon can never be visible without the room for it being reserved, and vice
 * versa. Exactly one Ribbon is expected per document; a second one's open/close would fight over the
 * attribute.
 *
 * The stylesheet's reservation is `--ribbon-h`, the strip's MINIMUM height — and a sentence that
 * wraps on a phone makes the strip taller than that, which left the footer rig's first row under
 * the strip at 375px (measured). So the island also writes the strip's MEASURED height as an inline
 * `--ribbon-inset` on the root while it is open, re-measured by a `ResizeObserver`, and removes it on
 * close. The reservation is then exactly what is drawn, at every width, with the stylesheet value as
 * the floor for the frame before the first measurement lands. The observer watches the box, which
 * is always present, so the measurement follows the content in on the render after it mounts.
 *
 * ## Motion
 *
 * Enter and exit both animate off `[data-state]`, on `transform`/`opacity` only, driven by
 * `usePresence`: the content mounts while the box is still closed and the state flips to open on
 * the next frame, so the slide-in runs; on exit the state flips to closed at once and the content
 * is dropped after the exit grace (`--dur-medium`), so the strip leaves carrying the words it
 * arrived with. The closed state is `visibility: hidden` (delayed until the exit has run), so a
 * withdrawn strip is out of the accessibility tree and the tab order — an action inside it must not
 * remain reachable by keyboard after the bar has left the screen. Reduced motion collapses both
 * transitions through the duration tokens and jumps straight to the final state.
 */
import type { ComponentChildren, JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/ribbon.css";
import { cx } from "../../core/cx.ts";
import { usePresence } from "../../overlay/core/usePresence.ts";

// #region Props
/** Props for {@link Ribbon}. */
export interface RibbonProps {
	/** Whether the strip is shown. Flipping it plays the enter/exit transition. */
	visible: boolean;
	/** Leading glyph. Pass `null` for none. */
	icon?: VNode | null;
	/** The one-line statement. Prefer this or `children`, not both. */
	text?: string;
	/** Rich statement (overrides `text` when both are given). */
	children?: ComponentChildren;
	/** Trailing control(s) — a retry, a "learn more" link. Keep it to one. */
	action?: ComponentChildren;
	/**
	 * How the statement is announced (default `polite`). A strip that appears because something
	 * stopped working is worth interrupting for; one that confirms recovery is not.
	 */
	live?: "polite" | "assertive";
	id?: string;
	/** Extra class(es) merged onto the strip. */
	class?: string;
}
// #endregion

/**
 * The exit grace before a withdrawn strip's content is dropped — the same instant the closed
 * state's delayed `visibility: hidden` lands (`--dur-medium`).
 */
const EXIT_MS = 250;

/**
 * Renders a `role="status"` strip pinned to the bottom of the viewport. The box is always mounted
 * — it is the live region — and EMPTY whenever the strip is hidden; its content is present only
 * while visible or during the exit transition.
 */
export function Ribbon(props: RibbonProps): JSX.Element {
	const { visible, icon, text, children, action, live = "polite", id, class: className } = props;
	const content = children ?? text;
	const stripRef = useRef<HTMLDivElement>(null);
	// `mounted` gates the CONTENT, not the box: true while visible and for the exit grace after.
	const { mounted, state } = usePresence(visible, EXIT_MS);

	// Reserve the room (see the docblock). Written from an effect, so SSR paints nothing and the
	// attribute only ever reflects a strip that is actually on screen.
	useEffect(() => {
		if (typeof document === "undefined") return;
		const root = document.documentElement;
		const release = () => {
			delete root.dataset.ribbon;
			root.style.removeProperty("--ribbon-inset");
		};
		if (!visible) {
			release();
			return;
		}
		root.dataset.ribbon = "open";

		// The measured reservation. `ResizeObserver` fires once on observe, so the first measurement
		// lands without a separate read; where it is absent the stylesheet's `--ribbon-h` floor stands.
		const strip = stripRef.current;
		if (!strip || typeof ResizeObserver === "undefined") return release;
		const ro = new ResizeObserver((entries) => {
			const h = entries[0]?.borderBoxSize?.[0]?.blockSize ?? strip.getBoundingClientRect().height;
			if (h > 0) root.style.setProperty("--ribbon-inset", `${Math.round(h)}px`);
		});
		ro.observe(strip);
		return () => {
			ro.disconnect();
			// An unmounting or closing open Ribbon must not leave the room reserved behind it.
			release();
		};
	}, [visible]);

	return (
		<div
			ref={stripRef}
			id={id}
			class={cx("ui-ribbon", className)}
			data-state={state}
			role="status"
			aria-live={live}
			aria-atomic="true"
		>
			{mounted && icon && <span class="ui-ribbon__icon" aria-hidden="true">{icon}</span>}
			{mounted && content !== undefined && <span class="ui-ribbon__text">{content}</span>}
			{mounted && action !== undefined && <span class="ui-ribbon__action">{action}</span>}
		</div>
	);
}
