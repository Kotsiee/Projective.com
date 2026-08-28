import { assertEquals } from "@std/assert";
import { revisionAllowanceKind, type StageRevisions } from "./view.ts";

/**
 * The revision-allowance classification, pinned.
 *
 * Every assertion here is a CLAIM THE PRODUCT MAKES to a buyer about what they will be charged for a
 * second look at the work. Getting one wrong is not a broken layout — it is a confident, wrong
 * sentence beside somebody's money, and it is exactly the class of defect a type checker cannot see
 * and a source-reading review reads straight past. The three shapes are rendered by four separate
 * surfaces (the conversion lane, the stage ledger, the listing's trust row and the catalogue editor's
 * own hint), which is four chances to describe one commitment differently unless they all ask this.
 */

/** A revision allowance with the two numbers set. `label` is display-only and never read here. */
function allowance(free: number, extra: number): StageRevisions {
	return { free, extraPrice: { min: extra, max: extra, label: `${extra}` } };
}

Deno.test("a priced further round with an included allowance is 'included'", () => {
	assertEquals(revisionAllowanceKind(allowance(2, 120)), "included");
	assertEquals(revisionAllowanceKind(allowance(1, 5)), "included");
});

Deno.test("nothing included but a price per round is 'metered', not 'included'", () => {
	assertEquals(revisionAllowanceKind(allowance(0, 90)), "metered");
});

/**
 * The interaction that makes this a shared rule rather than two independent reads.
 *
 * Once further rounds cost nothing the included COUNT is meaningless, and a surface that prints both
 * anyway produces "2 free revisions, then free" — a sentence that argues with itself. So a zero price
 * outranks any count, including a zero count.
 */
Deno.test("a free further round is 'unlimited' whatever the included count says", () => {
	assertEquals(revisionAllowanceKind(allowance(2, 0)), "unlimited");
	assertEquals(revisionAllowanceKind(allowance(0, 0)), "unlimited");
	assertEquals(revisionAllowanceKind(allowance(99, 0)), "unlimited");
});

/**
 * `max`, not `min`, decides. A range whose floor is zero still charges somebody something at the top
 * of it, and announcing that as unlimited would be the one error here that costs the reader money.
 */
Deno.test("a range that can charge is never announced as unlimited", () => {
	const ranged: StageRevisions = { free: 0, extraPrice: { min: 0, max: 80, label: "up to 80" } };
	assertEquals(revisionAllowanceKind(ranged), "metered");
});
