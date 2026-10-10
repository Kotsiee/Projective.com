import type { ComponentChildren, JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useDismiss } from "@projective/ui/hooks";
import {
	type DragSample,
	releaseVelocity,
	SHEET_DRAG_SLOP_PX,
	sheetDragOffset,
	sheetRelease,
	type SheetSnap,
} from "../core/sheet-gesture.ts";
import { ToolButton } from "./controls/ToolButton.tsx";

/** Props for {@link InspectorSheet}. */
export interface InspectorSheetProps {
	/** Whether the sheet shows; the sheet writes `false` when it is dismissed. */
	open: Signal<boolean>;
	/** Accessible name of the sheet, e.g. "File details". */
	label: string;
	id?: string;
	/**
	 * `"solid"` (default) is a plain tonal scrim, right inside a modal that already blurs the page;
	 * `"glass"` blurs what sits behind, for the standalone inspector page.
	 */
	scrim?: "solid" | "glass";
	children: ComponentChildren;
}

interface Drag {
	id: number;
	startY: number;
	active: boolean;
	height: number;
	samples: DragSample[];
}

const TRANSITION_WATCHDOG_MS = 600;
const MAX_SAMPLES = 12;

function reducedMotion(): boolean {
	if (typeof document === "undefined") return true;
	if (document.documentElement.dataset.motion === "reduced") return true;
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function afterTransform(panel: HTMLElement, done: () => void): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const release = () => {
		panel.removeEventListener("transitionend", onEnd);
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};
	const finish = () => {
		release();
		done();
	};
	const onEnd = (event: TransitionEvent) => {
		if (event.target === panel && event.propertyName === "transform") finish();
	};
	panel.addEventListener("transitionend", onEnd);
	timer = setTimeout(finish, TRANSITION_WATCHDOG_MS);
	return release;
}

function layoutTop(panel: HTMLElement, offset: number): number {
	return panel.getBoundingClientRect().top - offset;
}

/**
 * The details panel as a bottom sheet over its host (not portalled; fills the nearest positioned
 * ancestor). Swipe the grip down to dismiss or up to expand; Escape, the scrim and the close button
 * dismiss it too, each through its own Escape layer so a host modal stays open. Focus moves into the
 * sheet on open and back to whatever had it on close. Motion is transform-only and dropped under
 * reduced motion.
 */
