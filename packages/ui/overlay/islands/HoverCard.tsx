import type { ComponentChildren, JSX, VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "../styles/hover-card.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { usePresence } from "../core/usePresence.ts";
import { BodyPortal } from "../components/BodyPortal.tsx";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { useId } from "../../hooks/useId.ts";
import type { Placement } from "../../types/mod.ts";

// #region Props
/** Props for {@link HoverCard}. */
export interface HoverCardProps {
	/** The anchor — its hover/focus opens the card. Wrapped in an inline span carrying the ref. */
	children: ComponentChildren;
	/** Card contents (a rich preview: avatar, meta, actions…). */
	card: VNode | (() => VNode);
	/** Preferred side/alignment; flips on overflow (default `bottom-start`). */
	placement?: Placement;
	/** Delay before opening on hover/focus, ms (default 300). */
	openDelay?: number;
	/** Delay before closing on leave/blur, ms (default 200). */
	closeDelay?: number;
	/** Gap between anchor and card, px (default 8). */
	offset?: number;
	/** Extra class(es) merged onto the card panel. */
	class?: string;
}
// #endregion

/**
 * HoverCard — an anchored, non-modal rich preview revealed when its trigger is hovered or focused,
 * with independent open/close delays so brief cursor transits don't flicker it. Positioned by
 * {@link useFloating} (flips on overflow) and kept mounted through an exit transition. Keyboard users
 * get it on focus; it never steals focus. Pointer over the card cancels the close timer so the
 * contents stay reachable.
 *
 * The panel renders through {@link BodyPortal} — a real `document.body` DOM portal — so a HoverCard
 * nested inside a transformed/filtered ancestor still resolves its `position: fixed` against the
 * viewport instead of the ancestor's box (the glass-blur fixed-overlay trap). The portal tears its
 * container + subtree down when the card closes.
 */
export function HoverCard(props: HoverCardProps): JSX.Element {
	const {
		children,
		card,
		placement = "bottom-start",
		openDelay = 300,
		closeDelay = 200,
		offset = 8,
		class: className,
	} = props;

	const triggerRef = useRef<HTMLSpanElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const timer = useRef<number | undefined>(undefined);
	const cardId = useId(undefined, "hovercard");

	const [open, setOpen] = useState(false);
	const floating = useFloating({ open, triggerRef, panelRef, placement, offset });
	const { mounted, state } = usePresence(open, 150);
	// Joins the managed stack rather than pinning a static `--z-overlay`, which sat at the popover base
	// and therefore rendered BEHIND any open Dialog.
	const stack = useOverlayStack({ active: mounted, layer: "popover" });

	// #region Open / close scheduling
	const clearTimer = () => {
		if (timer.current !== undefined) clearTimeout(timer.current);
		timer.current = undefined;
	};
	const schedule = (next: boolean, delay: number) => {
		clearTimer();
		timer.current = setTimeout(() => setOpen(next), delay) as unknown as number;
	};
	const scheduleOpen = () => schedule(true, openDelay);
	const scheduleClose = () => schedule(false, closeDelay);
	// #endregion

	// WCAG 2.1 SC 1.4.13 (Content on Hover or Focus) requires hover-revealed content to be dismissable
	// without moving the pointer. Escape closes it immediately.
	useEffect(() => {
		if (!mounted) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			clearTimer();
			setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [mounted]);

	return (
		<span
			ref={triggerRef}
			class="ui-hovercard"
			onPointerEnter={scheduleOpen}
			onPointerLeave={scheduleClose}
			onFocusIn={scheduleOpen}
			onFocusOut={scheduleClose}
			aria-describedby={mounted ? cardId : undefined}
		>
			{children}
			{mounted && (
				<BodyPortal>
					<div
						ref={panelRef}
						id={cardId}
						data-state={state}
						class={cx(
							"ui-hovercard__panel",
							floating?.placement.startsWith("top") && "ui-hovercard__panel--top",
							className,
						)}
						// No `role="tooltip"` and no `aria-hidden`. The card holds a rich, pointer-reachable
						// preview, which a tooltip role misdescribes — and marking it hidden while the anchor
						// pointed `aria-describedby` at it meant the description resolved to nothing at all.
						style={styleVars({
							"--float-top": floating ? `${floating.top}px` : undefined,
							"--float-left": floating ? `${floating.left}px` : undefined,
							"--z-portal": String(stack.zIndex),
						})}
						onPointerEnter={clearTimer}
						onPointerLeave={scheduleClose}
					>
						{typeof card === "function" ? card() : card}
					</div>
				</BodyPortal>
			)}
		</span>
	);
}
