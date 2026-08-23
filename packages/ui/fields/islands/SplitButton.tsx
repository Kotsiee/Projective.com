import type { JSX, VNode } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/split-button.css";
import { Button, type ButtonVariant } from "../components/Button.tsx";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useFloating } from "../hooks/useFloating.ts";
import type { Placement } from "../hooks/useFloating.ts";
import { useDismiss } from "../hooks/useDismiss.ts";
import { useId } from "../hooks/useId.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import type { FieldSize, Severity } from "../types/mod.ts";

// #region Types
/**
 * A single actionable entry in a menu-style control. Local to the menu-bearing components (not part
 * of the shared field foundation): a label, an optional leading icon, disabled state, and either a
 * click handler (button semantics) or an `href` (link semantics).
 */
export interface MenuAction {
	/** Visible text of the action. */
	label: string;
	/** Optional leading icon node. */
	icon?: VNode;
	/** Disable this single action. */
	disabled?: boolean;
	/** Invoked on activation (ignored when `href` is set and no handler is desired). */
	onClick?: () => void;
	/** Render the item as a link to this destination instead of a button. */
	href?: string;
}

export interface SplitButtonProps {
	/** Primary-action label. */
	label?: string;
	/** Primary-action leading icon. */
	icon?: VNode;
	/** Primary-action handler (the large left segment). */
	onClick?: () => void;
	/** Secondary actions shown in the dropdown menu. */
	model?: MenuAction[];
	/** Semantic colour ramp shared by both segments (default `primary`). */
	severity?: Severity;
	/** Fill treatment shared by both segments (default `filled`). */
	variant?: ButtonVariant;
	/** Size ramp (default `md`). */
	size?: FieldSize;
	/** Disable both segments. */
	disabled?: boolean;
	/** Loading state — shows a spinner on the primary segment and blocks both. */
	loading?: boolean;
	/** Preferred placement of the dropdown menu (default `bottom-end`). */
	menuPlacement?: Placement;
	/** Stretch to fill the parent's inline size. */
	fluid?: boolean;
	/** Accessible label for the dropdown toggle (default `More actions`). */
	menuLabel?: string;
	class?: string;
}
// #endregion

