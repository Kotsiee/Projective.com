/**
 * Message — an inline, static status block (PrimeNG `Message` parity). Zero-JS server component:
 * `closable` is expressed purely as an `onClose` callback wired to a native `<button>`, so the block
 * itself never owns state (see {@link Messages} for a stateful, auto-dismissing stack of these).
 */
import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/message.css";
import { cx } from "../../core/cx.ts";
import { closeIcon, severityIcon } from "../core/icons.tsx";
import type { FieldSize, Severity } from "../../fields/types/mod.ts";

// #region Props
/** Fill treatment: `subtle` (default) tints the surface with a leading accent bar and no border —
 * the separation-hierarchy-safe choice for non-interactive content. `filled` raises the tint to a
 * solid accent background. `outlined` adds a full hairline border (opt-in, mirrors `Button`). */
export type MessageVariant = "filled" | "outlined" | "subtle";

export interface MessageProps {
	/** Semantic colour ramp (default `info`). */
	severity?: Severity;
	/** Message body as plain text; prefer this or `children`, not both. */
	text?: string;
	/** Rich body content (overrides `text` when both are given). */
	children?: ComponentChildren;
	/** Leading icon. Pass `null` to render no icon at all; omit to use the severity default. */
	icon?: VNode | null;
	/** Show a trailing dismiss button. Requires `onClose` to actually remove the block. */
	closable?: boolean;
	/** Invoked when the dismiss button is activated. */
	onClose?: () => void;
	/** Fill treatment (default `subtle`). */
	variant?: MessageVariant;
	/** Size ramp (default `md`). */
	size?: FieldSize;
	id?: string;
	class?: string;
}
// #endregion

/**
 * Renders a `role="alert"` (assertive) block for `warning`/`danger` severities — status the user did
 * not ask for and must notice — and `role="status"` (polite) for the rest.
 */
export function Message(props: MessageProps): JSX.Element {
	const {
		severity = "info",
		text,
		children,
		icon,
		closable,
		onClose,
		variant = "subtle",
		size = "md",
		id,
		class: className,
	} = props;

	const content = children ?? text;
	const assertive = severity === "warning" || severity === "danger";
	const shownIcon = icon === null ? null : icon ?? severityIcon(severity);

	return (
		<div
			id={id}
			class={cx(
				"ui-message",
				`ui-message--${severity}`,
				`ui-message--${variant}`,
				`ui-message--size-${size}`,
				className,
			)}
			role={assertive ? "alert" : "status"}
			aria-live={assertive ? "assertive" : "polite"}
		>
			{shownIcon && <span class="ui-message__icon" aria-hidden="true">{shownIcon}</span>}
			{content !== undefined && <span class="ui-message__text">{content}</span>}
			{closable && (
				<button
					type="button"
					class="ui-message__close"
					aria-label="Close message"
					onClick={onClose}
				>
					{closeIcon()}
				</button>
			)}
		</div>
	);
}
