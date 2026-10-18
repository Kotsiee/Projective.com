/** `/contact`'s URL contract (Decision #276): the intent, and the no-JS road's outcome. */
import { assertEquals } from "@std/assert";
import {
	contactErrorHref,
	contactHref,
	contactIntentHrefs,
	contactLoginHref,
	contactSentHref,
	parseContactUrl,
} from "./contact-url.ts";

const at = (q: string) => parseContactUrl(new URL(`https://projective.app/contact${q}`));

Deno.test("parseContactUrl: the intent defaults to support, and an unknown one reads as the default", () => {
	assertEquals(at("").intent, "support");
	assertEquals(at("?intent=dispute").intent, "dispute");
	assertEquals(at("?intent=Dispute").intent, "support");
	assertEquals(at("?intent=press").intent, "support");
});

Deno.test("parseContactUrl: sent and error are exclusive; fields are read only with an error, and only known ones", () => {
	assertEquals(at("?intent=sales&sent=1"), {
		intent: "sales",
		sent: true,
		error: null,
		fields: [],
	});
	assertEquals(at("?sent=1&error=invalid&fields=email").sent, false);
	assertEquals(at("?error=invalid&fields=email,message,evil,%3Cscript%3E"), {
		intent: "support",
		sent: false,
		error: "invalid",
		fields: ["email", "message"],
	});
	assertEquals(at("?error=bogus&fields=email").error, null);
	assertEquals(at("?fields=email").fields, []);
});

Deno.test("hrefs: every intent spelled out; refusals and sign-in round-trip", () => {
	assertEquals(contactHref("support"), "/contact?intent=support");
	assertEquals(contactSentHref("security"), "/contact?intent=security&sent=1");
	assertEquals(
		contactErrorHref("sales", "rate_limited"),
		"/contact?intent=sales&error=rate_limited",
	);
	assertEquals(
		contactErrorHref("support", "invalid", ["email", "nonsense", "message"]),
		"/contact?intent=support&error=invalid&fields=email%2Cmessage",
	);
	assertEquals(
		at(contactErrorHref("support", "invalid", ["email"]).slice("/contact".length)).fields,
		["email"],
	);
	assertEquals(contactLoginHref(), "/login?redirectTo=%2Fcontact%3Fintent%3Ddispute");
	// The attachments block signs a guest in back to the form they were filling in.
	assertEquals(contactLoginHref("support"), "/login?redirectTo=%2Fcontact%3Fintent%3Dsupport");
	assertEquals(contactLoginHref("security"), "/login?redirectTo=%2Fcontact%3Fintent%3Dsecurity");
	assertEquals(contactIntentHrefs().map((h) => h.intent), [
		"sales",
		"support",
		"dispute",
		"security",
	]);
});
