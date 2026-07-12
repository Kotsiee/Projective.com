import type { ComponentChildren, JSX } from "preact";
import "../styles/portal.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";

// #region Props
/** Props for {@link Portal}. */
export interface PortalProps {
	/**
	 * Stacking context for the layer. Defaults to the `--z-overlay` token when omitted; pass the
	 * z-index handed out by {@link useOverlayStack} to participate in the managed overlay stack.
	 */
	zIndex?: number;
	/** Extra class(es) merged onto the layer root. */
	class?: string;
	/** Layer contents (backdrop + panel). */
	children?: ComponentChildren;
}
// #endregion

/**
 * Portal — the shared full-viewport layer every overlay renders into. This codebase does not use DOM
 * portals: the element is `position: fixed; inset: 0` and simply relies on being a stacking context at
 * a z-index token, so it visually escapes its ancestor without leaving the tree. The layer itself is
 * click-through (`pointer-events: none`); its direct children (backdrop, panel) opt back in. Purely
 * structural — no interactivity, so it is a server component.
 */
export function Portal(props: PortalProps): JSX.Element {
	const { zIndex, class: className, children } = props;
	return (
		<div
			class={cx("ui-portal", className)}
			style={zIndex !== undefined ? styleVars({ "--z-portal": String(zIndex) }) : undefined}
		>
			{children}
		</div>
	);
}
