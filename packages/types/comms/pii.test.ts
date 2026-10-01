import { assertEquals } from "@std/assert";
import { containsPii, maskPii } from "./pii.ts";

Deno.test("text with no contact details comes back unchanged", () => {
	const text = "Happy to start Monday — the brief reads well, 3 revisions included.";
	assertEquals(maskPii(text), { masked: text, categories: [] });
	assertEquals(containsPii(text), false);
});

Deno.test("an email is masked", () => {
	assertEquals(maskPii("Reach me on hannah.cole@example.co.uk please"), {
		masked: "Reach me on [email hidden] please",
		categories: ["email"],
	});
});

Deno.test("payment links and off-platform messaging handles are masked, with or without a scheme", () => {
	assertEquals(
		maskPii("Pay me at paypal.me/hannah or https://wa.me/447700900123").masked,
		"Pay me at [link hidden] or [link hidden]",
	);
	assertEquals(maskPii("Ping me on t.me/hannah").categories, ["payment_link"]);
});

Deno.test("a cashtag is masked as a handle", () => {
	assertEquals(maskPii("Send it to $hannahcole"), {
		masked: "Send it to [handle hidden]",
		categories: ["handle"],
	});
});

Deno.test("a phone number is masked; a short figure is not", () => {
	assertEquals(maskPii("Call +44 (0)7700 900-123 today").masked, "Call [phone hidden] today");
	assertEquals(maskPii("Stage 2 of 3, due in 14 days").categories, []);
});

Deno.test("passes run in the SQL's order: the link before the phone pass can eat its digits", () => {
	const result = maskPii("wa.me/447700900123 or tomasz@example.com or 07700 900123");
	assertEquals(result.categories, ["email", "payment_link", "phone"]);
	assertEquals(result.masked, "[link hidden] or [email hidden] or [phone hidden]");
});

Deno.test("masking is idempotent — a masked body masks to itself", () => {
	const once = maskPii("hannah@example.com · +44 7700 900123").masked;
	assertEquals(maskPii(once), { masked: once, categories: [] });
});
