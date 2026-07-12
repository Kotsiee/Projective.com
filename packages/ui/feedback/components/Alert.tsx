/**
 * Alert — a larger, page-level status surface with a title, description, optional action slot, and
 * an optional close control. `Banner` is the full-width modifier of the same component (e.g. a
 * top-of-page system notice) — pass `banner` or use the `Banner` alias. Zero-JS server component:
 * `onClose` is a plain callback prop, matching {@link Message}.
 */
import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/alert.css";
import { cx } from "../../core/cx.ts";
import { closeIcon, severityIcon } from "../core/icons.tsx";
import type { Severity } from "../../fields/types/mod.ts";

// #region Props
export type AlertVariant = "filled" | "outlined" | "subtle";

export interface AlertProps {
	/** Semantic colour ramp (default `info`). */
	severity?: Severity;
	/** Bold heading line. */
	title?: ComponentChildren;
	/** Supporting description below the title. */
	description?: ComponentChildren;
	/** Body content (used instead of `description` when richer markup is needed). */
	children?: ComponentChildren;
	/** Leading icon; pass `null` to render none, omit for the severity default. */
	icon?: VNode | null;
	/** Trailing action row (buttons/links) rendered under the description. */
	actions?: ComponentChildren;
	/** Show a trailing dismiss button. */
	closable?: boolean;
	/** Invoked when the dismiss button is activated. */
	onClose?: () => void;
	/** Fill treatment (default `subtle`). */
	variant?: AlertVariant;
	/** Stretch edge-to-edge and drop the standalone corner radius — the "Banner" placement. */
	banner?: boolean;
	id?: string;
	class?: string;
}
// #endregion

/**
 * `role="alert"` (assertive) for `warning`/`danger`; `role="status"` (polite) otherwise — same
 * escalation rule as `Message`.
 */
export function Alert(props: AlertProps): JSX.Element {
	const {
		severity = "info",
		title,
		description,
		children,
		icon,
		actions,
		closable,
		onClose,
		variant = "subtle",
		banner,
		id,
		class: className,
	} = props;

	const assertive = severity === "warning" || severity === "danger";
	const shownIcon = icon === null ? null : icon ?? severityIcon(severity);
	const body = children ?? description;

	return (
		<div
			id={id}
			class={cx(
				"ui-alert",
				`ui-alert--${severity}`,
				`ui-alert--${variant}`,
				banner && "ui-alert--banner",
				className,
			)}
			role={assertive ? "alert" : "status"}
			aria-live={assertive ? "assertive" : "polite"}
		>
			{shownIcon && <span class="ui-alert__icon" aria-hidden="true">{shownIcon}</span>}
			<div class="ui-alert__content">
				{title !== undefined && <div class="ui-alert__title">{title}</div>}
				{body !== undefined && <div class="ui-alert__description">{body}</div>}
				{actions !== undefined && <div class="ui-alert__actions">{actions}</div>}
			</div>
			{closable && (
				<button type="button" class="ui-alert__close" aria-label="Close alert" onClick={onClose}>
					{closeIcon()}
				</button>
			)}
		</div>
	);
}

/** `Banner` — the full-width Alert placement, e.g. a top-of-page system notice. */
export function Banner(props: Omit<AlertProps, "banner">): JSX.Element {
	return <Alert {...props} banner />;
}
