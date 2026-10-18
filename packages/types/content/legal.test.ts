/**
 * The legal document schema (Decision #270): the narrowed slug and version, the review rule, and
 * the reserved `workspace` segment.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	isLegalSlug,
	LEGAL_DOCUMENT_SLUGS,
	LEGAL_RESERVED_SLUGS,
	type LegalDoc,
	LegalDocSchema,
	LegalVersionSchema,
} from "./legal.ts";

const VALID: LegalDoc = {
	id: "terms-of-service",
	slug: "terms",
	title: "Terms of Service",
	summary: "The agreement.",
	updatedAt: "2026-10-17",
	version: "2.0",
	effectiveDate: "2026-10-17",
	reviewedAt: null,
	changeSummary: "First published.",
	sections: [{ id: "about", heading: "About", body: [{ type: "p", content: "Text." }] }],
};

Deno.test("LegalDocSchema: a draft version parses", () => {
	assert(LegalDocSchema.safeParse(VALID).success);
});

Deno.test("LegalDocSchema: the slug is one of the six documents", () => {
	assertFalse(LegalDocSchema.safeParse({ ...VALID, slug: "refunds" }).success);
	for (const slug of LEGAL_DOCUMENT_SLUGS) {
		assert(LegalDocSchema.safeParse({ ...VALID, slug }).success, slug);
	}
});

Deno.test("LegalDocSchema: versions are MAJOR.MINOR", () => {
	for (const ok of ["1.0", "2.1", "10.12", "0.9"]) {
		assert(LegalVersionSchema.safeParse(ok).success, ok);
	}
	for (const bad of ["1", "1.0.0", "v2.0", "01.0", "2026-10"]) {
		assertFalse(LegalVersionSchema.safeParse(bad).success, bad);
	}
});

Deno.test("LegalDocSchema: a review cannot pre-date the text it signed off", () => {
	assertFalse(LegalDocSchema.safeParse({ ...VALID, reviewedAt: "2026-10-01" }).success);
	assert(LegalDocSchema.safeParse({ ...VALID, reviewedAt: "2026-10-20" }).success);
});

Deno.test("LegalDocSchema: keeps the shared anchor rule (duplicate and reserved ids refused)", () => {
	const body = [{ type: "p" as const, content: "x" }];
	assertFalse(
		LegalDocSchema.safeParse({
			...VALID,
			sections: [{ id: "a", heading: "A", body }, { id: "a", heading: "B", body }],
		}).success,
	);
	assertFalse(
		LegalDocSchema.safeParse({ ...VALID, sections: [{ id: "doc-title", heading: "A", body }] })
			.success,
	);
});

Deno.test("isLegalSlug: documents yes, the reserved workspace segment never", () => {
	assertEquals(LEGAL_RESERVED_SLUGS, ["workspace"]);
	assertFalse(isLegalSlug("workspace"));
	assertFalse(isLegalSlug(""));
	assertFalse(isLegalSlug("Terms"));
	for (const slug of LEGAL_DOCUMENT_SLUGS) assert(isLegalSlug(slug));
	for (const reserved of LEGAL_RESERVED_SLUGS) {
		assertFalse((LEGAL_DOCUMENT_SLUGS as readonly string[]).includes(reserved));
	}
});
