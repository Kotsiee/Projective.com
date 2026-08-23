import { assertEquals } from "@std/assert";
import { resolveSplitSizes } from "./split-sizes.ts";

/**
 * The pane-count reconciliation, exercised as arithmetic.
 *
 * The defect these exist for needs no DOM: the sizes were resolved exactly once, on mount, so a
 * caller that hid or revealed a pane between renders kept an array describing the OTHER layout. The
 * modal that surfaced it (the Event Modal's roster column) leaves a 68/32 split for a single pane the
 * moment the reader opens a tab with no side panel, and the mirror case reads past the end of the
 * array. Both are a length mismatch, so both are one rule.
 */

const none = () => null;

// #region The live ratio wins while it still fits
Deno.test("resolveSplitSizes — a matching live ratio wins over both seeds and storage", () => {
	// This is the drag-persistence contract: `size` is a seed, so a re-render must not move the pane
	// back to it. Storage loses too — what is on screen is more current than what was stored.
	assertEquals(
		resolveSplitSizes([55, 45], [68, 32], () => [10, 90]),
		[55, 45],
	);
});

Deno.test("resolveSplitSizes — the returned array is a copy, so a caller cannot mutate the source", () => {
	const tracked = [55, 45];
	const out = resolveSplitSizes(tracked, [68, 32], none);
	out[0] = 1;
	assertEquals(tracked, [55, 45]);
});
// #endregion

// #region A changed pane count
Deno.test("resolveSplitSizes — losing a pane re-seeds instead of stranding the survivor", () => {
	// The reported defect, exactly: a 68/32 split, then the side panel goes. Without this the one
	// remaining pane kept `--split-size: 68%` and a third of the modal was dead space.
	assertEquals(resolveSplitSizes([68, 32], [100], none), [100]);
});

Deno.test("resolveSplitSizes — gaining a pane re-seeds instead of reading past the end", () => {
	// The mirror case. `sizes[1]` was `undefined`, which reached the DOM as `--split-size: undefined%`
	// and `aria-valuenow="NaN"` — a broken layout AND a broken accessible value.
	const out = resolveSplitSizes([100], [68, 32], none);
	assertEquals(out, [68, 32]);
	for (const v of out) assertEquals(Number.isFinite(v), true);
});

Deno.test("resolveSplitSizes — a stored ratio of the wrong length is refused, never coerced", () => {
	// A ratio for two panes is not a worse answer for one pane; it is an answer to a different
	// question. Padding or truncating it would silently invent a number nobody chose.
	assertEquals(resolveSplitSizes([68, 32], [100], () => [55, 45]), [100]);
});

Deno.test("resolveSplitSizes — a stored ratio of the RIGHT length is restored over the seeds", () => {
	// The round trip that makes the reconciliation safe to do at all: hide the panel, come back, and
	// the ratio the reader dragged is still theirs rather than the caller's declared default.
	assertEquals(resolveSplitSizes([100], [68, 32], () => [55, 45]), [55, 45]);
});

Deno.test("resolveSplitSizes — storage is not read while the live ratio fits", () => {
	// Lazy on purpose: it is a `localStorage` hit on every render of every split layout on the page.
	let reads = 0;
	resolveSplitSizes([68, 32], [68, 32], () => {
		reads++;
		return null;
	});
	assertEquals(reads, 0);
});
// #endregion

// #region Seeding
Deno.test("resolveSplitSizes — undeclared panes share what the declared ones leave", () => {
	assertEquals(resolveSplitSizes([], [60, undefined, undefined], none), [60, 20, 20]);
	assertEquals(resolveSplitSizes([], [undefined, undefined], none), [50, 50]);
});

Deno.test("resolveSplitSizes — over-declared seeds leave nothing rather than a negative share", () => {
	// Two panes declaring 70 each is a caller error; the honest response is to give the undeclared
	// pane zero, not a negative basis that flexbox would resolve into an unpredictable layout.
	assertEquals(resolveSplitSizes([], [70, 70, undefined], none), [70, 70, 0]);
});

Deno.test("resolveSplitSizes — a fully declared set is passed through untouched", () => {
	assertEquals(resolveSplitSizes([], [68, 32], none), [68, 32]);
});
// #endregion
