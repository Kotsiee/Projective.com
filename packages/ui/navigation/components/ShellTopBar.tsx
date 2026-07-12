import type { ComponentChildren, JSX } from "preact";
import "../styles/top-bar.css";
import { cx } from "../../core/cx.ts";

export interface ShellTopBarProps {
	/** Glass treatment (transparent + `backdrop-filter` blur). Forced on guest/mobile (Part D.3). */
	glass?: boolean;
	/** Leading slot — brand/wordmark, and the mobile menu button. */
	brand?: ComponentChildren;
	/** Centered slot — the mobile micro search bar (Part D.3). */
	center?: ComponentChildren;
	/** Trailing actions (search, notifications, theme toggle, avatar). */
	children?: ComponentChildren;
}

/** ShellTopBar — the Red-zone top horizontal utility bar. */
export function ShellTopBar(
	{ glass, brand, center, children }: ShellTopBarProps,
): JSX.Element {
	return (
		<header class={cx("ui-shell-topbar", glass && "ui-shell-topbar--glass")}>
			<div class="ui-shell-topbar__lead">{brand}</div>
			{center ? <div class="ui-shell-topbar__center">{center}</div> : null}
			<div class="ui-shell-topbar__actions">{children}</div>
		</header>
	);
}
