import type { RefObject } from "preact";
import type { ReadonlySignal } from "@preact/signals";
import { useEffect, useMemo } from "preact/hooks";
import { createIdleWake } from "../core/idle-wake.ts";

const ACTIVITY = ["pointermove", "pointerdown", "wheel", "keydown", "focusin"] as const;

function holding(bar: HTMLElement | null): boolean {
	if (!bar) return false;
	return bar.matches(":hover") || bar.contains(document.activeElement) ||
		bar.querySelector('[aria-expanded="true"]') !== null;
}

/**
 * Whether a floating canvas toolbar shows: awake on any pointer, wheel or key activity over `surface`
 * (the toolbar's own parent when omitted), asleep `TOOLBAR_IDLE_MS` after the last, and held up
 * while the pointer rests on the toolbar, focus is inside it, or a menu it opened is open.
 */
export function useIdleWake(
	bar: RefObject<HTMLElement>,
	surface?: RefObject<HTMLElement>,
): ReadonlySignal<boolean> {
	const wake = useMemo(() => createIdleWake({ hold: () => holding(bar.current) }), []);

	useEffect(() => {
		const target = surface?.current ?? bar.current?.parentElement ?? null;
		const onActivity = () => wake.wake();
		for (const type of ACTIVITY) target?.addEventListener(type, onActivity, { passive: true });
		return () => {
			for (const type of ACTIVITY) target?.removeEventListener(type, onActivity);
			wake.dispose();
		};
	}, []);

	return wake.awake;
}
