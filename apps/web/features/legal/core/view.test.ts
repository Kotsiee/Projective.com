/** The legal library and the request resolver behind `/legal/<slug>` and its PDF (Decision #270). */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { LEGAL_DOCUMENT_SLUGS } from "@projective/types/content";
import {
	currentVersion,
	LEGAL_GROUPS,
	LEGAL_LIBRARY,
	legalFamily,
	legalToday,
	versionOf,
} from "./registry.ts";
import {
	changedClauseEntries,
	type LegalDocumentRequest,
	type LegalDocumentView,
	legalRailEntries,
	resolveLegalDocument,
	resolveLegalPdf,
} from "./view.ts";

const TODAY = "2026-10-17";
const q = (query = "") => new URLSearchParams(query);

/** The view of a request that must resolve to a document. */
function view(request: LegalDocumentRequest): LegalDocumentView {
	if (request.kind !== "document") throw new Error(`expected a document, got ${request.kind}`);
	return request.view;
}

// #region Registry
Deno.test("registry: the hub groups hold every document exactly once", () => {
	const grouped = LEGAL_GROUPS.flatMap((g) => g.slugs);
	assertEquals([...grouped].sort(), [...LEGAL_DOCUMENT_SLUGS].sort());
	assertEquals(new Set(grouped).size, grouped.length);
});

Deno.test("registry: `workspace` (and anything unknown) never resolves as a document", () => {
	assertEquals(legalFamily("workspace"), undefined);
	assertEquals(legalFamily("refunds"), undefined);
	assertEquals(legalFamily("TERMS"), undefined);
	assertEquals(resolveLegalDocument("workspace", q(), TODAY), { kind: "not-found" });
	assertEquals(resolveLegalPdf("workspace", q(), TODAY), { kind: "not-found" });
});

Deno.test("registry: today's current version is the newest in effect", () => {
	const terms = legalFamily("terms")!;
	assertEquals(currentVersion(terms, TODAY).version, "2.0");
	assertEquals(currentVersion(terms, "2026-09-01").version, "1.0");
	assertEquals(versionOf(terms, "1.0")?.version, "1.0");
	assertEquals(versionOf(terms, "9.9"), undefined);
	assertEquals(legalToday(new Date("2026-10-17T23:59:00Z")), "2026-10-17");
});
// #endregion

// #region Document request
Deno.test("resolveLegalDocument: the bare address shows today's version, a draft, noindex", () => {
	const v = view(resolveLegalDocument("terms", q(), TODAY));
	assertEquals(v.doc.version, "2.0");
	assertEquals(v.shown.status, "current");
	assertFalse(v.pinned);
	assert(v.draft);
	assert(v.noindex);
	assertEquals(v.compare, null);
	assertEquals(v.diff, null);
});

Deno.test("resolveLegalDocument: ?v= pins a version, including the current one", () => {
	const old = view(resolveLegalDocument("terms", q("v=1.0"), TODAY));
	assertEquals(old.doc.version, "1.0");
	assertEquals(old.shown.status, "superseded");
	assert(old.pinned);
	const pinned = view(resolveLegalDocument("terms", q("v=2.0"), TODAY));
	assertEquals(pinned.doc.version, "2.0");
	assert(pinned.pinned);
});

Deno.test("resolveLegalDocument: unknown versions are a 404", () => {
	assertEquals(resolveLegalDocument("terms", q("v=9.0"), TODAY), { kind: "not-found" });
	assertEquals(resolveLegalDocument("terms", q("compare=0.1"), TODAY), { kind: "not-found" });
	assertEquals(resolveLegalDocument("nope", q(), TODAY), { kind: "not-found" });
});

Deno.test("resolveLegalDocument: empty parameters (a no-JS form) redirect to the clean address", () => {
	assertEquals(resolveLegalDocument("terms", q("v=&compare="), TODAY), {
		kind: "redirect",
		location: "/legal/terms",
	});
	assertEquals(resolveLegalDocument("terms", q("v=1.0&compare="), TODAY), {
		kind: "redirect",
		location: "/legal/terms?v=1.0",
	});
	assertEquals(resolveLegalDocument("terms", q("v=&compare=1.0"), TODAY), {
		kind: "redirect",
		location: "/legal/terms?compare=1.0",
	});
});

Deno.test("resolveLegalDocument: comparing with itself drops compare; with a newer one swaps", () => {
	assertEquals(resolveLegalDocument("terms", q("v=1.0&compare=1.0"), TODAY), {
		kind: "redirect",
		location: "/legal/terms?v=1.0",
	});
	assertEquals(resolveLegalDocument("terms", q("v=1.0&compare=2.0"), TODAY), {
		kind: "redirect",
		location: "/legal/terms?v=2.0&compare=1.0",
	});
});

Deno.test("resolveLegalDocument: ?compare= diffs today's version against an older one", () => {
	const v = view(resolveLegalDocument("escrow-terms", q("compare=1.0"), TODAY));
	assertEquals(v.doc.version, "2.0");
	assertEquals(v.compare?.version, "1.0");
	assert(v.diff);
	assertEquals(v.diff.from, "1.0");
	assertEquals(v.diff.to, "2.0");
	assert(v.diff.counts.changed > 0);
	assert(v.diff.counts.added > 0);
	assert(v.noindex);
	const ids = changedClauseEntries(v.diff).map((e) => e.id);
	assert(ids.includes("pending-window"));
	assertFalse(ids.includes("what-escrow-is"), "an unchanged clause is not in the rail");
});

Deno.test("resolveLegalDocument: Terms 1.0 → 2.0 shows every kind of change", () => {
	const { diff } = view(resolveLegalDocument("terms", q("compare=1.0"), TODAY));
	const status = Object.fromEntries(diff!.clauses.map((c) => [c.id, c.status]));
	assertEquals(status["about"], "unchanged");
	assertEquals(status["age"], "changed");
	assertEquals(status["hiring"], "added");
	assertEquals(status["opening-credit"], "removed");
});
// #endregion

// #region Rail & PDF
Deno.test("legalRailEntries: every document, the current one expanded and marked", () => {
	const entries = legalRailEntries(
		"privacy",
		[{ id: "x", text: "X", level: 2, children: [] }],
		TODAY,
	);
	assertEquals(entries.map((e) => e.href), LEGAL_LIBRARY.map((f) => `/legal/${f.slug}`));
	const privacy = entries.find((e) => e.href === "/legal/privacy")!;
	assert(privacy.current);
	assertEquals(privacy.children.length, 1);
	assert(entries.filter((e) => e !== privacy).every((e) => !e.current && e.children.length === 0));
	assertEquals(new Set(entries.map((e) => e.id)).size, entries.length);
});

Deno.test("resolveLegalPdf: the current version, or a pinned one; compare is ignored", () => {
	const current = resolveLegalPdf("terms", q(), TODAY);
	assertEquals(current.kind === "pdf" && [current.doc.version, current.current], ["2.0", true]);
	const old = resolveLegalPdf("terms", q("v=1.0&compare=2.0"), TODAY);
	assertEquals(old.kind === "pdf" && [old.doc.version, old.current], ["1.0", false]);
	assertEquals(resolveLegalPdf("terms", q("v=3.0"), TODAY), { kind: "not-found" });
});
// #endregion
