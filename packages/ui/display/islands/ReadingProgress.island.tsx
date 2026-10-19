import "../styles/editorial.css";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { styleVars } from "../../core/style.ts";
import { readingRatio } from "../core/scroll-spy.ts";

// #region Props
/** Props for {@link ReadingProgress}. */
export interface ReadingProgressProps {
	/** The id of the element whose reading is measured (default `doc-article`, DocumentLayout's). */
	target?: string;
	/** The progress bar's accessible name (default "Reading progress"). */
	label?: string;
}
// #endregion

/**
 * ReadingProgress — a 2px bar pinned under the site header that fills as the reader moves through
 * the document (island). It is a `role="progressbar"` with `aria-valuenow` (whole percent) and an
 * `aria-valuetext` ("40% read") once measured, and is hidden — visually and from assistive
 * technology — until then, and for good on a document that scrolls less than half a viewport.
 *
 * Measured from the target's own box on every scroll and resize (a `ResizeObserver` catches images
 * and fonts arriving), never from the page, so the shell's header band and footer do not count as
 * reading. The bar's fill is `--doc-progress` → `transform: scaleX()` (reading-progress.css): no
 * geometry moves, and the reduced-motion channels collapse its easing to a jump.
 */
export default function ReadingProgress(
	{ target = "doc-article", label = "Reading progress" }: ReadingProgressProps,
): JSX.Element {
	const host = useRef<HTMLDivElement>(null);
	const state = useSignal<"idle" | "short" | "active">("idle");
	const permille = useSignal(0);

	useEffect(() => {
		const article = document.getElementById(target);
		const bar = host.current;
		if (!article || !bar) return;
		const measure = () => {
			const rect = article.getBoundingClientRect();
			const ratio = readingRatio({
				top: rect.top,
				height: rect.height,
				viewport: globalThis.innerHeight,
				// The sticky host's own resolved top IS the chrome's bottom edge (--doc-chrome-h).
				chrome: Number.parseFloat(getComputedStyle(bar).top) || 0,
			});
			if (ratio === null) {
				state.value = "short";
				return;
			}
			state.value = "active";
			permille.value = Math.round(ratio * 1000);
		};
		measure();
		globalThis.addEventListener("scroll", measure, { passive: true });
		globalThis.addEventListener("resize", measure);
		const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
		resize?.observe(article);
		return () => {
			globalThis.removeEventListener("scroll", measure);
			globalThis.removeEventListener("resize", measure);
			resize?.disconnect();
		};
	}, [target]);

	const active = state.value === "active";
	const percent = Math.round(permille.value / 10);
	return (
		<div
			ref={host}
			class="ui-reading-progress"
			data-state={state.value}
			role={active ? "progressbar" : undefined}
			aria-hidden={active ? undefined : "true"}
			aria-label={active ? label : undefined}
			aria-valuemin={active ? 0 : undefined}
			aria-valuemax={active ? 100 : undefined}
			aria-valuenow={active ? percent : undefined}
			aria-valuetext={active ? `${percent}% read` : undefined}
			style={styleVars({ "--doc-progress": (permille.value / 1000).toFixed(3) })}
		>
			<div class="ui-reading-progress__bar" />
		</div>
	);
}
