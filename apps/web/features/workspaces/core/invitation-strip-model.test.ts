/**
 * The invitation strip's pure rules (Teams work order R2): one filled Accept per strip, focus after an
 * answer, the row's meta facts, the typed refusals and the strip's visibility — plus two source gates
 * that hold the rebuild in place (the strip draws no kind chip and its sheet no fill of its own).
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type { IncomingInvite } from "@projective/types/workspace";
import {
	answerSentence,
	daysLeft,
	expiryLabel,
	filledAcceptCount,
	focusAfterResolving,
	invitationStripShown,
	inviteMeta,
	inviteRefusal,
	planInviteActions,
	withEntry,
	withId,
	withoutEntry,
	withoutId,
} from "./invitation-strip-model.ts";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

function invite(id: string, over: Partial<IncomingInvite> = {}): IncomingInvite {
	return {
		id,
		workspaceId: `w-${id}`,
		workspaceName: "Northwind Studio",
		workspaceHandle: "northwind",
		workspaceAvatar: "",
		kind: "team",
		fromName: "Noor Haddad",
		fromHandle: "noor",
		roleLabel: "Lead",
		sentAt: "2 days ago",
		note: null,
		expiresAt: inDays(5),
		...over,
	};
}

// #region The action model
Deno.test("planInviteActions: N rows → exactly one tier-3 Accept, on the first row", () => {
	for (let n = 1; n <= 8; n++) {
		const rows = Array.from({ length: n }, (_, i) => ({ id: `i${i}` }));
		const plan = planInviteActions(rows);
		assertEquals(plan.length, n);
		assertEquals(filledAcceptCount(plan), 1, `${n} rows`);
		assertEquals(plan[0].accept, 3);
		assert(plan.slice(1).every((row) => row.accept === 4), "every other Accept is tier 4");
		assert(plan.every((row) => row.decline === 5), "Decline is tier 5 on every row");
		assertEquals(plan.map((row) => row.id), rows.map((row) => row.id));
	}
	assertEquals(planInviteActions([]), []);
});

Deno.test("planInviteActions: when the first row resolves, the next becomes the filled one", () => {
	const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
	assertEquals(planInviteActions(rows).find((row) => row.accept === 3)?.id, "a");
	const afterFirst = planInviteActions(rows.filter((row) => row.id !== "a"));
	assertEquals(afterFirst.find((row) => row.accept === 3)?.id, "b");
	assertEquals(filledAcceptCount(afterFirst), 1);
	// Answering a later row leaves the fill where it was.
	const afterMiddle = planInviteActions(rows.filter((row) => row.id !== "b"));
	assertEquals(afterMiddle.find((row) => row.accept === 3)?.id, "a");
});
// #endregion

// #region Focus
Deno.test("focusAfterResolving: the next row, else the previous one, else the heading (null)", () => {
	const ids = ["a", "b", "c"];
	assertEquals(focusAfterResolving(ids, "a"), "b");
	assertEquals(focusAfterResolving(ids, "b"), "c");
	assertEquals(focusAfterResolving(ids, "c"), "b");
	assertStrictEquals(focusAfterResolving(["a"], "a"), null);
	assertEquals(focusAfterResolving(ids, "gone"), "a");
	assertStrictEquals(focusAfterResolving([], "gone"), null);
});
// #endregion

// #region Row copy
Deno.test("inviteMeta: kind as a word, the role, the sender's handle, a tabular day count", () => {
	assertEquals(inviteMeta(invite("a"), NOW), [
		"Team",
		"as Lead",
		"from @noor",
		{ text: "expires in 5 days", tabular: true },
	]);
	assertEquals(
		inviteMeta(invite("b", { kind: "business", roleLabel: "Admin", expiresAt: null }), NOW),
		["Business", "as Admin", "from @noor"],
	);
	assertEquals(inviteMeta(invite("c", { fromHandle: "" }), NOW)[2], "from Noor Haddad");
});

Deno.test("expiryLabel / daysLeft: rounded up, singular at one, expired at zero", () => {
	assertEquals(expiryLabel(inDays(14), NOW), "expires in 14 days");
	assertEquals(expiryLabel(inDays(1), NOW), "expires in 1 day");
	assertEquals(expiryLabel(inDays(0.2), NOW), "expires in 1 day");
	assertEquals(expiryLabel(inDays(1.5), NOW), "expires in 2 days");
	assertEquals(expiryLabel(inDays(-0.1), NOW), "expired");
	assertStrictEquals(expiryLabel(null, NOW), null);
	assertStrictEquals(daysLeft("not a date", NOW), null);
});

Deno.test("answerSentence names the entity", () => {
	assertEquals(answerSentence(invite("a"), true), "You joined Northwind Studio.");
	assertEquals(
		answerSentence(invite("a"), false),
		"You declined the invitation from Northwind Studio.",
	);
});
// #endregion

// #region Refusals
Deno.test("inviteRefusal: payout_not_ready → the server's sentence and the Settings → Verification fix", () => {
	const refusal = inviteRefusal(
		{
			message: "Verify your identity and add a payout account first.",
			details: {
				reason: "payout_not_ready",
				actor: "self",
				href: "/settings/verification",
				members: null,
			},
		},
		invite("a"),
		true,
	);
	assertEquals(refusal, {
		code: "payout",
		text: "Verify your identity and add a payout account first.",
		fix: { href: "/settings/verification", label: "Verify and set up payouts" },
	});
	const somebodyElse = inviteRefusal(
		{ details: { reason: "payout_not_ready", actor: "other", href: null, members: null } },
		invite("a"),
		true,
	);
	assertEquals([somebodyElse.code, somebodyElse.fix], ["payout", null]);
});

Deno.test("inviteRefusal: persona and seat cap read their typed code, not the wording", () => {
	const persona = inviteRefusal(
		{
			message: "Whatever the database said.",
			details: { reason: "persona", actor: "self", persona: "client" },
		},
		invite("a"),
		true,
	);
	assertEquals(persona, {
		code: "persona",
		text: "Teams are for freelancer accounts.",
		fix: null,
	});
	const full = inviteRefusal(
		{ message: "x", details: { reason: "seat_cap" } },
		invite("a"),
		true,
	);
	assertEquals(full, { code: "seat", text: "This team is full.", fix: null });
});

Deno.test("inviteRefusal: anything else is the server's sentence, or a fallback naming the entity", () => {
	assertEquals(
		inviteRefusal(
			{ message: "This invitation has expired — ask for a new one." },
			invite("a"),
			true,
		)
			.text,
		"This invitation has expired — ask for a new one.",
	);
	assertEquals(
		inviteRefusal({}, invite("a"), false),
		{
			code: "other",
			text: "Couldn't decline the invitation from Northwind Studio.",
			fix: null,
		},
	);
});
// #endregion

// #region Visibility
Deno.test("invitationStripShown: something to show, and not dismissed unless on the Invitations tab", () => {
	const base = { waiting: 2, answeredHere: false, dismissed: false, onInvitationsTab: false };
	assertEquals(invitationStripShown(base), true);
	assertEquals(invitationStripShown({ ...base, dismissed: true }), false);
	assertEquals(invitationStripShown({ ...base, dismissed: true, onInvitationsTab: true }), true);
	assertEquals(invitationStripShown({ ...base, waiting: 0 }), false);
	// Emptied by an answer given here: the heading stays so focus has somewhere to land.
	assertEquals(invitationStripShown({ ...base, waiting: 0, answeredHere: true }), true);
});
// #endregion

// #region Immutable collections
Deno.test("the id-set and map helpers never mutate their input", () => {
	const set: ReadonlySet<string> = new Set(["a"]);
	const added = withId(set, "b");
	assertEquals([...set], ["a"]);
	assertEquals([...added], ["a", "b"]);
	assertEquals([...withoutId(added, "a")], ["b"]);
	const map: ReadonlyMap<string, number> = new Map([["a", 1]]);
	const more = withEntry(map, "b", 2);
	assertEquals([...map.keys()], ["a"]);
	assertEquals([...more.keys()], ["a", "b"]);
	assertStrictEquals(withoutEntry(map, "zz"), map);
	assertEquals([...withoutEntry(more, "a").keys()], ["b"]);
});
// #endregion

// #region Source gates
Deno.test("the strip draws the kind as text: no wsp-chip--kind anywhere in the feature", () => {
	const strip = Deno.readTextFileSync(
		new URL("../components/InvitationStrip.tsx", import.meta.url),
	);
	assert(!/wsp-chip--kind/.test(strip), "InvitationStrip.tsx still draws a kind chip");
	const tokens = Deno.readTextFileSync(
		new URL("../styles/workspace-tokens.css", import.meta.url),
	);
	assert(!/\.wsp-chip--kind\b/.test(tokens), "the dead .wsp-chip--kind rule is back");
});

Deno.test("the strip's rules carry no fill of their own and no hand-made Accept", () => {
	const sheet = Deno.readTextFileSync(new URL("../styles/workspace-roster.css", import.meta.url))
		.replace(/\/\*[\s\S]*?\*\//g, "");
	assert(!/\.wsp-invitestrip__accept\b/.test(sheet), ".wsp-invitestrip__accept is back");
	assert(!/\.wsp-invitestrip__decline\b/.test(sheet), ".wsp-invitestrip__decline is back");
	const fills: string[] = [];
	for (const rule of sheet.matchAll(/([^{}]*\.wsp-invitestrip[^{}]*)\{([^{}]*)\}/g)) {
		if (/(^|[;\s])background(-color)?\s*:/.test(rule[2])) fills.push(rule[1].trim());
	}
	assertEquals(fills, [], "a .wsp-invitestrip rule paints a background (the strip is unboxed)");
});
// #endregion
