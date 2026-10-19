import { assertEquals } from "@std/assert";
import type { LegalDoc } from "@projective/types/content";
import { LEGAL_LIBRARY, type LegalFamily } from "./registry.ts";
import { legalSitemapEntries } from "./sitemap.ts";

const TODAY = "2026-10-18";

/** A family whose versions in effect by `TODAY` are marked reviewed (a copy; nothing mutated). */
function reviewed(family: LegalFamily, reviewedAt: string, updatedAt: string): LegalFamily {
	return {
		slug: family.slug,
		versions: family.versions.map((doc: LegalDoc) =>
			doc.effectiveDate <= TODAY ? { ...doc, reviewedAt, updatedAt } : doc
		),
	};
}

Deno.test("legal sitemap: nothing while every document in effect is a draft (today's library)", () => {
	assertEquals(legalSitemapEntries(LEGAL_LIBRARY, TODAY), []);
});

Deno.test("legal sitemap: a reviewed document and the hub are listed, the drafts are not", () => {
	const library = LEGAL_LIBRARY.map((family) =>
		family.slug === "privacy" ? reviewed(family, "2026-10-18", "2026-10-18") : family
	);
	assertEquals(legalSitemapEntries(library, TODAY), [
		{ path: "/legal", lastmod: "2026-10-18" },
		{ path: "/legal/privacy", lastmod: "2026-10-18" },
	]);
});
