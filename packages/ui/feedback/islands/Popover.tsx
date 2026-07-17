import type { ComponentChildren, JSX, RefObject, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/popover.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { usePresence } from "../../overlay/core/usePresence.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { useId } from "../../hooks/useId.ts";
import type { Placement } from "../../types/mod.ts";
import type { BoundarySource, Side } from "../../hooks/useFloating.ts";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Props
/** Imperative handle passed to the {@link PopoverProps.trigger} render-prop. */
export interface PopoverTriggerApi {
	/** Attach to the trigger element so the popover can anchor to it. */
	ref: RefObject<HTMLElement>;
	/** Toggle open/closed. */
	toggle: () => void;
	/** Open the popover. */
	open: () => void;
	/** Close the popover. */
	close: () => void;
	/** Current open state (wire to `aria-expanded`). */
	expanded: boolean;
	/** Id of the popover panel (wire to `aria-controls`). */
	panelId: string;
}

/** Props for {@link Popover} (aliased as {@link OverlayPanel}). */
export interface PopoverProps {
	/** Controlled/uncontrolled open state. */
	open?: Bindable<boolean>;
	/** Render-prop for the trigger; receives {@link PopoverTriggerApi}. Mutually exclusive with `targetRef`. */
	trigger?: (api: PopoverTriggerApi) => VNode;
	/** Anchor an external element instead of a render-prop trigger; clicking it toggles the panel. */
	targetRef?: RefObject<HTMLElement>;
	/** Preferred side/alignment; flips on overflow (default `bottom-start`). */
	placement?: Placement;
	/**
	 * Higher-level layout zones the panel must never intersect (the site-nav sidebar, the header). It
	 * shifts clear of each — e.g. avoiding a left sidebar pushes the panel right, past a
	 * `bottom-end`/viewport clamp that would otherwise let it slide under the rail. Accepts CSS
	 * selectors (re-measured live), refs, or rects (see `BoundarySource`).
	 */
	avoid?: readonly BoundarySource[];
	/**
	 * Viewport edges the panel MAY overflow into a lower-level zone (e.g. a header search dropping into
	 * the body). Relaxes the viewport clamp on those sides; `avoid` zones still constrain.
	 */
	allowOverflow?: readonly Side[];
	/** Render a small directional arrow toward the anchor. */
	arrow?: boolean;
	/** Match the panel width to the anchor. */
	matchWidth?: boolean;
	/** Outside-pointer dismissal (default `true`). */
	dismissable?: boolean;
	/** Close on Escape (default `true`). */
	closeOnEscape?: boolean;
	/** Fired whenever the open state changes. */
	onOpenChange?: (open: boolean) => void;
	/** Extra class(es) merged onto the panel. */
	class?: string;
	/** Panel contents. */
	children?: ComponentChildren;
}
// #endregion

/**
 * Popover — a click-triggered, anchored flyout holding arbitrary content (also exported as
 * {@link OverlayPanel}). Anchored by {@link useFloating} (flips on overflow), dismissed on
 * outside-pointer/Escape ({@link useDismiss}), and focus-managed by {@link useFocusTrap} (initial
 * focus in, restore out, Tab cycles). `role="dialog"`; the trigger wires `aria-expanded`/`aria-controls`
 * via the render-prop api. An optional arrow points at the anchor. Presence animates the exit.
 */
export function Popover(props: PopoverProps): JSX.Element {
	const {
		open,
		trigger,
		targetRef,
		placement = "bottom-start",
		avoid,
		allowOverflow,
		arrow = false,
		matchWidth = false,
		dismissable = true,
		closeOnEscape = true,
		onOpenChange,
		class: className,
		children,
	} = props;

	const ctrl = useControllable<boolean>(open, false, onOpenChange);
	const isOpen = ctrl.signal.value;
	const { mounted, state } = usePresence(isOpen, 150);

	const localTriggerRef = useRef<HTMLElement>(null);
	const anchorRef = targetRef ?? localTriggerRef;
	const panelRef = useRef<HTMLDivElement>(null);
	const panelId = useId(undefined, "popover");

	const stack = useOverlayStack({ active: mounted });
	const floating = useFloating({
		open: mounted,
		triggerRef: anchorRef,
		panelRef,
		placement,
		matchWidth,
		avoid,
		allowOverflow,
	});

	const openFn = () => ctrl.set(true);
	const closeFn = () => ctrl.set(false);
	const toggle = () => ctrl.set(!ctrl.get());

	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({
		open: mounted,
		onDismiss: () => {
			if (stack.isTop) closeFn();
		},
		panelRef,
		triggerRef: anchorRef,
		closeOnEscape,
		closeOnOutside: dismissable,
	});

	// #region External-anchor wiring
	useEffect(() => {
		const el = targetRef?.current;
		if (!el) return;
		const onClick = () => toggle();
		el.addEventListener("click", onClick);
		el.setAttribute("aria-haspopup", "dialog");
		el.setAttribute("aria-controls", panelId);
		return () => el.removeEventListener("click", onClick);
	}, [targetRef?.current]);

	useEffect(() => {
		targetRef?.current?.setAttribute("aria-expanded", String(isOpen));
	}, [isOpen, targetRef?.current]);
	// #endregion

	const api: PopoverTriggerApi = {
		ref: localTriggerRef,
		toggle,
		open: openFn,
		close: closeFn,
		expanded: isOpen,
		panelId,
	};

	return (
		<>
			{trigger?.(api)}
			{mounted && (
				<div
					ref={panelRef}
					id={panelId}
					role="dialog"
					data-state={state}
					class={cx(
						"ui-popover",
						arrow && "ui-popover--arrow",
						`ui-popover--${floating?.placement ?? placement}`,
						className,
					)}
					style={styleVars({
						"--float-top": floating ? `${floating.top}px` : undefined,
						"--float-left": floating ? `${floating.left}px` : undefined,
						"--float-width": floating && matchWidth ? `${floating.width}px` : undefined,
						"--z-portal": String(stack.zIndex),
					})}
					tabIndex={-1}
				>
					{arrow && <span class="ui-popover__arrow" aria-hidden="true" />}
					<div class="ui-popover__content">{children}</div>
				</div>
			)}
		</>
	);
}

/** PrimeReact-parity alias for {@link Popover}. */
export const OverlayPanel = Popover;
