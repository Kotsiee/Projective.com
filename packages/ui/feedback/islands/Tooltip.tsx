import type { ComponentChildren, JSX, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/tooltip.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { usePresence } from "../../overlay/core/usePresence.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import { useId } from "../../hooks/useId.ts";
import { pushEscapeLayer } from "../../hooks/escape-stack.ts";
import type { Placement } from "../../types/mod.ts";

// #region Props
/** Props for {@link Tooltip}. */
export interface TooltipProps {
	/** Tooltip text or node; `""` keeps it closed, and closes it if it is open. */
	content: string | VNode;
	/** Anchor element — wrapped in an inline span that carries the ref + listeners. */
	children: ComponentChildren;
	/** Preferred side/alignment; flips on overflow (default `top`). */
	placement?: Placement;
	/**
	 * Hover/focus intent before showing: `none` 0ms (a rail whose labels are hidden) · `fast` 150ms ·
	 * `slow` 350ms (prose that would flash past a passing pointer) · or a number of ms (default `fast`).
	 */
	delay?: "none" | "fast" | "slow" | number;
	/** `compact` is the dense-toolbar size (calendar and board utility rigs); default `default`. */
	density?: "default" | "compact";
	/** `inverted` high-contrast chip (default) or a raised `surface` panel. */
	variant?: "inverted" | "surface";
	/** Status tone (default `neutral`): filled on `inverted`, an opaque status tint on `surface`. */
	tone?: "neutral" | "warning" | "danger";
	/**
	 * Keyboard shortcut rendered as `<kbd>` after the label: one chord, or alternative chords. Shown
	 * only when the reader opted in — `<html data-tooltip-shortcuts="on">`, painted by the host app
	 * like `data-motion` — so the label must make sense without it.
	 */
	shortcut?: string | string[];
	/** The pointer may move onto the tooltip without it closing (WCAG 1.4.13 hoverable). */
	interactive?: boolean;
	/**
	 * A full-text reveal: open only while text inside the anchor is clipped — an ellipsized label, or
	 * one collapsed to a visually-hidden box — measured on each show. The anchor then shrinks with its
	 * row (`ui-tooltip__anchor--truncate`), so the ellipsis chain through it to the label holds.
	 */
	whenTruncated?: boolean;
	/**
	 * A press on the anchor (click, tap, Enter/Space on the button it holds) opens it at once and pins
	 * it until a second press, Escape, blur, or a press outside the anchor and the tooltip — so a touch
	 * reader, who never hovers, can read it. While pinned it is the top Escape layer, so Escape closes
	 * it and not the dialog it sits in. The anchor must hold a focusable `<button>`.
	 */
	toggleOnPress?: boolean;
	/** Gap between anchor and tooltip, px (default 6). */
	offset?: number;
	/** Extra class(es) merged onto the tooltip surface. */
	class?: string;
}
// #endregion

/**
 * The `delay` presets. They match `--dur-fast` / `--dur-slow` but are not read from them: those
 * collapse to 0ms under reduced motion, and the hover delay is intent, not motion.
 */
const DELAY_MS = { none: 0, fast: 150, slow: 350 } as const;

/** Time an `interactive` tooltip stays up while the pointer crosses the `offset` gap onto it. */
const INTERACTIVE_GRACE_MS = 150;

/** Some box in the anchor (itself included) is narrower than its content and clips it. */
function clipsText(anchor: HTMLElement): boolean {
	return [anchor, ...anchor.querySelectorAll("*")].some((el) => el.scrollWidth > el.clientWidth);
}

/**
 * Tooltip — a hover/focus micro-popup describing its anchor. Positioned by {@link useFloating} (flips
 * on overflow) and wired with `role="tooltip"` + `aria-describedby` so it is announced, shortcut
 * included. Opens on pointer-enter or keyboard (`:focus-visible`) focus after `delay`, hides on
 * leave/blur; Escape closes it from anywhere while it is up. It also never outlives its use: a press
 * on the anchor (pointer, Enter or Space) closes it and keeps it shut until the pointer leaves or focus
 * moves on; a pointer move outside the anchor and the panel closes a hover-opened one whose leave was
 * missed (an anchor re-rendered, hidden or moved under a still pointer); and leaving the window or the
 * tab closes it. `toggleOnPress` adds a pinned state a press opens and closes, for touch, instead of
 * the press dismissal. Presence keeps it mounted through a short exit fade that collapses under
 * reduced motion. The pending timer is cancelled on every re-schedule and on unmount.
 *
 * The panel renders through {@link BodyPortal} — a real `document.body` DOM portal — so a Tooltip
 * nested inside a transformed/filtered ancestor (e.g. a glass Popover such as the projects Smart
 * Filter) still resolves its `position: fixed` against the viewport instead of the ancestor's box.
 * `useFloating` measures the anchor with `getBoundingClientRect` (viewport coords, matching `fixed`)
 * and recomputes on scroll/resize while open; the portal tears its container + subtree down on close.
 */
export function Tooltip(props: TooltipProps): JSX.Element {
	const {
		content,
		children,
		placement = "top",
		delay = "fast",
		density = "default",
		variant = "inverted",
		tone = "neutral",
		shortcut,
		interactive = false,
		whenTruncated = false,
		toggleOnPress = false,
		offset = 6,
		class: className,
	} = props;

	const triggerRef = useRef<HTMLSpanElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const timer = useRef<number | undefined>(undefined);
	const pinned = useRef(false);
	// Set by a press on the anchor: the hint has done its job, so it stays shut until the pointer
	// leaves (or focus moves away) and comes back.
	const pressed = useRef(false);
	// What opened it. Only a POINTER-opened tooltip is closed by the pointer wandering off; one a
	// keyboard focus opened stays until blur or Escape (WCAG 1.4.13 "persistent").
	const via = useRef<"pointer" | "focus">("pointer");
	const releaseEscape = useRef<(() => void) | null>(null);
	const tipId = useId(undefined, "tooltip");

	const open = useSignal(false);
	// Exempt from `useOverlayStack` (§B.10.3): a tooltip sits in the static `--z-tooltip` band at the
	// top of the z-scale, above every class the stack allocates, takes no focus and never nests another
	// overlay — a claim would only steal `isTop`, and with it Escape, from the dialog it is shown inside.
	const floating = useFloating({ open: open.value, triggerRef, panelRef, placement, offset });
	const { mounted, state } = usePresence(open.value, 150);

	// #region Scheduling
	const clearTimer = () => {
		if (timer.current !== undefined) clearTimeout(timer.current);
		timer.current = undefined;
	};
	const schedule = (next: boolean, ms: number) => {
		clearTimer();
		timer.current = setTimeout(() => (open.value = next), ms) as unknown as number;
	};
	// An empty `content` never opens, so a caller can switch a hint off without unwrapping its anchor.
	const show = (from: "pointer" | "focus") => {
		if (content === "" || pressed.current) return;
		if (whenTruncated && triggerRef.current && !clipsText(triggerRef.current)) return;
		via.current = from;
		schedule(true, typeof delay === "number" ? delay : DELAY_MS[delay]);
	};
	const close = () => {
		clearTimer();
		pinned.current = false;
		releaseEscape.current?.();
		releaseEscape.current = null;
		open.value = false;
	};
	const hide = () => {
		if (!pinned.current) schedule(false, interactive ? INTERACTIVE_GRACE_MS : 0);
	};
	const leave = () => {
		pressed.current = false;
		hide();
	};
	// Keyboard focus only: focus a script moves after a click (a popover focusing its first control)
	// is not a request for the label.
	const showOnFocus = (e: JSX.TargetedFocusEvent<HTMLSpanElement>) => {
		if ((e.target as Element).matches(":focus-visible")) show("focus");
	};
	const hideOnBlur = (e: JSX.TargetedFocusEvent<HTMLSpanElement>) => {
		const next = e.relatedTarget as Node | null;
		if (!next || !triggerRef.current?.contains(next)) pressed.current = false;
		return pinned.current ? close() : hide();
	};
	/*
	 * A press on the anchor ends the hint. The control has been found and used, and what it does next
	 * (a menu, a dialog, a saved state, a navigation) is now the thing to read, so a label still hanging
	 * over it is clutter — and a label that outlives the press is the one a reader sees as stuck.
	 * Enter and Space are the keyboard's press. `toggleOnPress` owns the press instead, as its pin.
	 */
	const dismissOnPress = () => {
		if (toggleOnPress) return;
		pressed.current = true;
		close();
	};
	const dismissOnKey = (e: JSX.TargetedKeyboardEvent<HTMLSpanElement>) => {
		if (e.key === "Enter" || e.key === " ") dismissOnPress();
	};
	const togglePinned = () => {
		if (pinned.current) return close();
		if (content === "") return;
		clearTimer();
		pinned.current = true;
		releaseEscape.current ??= pushEscapeLayer({
			enabled: () => true,
			closeOnEscape: () => true,
			dismiss: close,
		});
		open.value = true;
	};

	useEffect(() => () => {
		clearTimer();
		releaseEscape.current?.();
	}, []);
	useEffect(() => {
		if (content === "" && open.peek()) close();
	}, [content === ""]);

	// Global while open, so a pointer-only reader can dismiss it without moving (WCAG 1.4.13).
	useEffect(() => {
		if (!open.value) return;
		const within = (target: Node | null) =>
			!!target && (!!triggerRef.current?.contains(target) || !!panelRef.current?.contains(target));
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		const onPointerDown = (e: PointerEvent) => {
			if (!pinned.current || within(e.target as Node | null)) return;
			close();
		};
		/*
		 * The safety net for a `pointerleave` that never arrives. The anchor's own leave is the normal
		 * close, but it is not guaranteed: the anchor can be re-rendered, hidden or moved out from under
		 * a still pointer (a row action that hides once used, a card control that slides when its state
		 * flips), and then no leave fires until something else happens. The next pointer move anywhere
		 * outside the anchor and the panel closes a hover-opened tooltip, through `hide()` so an
		 * `interactive` one keeps its grace for the gap; a pending close is not re-armed on every move.
		 */
		const onPointerMove = (e: PointerEvent) => {
			if (pinned.current || via.current !== "pointer" || timer.current !== undefined) return;
			if (triggerRef.current?.isConnected && within(e.target as Node | null)) return;
			hide();
		};
		// Leaving the window or the tab ends a hover the anchor will never see the end of.
		const onAway = () => {
			if (!pinned.current) close();
		};
		const onVisibility = () => {
			if (document.visibilityState === "hidden") onAway();
		};
		globalThis.addEventListener("keydown", onKeyDown);
		globalThis.addEventListener("blur", onAway);
		document.addEventListener("visibilitychange", onVisibility);
		document.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
		if (toggleOnPress) document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			globalThis.removeEventListener("keydown", onKeyDown);
			globalThis.removeEventListener("blur", onAway);
			document.removeEventListener("visibilitychange", onVisibility);
			document.removeEventListener("pointermove", onPointerMove, { capture: true });
			if (toggleOnPress) document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [open.value, toggleOnPress]);
	// #endregion

	// Read when the panel mounts (client-only), so the server never needs the preference.
	const chords = mounted && document.documentElement.dataset.tooltipShortcuts === "on"
		? typeof shortcut === "string" ? [shortcut] : shortcut
		: undefined;

	return (
		<span
			ref={triggerRef}
			class={cx("ui-tooltip__anchor", whenTruncated && "ui-tooltip__anchor--truncate")}
			aria-describedby={mounted ? tipId : undefined}
			onPointerEnter={() => show("pointer")}
			onPointerLeave={leave}
			// Capture phase: a control inside that stops its press from bubbling still ends the hint.
			onPointerDownCapture={dismissOnPress}
			onKeyDownCapture={dismissOnKey}
			onFocusIn={showOnFocus}
			onFocusOut={hideOnBlur}
			onClick={toggleOnPress ? togglePinned : undefined}
		>
			{children}
			{mounted && (
				<BodyPortal>
					<div
						ref={panelRef}
						id={tipId}
						role="tooltip"
						data-state={state}
						class={cx(
							"ui-tooltip",
							`ui-tooltip--${floating?.placement ?? placement}`,
							`ui-tooltip--${variant}`,
							density === "compact" && "ui-tooltip--compact",
							tone !== "neutral" && `ui-tooltip--${tone}`,
							interactive && "ui-tooltip--interactive",
							className,
						)}
						style={floating
							? styleVars({
								"--float-top": `${floating.top}px`,
								"--float-left": `${floating.left}px`,
							})
							: undefined}
						// The portal is outside the anchor's subtree, so its own hover must hold it open.
						onPointerEnter={interactive ? clearTimer : undefined}
						onPointerLeave={interactive ? hide : undefined}
					>
						{content}
						{chords?.length
							? (
								<span class="ui-tooltip__shortcut">
									{chords.map((chord) => <kbd key={chord} class="ui-tooltip__kbd">{chord}</kbd>)}
								</span>
							)
							: null}
					</div>
				</BodyPortal>
			)}
		</span>
	);
}
