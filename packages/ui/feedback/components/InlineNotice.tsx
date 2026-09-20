/**
 * InlineNotice — a quiet, unboxed one-line status for the EDGE of a region: the foot of a list whose
 * next page did not arrive, the tail of a feed that has stalled. One sentence in the meta register,
 * an optional leading glyph, and at most one underlined text action beside it.
 *
 * It exists because {@link Message} is the wrong shape for that job: a tinted, accent-railed block
 * appended under a grid of cards reads as a boxed item in the list rather than as a note about it,
 * which is the §B.4 finding in miniature. This draws no fill and no border — spacing and the
 * `--text-secondary` register are the only separation devices — so it never competes with the
 * content it is reporting on.
 *
 * Zero-JS server component: the action is a plain callback wired to a native `<button>`, and the
 * `busy` state is expressed as data, so a consumer's retry can disable the control while it runs.
 */
import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/inline-notice.css";
import { cx } from "../../core/cx.ts";
import { Button } from "../../fields/components/Button.tsx";

// #region Props
/** Props for {@link InlineNotice}. */
export interface InlineNoticeProps {
	/** The one-line statement. Prefer this or `children`, not both. */
	text?: string;
	/** Rich statement (overrides `text` when both are given). */
	children?: ComponentChildren;
	/** Leading glyph. Omit for none — a notice at a list's foot rarely needs one. */
	icon?: VNode;
	/** Label of the single text action (`"Retry"`). Rendered only when `onAction` is also given. */
	actionLabel?: string;
	/** Invoked when the action is activated. */
	onAction?: () => void;
	/** The action is in flight: the control is disabled and announced as busy, the words stay. */
	busy?: boolean;
	/**
	 * Announce assertively (default `false`, i.e. `role="status"`). A stalled page of results is not
	 * an interruption; a refused write is.
	 */
	assertive?: boolean;
	/** Horizontal alignment within its container (default `center`). */
	align?: "start" | "center";
	id?: string;
	class?: string;
}
// #endregion

/** Renders a `role="status"` line (or `role="alert"` when `assertive`) with an optional text action. */
export function InlineNotice(props: InlineNoticeProps): JSX.Element {
	const {
		text,
		children,
		icon,
		actionLabel,
		onAction,
		busy = false,
		assertive = false,
		align = "center",
		id,
		class: className,
	} = props;
	const content = children ?? text;

	return (
		<div
			id={id}
			class={cx("ui-inline-notice", `ui-inline-notice--${align}`, className)}
			role={assertive ? "alert" : "status"}
			aria-live={assertive ? "assertive" : "polite"}
			aria-busy={busy ? "true" : undefined}
		>
			{icon && <span class="ui-inline-notice__icon" aria-hidden="true">{icon}</span>}
			{content !== undefined && <span class="ui-inline-notice__text">{content}</span>}
			{actionLabel !== undefined && onAction !== undefined && (
				<Button
					variant="link"
					size="sm"
					label={actionLabel}
					class="ui-inline-notice__action"
					disabled={busy}
					onClick={onAction}
				/>
			)}
		</div>
	);
}
