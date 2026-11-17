import type { JSX, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import {
	leaveOffset,
	type ScopeStep,
	SWIPE_SLOP_PX,
	swipeOutcome,
} from "../core/scope-deck.ts";

/** Where the hero's slide is: at rest, following a held pointer, or leaving for another wallet. */
export type SwipePhase = "rest" | "drag" | "leave";

/** What {@link useScopeSwipe} hands the hero: the two elements it moves, its phase and its handlers. */
export interface ScopeSwipe {
	/** The drag surface — the switcher and the balance it heads (`touch-action: pan-y`). */
	deckRef: RefObject<HTMLDivElement>;
	/** The part that moves under the pointer and leaves for a step. */
	slideRef: RefObject<HTMLDivElement>;
	phase: Signal<SwipePhase>;
	/** Plays the leave motion for a step taken some other way (a chevron, an arrow key). */
	leave: (step: ScopeStep) => void;
	handlers: Pick<
		JSX.HTMLAttributes<HTMLDivElement>,
		| "onPointerDown"
		| "onPointerMove"
		| "onPointerUp"
		| "onPointerCancel"
		| "onLostPointerCapture"
		| "onClickCapture"
		| "onDragStart"
	>;
}

interface Press {
	id: number;
	x: number;
	y: number;
	lastX: number;
	lastT: number;
	velocity: number;
	dragging: boolean;
}

/** A release this long after the last move is a stop, not a flick. */
const FLICK_WINDOW_MS = 80;

function rtlOf(el: Element | null): boolean {
	return el ? getComputedStyle(el).direction === "rtl" : false;
}

function reducedMotion(): boolean {
	if (typeof document === "undefined") return true;
	if (document.documentElement.dataset.motion === "reduced") return true;
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * The hero's scope carousel gesture. A horizontal drag on the deck moves the slide 1:1 under the
 * pointer (`--wlt-swipe-x`, written straight onto the deck from a signal, so a drag re-renders
 * nothing) and, on release, either commits a step to the neighbouring wallet or settles back. A
 * press becomes a drag only past {@link SWIPE_SLOP_PX} along the inline axis — a vertical one is
 * left to the page's scroll — and capture is taken only then, so a tap on the scope pill or a
 * chevron still lands on it; the click a finished drag would fire is swallowed instead.
 *
 * Under either reduced-motion channel the slide still follows a held pointer (direct manipulation)
 * but never animates: it does not glide back or out. A page restored from the back-forward cache
 * starts at rest again.
 */
export function useScopeSwipe(
	{ enabled, onCommit }: { enabled: boolean; onCommit: (step: ScopeStep) => void },
): ScopeSwipe {
	const deckRef = useRef<HTMLDivElement>(null);
	const slideRef = useRef<HTMLDivElement>(null);
	const phase = useSignal<SwipePhase>("rest");
	const offset = useSignal(0);
	const press = useRef<Press | null>(null);
	const swallowClick = useRef(false);
	const width = useRef(0);
	const measure = () => (width.current = slideRef.current?.offsetWidth ?? 0);

	useSignalEffect(() => {
		const x = offset.value;
		const deck = deckRef.current;
		if (!deck) return;
		deck.style.setProperty("--wlt-swipe-x", `${x}px`);
		deck.style.setProperty(
			"--wlt-swipe-p",
			String(width.current > 0 ? Math.min(1, Math.abs(x) / width.current) : 0),
		);
	});

	useEffect(() => {
		const onShow = (e: PageTransitionEvent) => {
			if (!e.persisted) return;
			press.current = null;
			phase.value = "rest";
			offset.value = 0;
		};
		globalThis.addEventListener("pageshow", onShow);
		return () => globalThis.removeEventListener("pageshow", onShow);
	}, []);

	const settle = () => {
		phase.value = "rest";
		offset.value = 0;
	};

	const leave = (step: ScopeStep) => {
		phase.value = "leave";
		if (reducedMotion()) return;
		offset.value = leaveOffset(step, measure(), rtlOf(deckRef.current));
	};

	const release = (e: PointerEvent) => {
		const held = press.current;
		press.current = null;
		if (!held?.dragging) return;
		swallowClick.current = true;
		const step = swipeOutcome({
			dx: e.clientX - held.x,
			width: width.current,
			velocity: e.timeStamp - held.lastT > FLICK_WINDOW_MS ? 0 : held.velocity,
			rtl: rtlOf(deckRef.current),
		});
		if (!step) return settle();
		leave(step);
		onCommit(step);
	};

	const abandon = () => {
		const held = press.current;
		press.current = null;
		if (held?.dragging || phase.peek() === "drag") settle();
	};

	return {
		deckRef,
		slideRef,
		phase,
		leave,
		handlers: {
			onPointerDown: (e) => {
				swallowClick.current = false;
				if (!enabled || !e.isPrimary || phase.peek() === "leave") return;
				if (e.pointerType === "mouse" && e.button !== 0) return;
				press.current = {
					id: e.pointerId,
					x: e.clientX,
					y: e.clientY,
					lastX: e.clientX,
					lastT: e.timeStamp,
					velocity: 0,
					dragging: false,
				};
			},
			onPointerMove: (e) => {
				const held = press.current;
				if (!held || e.pointerId !== held.id) return;
				const dx = e.clientX - held.x;
				const dy = e.clientY - held.y;
				if (!held.dragging) {
					if (Math.abs(dy) > SWIPE_SLOP_PX && Math.abs(dy) >= Math.abs(dx)) {
						press.current = null;
						return;
					}
					if (Math.abs(dx) < SWIPE_SLOP_PX || Math.abs(dx) < Math.abs(dy)) return;
					held.dragging = true;
					measure();
					phase.value = "drag";
					globalThis.getSelection?.()?.removeAllRanges();
					e.currentTarget.setPointerCapture(e.pointerId);
				}
				const dt = e.timeStamp - held.lastT;
				if (dt > 0) held.velocity = (e.clientX - held.lastX) / dt;
				held.lastX = e.clientX;
				held.lastT = e.timeStamp;
				offset.value = dx;
			},
			onPointerUp: (e) => release(e),
			onPointerCancel: abandon,
			onLostPointerCapture: () => {
				if (phase.peek() === "drag") abandon();
			},
			onClickCapture: (e) => {
				if (!swallowClick.current) return;
				swallowClick.current = false;
				e.preventDefault();
				e.stopPropagation();
			},
			onDragStart: (e) => {
				if (enabled) e.preventDefault();
			},
		},
	};
}
