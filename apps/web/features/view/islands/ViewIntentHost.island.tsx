import { useEffect } from "preact/hooks";
import { openBookingPanel, requestContact } from "../core/booking-state.ts";
import { applyOpen } from "../core/view-state.ts";
import { type ViewIntent, withoutViewIntent } from "../core/view-intent.ts";

/**
 * ViewIntentHost — acts once on a listing page's honoured `?intent=` (Decision #422): it opens the
 * panel the page's own control opens — the slot picker, the Contact menu or the apply dialog — through
 * the same bridge that control writes, then takes the parameter out of the address bar so a reload or
 * Back never reopens it. Mounted by the page controller whenever the URL carried an intent; `intent` is
 * what `honouredIntent` accepted, and `null` only strips the parameter. Renders nothing.
 *
 * The panel opens after the document has loaded and two frames have painted: the Contact menu anchors
 * to whichever of the lane and the buy bar is laid out, and that is only knowable once the page's
 * styles have landed.
 */
export default function ViewIntentHost({ intent }: { intent: ViewIntent | null }): null {
	useEffect(() => {
		const { pathname, search, hash } = globalThis.location;
		globalThis.history.replaceState(
			globalThis.history.state,
			"",
			withoutViewIntent(pathname + search + hash),
		);
		if (!intent) return;
		return afterSettled(() => act(intent));
	}, []);
	return null;
}

function act(intent: ViewIntent): void {
	switch (intent) {
		case "book":
			openBookingPanel("scheduler");
			return;
		case "contact":
			requestContact();
			return;
		case "apply":
			applyOpen.value = true;
			return;
	}
}

function afterSettled(run: () => void): () => void {
	let frame = 0;
	let live = true;
	const schedule = () => {
		frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => {
				if (live) run();
			});
		});
	};
	if (document.readyState === "complete") schedule();
	else globalThis.addEventListener("load", schedule, { once: true });
	return () => {
		live = false;
		cancelAnimationFrame(frame);
		globalThis.removeEventListener("load", schedule);
	};
}
