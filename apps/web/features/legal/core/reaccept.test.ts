import { assertEquals } from "@std/assert";
import { currentLegalVersion } from "@projective/types/legal";
import { reacceptDocuments } from "./reaccept.ts";

Deno.test("re-accept lists the accepted documents at today's versions, never the privacy notice", () => {
	const today = "2026-11-18";
	const docs = reacceptDocuments(today);
	assertEquals(docs.map((d) => d.slug), ["terms", "acceptable-use"]);
	for (const doc of docs) {
		assertEquals(doc.version, currentLegalVersion(doc.slug, today));
		assertEquals(doc.changeSummary.length > 0, true);
	}
});
