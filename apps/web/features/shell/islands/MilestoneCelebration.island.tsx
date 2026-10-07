import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Toast, useToast } from "@projective/ui/feedback";
import {
	accountSetupSnapshot,
	celebrating,
	markOf,
	MILESTONE_TOAST,
	milestoneReached,
	rememberMark,
	seenMark,
} from "@web/features/shell/core/milestones.ts";

/** How long the crest and the ring keep `data-celebrate` — comfortably past the stamp animation. */
const CELEBRATION_MS = 1200;

/**
 * MilestoneCelebration — the header's in-situ celebration of a high-stakes milestone (Decision #155):
 * a verification stamp landing, or profile setup reaching 100%.
 *
 * Deliberately NOT a modal. It watches the setup the account popover renders, compares it with the
 * last mark this device saw, and on a raise does two non-blocking things: sets {@link celebrating},
 * which plays a one-shot stamp animation on the header ring and the popover crest, and posts one
 * transient toast that says only what the milestone actually unlocks. A first visit only records the
 * baseline, so nobody is congratulated for a state they already held.
 */
export default function MilestoneCelebration(): JSX.Element | null {
	const toast = useToast();
	const toastMounted = useSignal(false);

	useSignalEffect(() => {
		const setup = accountSetupSnapshot.value;
		if (!setup?.handle) return;
		const next = markOf(setup);
		const kind = milestoneReached(seenMark(setup.handle), next);
		rememberMark(setup.handle, next);
		if (!kind) return;

		if (!toastMounted.peek() && !document.querySelector(".ui-toast")) toastMounted.value = true;
		const copy = MILESTONE_TOAST[kind];
		toast.show({ severity: "success", summary: copy.summary, detail: copy.detail, life: 6000 });

		celebrating.value = kind;
		setTimeout(() => {
			if (celebrating.peek() === kind) celebrating.value = null;
		}, CELEBRATION_MS);
	});

	return toastMounted.value ? <Toast position="bottom-center" /> : null;
}
