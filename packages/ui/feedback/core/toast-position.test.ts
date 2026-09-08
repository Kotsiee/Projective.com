/**
 * The toast placement contract, and the two halves of it that fail silently.
 *
 * A position is only ever half a contract: `resolveToastAnchor` decides a class name, and
 * `toast.css` decides whether that class name means anything. Neither half can be tested alone —
 * an anchor with no rule leaves a `position: fixed` stack at its static position, which is a toast
 * nobody sees rather than a toast in the wrong corner, and no type-checker can see it. So the
 * stylesheet is READ here and cross-checked against the anchor list.
 *
 * The RTL assertions are the same shape. `inset-inline-start: 50%` + `translateX(-50%)` centres
 * correctly in LTR and lands a full width off-centre in RTL, because `inset-inline-start` mirrors
 * and `translateX` does not. Both directions render, both look deliberate in source, and only one
 * of them is right — so the rule is pinned against the mechanism rather than the appearance.
 */
import { assert, assertEquals } from "@std/assert";
import {
	DEFAULT_TOAST_POSITION,
	resolveToastAnchor,
	TOAST_ANCHORS,
	TOAST_LOGICAL_ANCHORS,
	type ToastAnchor,
} from "./toast-position.ts";

// #region Resolution
Deno.test("resolveToastAnchor — a canonical anchor passes through unchanged", () => {
	for (const anchor of TOAST_ANCHORS) {
		assertEquals(resolveToastAnchor(anchor), anchor);
	}
});

Deno.test("resolveToastAnchor — every logical spelling maps to a real anchor", () => {
	for (const [logical, canonical] of Object.entries(TOAST_LOGICAL_ANCHORS)) {
		assertEquals(
			resolveToastAnchor(logical as keyof typeof TOAST_LOGICAL_ANCHORS),
			canonical,
			`${logical} must resolve to ${canonical}`,
		);
		assert(
			TOAST_ANCHORS.includes(canonical),
			`${logical} resolves to ${canonical}, which is not an anchor the stylesheet knows`,
		);
	}
});

Deno.test("resolveToastAnchor — `bottom-end` and `bottom-right` are the SAME anchor", () => {
	// Not a tautology: they are two spellings offered to callers, and the whole point of offering
	// both is that they never diverge into two rules that could be styled differently.
	assertEquals(resolveToastAnchor("bottom-end"), resolveToastAnchor("bottom-right"));
	assertEquals(resolveToastAnchor("bottom-start"), resolveToastAnchor("bottom-left"));
});

Deno.test("resolveToastAnchor — omitted, empty and unknown all fall back to the default", () => {
	assertEquals(resolveToastAnchor(undefined), DEFAULT_TOAST_POSITION);
	// Reachable from JavaScript the type-checker never saw — an API response, a config value, a
	// hand-written island prop. The fallback is what stops it becoming an invisible stack.
	assertEquals(resolveToastAnchor("bottom-middle" as ToastAnchor), DEFAULT_TOAST_POSITION);
	assertEquals(resolveToastAnchor("" as ToastAnchor), DEFAULT_TOAST_POSITION);
});

Deno.test("the default has not moved", () => {
	// Pinned deliberately. Every mount passes `position` explicitly today, so the only thing a
	// changed default could do is silently relocate a stack somebody adds later.
	assertEquals(DEFAULT_TOAST_POSITION, "top-right");
});
// #endregion

// #region The stylesheet half
const css = await Deno.readTextFile(new URL("../styles/toast.css", import.meta.url));

/** The declaration block for one anchor's rule, or `null` when the sheet has no rule for it. */
function blockFor(anchor: ToastAnchor): string | null {
	// Anchored on `{` so `.ui-toast--center` cannot match `.ui-toast--center-left`'s rule.
	const start = css.indexOf(`.ui-toast--${anchor} {`);
	if (start === -1) return null;
	const end = css.indexOf("}", start);
	return end === -1 ? null : css.slice(start, end);
}

Deno.test("every anchor the resolver can return has a rule in toast.css", () => {
	for (const anchor of TOAST_ANCHORS) {
		assert(
			blockFor(anchor) !== null,
			`.ui-toast--${anchor} has no rule — the stack would be unpositioned`,
		);
	}
});

Deno.test("no anchor is positioned with a physical inset", () => {
	// `left`/`right` do not mirror. One of these anywhere in the block would pin that stack to a
	// physical side of the viewport while its siblings follow the reading direction.
	for (const anchor of TOAST_ANCHORS) {
		const block = blockFor(anchor)!;
		assert(!/\n\s*(left|right)\s*:/.test(block), `.ui-toast--${anchor} uses a physical inset`);
	}
});

Deno.test("the centred anchors centre with auto margins, never with translateX", () => {
	for (const anchor of ["top-center", "center", "bottom-center"] as const) {
		const block = blockFor(anchor)!;
		assert(
			/inset-inline:\s*0/.test(block) && /margin-inline:\s*auto/.test(block),
			`.ui-toast--${anchor} must centre with \`inset-inline: 0\` + \`margin-inline: auto\``,
		);
		assert(
			!/translateX|translate\(/.test(block),
			`.ui-toast--${anchor} centres with a PHYSICAL translate — correct in LTR, a full width off-centre in RTL`,
		);
	}
});

Deno.test("`center` still centres on the block axis, which translateY does correctly", () => {
	// The horizontal fix must not take the vertical centring with it: direction does not affect the
	// block axis, and `inset-block: 0` would stretch the stack rather than centre it.
	const block = blockFor("center")!;
	assert(/transform:\s*translateY\(-50%\)/.test(block));
});
// #endregion
