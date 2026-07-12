/**
 * Toast — a corner overlay stack of transient notifications, fed by {@link useToast} from anywhere in
 * the tree (no prop drilling; one module-level signal per document, matching the "no true DOM
 * portals" pattern — this renders `position: fixed` at `--z-toast`). Each item auto-dismisses after
 * `life` ms (default 3000, `sticky` disables it) behind a visible countdown bar, pauses on
 * pointer-hover, and can be swiped horizontally past a threshold to dismiss early. The region is
 * `aria-live="polite"`; individual items escalate to `role="alert"`/assertive for `warning`/`danger`.
 */
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { signal, useSignal } from "@preact/signals";
import "../styles/toast.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { nextId } from "../../fields/core/ids.ts";
import { closeIcon, severityIcon } from "../core/icons.tsx";
import type { ToastMessage, ToastPosition } from "../types/mod.ts";

// #region Shared store
/** Module-scoped signal — the single source of truth every `<Toast/>` instance renders from. */
const toasts = signal<ToastMessage[]>([]);

export interface ToastApi {
	/** Push a new toast; returns its id (auto-generated when `message.id` is omitted). */
	show: (message: Omit<ToastMessage, "id"> & { id?: string }) => string;
	/** Remove a single toast immediately (no exit animation). */
	remove: (id: string) => void;
	/** Remove every toast immediately. */
	clear: () => void;
}

/** Imperative push/clear API for the shared toast stack — call from any event handler or effect. */
export function useToast(): ToastApi {
	return {
		show: (message) => {
			const id = message.id ?? nextId("toast");
			toasts.value = [...toasts.value, { life: 3000, closable: true, ...message, id }];
			return id;
		},
		remove: (id) => {
			toasts.value = toasts.value.filter((t) => t.id !== id);
		},
		clear: () => {
			toasts.value = [];
		},
	};
}
// #endregion

// #region Row
const SWIPE_DISMISS_PX = 80;

interface RowProps {
	item: ToastMessage;
}

/** A single toast: owns its own countdown timer, pause-on-hover, and swipe-to-dismiss gesture. */
function ToastRow({ item }: RowProps): JSX.Element {
	const closing = useSignal(false);
	const mounted = useSignal(false);
	const paused = useSignal(false);
	const dragX = useSignal(0);
	const rowRef = useRef<HTMLDivElement>(null);
	const remainingMs = useRef(item.sticky ? 0 : item.life ?? 3000);
	const startedAt = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const dragging = useRef(false);
	const dragStartX = useRef(0);

	const requestClose = () => {
		closing.value = true;
	};

	const clearTimer = () => {
		if (timer.current !== undefined) {
			clearTimeout(timer.current);
			timer.current = undefined;
		}
	};

	const arm = () => {
		if (item.sticky || remainingMs.current <= 0) return;
		startedAt.current = Date.now();
		timer.current = setTimeout(requestClose, remainingMs.current);
	};

	useEffect(() => {
		arm();
		const raf = requestAnimationFrame(() => {
			mounted.value = true;
		});
		return () => {
			clearTimer();
			cancelAnimationFrame(raf);
		};
	}, []);

	useEffect(() => {
		if (!closing.value) return;
		const el = rowRef.current;
		const durationMs = el ? parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0 : 0;
		const t = setTimeout(() => {
			toasts.value = toasts.value.filter((t2) => t2.id !== item.id);
		}, durationMs);
		return () => clearTimeout(t);
	}, [closing.value]);

	const onPointerEnter = () => {
		if (item.sticky || closing.value) return;
		paused.value = true;
		clearTimer();
		remainingMs.current = Math.max(0, remainingMs.current - (Date.now() - startedAt.current));
	};
	const onPointerLeave = () => {
		if (item.sticky || closing.value) return;
		paused.value = false;
		arm();
	};

	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		dragging.current = true;
		dragStartX.current = e.clientX;
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (!dragging.current) return;
		dragX.value = e.clientX - dragStartX.current;
	};
	const endDrag = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (!dragging.current) return;
		dragging.current = false;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		if (Math.abs(dragX.value) > SWIPE_DISMISS_PX) {
			requestClose();
		} else {
			dragX.value = 0;
		}
	};

	const severity = item.severity ?? "info";
	const assertive = severity === "warning" || severity === "danger";
	const icon = item.icon === null ? null : item.icon ?? severityIcon(severity);
	const dragOpacity = 1 - Math.min(1, Math.abs(dragX.value) / (SWIPE_DISMISS_PX * 2));

	return (
		<div
			ref={rowRef}
			class={cx(
				"ui-toast__item",
				`ui-toast__item--${severity}`,
				!mounted.value && "ui-toast__item--enter",
				closing.value && "ui-toast__item--exit",
				dragging.current && "ui-toast__item--dragging",
			)}
			style={styleVars({
				"--toast-drag": `${dragX.value}px`,
				"--toast-opacity": closing.value ? 0 : dragOpacity,
				"--toast-life": `${item.sticky ? 0 : item.life ?? 3000}ms`,
			})}
			role={assertive ? "alert" : "status"}
			aria-live={assertive ? "assertive" : "polite"}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
		>
			{icon && <span class="ui-toast__icon" aria-hidden="true">{icon}</span>}
			<span class="ui-toast__body">
				{item.summary && <span class="ui-toast__summary">{item.summary}</span>}
				{item.detail && <span class="ui-toast__detail">{item.detail}</span>}
			</span>
			{item.closable !== false && (
				<button
					type="button"
					class="ui-toast__close"
					aria-label="Dismiss notification"
					onClick={requestClose}
				>
					{closeIcon()}
				</button>
			)}
			{!item.sticky && (item.life ?? 3000) > 0 && (
				<span
					class={cx("ui-toast__progress", paused.value && "ui-toast__progress--paused")}
					aria-hidden="true"
				/>
			)}
		</div>
	);
}
// #endregion

export interface ToastProps {
	/** Corner (or edge/centre) anchor for this stack (default `top-right`). */
	position?: ToastPosition;
	id?: string;
	class?: string;
}

/** Renders the shared toast stack anchored at `position`. Mount once per corner you use. */
export function Toast(props: ToastProps): JSX.Element {
	const { position = "top-right", id, class: className } = props;

	return (
		<div
			id={id}
			class={cx("ui-toast", `ui-toast--${position}`, className)}
			aria-live="polite"
			aria-atomic="false"
		>
			{toasts.value.map((item) => <ToastRow key={item.id} item={item} />)}
		</div>
	);
}