// #region Icons
/** Down-chevron used by the dropdown toggle. */
function ChevronDown(): JSX.Element {
	return (
		<svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" fill="none">
			<path
				d="M4 6l4 4 4-4"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}
// #endregion

/**
 * SplitButton — a primary action seamed to a dropdown of secondary actions. The large left segment
 * fires `onClick`; the attached chevron toggle opens a floating `role="menu"` built from `model`.
 * Both segments share one severity/variant/size and one outline (interior hairline seam, §B.4).
 * Keyboard: the toggle opens on ArrowDown/Enter/Space (ArrowUp opens to the last item); inside the
 * menu, ArrowUp/Down + Home/End rove the `menuitem`s, Enter/Space activate, and Escape closes and
 * returns focus to the toggle. Disabled/loading blocks both segments.
 *
 * The MENU is projected into `document.body` via {@link BodyPortal} and claims a live stacking index
 * from {@link useOverlayStack}, so it escapes any ancestor that would clip it (`overflow: hidden`) or
 * re-base its `position: fixed` (`transform`/`filter`/`backdrop-filter`) — the trap a Dialog panel
 * sets. The segments stay in place and the id-based ARIA wiring survives the move.
 */
export function SplitButton(props: SplitButtonProps): JSX.Element {
	const {
		label,
		icon,
		onClick,
		model = [],
		severity = "primary",
		variant = "filled",
		size = "md",
		disabled,
		loading,
		menuPlacement = "bottom-end",
		fluid,
		menuLabel = "More actions",
		class: className,
	} = props;

	// #region State & refs
	const open = useMemo(() => signal(false), []);
	const active = useMemo(() => signal(-1), []);
	const rootRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const itemRefs = useRef<Array<HTMLElement | null>>([]);
	const menuId = useId(undefined, "split-menu");

	const isOpen = open.value;
	const activeIndex = active.value;
	const blocked = Boolean(disabled || loading);

	const stack = useOverlayStack({ active: isOpen, layer: "popover" });
	const floating = useFloating({
		open: isOpen,
		triggerRef: rootRef,
		panelRef,
		placement: menuPlacement,
		matchWidth: false,
	});
	// #endregion

	// #region Navigation helpers
	const isDisabled = (i: number) => Boolean(model[i]?.disabled);
	const nextEnabled = (from: number, delta: 1 | -1): number => {
		const n = model.length;
		if (n === 0) return -1;
		let i = from;
		for (let step = 0; step < n; step++) {
			i = (i + delta + n) % n;
			if (!isDisabled(i)) return i;
		}
		return from < 0 ? -1 : from;
	};

	const focusToggle = () => {
		rootRef.current?.querySelector<HTMLButtonElement>(".ui-split-button__toggle")?.focus();
	};

	const close = (returnFocus = true) => {
		open.value = false;
		active.value = -1;
		if (returnFocus) queueMicrotask(focusToggle);
	};

	const openMenu = (edge: "first" | "last") => {
		if (blocked) return;
		open.value = true;
		active.value = edge === "first" ? nextEnabled(-1, 1) : nextEnabled(0, -1);
	};

	const activate = (i: number) => {
		const item = model[i];
		if (!item || item.disabled) return;
		item.onClick?.();
		if (!item.href) close(true);
	};
	// #endregion

	// `enabled` gates the ESCAPE channel only, and that channel is exclusive (its handler calls
	// `stopImmediatePropagation`). Every listener registers on `document` in the capture phase, so
	// they run in registration order, not stacking order — without this an open menu under a later
	// overlay eats that overlay's Escape. Outside-pointer dismissal is governed by containment and
	// stays live regardless.
	useDismiss({
		open: isOpen,
		enabled: stack.isTop,
		onDismiss: () => close(false),
		panelRef,
		triggerRef: rootRef,
	});

	useEffect(() => {
		if (isOpen && activeIndex >= 0) itemRefs.current[activeIndex]?.focus();
	}, [isOpen, activeIndex]);

	// #region Keyboard
	const onToggleKeyDown = (e: KeyboardEvent) => {
		if (blocked) return;
		if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			openMenu("first");
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			openMenu("last");
		}
	};

	const onMenuKeyDown = (e: KeyboardEvent) => {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				active.value = nextEnabled(active.peek(), 1);
				break;
			case "ArrowUp":
				e.preventDefault();
				active.value = nextEnabled(active.peek(), -1);
				break;
			case "Home":
				e.preventDefault();
				active.value = nextEnabled(-1, 1);
				break;
			case "End":
				e.preventDefault();
				active.value = nextEnabled(0, -1);
				break;
			case "Enter":
			case " ":
				e.preventDefault();
				activate(active.peek());
				break;
			case "Escape":
				e.preventDefault();
				close(true);
				break;
			case "Tab":
				close(false);
				break;
		}
	};
	// #endregion

	const panelStyle = styleVars({
		"--float-top": floating ? `${floating.top}px` : "-9999px",
		"--float-left": floating ? `${floating.left}px` : "-9999px",
		"--z-portal": String(stack.zIndex),
	});

	return (
		<div
			ref={rootRef}
			class={cx(
				"ui-split-button",
				`ui-split-button--${variant}`,
				fluid && "ui-split-button--fluid",
				className,
			)}
		>
			<Button
				class="ui-split-button__primary"
				label={label}
				icon={icon}
				severity={severity}
				variant={variant}
				size={size}
				disabled={disabled}
				loading={loading}
				fluid={fluid}
				onClick={onClick}
			/>
			<Button
				class="ui-split-button__toggle"
				iconOnly
				icon={<ChevronDown />}
				severity={severity}
				variant={variant}
				size={size}
				disabled={blocked}
				aria-label={menuLabel}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				aria-controls={isOpen ? menuId : undefined}
				onClick={() => (isOpen ? close(false) : openMenu("first"))}
				onKeyDown={onToggleKeyDown}
			/>
			{isOpen && (
				<BodyPortal>
					<div
						ref={panelRef}
						id={menuId}
						role="menu"
						aria-label={menuLabel}
						class={cx(
							"ui-split-button__menu",
							floating?.placement.startsWith("top") && "ui-split-button__menu--top",
						)}
						style={panelStyle}
						onKeyDown={onMenuKeyDown}
					>
						{model.map((item, i) => {
							const cls = cx(
								"ui-split-button__item",
								item.disabled && "ui-split-button__item--disabled",
							);
							const tabIndex = i === activeIndex ? 0 : -1;
							const setRef = (el: HTMLElement | null) => {
								itemRefs.current[i] = el;
							};
							const inner = (
								<>
									{item.icon && <span class="ui-split-button__item-icon">{item.icon}</span>}
									<span class="ui-split-button__item-label">{item.label}</span>
								</>
							);
							return item.href && !item.disabled
								? (
									<a
										ref={setRef}
										role="menuitem"
										class={cls}
										href={item.href}
										tabIndex={tabIndex}
										onClick={() => activate(i)}
									>
										{inner}
									</a>
								)
								: (
									<button
										ref={setRef}
										type="button"
										role="menuitem"
										class={cls}
										tabIndex={tabIndex}
										disabled={item.disabled}
										aria-disabled={item.disabled || undefined}
										onClick={() => activate(i)}
									>
										{inner}
									</button>
								);
						})}
					</div>
				</BodyPortal>
			)}
		</div>
	);
}
