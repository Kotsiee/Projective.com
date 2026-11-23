import { assertEquals } from "@std/assert";
import { legalAcceptanceRefusal } from "./legal-gate.ts";

const DEED = {
	code: "PN409",
	message: "legal_acceptance_required: accept the ip-transfer-deed version 1.0 to continue",
	details: '{"version": "1.0", "document": "ip-transfer-deed"}',
};

Deno.test("the gate's PN409 is a 409 naming the document and the version in effect", () => {
	assertEquals(legalAcceptanceRefusal(DEED), {
		status: 409,
		message: "Accept the IP Transfer Deed (version 1.0) to continue.",
		details: { reason: "legal_acceptance_required", document: "ip-transfer-deed", version: "1.0" },
	});
	assertEquals(
		legalAcceptanceRefusal({ ...DEED, details: '{"version": "2.0", "document": "escrow-terms"}' })
			?.message,
		"Accept the Escrow Terms (version 2.0) to continue.",
	);
});

Deno.test("any other error, or a detail that is not a commit document, is not the gate's", () => {
	assertEquals(legalAcceptanceRefusal({ ...DEED, code: "PC409" }), null);
	assertEquals(legalAcceptanceRefusal({ ...DEED, details: null }), null);
	assertEquals(
		legalAcceptanceRefusal({ ...DEED, details: '{"document": "terms", "version": "2.0"}' }),
		null,
	);
	assertEquals(legalAcceptanceRefusal(null), null);
});
