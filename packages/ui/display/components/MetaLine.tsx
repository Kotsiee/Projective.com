import type { JSX } from "preact";
import "../styles/meta-line.css";
import { MetaLineMarkup, type MetaLineProps } from "../core/meta-line.tsx";

export type {
	MetaLineElement,
	MetaLineEntry,
	MetaLineProps,
	MetaLineSize,
} from "../core/meta-line.tsx";

/**
 * MetaLine — THE way non-actionable metadata reaches the screen (DESIGN_SYSTEM.md §B.11).
 *
 * Facts in the Meta register (§A.4) in `--text-secondary`, joined by an `aria-hidden` middot; figures
 * flagged `tabular` set in `tabular-nums`. No container, no border, no fill: a pill is a promise of
 * interactivity, and a fact that cannot be acted on makes no such promise. Renders nothing when every
 * entry is falsy. Zero client JS.
 */
export function MetaLine(props: MetaLineProps): JSX.Element | null {
	return MetaLineMarkup(props);
}
