/** The clause-level, word-level legal diff (Decision #270). */
import { assert, assertEquals } from "@std/assert";
import type { DocSection } from "@projective/types/content";
import {
	clauseRuns,
	clauseUnits,
	diffDocuments,
	diffUnits,
	diffWords,
	spell,
	tokenize,
} from "./diff.ts";

// #region Words
Deno.test("tokenize: words keep inner apostrophes, points and commas; punctuation stands alone", () => {
	assertEquals(tokenize("Don't pay £1,000."), ["Don't", " ", "pay", " ", "£", "1,000", "."]);
	assertEquals(tokenize("5% of 2.5"), ["5", "%", " ", "of", " ", "2.5"]);
	assertEquals(tokenize(""), []);
});

Deno.test("diffWords: identical text is one equal run; empty is nothing", () => {
	assertEquals(diffWords("same text", "same text"), [{ op: "equal", text: "same text" }]);
	assertEquals(diffWords("", ""), []);
});

Deno.test("diffWords: a replaced word reads as delete then insert", () => {
	assertEquals(diffWords("a 5% fee", "a 6% fee"), [
		{ op: "equal", text: "a " },
		{ op: "delete", text: "5" },
		{ op: "insert", text: "6" },
		{ op: "equal", text: "% fee" },
	]);
});

Deno.test("diffWords: a space alone between two changes joins them into one phrase", () => {
	assertEquals(diffWords("pay the client now", "refund a payer now"), [
		{ op: "delete", text: "pay the client" },
		{ op: "insert", text: "refund a payer" },
		{ op: "equal", text: " now" },
	]);
});

Deno.test("diffWords: insertions and deletions at the edges", () => {
	assertEquals(diffWords("held", "held for 7 days"), [
		{ op: "equal", text: "held" },
		{ op: "insert", text: " for 7 days" },
	]);
	assertEquals(diffWords("never held", "held"), [
		{ op: "delete", text: "never " },
		{ op: "equal", text: "held" },
	]);
	assertEquals(diffWords("", "new"), [{ op: "insert", text: "new" }]);
	assertEquals(diffWords("old", ""), [{ op: "delete", text: "old" }]);
});

Deno.test("diffWords: every diff spells both sides back exactly", () => {
	const pairs: Array<[string, string]> = [
		[
			"The escrow is released 24 hours after the session ends.",
			"A sitting's escrow is released 24 hours after it ends unless a no-show is claimed.",
		],
		["One, two, three.", "Three, two, one."],
		["a b c d e f", "a x c y e z"],
		["Projective keeps 5%.", "Projective keeps 5% of every release."],
	];
	for (const [before, after] of pairs) {
		const spans = diffWords(before, after);
		assertEquals(spell(spans, "before"), before);
		assertEquals(spell(spans, "after"), after);
		for (let i = 1; i < spans.length; i++) {
			assert(spans[i].op !== spans[i - 1].op, "runs are merged");
		}
	}
});
// #endregion

// #region Units
const section = (
	id: string,
	heading: string,
	body: DocSection["body"],
	tldr?: string,
): DocSection => ({
	id,
	heading,
	...(tldr ? { tldr } : {}),
	body,
});

Deno.test("clauseUnits: summary first, then one unit per paragraph, item, row and term", () => {
	const units = clauseUnits(section("fees", "Fees", [
		{ type: "p", content: [{ type: "strong", text: "5%" }, " of each release."] },
		{ type: "h3", text: "Exceptions" },
		{
			type: "list",
			items: ["Refunds", { content: "Fair Exit", list: { type: "list", items: ["earned share"] } }],
		},
		{ type: "table", head: ["Tier", "Paid"], rows: [["25%", "a quarter"]] },
		{ type: "dl", items: [{ term: "Payee", definition: "Who is paid." }] },
	], "Projective keeps 5%."));
	assertEquals(units.map((u) => [u.kind, u.text, u.depth]), [
		["summary", "Projective keeps 5%.", 0],
		["paragraph", "5% of each release.", 0],
		["subheading", "Exceptions", 0],
		["item", "Refunds", 0],
		["item", "Fair Exit", 0],
		["item", "earned share", 1],
		["row", "Tier · Paid", 0],
		["row", "25% · a quarter", 0],
		["term", "Payee — Who is paid.", 0],
	]);
});

