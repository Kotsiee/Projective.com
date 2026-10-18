/** Version labels, statuses and the legal URL contract (Decision #270). */
import { assert, assertEquals } from "@std/assert";
import {
	compareVersions,
	isVersionLabel,
	legalDocumentHref,
	legalPdfHref,
	olderThan,
	versionStatuses,
} from "./versions.ts";

const v = (version: string, effectiveDate: string) => ({
	version,
	effectiveDate,
	reviewedAt: null,
	changeSummary: "x",
});

Deno.test("compareVersions: numeric, not lexical", () => {
	assert(compareVersions("1.10", "1.9") > 0);
	assert(compareVersions("2.0", "10.0") < 0);
	assertEquals(compareVersions("3.1", "3.1"), 0);
	assert(compareVersions("1.0", "nonsense") > 0);
	assert(isVersionLabel("2.0"));
	assert(!isVersionLabel("2"));
});

Deno.test("versionStatuses: the newest in effect is current; newer is upcoming; older superseded", () => {
	const versions = [v("3.0", "2026-12-01"), v("2.0", "2026-10-01"), v("1.0", "2026-08-01")];
	assertEquals(
		versionStatuses(versions, "2026-10-17").map((s) => s.status),
		["upcoming", "current", "superseded"],
	);
	assertEquals(
		versionStatuses(versions, "2026-12-01").map((s) => s.status),
		["current", "superseded", "superseded"],
	);
});

Deno.test("versionStatuses: with nothing in effect yet, the oldest (the first to take effect) is current", () => {
	const versions = [v("2.0", "2027-02-01"), v("1.0", "2027-01-01")];
	assertEquals(
		versionStatuses(versions, "2026-10-17").map((s) => s.status),
		["upcoming", "current"],
	);
});

Deno.test("olderThan: only strictly older versions, newest first", () => {
	const versions = [v("3.0", "x"), v("2.0", "x"), v("1.0", "x")];
	assertEquals(olderThan(versions, "2.0").map((x) => x.version), ["1.0"]);
	assertEquals(olderThan(versions, "1.0"), []);
});

Deno.test("legalDocumentHref / legalPdfHref: empty parameters are dropped", () => {
	assertEquals(legalDocumentHref("terms"), "/legal/terms");
	assertEquals(legalDocumentHref("terms", { v: "", compare: null }), "/legal/terms");
	assertEquals(legalDocumentHref("terms", { v: "1.0" }), "/legal/terms?v=1.0");
	assertEquals(legalDocumentHref("terms", { compare: "1.0" }), "/legal/terms?compare=1.0");
	assertEquals(
		legalDocumentHref("terms", { v: "2.0", compare: "1.0" }),
		"/legal/terms?v=2.0&compare=1.0",
	);
	assertEquals(legalPdfHref("terms"), "/legal/terms/pdf");
	assertEquals(legalPdfHref("terms", "1.0"), "/legal/terms/pdf?v=1.0");
});
