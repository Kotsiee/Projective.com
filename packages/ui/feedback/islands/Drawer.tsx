import type { ComponentChildren, JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import "../styles/drawer.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Portal } from "../../overlay/components/Portal.tsx";
import { Backdrop } from "../../overlay/islands/Backdrop.tsx";
import { usePresence } from "../../overlay/core/usePresence.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useId } from "../../hooks/useId.ts";
import type { Edge } from "../../types/mod.ts";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Props
/** Props for {@link Drawer} (aliased as {@link Sidebar}). */
export interface DrawerProps {
	/** Visibility — raw boolean (uncontrolled) or `Signal<boolean>` (controlled). */
	visible: Bindable<boolean>;
	/** Edge the panel docks to; `full` covers the viewport (default `left`). */
	position?: Edge;
	/** Header content — plain title string or a full node. */
	header?: string | VNode;
	/** Render a backdrop + trap focus + lock scroll (default `true`). */
	modal?: boolean;
	/** Allow outside-pointer / backdrop dismissal (default `true`). */
	dismissable?: boolean;
	/** Show the header close (×) button (default `true`). */
	closable?: boolean;
	/** Lock body scroll while open (default `true`). */
	blockScroll?: boolean;
	/** Close on Escape when top-most (default `true`). */
	closeOnEscape?: boolean;
	/** Panel extent along its docking axis (CSS length; width for left/right, height for top/bottom). */
	size?: string;
	/** Fired whenever visibility changes. */
	onVisibleChange?: (visible: boolean) => void;
	/** Extra class(es) merged onto the panel. */
	class?: string;
	/** Drawer body. */
	children?: ComponentChildren;
}
// #endregion

/**
 * Drawer — a panel that slides in from an {@link Edge} (a.k.a. Sidebar). Built on the shared overlay
 * pattern: {@link Portal} layer, {@link Backdrop}, managed z-index + scroll-lock, focus trap, and
 * Escape/outside dismissal (top-most only). `role="dialog"` with `aria-modal` + `aria-labelledby`
 * (when a header is given). Slide direction and resting axis follow `position`; `full` fills the
 * viewport. Token-duration enter/exit that collapses under reduced motion.
 */
export function Drawer(props: DrawerProps): JSX.Element | null {
	const {
		visible,
		position = "left",
		header,
		modal = true,
		dismissable = true,
		closable = true,
		blockScroll = true,
		closeOnEscape = true,
		size,
		onVisibleChange,
		class: className,
		children,
	} = props;

	const ctrl = useControllable<boolean>(visible, false, onVisibleChange);
	const isOpen = ctrl.signal.value;
	const { mounted, state } = usePresence(isOpen);

	const panelRef = useRef<HTMLDivElement>(null);
	const rootId = useId(undefined, "drawer");
	const titleId = `${rootId}-title`;

	const stack = useOverlayStack({
		active: mounted,
		lockScroll: blockScroll && modal,
		layer: "modal",
	});
	const close = () => ctrl.set(false);

	useFocusTrap({ active: mounted && modal, containerRef: panelRef });
	useDismiss({
		open: mounted,
		onDismiss: () => {
			if (stack.isTop) close();
		},
		panelRef,
		closeOnEscape,
		closeOnOutside: false,
	});

	if (!mounted) return null;

	const axis = position === "left" || position === "right" ? "inline" : "block";
	const sizeVars = size
		? styleVars(axis === "inline" ? { "--drawer-size": size } : { "--drawer-size-block": size })
		: undefined;

	return (
		<Portal zIndex={stack.zIndex}>
			{modal && <Backdrop visible={state === "open"} onClick={dismissable ? close : undefined} />}
			<div
				ref={panelRef}
				role="dialog"
				aria-modal={modal || undefined}
				aria-labelledby={header !== undefined ? titleId : undefined}
				data-state={state}
				class={cx("ui-drawer", `ui-drawer--${position}`, className)}
				style={sizeVars}
				tabIndex={-1}
			>
				{(header !== undefined || closable) && (
					<div class="ui-drawer__header">
						{header !== undefined && <h2 id={titleId} class="ui-drawer__title">{header}</h2>}
						{closable && (
							<button
								type="button"
								class="ui-drawer__close"
								aria-label="Close"
								onClick={close}
							>
								×
							</button>
						)}
					</div>
				)}
				<div class="ui-drawer__body">{children}</div>
			</div>
		</Portal>
	);
}

/** PrimeReact-parity alias for {@link Drawer}. */
export const Sidebar = Drawer;