export function InspectorSheet(props: InspectorSheetProps): JSX.Element | null {
	const { open, label, id, scrim = "solid", children } = props;
	const isOpen = open.value;
	const panelRef = useRef<HTMLDivElement>(null);
	const snap = useSignal<SheetSnap>("half");
	const closing = useSignal(false);
	const drag = useRef<Drag | null>(null);
	const offset = useRef(0);
	const pending = useRef<(() => void) | null>(null);

	function setOffset(px: number): void {
		offset.current = px;
		panelRef.current?.style.setProperty("--ins-sheet-y", `${px}px`);
	}

	function cancelPending(): void {
		pending.current?.();
		pending.current = null;
	}

	function jump(panel: HTMLElement, apply: () => void): void {
		panel.dataset.dragging = "true";
		apply();
		panel.getBoundingClientRect();
		delete panel.dataset.dragging;
	}

	function setSnap(panel: HTMLElement, next: SheetSnap): void {
		panel.dataset.snap = next;
		snap.value = next;
	}

	function requestClose(): void {
		if (!open.peek() || closing.peek()) return;
		cancelPending();
		const panel = panelRef.current;
		if (!panel || reducedMotion()) {
			open.value = false;
			return;
		}
		closing.value = true;
		pending.current = afterTransform(panel, () => {
			pending.current = null;
			closing.value = false;
			open.value = false;
		});
	}

	function settle(next: SheetSnap): void {
		const panel = panelRef.current;
		if (!panel) return;
		cancelPending();
		if (next === snap.peek()) {
			setOffset(0);
			return;
		}
		if (next === "full") {
			const visualTop = panel.getBoundingClientRect().top;
			jump(panel, () => {
				setSnap(panel, "full");
				setOffset(visualTop - layoutTop(panel, offset.current));
			});
			setOffset(0);
			return;
		}
		let halfTop = 0;
		let fullTop = 0;
		jump(panel, () => {
			fullTop = layoutTop(panel, offset.current);
			panel.dataset.snap = "half";
			halfTop = layoutTop(panel, offset.current);
			panel.dataset.snap = "full";
		});
		const toHalf = () =>
			jump(panel, () => {
				setSnap(panel, "half");
				setOffset(0);
			});
		if (reducedMotion()) {
			toHalf();
			return;
		}
		setOffset(halfTop - fullTop);
		pending.current = afterTransform(panel, () => {
			pending.current = null;
			toHalf();
		});
	}

	useDismiss({ open: isOpen, onDismiss: requestClose, panelRef, closeOnOutside: false });

	// #region Focus
	useEffect(() => {
		if (!isOpen) return;
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		snap.value = "half";
		offset.current = 0;
		const focus = setTimeout(() => {
			const panel = panelRef.current;
			if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
		}, 0);
		return () => {
			clearTimeout(focus);
			cancelPending();
			closing.value = false;
			drag.current = null;
			setTimeout(() => {
				const active = document.activeElement;
				if (active && active !== document.body && active.isConnected) return;
				if (opener?.isConnected) opener.focus({ preventScroll: true });
			}, 0);
		};
	}, [isOpen]);
	// #endregion

	// #region Swipe
	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (e.pointerType === "mouse" && e.button !== 0) return;
		if (e.target instanceof Element && e.target.closest("button, a, input, [role='slider']")) {
			return;
		}
		const panel = panelRef.current;
		if (!panel || closing.peek()) return;
		drag.current = {
			id: e.pointerId,
			startY: e.clientY,
			active: false,
			height: panel.getBoundingClientRect().height,
			samples: [{ t: e.timeStamp, y: e.clientY }],
		};
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const held = drag.current;
		const panel = panelRef.current;
		if (!held || held.id !== e.pointerId || !panel) return;
		const travel = e.clientY - held.startY;
		if (!held.active) {
			if (Math.abs(travel) < SHEET_DRAG_SLOP_PX) return;
			try {
				e.currentTarget.setPointerCapture(e.pointerId);
			} catch {
				drag.current = null;
				return;
			}
			cancelPending();
			held.active = true;
			panel.dataset.dragging = "true";
		}
		held.samples.push({ t: e.timeStamp, y: e.clientY });
		if (held.samples.length > MAX_SAMPLES) held.samples.shift();
		setOffset(sheetDragOffset(snap.peek(), travel));
	}

	function onPointerEnd(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const held = drag.current;
		if (!held || held.id !== e.pointerId) return;
		drag.current = null;
		if (!held.active) return;
		const el = e.currentTarget;
		if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
		const panel = panelRef.current;
		if (panel) delete panel.dataset.dragging;
		const outcome = e.type === "pointercancel" ? snap.peek() : sheetRelease({
			snap: snap.peek(),
			travel: e.clientY - held.startY,
			velocity: releaseVelocity(held.samples),
			height: held.height,
		});
		if (outcome === "dismiss") requestClose();
		else settle(outcome);
	}
	// #endregion

	if (!isOpen) return null;
	const full = snap.value === "full";

	return (
		<div class="ins-sheet" data-state={closing.value ? "closing" : "open"}>
			<div
				class={`ins-sheet__scrim ins-sheet__scrim--${scrim}`}
				aria-hidden="true"
				onClick={requestClose}
			/>
			<div
				ref={panelRef}
				id={id}
				class="ins-sheet__panel"
				role="dialog"
				aria-modal="false"
				aria-label={label}
				tabIndex={-1}
				data-snap={snap.value}
			>
				<div
					class="ins-sheet__head"
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerEnd}
					onPointerCancel={onPointerEnd}
				>
					<span class="ins-sheet__grip" aria-hidden="true" />
					<ToolButton
						icon={full ? "collapse" : "expand"}
						label={full ? "Shrink sheet" : "Expand sheet"}
						onClick={() => settle(full ? "half" : "full")}
					/>
					<ToolButton icon="close" label={`Close ${label.toLowerCase()}`} onClick={requestClose} />
				</div>
				<div class="ins-sheet__body">{children}</div>
			</div>
		</div>
	);
}
