import { assert, assertEquals } from "@std/assert";
import type {
	SubmissionNodeKind,
	SubmissionStatus,
	SubmissionTreeNode,
} from "@projective/types/projects";
import {
	ancestorKeys,
	childNodesAt,
	nodeAt,
	nodeKindLabel,
	nodeShowsChildCards,
	pathKey,
	statusLabel,
	statusTone,
	submissionHref,
	submissionsBase,
	submissionTickets,
} from "./submission-model.ts";

/**
 * The Submissions explorer's pure model, pinned. It owns no transitions — those live in the action
 * state machine (`submission-access.ts`, pinned in its own test) and in `review_submission` — but it
 * owns every word and colour a review state is shown with, and the addresses a deep link resolves.
 * A wrong label here tells a freelancer their work was accepted when it was returned.
 */

// #region Fixtures
const STATUSES: SubmissionStatus[] = ["draft", "pending_review", "revision_requested", "accepted"];

function node(
	segment: string,
	kind: SubmissionNodeKind,
	children: SubmissionTreeNode[] = [],
): SubmissionTreeNode {
	return { segment, kind, label: segment, fileCount: 0, children };
}

const TREE: SubmissionTreeNode[] = [
	node("discovery", "stage", [
		node("juno", "submitter", [
			node("v1", "unit", [node("assets", "dir")]),
		]),
	]),
	node("delivery", "stage"),
];
// #endregion

// #region Review-state vocabulary
Deno.test("every review state has its own label", () => {
	assertEquals(STATUSES.map(statusLabel), [
		"Draft",
		"Pending review",
		"Revision requested",
		"Accepted",
	]);
	assertEquals(new Set(STATUSES.map(statusLabel)).size, STATUSES.length);
});

Deno.test("every review state has its semantic tone", () => {
	assertEquals(STATUSES.map(statusTone), ["muted", "warning", "danger", "success"]);
});

Deno.test("a state outside the vocabulary reads as Draft, never as a verdict", () => {
	const stray = "revisions_requested" as SubmissionStatus;
	assertEquals(statusLabel(stray), "Draft");
	assertEquals(statusTone(stray), "muted");
});

Deno.test("node kinds are named for the reader, unknown kinds as folders", () => {
	const kinds: SubmissionNodeKind[] = ["stage", "submitter", "unit", "dir"];
	assertEquals(kinds.map(nodeKindLabel), ["Stage", "Freelancer", "Submission", "Folder"]);
});
// #endregion

// #region Addresses
Deno.test("the channel scope nests under its channel; the project scope is the ledger", () => {
	assertEquals(submissionsBase("channel", "prj-1", "stg-2"), "/projects/prj-1/stg-2/submissions");
	assertEquals(submissionsBase("project", "prj-1", "stg-2"), "/projects/prj-1/submissions");
});

Deno.test("a channel scope with no channel falls back to the project ledger", () => {
	assertEquals(submissionsBase("channel", "prj-1", null), "/projects/prj-1/submissions");
	assertEquals(submissionsBase("channel", "prj-1"), "/projects/prj-1/submissions");
	assertEquals(submissionsBase("channel", "prj-1", ""), "/projects/prj-1/submissions");
});

Deno.test("every segment is percent-encoded, so a path cannot escape its base", () => {
	assertEquals(submissionsBase("channel", "a/b", "c d"), "/projects/a%2Fb/c%20d/submissions");
	const base = "/projects/prj-1/submissions";
	assertEquals(submissionHref(base, []), base);
	assertEquals(submissionHref(base, ["juno", "v1"]), `${base}/juno/v1`);
	assertEquals(submissionHref(base, ["../x", "a b"]), `${base}/..%2Fx/a%20b`);
});

Deno.test("path keys and the ancestor chain, root-first", () => {
	assertEquals(pathKey([]), "");
	assertEquals(pathKey(["a", "b"]), "a/b");
	assertEquals(ancestorKeys([]), []);
	assertEquals(ancestorKeys(["a", "b", "c"]), ["a", "a/b", "a/b/c"]);
});
// #endregion

// #region Tree navigation
Deno.test("the scope root resolves to no node, and its children are the roots", () => {
	assertEquals(nodeAt(TREE, []), null);
	assertEquals(childNodesAt(TREE, []).map((n) => n.segment), ["discovery", "delivery"]);
});

Deno.test("a full path resolves to its node", () => {
	assertEquals(nodeAt(TREE, ["discovery", "juno", "v1"])?.kind, "unit");
	assertEquals(nodeAt(TREE, ["discovery", "juno", "v1", "assets"])?.kind, "dir");
});

Deno.test("an unknown segment degrades to the deepest matched node", () => {
	assertEquals(nodeAt(TREE, ["discovery", "juno", "nope", "v1"])?.segment, "juno");
	assertEquals(nodeAt(TREE, ["nope"]), null);
	assertEquals(nodeAt([], ["discovery"]), null);
});

Deno.test("an empty container has no child nodes", () => {
	assertEquals(childNodesAt(TREE, ["delivery"]), []);
});

Deno.test("containers drill into cards; a submission and its folders show files", () => {
	assert(nodeShowsChildCards(null));
	assert(nodeShowsChildCards(node("s", "stage")));
	assert(nodeShowsChildCards(node("f", "submitter")));
	assert(!nodeShowsChildCards(node("u", "unit")));
	assert(!nodeShowsChildCards(node("d", "dir")));
});
// #endregion

// #region Create-submission tickets
Deno.test("a one-off has no tickets to fulfil", () => {
	assertEquals(submissionTickets("prj-1:stg-1", { hasTickets: false }), []);
});

Deno.test("a ticketed engagement offers one to three tickets, stable per seed", () => {
	for (const seed of ["a", "prj-1:stg-1", "prj-2:stg-9", "zzzz", ""]) {
		const first = submissionTickets(seed, { hasTickets: true });
		assert(first.length >= 1 && first.length <= 3, `${seed}: ${first.length}`);
		assertEquals(submissionTickets(seed, { hasTickets: true }), first);
		for (const t of first) {
			assert(/^TCK-\d{3}$/.test(t.id), t.id);
			assert(t.title.startsWith(`${t.id} · `), t.title);
		}
	}
});

Deno.test("a revision ticket, when there is one, is only ever the last", () => {
	let sawRevision = false;
	for (let i = 0; i < 40; i++) {
		const list = submissionTickets(`seed-${i}`, { hasTickets: true });
		list.slice(0, -1).forEach((t) => assertEquals(t.kind, "ticket"));
		if (list.at(-1)?.kind === "revision") sawRevision = true;
	}
	assert(sawRevision, "some seed yields a revision ticket");
});
// #endregion
