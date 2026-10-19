/// <reference lib="dom" />
/**
 * The hero morph's `pageswap` gate: only an armed card navigation keeps its cross-document View
 * Transition, and skipping one never leaks the `AbortError` that a skipped transition's `ready`
 * rejects with, so no exit from Explore raises an unhandled rejection.
 */
import { assertEquals } from "@std/assert";
import { bindHeroMorph, type PageSwapLike } from "./hero-morph.ts";

// #region Harness
/** A `pageswap` event whose transition behaves as the engine's does: a skip rejects `ready`. */
function swapEvent(): { event: PageSwapLike; skipped: () => boolean } {
	let rejectReady: (reason: unknown) => void = () => {};
	const ready = new Promise<void>((_, reject) => {
		rejectReady = reject;
	});
	let skipped = false;
	const event = new Event("pageswap") as PageSwapLike;
	Object.defineProperty(event, "viewTransition", {
		value: {
			ready,
			skipTransition() {
				skipped = true;
				rejectReady(new DOMException("Transition was skipped.", "AbortError"));
			},
		},
	});
	return { event, skipped: () => skipped };
}

/** Runs `body` with a minimal `document`: `armed` names a card's media, `reduced` sets `data-motion`. */
async function withPage(
	{ armed, reduced }: { armed: boolean; reduced: boolean },
	body: () => void,
): Promise<{ unhandled: number }> {
	const fake = {
		documentElement: { dataset: reduced ? { motion: "reduced" } : {} },
		querySelector: (selector: string) => (armed && selector === "[data-hero-morph]" ? {} : null),
		querySelectorAll: () => [],
	};
	Object.defineProperty(globalThis, "document", {
		value: fake,
		configurable: true,
		writable: true,
	});
	let unhandled = 0;
	const onUnhandled = (e: PromiseRejectionEvent) => {
		e.preventDefault();
		unhandled++;
	};
	globalThis.addEventListener("unhandledrejection", onUnhandled);
	const unbind = bindHeroMorph();
	try {
		body();
		await new Promise((resolve) => setTimeout(resolve, 10));
	} finally {
		unbind();
		globalThis.removeEventListener("unhandledrejection", onUnhandled);
		Reflect.deleteProperty(globalThis, "document");
	}
	return { unhandled };
}
// #endregion

Deno.test("hero morph — an un-armed exit skips its transition without an unhandled rejection", async () => {
	const swap = swapEvent();
	const { unhandled } = await withPage({ armed: false, reduced: false }, () => {
		globalThis.dispatchEvent(swap.event);
	});
	assertEquals(swap.skipped(), true);
	assertEquals(unhandled, 0);
});

Deno.test("hero morph — an armed card navigation keeps its transition", async () => {
	const swap = swapEvent();
	const { unhandled } = await withPage({ armed: true, reduced: false }, () => {
		globalThis.dispatchEvent(swap.event);
	});
	assertEquals(swap.skipped(), false);
	assertEquals(unhandled, 0);
});

Deno.test("hero morph — reduced motion skips even an armed navigation, quietly", async () => {
	const swap = swapEvent();
	const { unhandled } = await withPage({ armed: true, reduced: true }, () => {
		globalThis.dispatchEvent(swap.event);
	});
	assertEquals(swap.skipped(), true);
	assertEquals(unhandled, 0);
});
