import { assertEquals } from "@std/assert";
import { DataExportRefusal } from "@projective/types/org";
import { dataExportFailure } from "./data-export-refusals.ts";

Deno.test("every refusal answers its own status and keeps its code", () => {
	const expected: Record<DataExportRefusal, number> = {
		reauth_required: 403,
		already_pending: 409,
		rate_limited: 429,
		account_closing: 409,
	};
	for (const code of DataExportRefusal.options) {
		const result = dataExportFailure({ code: "P0001", message: code });
		assertEquals(result.status, expected[code], code);
		assertEquals(result.details?.refusal, code);
	}
});

Deno.test("rate_limited carries when the next request may be filed", () => {
	const result = dataExportFailure({
		code: "P0001",
		message: "rate_limited",
		details: "2026-11-19T10:00:00+00:00",
	});
	assertEquals(result.details, { refusal: "rate_limited", retryAt: "2026-11-19T10:00:00+00:00" });
});

Deno.test("no subject is a 401, no profile a 403, anything else an outage", () => {
	assertEquals(dataExportFailure({ code: "28000", message: "not_authenticated" }).status, 401);
	assertEquals(dataExportFailure({ code: "42501", message: "profile_required" }).status, 403);
	const outage = dataExportFailure({ code: "XX000", message: "boom" });
	assertEquals(outage.status, 503);
	assertEquals(outage.details?.reason, "boom");
});
