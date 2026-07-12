import type { JSX, VNode } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/speed-dial.css";
import { Button } from "../components/Button.tsx";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { Severity } from "../types/mod.ts";

// #region Types
/**
 * A single actionable entry in a menu-style control. Local to the menu-bearing components (not part
 * of the shared field foundation): a label, an optional icon, disabled state, and either a click
 * handler (button semantics) or an `href` (link semantics).
 */
export interface MenuAction {
	/** Visible/announced label (used as the sub-button `aria-label` and the tooltip text). */
	label: string;
	/** Icon node shown inside the round sub-button. */
	icon?: VNode;
	/** Disable this single action. */
	disabled?: boolean;
	/** Invoked on activation. */
	onClick?: () => void;
	/** Render the item as a link to this destination instead of a button. */
	href?: string;
}

/** Fan-out direction of the sub-actions relative to the FAB. */
export type SpeedDialDirection =
	| "up"
	| "down"
	| "left"
	| "right"
	| "up-left"
	| "up-right"
	| "down-left"
	| "down-right";

/** Geometry the sub-actions are laid out on. */
export type SpeedDialType = "linear" | "circle" | "semi-circle" | "quarter-circle";

export interface SpeedDialProps {
	/** Sub-actions that fan out when the FAB is opened. */
	model?: MenuAction[];
	/** Fan-out direction (default `up`). */
	direction?: SpeedDialDirection;
	/** Layout geometry (default `linear`). */
	type?: SpeedDialType;
	/** Arc radius in px for the `circle`/`semi-circle`/`quarter-circle` types (default `120`). */
	radius?: number;
	/** FAB icon while closed (default a plus glyph). */
	icon?: VNode;
	/** FAB icon while open (default a close glyph). */
	openIcon?: VNode;
	/** Alias for `icon` (PrimeNG parity) — the closed-state FAB icon. */
	showIcon?: VNode;
	/** Alias for `openIcon` (PrimeNG parity) — the open-state FAB icon. */
	hideIcon?: VNode;
	/** Per-item stagger between items appearing, in ms (default `30`). */
	transitionDelay?: number;
	/** Disable the whole control. */
	disabled?: boolean;
	/** Semantic colour ramp for the FAB and sub-actions (default `primary`). */
	buttonSeverity?: Severity;
	/** Accessible label for the FAB (default `Speed dial`). */
	ariaLabel?: string;
	class?: string;
}
// #endregion

// #region Icons
/** Default closed-state FAB glyph. */
function PlusIcon(): JSX.Element {
	return (
		<svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" fill="none">
			<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
		</svg>
	);
}
/** Default open-state FAB glyph. */
function CloseIcon(): JSX.Element {
	return (
		<svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" fill="none">
			<path
				d="M4 4l8 8M12 4l-8 8"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
			/>
		</svg>
	);
}
// #endregion

// #region Geometry
const DIRECTION_ANGLE: Record<SpeedDialDirection, number> = {
	right: 0,
	"up-right": 45,
	up: 90,
	"up-left": 135,
	left: 180,
	"down-left": 225,
	down: 270,
	"down-right": 315,
};

const ARC_SPAN: Record<Exclude<SpeedDialType, "linear">, number> = {
	circle: 360,
	"semi-circle": 180,
	"quarter-circle": 90,
};

/**
 * Compute the per-item `--sd-x` / `--sd-y` offsets. For `linear` these are unit-vector multiples of
 * the gap length (`--sd-unit` = an item+gap token); for the arc types they are pixel magnitudes on
 * the given `radius` (`--sd-unit` = 1px). Screen-space y is negated so `up` points visually up.
 */
