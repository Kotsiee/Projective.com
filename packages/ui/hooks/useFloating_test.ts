/**
 * Tests for the anchored positioner's pure geometry.
 *
 * The case these exist for is the feedback loop: a panel that caps itself with
 * `max-block-size: var(--float-available-h)` is measuring a number this function produced, so if the
 * flip test reads the panel's RENDERED height the decision becomes a function of the previous
 * decision. Reproducing that needs no DOM — it is arithmetic over a rect — so the loop is exercised
 * by feeding the previous pass's `availableHeight` back in as the next pass's height, which is
 * exactly what the browser does through the stylesheet.
 *
 * `computePosition` touches only plain numbers and a `DOMRect`-shaped object, so a literal stands in
 * for the rect without a DOM implementation.
 */
import { assertEquals } from "@std/assert";
import { computePosition } from "./useFloating.ts";

// #region Fixtures
type Rect = Parameters<typeof computePosition>[0];

/** A trigger rect at a given vertical band. Widths are irrelevant to the vertical cases. */
function trigger(top: number, height = 32, left = 100, width = 200): Rect {
	return {
		x: left,
		y: top,
		top,
		left,
		right: left + width,
		bottom: top + height,
		width,
		height,
		toJSON: () => ({}),
	} as Rect;
}

const VIEWPORT = { width: 1280, height: 720 };
const OFFSET = 4;
const PAD = 8;

/**
 * One reposition. `renderedH` is the height the panel currently occupies; `naturalH` is the height it
 * would occupy uncapped. Returns the resolved side and the space the panel is being told it has.
 */
function place(
	t: Rect,
	renderedH: number,
	naturalH: number,
	viewport: { width: number; height: number } = VIEWPORT,
) {
	const s = computePosition(
		t,
		240,
		renderedH,
		viewport,
		"bottom-start",
		OFFSET,
		PAD,
		[],
		[],
		PAD,
		naturalH,
	);
	return { placement: s.placement, availableHeight: s.availableHeight, top: s.top, left: s.left };
}

/**
 * Drive the loop the stylesheet closes: pass 1 renders at the panel's natural height, and every pass
 * after that renders at whatever cap the previous pass published.
 */
function settle(
	t: Rect,
	natural: number,
	viewport: { width: number; height: number } = VIEWPORT,
	passes = 4,
) {
	const seen: string[] = [];
	let rendered = natural;
	for (let i = 0; i < passes; i++) {
		const r = place(t, rendered, natural, viewport);
		seen.push(r.placement);
		rendered = Math.min(natural, r.availableHeight ?? natural);
	}
	return seen;
}
// #endregion

Deno.test("computePosition: prefers the requested side when it fits", () => {
	const t = trigger(100);
	const r = place(t, 200, 200);
	assertEquals(r.placement, "bottom-start");
	assertEquals(r.top, 136); // trigger bottom (132) + offset
	assertEquals(r.left, 100);
});

Deno.test("computePosition: flips when the requested side lacks room and the other has more", () => {
	// Trigger low on the screen: 100px below, 588px above.
	const t = trigger(588);
	assertEquals(place(t, 300, 300).placement, "top-start");
});

Deno.test("computePosition: reports the space left on the side it resolved to", () => {
	const t = trigger(100);
	// bottom: viewport height - padding - (trigger bottom + offset) = 720 - 8 - 136
	assertEquals(place(t, 200, 200).availableHeight, 576);
});

Deno.test("computePosition: the flip is idempotent once the panel is capped", () => {
	/*
	 * The band where the loop actually bites, and it is narrow on purpose — a fixture outside it
	 * passes whether or not the fix is present, which is how a vacuous regression test gets written.
	 *
	 * Let `a` be the room above and `b` the room below. Pass 1 flips to `top` whenever `a > b` and the
	 * natural height does not fit below. The cap it then publishes is `a - offset - padding`, so pass
	 * 2 asks whether `b < (a - 12) + offset`, i.e. whether `b < a - 8`. Every trigger with
	 * `a - 8 <= b < a` therefore flipped to `top` and immediately back to `bottom`, settling on the
	 * side with LESS room. Here a = 110, b = 105.
	 */
	const shortViewport = { width: 1280, height: 247 };
	const t = trigger(110, 32);
	assertEquals(settle(t, 600, shortViewport), [
		"top-start",
		"top-start",
		"top-start",
		"top-start",
	]);

	// And the plain cases stay put, so the fix has not simply frozen the flip.
	const roomy = trigger(305, 32); // 305 above, 383 below
	assertEquals(settle(roomy, 600), [
		"bottom-start",
		"bottom-start",
		"bottom-start",
		"bottom-start",
	]);
	const low = trigger(600, 32); // 600 above, 88 below
	assertEquals(settle(low, 600), ["top-start", "top-start", "top-start", "top-start"]);
});

Deno.test("computePosition: a capped height still positions the panel it actually drew", () => {
	// Rendered 88, natural 600, resolved to `top`: the panel's top edge must be offset by the box it
	// occupies, not by the box it wanted — otherwise a capped panel floats away from its trigger.
	const t = trigger(600, 32);
	const r = place(t, 88, 600);
	assertEquals(r.placement, "top-start");
	assertEquals(r.top, 508); // trigger top (600) - rendered height (88) - offset (4)
});

Deno.test("computePosition: defaults the natural size to the rendered size", () => {
	// A caller that cannot measure a natural size gets exactly the pre-existing behaviour.
	const t = trigger(588);
	const withDefault = computePosition(
		t,
		240,
		300,
		VIEWPORT,
		"bottom-start",
		OFFSET,
		PAD,
	);
	assertEquals(withDefault.placement, place(t, 300, 300).placement);
	assertEquals(withDefault.top, place(t, 300, 300).top);
});

Deno.test("computePosition: clamps into the viewport inset by the collision padding", () => {
	const t = trigger(100, 32, 1200, 60); // trigger near the right edge
	const r = place(t, 200, 200);
	assertEquals(r.left, VIEWPORT.width - 240 - PAD);
});
