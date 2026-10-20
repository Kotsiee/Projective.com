import { type ReadonlySignal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { motionReduced } from "../../display/core/scroll-spy.ts";

/** How long a celebration stays active by default, ms: the burst and the settle, with margin. */
export const CELEBRATION_MS = 900;

/** What {@link useActionCelebration} hands its caller. */
export interface ActionCelebrationApi {
	/** Whether the burst is playing; pass it to `<ActionCelebration active>`. */
	active: ReadonlySignal<boolean>;
	/** Play the burst once. A no-op under reduced motion, or while one is already playing. */
	celebrate(): void;
}

/**
 * useActionCelebration — the trigger for {@link ActionCelebration}: call `celebrate()` once the
 * action has actually committed (never on press), and the burst plays for `durationMs`. Under either
 * reduced-motion channel nothing plays; the caller's confirmed state is the whole acknowledgement.
 */
export function useActionCelebration(durationMs: number = CELEBRATION_MS): ActionCelebrationApi {
	const active = useSignal(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(timer.current), []);

	return {
		active,
		celebrate() {
			if (active.peek() || motionReduced()) return;
			active.value = true;
			timer.current = setTimeout(() => {
				active.value = false;
			}, durationMs);
		},
	};
}
