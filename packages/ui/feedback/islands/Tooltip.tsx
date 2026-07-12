import type { ComponentChildren, JSX, VNode } from "preact";
import { useRef, useState } from "preact/hooks";
import "../styles/tooltip.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { usePresence } from "../../overlay/core/usePresence.ts";
import { useId } from "../../hooks/useId.ts";
import type { Placement } from "../../types/mod.ts";

// #region Props
/** Props for {@link Tooltip}. */
export interface TooltipProps {
	/** Tooltip text or node. */
	content: string | VNode;
	/** Anchor element — wrapped in an inline span that carries the ref + listeners. */
	children: ComponentChildren;
	/** Preferred side/alignment; flips on overflow (default `top`). */
	placement?: Placement;
	/** Delay before showing on hover/focus, ms (default 150). */
	showDelay?: number;
	/** Delay before hiding on leave/blur, ms (default 0). */
	hideDelay?: number;
	/** Gap between anchor and tooltip, px (default 6). */
	offset?: number;
	/** Extra class(es) merged onto the tooltip surface. */
	class?: string;
}
// #endregion

/**
 * Tooltip — a hover/focus micro-popup describing its anchor. Positioned by {@link useFloating} (flips
 * on overflow) and wired with `role="tooltip"` + `aria-describedby` so it is announced. Opens on
 * pointer-enter/focus after `showDelay`, hides on leave/blur/Escape. Escape closes it immediately.
 * Presence keeps it mounted through a short exit fade that collapses under reduced motion.
 */
export function Tooltip(props: TooltipProps): JSX.Element {
	const {
		content,
		children,
		placement = "top",
		showDelay = 150,
		hideDelay = 0,
		offset = 6,
		class: className,
	} = props;

	const triggerRef = useRef<HTMLSpanElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const timer = useRef<number | undefined>(undefined);
	const tipId = useId(undefined, "tooltip");

	const [open, setOpen] = useState(false);
	const floating = useFloating({ open, triggerRef, panelRef, placement, offset });
	const { mounted, state } = usePresence(open, 150);

	// #region Scheduling
	const clearTimer = () => {
		if (timer.current !== undefined) clearTimeout(timer.current);
		timer.current = undefined;
	};
	const show = () => {
		clearTimer();
		timer.current = setTimeout(() => setOpen(true), showDelay) as unknown as number;
	};
	const hide = () => {
		clearTimer();
		timer.current = setTimeout(() => setOpen(false), hideDelay) as unknown as number;
	};
	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLSpanElement>) => {
		if (e.key === "Escape" && open) {
			clearTimer();
			setOpen(false);
		}
	};
	// #endregion

	return (
		<span
			ref={triggerRef}
			class="ui-tooltip__anchor"
			aria-describedby={mounted ? tipId : undefined}
			onPointerEnter={show}
			onPointerLeave={hide}
			onFocusIn={show}
			onFocusOut={hide}
			onKeyDown={onKeyDown}
		>
			{children}
			{mounted && (
				<div
					ref={panelRef}
					id={tipId}
					role="tooltip"
					data-state={state}
					class={cx(
						"ui-tooltip",
						`ui-tooltip--${floating?.placement ?? placement}`,
						className,
					)}
					style={floating
						? styleVars({
							"--float-top": `${floating.top}px`,
							"--float-left": `${floating.left}px`,
						})
						: undefined}
				>
					{content}
				</div>
			)}
		</span>
	);
}
