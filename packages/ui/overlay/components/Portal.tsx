import type { ComponentChildren, JSX } from "preact";
import "../styles/portal.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { BodyPortal } from "./BodyPortal.tsx";

// #region Props
/** Props for {@link Portal}. */
export interface PortalProps {
	/**
	 * Stacking context for the layer. Defaults to the `--z-overlay` token when omitted; pass the
	 * z-index handed out by {@link useOverlayStack} to participate in the managed overlay stack.
	 */
	zIndex?: number;
	/**
	 * Project the layer into `document.body` (default `true`). Escapes every ancestor's stacking
	 * context, `overflow`, and `transform`/`filter`/`backdrop-filter`. Set `false` only for a layer
	 * that must stay inside its subtree (e.g. one deliberately scoped to a sub-surface).
	 */
	toBody?: boolean;
	/** Extra class(es) merged onto the layer root. */
	class?: string;
	/** Layer contents (backdrop + panel). */
	children?: ComponentChildren;
}
// #endregion

/**
 * Portal — the shared full-viewport layer every overlay renders into: `position: fixed; inset: 0` at a
 * managed z-index token. The layer itself is click-through (`pointer-events: none`); its direct
 * children (backdrop, panel) opt back in.
 *
 * By default the layer is projected into `document.body` via {@link BodyPortal}. Staying in the tree
 * is not sufficient for a fixed layer: an ancestor with `overflow: clip` clips fixed descendants
 * outright, an ancestor with `transform`/`filter`/`backdrop-filter` re-bases them onto its own box,
 * and an ancestor that is a stacking context (e.g. a `position: sticky` nav lane) caps the whole
 * subtree's paint order no matter how high the layer's own z-index is. The authenticated shell's
 * middle-nav lane hits all three, so a Dialog/Drawer opened from the lane was clipped away entirely.
 *
 * SSR renders the layer inline (`BodyPortal` is client-only), which only matters for the rare overlay
 * that is already open on the first byte — every overlay here mounts on user action.
 */
export function Portal(props: PortalProps): JSX.Element {
	const { zIndex, toBody = true, class: className, children } = props;

	const layer = (
		<div
			class={cx("ui-portal", className)}
			style={zIndex !== undefined ? styleVars({ "--z-portal": String(zIndex) }) : undefined}
		>
			{children}
		</div>
	);

	if (!toBody || typeof document === "undefined") return layer;
	return (
		<>
			<BodyPortal>{layer}</BodyPortal>
		</>
	);
}
