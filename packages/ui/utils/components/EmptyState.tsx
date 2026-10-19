import type { JSX } from "preact";
import "../styles/empty-state.css";
import { EmptyStateMarkup, type EmptyStateProps } from "../core/empty-state.tsx";

export type { EmptyStateProps } from "../core/empty-state.tsx";

/**
 * EmptyState — a zero-JS placeholder for empty collections, zero-result searches, and first-run
 * screens. Centres an optional icon, a title, supporting copy, an optional body (`children`) and an
 * actions slot on a tonal surface tint with no four-sided border (separation via spacing + tint, §B.4).
 * Announced as a `status` region so assistive tech reads the reason a view is empty. The markup is the
 * stylesheet-free `core/empty-state.tsx`, so its slot order is unit-tested.
 */
export function EmptyState(props: EmptyStateProps): JSX.Element {
	return EmptyStateMarkup(props);
}
