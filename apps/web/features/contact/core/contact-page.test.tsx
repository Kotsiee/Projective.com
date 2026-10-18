/**
 * `/contact`'s server-rendered parts (Decision #276): the structured data, the copy's promises and
 * the rail. None of the JSON-LD shows on the page and the rail's placeholders must never turn into
 * invented facts, so both are pinned here. (The intake island imports CSS and cannot load under
 * `deno test`; the rail and the builders do not.)
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { CONTACT_INTENTS } from "@projective/types/contact";
import { contactJsonLd, contactOrganizationJsonLd } from "./contact-jsonld.ts";
import {
	BOOKING_UNAVAILABLE_REASON,
	ENTITY_FACTS,
	ENTITY_PLACEHOLDER,
	INTENT_COPY,
	intentOptions,
	nextSteps,
	PROJECTIVE_SALES_HANDLE,
} from "./contact-copy.ts";
import { ContactRail } from "../components/ContactRail.tsx";

const ORIGIN = "https://projective.app";

Deno.test("JSON-LD: a ContactPage, the site, and the organisation with one contact point per intent", () => {
	const graph = contactJsonLd(ORIGIN, "Contact Projective.");
	assertEquals(graph["@context"], "https://schema.org");
	const types = graph["@graph"].map((n) => n["@type"]);
	assertEquals(types, ["ContactPage", "WebSite", "Organization"]);
	const page = graph["@graph"][0];
	assertEquals(page.url, `${ORIGIN}/contact`);
	const org = contactOrganizationJsonLd(ORIGIN);
	const points = org.contactPoint as Array<Record<string, unknown>>;
	assertEquals(points.map((p) => p.contactType), [
		"sales",
		"customer support",
		"dispute resolution",
		"security",
	]);
	assertEquals(points[0].url, `${ORIGIN}/contact?intent=sales`);
	for (const p of points) {
		assertFalse("telephone" in p, "no telephone is published — none exists");
		assertFalse("email" in p);
	}
	assert(JSON.parse(JSON.stringify(graph)));
});

Deno.test("copy: every intent is named, described and given a reply target phrased as a target", () => {
	assertEquals(intentOptions().map((o) => o.value), [...CONTACT_INTENTS]);
	for (const intent of CONTACT_INTENTS) {
		const copy = INTENT_COPY[intent];
		assert(copy.label && copy.description && copy.legend && copy.submit);
		assert(copy.replyTarget.startsWith("We aim to"), `${intent}: a target, not a measured promise`);
	}
});

Deno.test("copy: what happens next names the reference, and an anonymous report is told there is no reply", () => {
	const named = nextSteps("support", "CT-7K4Q-2M9X", { kind: "address", email: "ada@example.com" });
	assert(named.some((s) => s.includes("ada@example.com") && s.includes("CT-7K4Q-2M9X")));
	const given = nextSteps("sales", "CT-7K4Q-2M9X", { kind: "given" });
	assert(given.some((s) => s.includes("the address you gave") && s.includes("CT-7K4Q-2M9X")));
	assertFalse(
		given.some((s) => s.includes("can't write back")),
		"a named no-JS request is never told it gets no reply",
	);
	const anon = nextSteps("security", "CT-7K4Q-2M9X", { kind: "none" });
	assert(anon.some((s) => s.includes("can't write back")));
	assertFalse(anon.some((s) => s.includes("@")));
});

Deno.test("the entity facts stay placeholders until supplied, and the booking control says why it is off", () => {
	assertEquals(ENTITY_FACTS.map((f) => f.term), [
		"Legal name",
		"Company number",
		"Registered address",
		"Support hours",
	]);
	assert(ENTITY_FACTS.every((f) => f.value === ENTITY_PLACEHOLDER));
	assertEquals(ENTITY_PLACEHOLDER, "XXXX-XXXX");
	assertEquals(PROJECTIVE_SALES_HANDLE, null);
	assert(BOOKING_UNAVAILABLE_REASON.length > 20);
});

Deno.test("ContactRail: a labelled complementary region; placeholders marked; no status line", () => {
	const html = renderToString(<ContactRail />);
	assert(html.startsWith('<aside class="ctc-rail" aria-labelledby="ctc-rail-title"'));
	assertEquals((html.match(/XXXX-XXXX/g) ?? []).length, 4);
	assertEquals((html.match(/\(not yet published\)/g) ?? []).length, 4);
	for (const intent of CONTACT_INTENTS) assert(html.includes(INTENT_COPY[intent].replyTarget));
	assert(html.includes('href="/help"') && html.includes('href="/legal"'));
	assertFalse(
		/operational|systems? (are )?(up|online)/i.test(html),
		"no status line without a health endpoint",
	);
	assertFalse(html.includes("<h1"), "the page owns the one h1");
});
