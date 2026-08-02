import type { JSX } from "preact";
import "../styles/dnd.css";
import { cx } from "../../core/cx.ts";

// #region Types
/** Props for {@link DropIndicator}. */
export interface DropIndicatorProps {
	/** Whether the indicator is showing. Render it unconditionally and flip this — it animates. */
	active: boolean;
	/**
	 * The axis the list flows along. A vertical list (the common case) shows a horizontal rule
	 * BETWEEN two rows; a horizontal list shows a vertical one between two columns.
	 */
	orientation?: "vertical" | "horizontal";
	/**
	 * Reserve the indicator's own height while inactive, so revealing it does not shift the rows
	 * around it. Off by default — a list whose gap already exceeds the rule can absorb it.
	 */
	reserveSpace?: boolean;
	class?: string;
}
// #endregion

/**
 * DropIndicator — the precise landing line a sortable list draws at the insertion point.
 *
 * The drag ghost tells you WHAT you are moving; it cannot tell you where it will land, and a
 * highlighted neighbour cannot either — "this row is the target" leaves before-or-after unanswered
 * at exactly the moment the answer matters. This draws the seam itself: a full-width rule with a
 * terminal knob marking the leading edge, so the landing position is unambiguous at a glance.
 *
 * Purely presentational and controlled: the consumer decides where it renders from its own
 * collision state (typically `isOver` plus a midpoint comparison), which keeps it correct under a
 * controlled reorder model. Under reduced motion it appears at full extent rather than growing.
 *
 * @example Between two sortable rows.
 * ```tsx
 * <DropIndicator active={isOver.value && before} />
 * <li ref={sortable.setNodeRef}>…</li>
 * ```
 */
export function DropIndicator(
	{ active, orientation = "vertical", reserveSpace, class: className }: DropIndicatorProps,
): JSX.Element {
	return (
		<div
			class={cx("ui-drop-indicator", className)}
			data-active={active ? "true" : undefined}
			data-orientation={orientation}
			data-reserved={reserveSpace ? "true" : undefined}
			aria-hidden="true"
		>
			<span class="ui-drop-indicator__knob" />
			<span class="ui-drop-indicator__rule" />
		</div>
	);
}
