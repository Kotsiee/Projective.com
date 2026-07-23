import type { ComponentChildren, JSX, VNode } from "preact";
import { useRef, useState } from "preact/hooks";
import "../styles/draggable-popover.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { BodyPortal } from "../components/BodyPortal.tsx";
import { usePresence } from "../core/usePresence.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useId } from "../../hooks/useId.ts";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Props
/** A viewport-relative top-left position, in CSS pixels. */
export interface PopoverPosition {
	x: number;
	y: number;
}

/** Props for {@link DraggablePopover}. */
export interface DraggablePopoverProps {
	/** Controlled/uncontrolled open state. */
	open: Bindable<boolean>;
	/** Fired whenever the open state changes (e.g. the × or Escape). */
	onOpenChange?: (open: boolean) => void;
	/** Header title — plain text or a node. Also the accessible name of the window + drag handle. */
	title: string | VNode;
	/** Optional leading glyph rendered before the title. */
	icon?: VNode;
	/** Initial top-left position (px). Defaults to a spot below the top bar. */
	defaultPosition?: PopoverPosition;
	/** Fired when a drag or keyboard move finishes, so the caller can persist the position. */
	onPositionChange?: (position: PopoverPosition) => void;
	/** Panel width (CSS length, default `22rem`). */
	width?: string;
	/** Panel height (CSS length). When omitted the panel is content-sized up to a viewport cap. */
	height?: string;
	/** Allow the user to resize the panel (native corner handle + internal scroll). Default `true`. */
	resizable?: boolean;
	/** Extra controls rendered in the header, before the close button. */
	headerActions?: ComponentChildren;
	/** Extra class(es) merged onto the panel (e.g. to raise its z-index for a dev overlay). */
	class?: string;
	/** Panel body. */
	children: ComponentChildren;
}
// #endregion

/** Keep at least this many px of the panel on-screen so the drag handle is always reachable. */
const KEEP_VISIBLE = 48;
/** Keyboard nudge distance (px); Shift multiplies it. */
const NUDGE = 12;
/** Module-level "top" z so the most-recently-touched window floats above its siblings. */
let zTop = 0;

/**
 * DraggablePopover — a **non-modal**, freely draggable floating window. Deliberately unlike
 * {@link Drawer}/{@link Dialog}: there is **no backdrop and no focus trap**, so the page beneath stays
 * 100% interactive (scroll, click, type) while the window is open — the use-case is a persistent
 * inspector/utility panel, not a blocking prompt.
 *
 * **Move & resize.** The header is a drag handle (Pointer Events + `setPointerCapture`, clamped so it
 * can never be lost off-screen) and is also keyboard-movable (focus it, then arrow keys; `Shift` for a
 * larger step). When `resizable`, the panel gets a native corner resize handle and its body scrolls
 * internally on overflow. `onPositionChange` fires at the end of a move so the caller can persist it.
 * Touching any part of a window lifts it above the others (a shared z-counter).
 *
 * **A11y.** `role="dialog"` with `aria-modal="false"` (explicitly non-blocking) + `aria-labelledby`.
 * The drag handle is a `role="button"` with a descriptive `aria-label`; the close control is a sibling
 * (never nested inside the handle). `Escape` closes only while focus is within the panel, so it never
 * hijacks a global Escape. Rendered through {@link BodyPortal} so its `position: fixed` resolves to the
 * viewport even inside a transformed/blurred shell ancestor (the glass-blur fixed-overlay trap).
 */
