import { assertEquals } from "@std/assert";
import { plural, resolveCta } from "./common.ts";

/**
 * The CTA resolver's rules, pinned.
 *
 * Every assertion here is a CLAIM THE PRODUCT MAKES to a buyer — what the button says, whether it can
 * be pressed, and why it cannot. The failure mode of getting one wrong is not a broken layout; it is a
 * confident, wrong sentence beside somebody's money, which is exactly the class of defect a type
 * checker cannot see and a source-reading review reads straight past.
 */

const base = {
	sessionCount: 1,
	seatsRemaining: null,
	draftHref: null,
	bookingsOpen: true,
} as const;

Deno.test("product offers Buy now with a basket secondary", () => {
	const rig = resolveCta({ ...base, format: "product" });
	assertEquals(rig.primary.kind, "buy_now");
	assertEquals(rig.primary.label, "Buy now");
	assertEquals(rig.secondary?.kind, "add_to_basket");
});

Deno.test("pipeline offers Add to projects and NO basket line", () => {
	const rig = resolveCta({ ...base, format: "pipeline" });
	assertEquals(rig.primary.kind, "instantiate_pipeline");
	assertEquals(rig.primary.label, "Add to projects");
	// A pipeline is staffed and then bought against, one ticket at a time. A basket control here would
	// be an affordance with nothing to add.
	assertEquals(rig.secondary, null);
});

Deno.test("an existing draft flips the pipeline primary to a LINK, never a destructive action", () => {
	const rig = resolveCta({ ...base, format: "pipeline", draftHref: "/projects/x/board" });
	assertEquals(rig.primary.kind, "open_project");
	assertEquals(rig.primary.label, "Open project");
	assertEquals(rig.primary.href, "/projects/x/board");
	assertEquals(rig.primary.disabled, false);
	// The whole point: it must never become "Remove project". A conversion CTA that turns destructive
	// puts a delete under a cursor that was hovering the primary one render ago.
	assertEquals(/remove|delete|archive/i.test(rig.primary.label), false);
});

Deno.test("one-off and single task both Continue, with different accessible names", () => {
	const oneOff = resolveCta({ ...base, format: "one_off" });
	const task = resolveCta({ ...base, format: "single_task" });
	assertEquals(oneOff.primary.label, "Continue");
	assertEquals(task.primary.label, "Continue");
	assertEquals(oneOff.primary.kind, "open_scope");
	assertEquals(task.primary.kind, "open_scope");
	// The visible label is the same; what the reader is about to be asked for is not.
	assertEquals(oneOff.primary.ariaLabel !== task.primary.ariaLabel, true);
});

Deno.test("a session offers no basket secondary — a booking needs a time", () => {
	const rig = resolveCta({ ...base, format: "session" });
	assertEquals(rig.primary.label, "Book session");
	assertEquals(rig.secondary, null);
});

Deno.test("a set-session block names its size and pluralises correctly", () => {
	assertEquals(resolveCta({ ...base, format: "set_session", sessionCount: 6 }).primary.label, "Book 6 sessions");
	// A block of one is not a block. This is the case that produces "Book 1 sessions" when nobody checks.
	assertEquals(resolveCta({ ...base, format: "set_session", sessionCount: 1 }).primary.label, "Book session");
});

Deno.test("a cohort counts its remaining seats, singular at one", () => {
	assertEquals(
		resolveCta({ ...base, format: "cohort", seatsRemaining: 7 }).primary.label,
		"Join cohort (7 spots left)",
	);
	assertEquals(
		resolveCta({ ...base, format: "cohort", seatsRemaining: 1 }).primary.label,
		"Join cohort (1 spot left)",
	);
});

Deno.test("a full cohort is REFUSED with a reason, not hidden", () => {
	const rig = resolveCta({ ...base, format: "cohort", seatsRemaining: 0 });
	assertEquals(rig.primary.disabled, true);
	assertEquals(rig.primary.label, "Cohort full");
	// The reason is the difference between a reader leaving and a reader looking at the next cohort.
	assertEquals(typeof rig.primary.disabledReason, "string");
	assertEquals((rig.primary.disabledReason ?? "").length > 0, true);
});

Deno.test("a provider taking no bookings refuses the session primary with a reason", () => {
	const rig = resolveCta({ ...base, format: "session", bookingsOpen: false });
	assertEquals(rig.primary.disabled, true);
	assertEquals(rig.primary.kind, "unavailable");
	assertEquals((rig.primary.disabledReason ?? "").length > 0, true);
});

Deno.test("every rig carries exactly one primary, and a disabled one always explains itself", () => {
	const formats = [
		"pipeline",
		"one_off",
		"single_task",
		"session",
		"set_session",
		"cohort",
		"product",
	] as const;
	for (const format of formats) {
		for (const seats of [null, 0, 1, 5]) {
			for (const open of [true, false]) {
				const rig = resolveCta({ ...base, format, seatsRemaining: seats, bookingsOpen: open });
				assertEquals(typeof rig.primary.label, "string");
				assertEquals(rig.primary.label.length > 0, true);
				// `disabled` and `disabledReason` are two halves of one fact and must never disagree —
				// a refused control with nothing to say is the defect this pairing exists to prevent.
				assertEquals(
					rig.primary.disabled,
					rig.primary.disabledReason !== null,
					`${format}/${seats}/${open}: disabled and disabledReason disagree`,
				);
			}
		}
	}
});

Deno.test("plural picks the right form", () => {
	assertEquals(plural(1, "seat"), "seat");
	assertEquals(plural(0, "seat"), "seats");
	assertEquals(plural(2, "seat"), "seats");
	assertEquals(plural(1, "spot"), "spot");
});