Deno.test("diffUnits: identical units anchor; the gap between pairs in order; leftovers are whole", () => {
	const p = (text: string) => ({ kind: "paragraph" as const, text, depth: 0 });
	const blocks = diffUnits([p("one"), p("two"), p("three")], [
		p("one"),
		p("2"),
		p("new"),
		p("three"),
	]);
	assertEquals(blocks.map((b) => b.status), ["equal", "changed", "added", "equal"]);
	assertEquals(blocks[1].spans, [{ op: "delete", text: "two" }, { op: "insert", text: "2" }]);
	assertEquals(blocks[2].spans, [{ op: "insert", text: "new" }]);
});
// #endregion

// #region Documents
const p = (content: string) => ({ type: "p" as const, content });
const BEFORE = {
	version: "1.0",
	sections: [
		section("about", "About", [p("Same.")]),
		section("fees", "Fees", [p("5% of each release.")]),
		section("credit", "Opening credit", [p("A one-time credit.")]),
		section("closing", "Closing", [p("Ask us.")]),
	],
};
const AFTER = {
	version: "2.0",
	sections: [
		section("about", "About", [p("Same.")]),
		section("age", "Age", [p("You must be 13.")]),
		section("fees", "Fees", [p("5% of each release, taken from the payee.")]),
		section("closing", "Closing your account", [p("Ask us.")]),
	],
};

Deno.test("diffDocuments: clauses matched by id, in the newer order, each with its status and numbers", () => {
	const diff = diffDocuments(BEFORE, AFTER);
	assertEquals(diff.from, "1.0");
	assertEquals(diff.to, "2.0");
	assertEquals(
		diff.clauses.map((c) => [c.id, c.status, c.numberBefore, c.numberAfter]),
		[
			["about", "unchanged", "1", "1"],
			["age", "added", undefined, "2"],
			["fees", "changed", "2", "3"],
			["credit", "removed", "3", undefined],
			["closing", "changed", "4", "4"],
		],
	);
	assertEquals(diff.counts, { unchanged: 1, changed: 2, added: 1, removed: 1 });
});

Deno.test("diffDocuments: a heading-only change is a change, with the heading's own word diff", () => {
	const closing = diffDocuments(BEFORE, AFTER).clauses.find((c) => c.id === "closing")!;
	assertEquals(closing.blocks.map((b) => b.status), ["equal"]);
	assertEquals(closing.headingSpans, [
		{ op: "equal", text: "Closing" },
		{ op: "insert", text: " your account" },
	]);
});

Deno.test("diffDocuments: a removed clause before every survivor goes first", () => {
	const diff = diffDocuments(
		{
			version: "1.0",
			sections: [section("gone", "Gone", [p("x")]), section("kept", "Kept", [p("y")])],
		},
		{ version: "2.0", sections: [section("kept", "Kept", [p("y")])] },
	);
	assertEquals(diff.clauses.map((c) => [c.id, c.status]), [["gone", "removed"], [
		"kept",
		"unchanged",
	]]);
});

Deno.test("diffDocuments: identical versions are all unchanged", () => {
	const diff = diffDocuments(BEFORE, { ...BEFORE, version: "1.1" });
	assert(diff.clauses.every((c) => c.status === "unchanged"));
});

Deno.test("clauseRuns: consecutive unchanged clauses fold into one run", () => {
	const diff = diffDocuments(
		{ version: "1.0", sections: ["a", "b", "c", "d"].map((id) => section(id, id, [p(id)])) },
		{
			version: "2.0",
			sections: [
				section("a", "a", [p("a")]),
				section("b", "b", [p("b")]),
				section("c", "c", [p("changed")]),
				section("d", "d", [p("d")]),
			],
		},
	);
	const runs = clauseRuns(diff.clauses);
	assertEquals(
		runs.map((r) => r.kind === "clause" ? r.clause.id : r.clauses.map((c) => c.id).join("+")),
		[
			"a+b",
			"c",
			"d",
		],
	);
});
// #endregion
