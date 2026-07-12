import type { ComponentChildren, JSX } from "preact";
import "../styles/badge.css";
import { cx } from "../../core/cx.ts";
import type { FieldSize, Severity } from "../../fields/types/mod.ts";

// #region Badge
export interface BadgeProps {
	/** Count/status content. Omit (or set `dot`) for a bare status dot. */
	value?: string | number;
	/** Semantic colour ramp (default `primary`). */
	severity?: Severity;
	/** Size ramp (default `md`). */
	size?: FieldSize;
	/** Force the dot treatment (no value text) regardless of `value`. */
	dot?: boolean;
	/** Pill corners (default `true`); `false` uses the base radius token instead. */
	rounded?: boolean;
	class?: string;
	/** Accessible name. Omit on purely decorative badges (they're `aria-hidden` instead). */
	"aria-label"?: string;
}

/**
 * Badge — a small count/status pill. Renders as a bare dot when `dot` is set or `value` is omitted;
 * otherwise shows `value` text. Decorative by default (`aria-hidden`) unless `aria-label` is given, in
 * which case it takes `role="status"` so assistive tech announces it. Zero client JS.
 */
export function Badge(props: BadgeProps): JSX.Element {
	const {
		value,
		severity = "primary",
		size = "md",
		dot,
		rounded = true,
		class: className,
		"aria-label": ariaLabel,
	} = props;

	const isDot = dot || value === undefined;

	return (
		<span
			class={cx(
				"ui-badge",
				`ui-badge--${severity}`,
				`ui-badge--size-${size}`,
				isDot && "ui-badge--dot",
				rounded && "ui-badge--rounded",
				className,
			)}
			role={ariaLabel ? "status" : undefined}
			aria-label={ariaLabel}
			aria-hidden={!ariaLabel ? "true" : undefined}
		>
			{!isDot && value}
		</span>
	);
}
// #endregion

// #region OverlayBadge
export interface OverlayBadgeProps {
	/** The element the badge is pinned to the corner of. */
	children: ComponentChildren;
	/** Props forwarded to the inner {@link Badge} (position/corner is controlled by CSS). */
	badge?: BadgeProps;
	class?: string;
}

/**
 * OverlayBadge — wraps `children` in a relatively-positioned box and pins a {@link Badge} at its
 * top-right corner (the same corner-badge treatment as `Button`'s `badge` prop, generalised to any
 * content). Zero client JS.
 */
export function OverlayBadge(props: OverlayBadgeProps): JSX.Element {
	const { children, badge, class: className } = props;
	return (
		<span class={cx("ui-overlay-badge", className)}>
			{children}
			<Badge {...badge} class={cx("ui-overlay-badge__badge", badge?.class)} />
		</span>
	);
}
// #endregion