function itemOffset(
	type: SpeedDialType,
	direction: SpeedDialDirection,
	radius: number,
	index: number,
	count: number,
): { x: number; y: number } {
	const center = DIRECTION_ANGLE[direction];
	if (type === "linear") {
		const rad = (center * Math.PI) / 180;
		const step = index + 1;
		return { x: round(Math.cos(rad) * step), y: round(-Math.sin(rad) * step) };
	}
	const span = ARC_SPAN[type];
	let angle: number;
	if (type === "circle") {
		angle = center + (360 / count) * index;
	} else {
		angle = count <= 1 ? center : center - span / 2 + (span / (count - 1)) * index;
	}
	const rad = (angle * Math.PI) / 180;
	return { x: round(Math.cos(rad) * radius), y: round(-Math.sin(rad) * radius) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
// #endregion

/**
 * SpeedDial — a floating action button that fans a set of round sub-action buttons out along a line
 * or arc. `type` picks the geometry (`linear` stacks along `direction`; `circle`/`semi-circle`/
 * `quarter-circle` distribute over an arc of `radius`), and each item's position is emitted as inline
 * `--sd-x`/`--sd-y` custom properties the CSS transforms. Opening staggers the items by
 * `transitionDelay` ms (collapsed to instant under reduced motion). The FAB carries
 * `aria-haspopup`/`aria-expanded`; the list is a `role="menu"` of `menuitem`s with tooltip labels.
 * Keyboard: Enter/Space/Arrow open and focus the first item, Arrow keys rove, Escape closes and
 * returns focus to the FAB.
 */
export function SpeedDial(props: SpeedDialProps): JSX.Element {
	const {
		model = [],
		direction = "up",
		type = "linear",
		radius = 120,
		icon,
		openIcon,
		showIcon,
		hideIcon,
		transitionDelay = 30,
		disabled,
		buttonSeverity = "primary",
		ariaLabel = "Speed dial",
		class: className,
	} = props;

	// #region State & refs
	const open = useMemo(() => signal(false), []);
	const active = useMemo(() => signal(-1), []);
	const rootRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	const isOpen = open.value;
	const activeIndex = active.value;
	const closedIcon = icon ?? showIcon ?? <PlusIcon />;
	const openStateIcon = openIcon ?? hideIcon ?? <CloseIcon />;
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

	const focusFab = () => {
		rootRef.current?.querySelector<HTMLButtonElement>(".ui-speed-dial__fab")?.focus();
	};

	const close = (returnFocus = true) => {
		open.value = false;
		active.value = -1;
		if (returnFocus) queueMicrotask(focusFab);
	};

	const openDial = (edge: "first" | "last") => {
		if (disabled) return;
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

	useEffect(() => {
		if (!isOpen || activeIndex < 0) return;
		const btns = listRef.current?.querySelectorAll<HTMLButtonElement>(".ui-speed-dial__action");
		btns?.[activeIndex]?.focus();
	}, [isOpen, activeIndex]);

	// #region Keyboard
	const onFabKeyDown = (e: KeyboardEvent) => {
		if (disabled) return;
		if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowRight") {
			e.preventDefault();
			openDial("first");
		} else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
			e.preventDefault();
			openDial("last");
		} else if (e.key === "Escape" && isOpen) {
			e.preventDefault();
			close(true);
		}
	};

	const onListKeyDown = (e: KeyboardEvent) => {
		switch (e.key) {
			case "ArrowDown":
			case "ArrowRight":
				e.preventDefault();
				active.value = nextEnabled(active.peek(), 1);
				break;
			case "ArrowUp":
			case "ArrowLeft":
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

	const count = model.length;

	return (
		<div
			ref={rootRef}
			class={cx(
				"ui-speed-dial",
				`ui-speed-dial--${type}`,
				`ui-speed-dial--dir-${direction}`,
				isOpen && "ui-speed-dial--open",
				disabled && "ui-speed-dial--disabled",
				className,
			)}
			style={styleVars({ "--sd-stagger": `${transitionDelay}ms` })}
		>
			<ul
				ref={listRef}
				class="ui-speed-dial__list"
				role="menu"
				aria-label={ariaLabel}
				onKeyDown={onListKeyDown}
			>
				{model.map((item, i) => {
					const { x, y } = itemOffset(type, direction, radius, i, count);
					const tabIndex = i === activeIndex ? 0 : -1;
					return (
						<li
							class="ui-speed-dial__item"
							style={styleVars({ "--sd-x": x, "--sd-y": y, "--sd-delay": i })}
						>
							<Button
								class="ui-speed-dial__action"
								rounded
								iconOnly
								icon={item.icon}
								severity={buttonSeverity}
								disabled={item.disabled || disabled}
								role="menuitem"
								aria-label={item.label}
								tabIndex={isOpen ? tabIndex : -1}
								onClick={() => activate(i)}
							/>
							<span class="ui-speed-dial__tooltip" role="tooltip">{item.label}</span>
						</li>
					);
				})}
			</ul>
			<Button
				class="ui-speed-dial__fab"
				rounded
				iconOnly
				raised
				icon={isOpen ? openStateIcon : closedIcon}
				severity={buttonSeverity}
				disabled={disabled}
				aria-label={ariaLabel}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				onClick={() => (isOpen ? close(false) : openDial("first"))}
				onKeyDown={onFabKeyDown}
			/>
		</div>
	);
}
