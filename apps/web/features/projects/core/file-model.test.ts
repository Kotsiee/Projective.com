import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fileDateLabel, formatFileDate } from "./file-model.ts";

const AT = "2026-11-06T22:05:00.000Z";

Deno.test("a stored file reads on the viewer's clock, in the shape of the server's label", () => {
	const local = new Date(AT);
	const hour = local.getHours() % 12 || 12;
	const label = fileDateLabel({ createdAt: AT, dateLabel: "Nov 6 · 10:05 PM" });
	assertMatch(label, /^[A-Z][a-z]{2} \d{1,2}(, \d{4})? · \d{1,2}:\d{2}\s[AP]M$/);
	assertStringIncludes(label, `${hour}:${String(local.getMinutes()).padStart(2, "0")}`);
});

Deno.test("the list and the card write one instant the same way", () => {
	const file = { createdAt: AT, dateLabel: "ignored" };
	assertEquals(fileDateLabel(file), formatFileDate(Date.parse(AT)));
});

Deno.test("a row with no stored date keeps the words it came with", () => {
	assertEquals(
		fileDateLabel({ createdAt: AT, dateLabel: "Not uploaded", status: "pending_upload" }),
		"Not uploaded",
	);
	assertEquals(fileDateLabel({ createdAt: "", dateLabel: "" }), "");
});