export function DraggablePopover(props: DraggablePopoverProps): JSX.Element | null {
	const {
		open,
		onOpenChange,
		title,
		icon,
		defaultPosition,
		onPositionChange,
		width = "22rem",
		height,
		resizable = true,
		headerActions,
		class: className,
		children,
	} = props;

	const ctrl = useControllable<boolean>(open, false, onOpenChange);
	const { mounted, state } = usePresence(ctrl.signal.value, 180);

	const panelRef = useRef<HTMLDivElement>(null);
	const posRef = useRef<PopoverPosition>(defaultPosition ?? { x: 24, y: 88 });
	const [pos, setPosState] = useState<PopoverPosition>(posRef.current);
	const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
	const [z, setZ] = useState(0);
	const titleId = useId(undefined, "dpopover") + "-title";

	const setPos = (next: PopoverPosition) => {
		posRef.current = next;
		setPosState(next);
	};

	/** Constrain a candidate position so the panel stays reachable within the viewport. */
	const clamp = (x: number, y: number): PopoverPosition => {
		const el = panelRef.current;
		const w = el?.offsetWidth ?? 320;
		const maxX = globalThis.innerWidth - KEEP_VISIBLE;
		const maxY = globalThis.innerHeight - KEEP_VISIBLE;
		return {
			x: Math.max(KEEP_VISIBLE - w, Math.min(x, maxX)),
			y: Math.max(0, Math.min(y, maxY)),
		};
	};

	const lift = () => setZ(++zTop);
	const close = () => ctrl.set(false);

	// #region Drag (Pointer Events on the handle)
	const onHandlePointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		const handle = e.currentTarget;
		handle.setPointerCapture(e.pointerId);
		dragOffset.current = { dx: e.clientX - posRef.current.x, dy: e.clientY - posRef.current.y };
		lift();
	};
	const onHandlePointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const off = dragOffset.current;
		if (!off) return;
		setPos(clamp(e.clientX - off.dx, e.clientY - off.dy));
	};
	const onHandlePointerUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (!dragOffset.current) return;
		dragOffset.current = null;
		e.currentTarget.releasePointerCapture?.(e.pointerId);
		onPositionChange?.(posRef.current);
	};

	const onHandleKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const step = e.shiftKey ? NUDGE * 4 : NUDGE;
		let handled = true;
		switch (e.key) {
			case "ArrowUp":
				setPos(clamp(posRef.current.x, posRef.current.y - step));
				break;
			case "ArrowDown":
				setPos(clamp(posRef.current.x, posRef.current.y + step));
				break;
			case "ArrowLeft":
				setPos(clamp(posRef.current.x - step, posRef.current.y));
				break;
			case "ArrowRight":
				setPos(clamp(posRef.current.x + step, posRef.current.y));
				break;
			default:
				handled = false;
		}
		if (handled) {
			e.preventDefault();
			onPositionChange?.(posRef.current);
		}
	};
	// #endregion

	const onPanelKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			close();
		}
	};

	if (!mounted) return null;

	return (
		<BodyPortal>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="false"
				aria-labelledby={titleId}
				data-state={state}
				class={cx(
					"ui-draggable-popover",
					resizable && "ui-draggable-popover--resizable",
					className,
				)}
				style={styleVars({
					"--dd-x": `${pos.x}px`,
					"--dd-y": `${pos.y}px`,
					"--dd-z": z,
					"--ddp-w": width,
					"--ddp-h": height,
				})}
				onKeyDownCapture={onPanelKeyDown}
				onPointerDownCapture={lift}
			>
				<div class="ui-draggable-popover__header">
					<div
						class="ui-draggable-popover__handle"
						role="button"
						tabIndex={0}
						aria-label={`Move window${
							typeof title === "string" ? `: ${title}` : ""
						}. Use arrow keys.`}
						onPointerDown={onHandlePointerDown}
						onPointerMove={onHandlePointerMove}
						onPointerUp={onHandlePointerUp}
						onKeyDown={onHandleKeyDown}
					>
						{icon && <span class="ui-draggable-popover__icon" aria-hidden="true">{icon}</span>}
						<span id={titleId} class="ui-draggable-popover__title">{title}</span>
					</div>
					<div class="ui-draggable-popover__actions">
						{headerActions}
						<button
							type="button"
							class="ui-draggable-popover__close"
							aria-label="Close window"
							onClick={close}
						>
							<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
								<path
									d="M6 6l12 12M18 6 6 18"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
								/>
							</svg>
						</button>
					</div>
				</div>
				<div class="ui-draggable-popover__body">{children}</div>
			</div>
		</BodyPortal>
	);
}
