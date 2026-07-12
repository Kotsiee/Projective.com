import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";

// #region Props
/** Props for {@link FocusTrap}. */
export interface FocusTrapProps {
	/** Confine focus within the container while `true` (default `true`). */
	active?: boolean;
	/** Restore focus to the previously-focused element when deactivated (default `true`). */
	restoreFocus?: boolean;
	/** Content whose focusable descendants are trapped. */
	children?: ComponentChildren;
	class?: string;
}
// #endregion

/**
 * FocusTrap — a thin declarative wrapper around {@link useFocusTrap}. While `active`, Tab / Shift+Tab
 * cycle only through the focusable descendants of this container, initial focus moves inside on
 * activation, and focus is restored to the prior element on deactivation. Non-modal by itself (no
 * scrim); compose it inside a dialog/drawer for a full modal. SSR-safe (the trap is a client effect).
 */
export function FocusTrap(props: FocusTrapProps): JSX.Element {
	const { active = true, restoreFocus = true, children, class: className } = props;
	const containerRef = useRef<HTMLDivElement>(null);

	useFocusTrap({ active, containerRef, restoreFocus });

	return (
		<div ref={containerRef} class={cx("ui-focus-trap", className)}>
			{children}
		</div>
	);
}
