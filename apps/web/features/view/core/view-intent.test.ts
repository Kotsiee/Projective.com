import { assertEquals } from "@std/assert";
import type { BookingActionKind, ServiceBookingOffer } from "@projective/types/services";
import {
	guestIntentRedirect,
	honouredIntent,
	type IntentFacts,
	readViewIntent,
	withoutViewIntent,
	withViewIntent,
} from "./view-intent.ts";
import { messageHrefFor, type MessageOwner, messageRecipient } from "./view-model.ts";

function offer(kind: BookingActionKind, disabled = false): Pick<ServiceBookingOffer, "cta"> {
	return {
		cta: {
			format: "session",
			primary: {
				kind,
				label: "Book session",
				href: null,
				disabled,
				disabledReason: disabled ? "Not taking bookings." : null,
			},
			secondary: null,
		},
	};
}

function facts(over: Partial<IntentFacts> = {}): IntentFacts {
	return {
		archetype: "session",
		offer: offer("open_scheduler"),
		authed: true,
		blocked: false,
		inert: false,
		...over,
	};
}

Deno.test("readViewIntent — reads the three intents and nothing else", () => {
	assertEquals(readViewIntent("?intent=book"), "book");
	assertEquals(readViewIntent("type=services&intent=contact"), "contact");
	assertEquals(readViewIntent(new URLSearchParams("intent=apply")), "apply");
	assertEquals(readViewIntent("?intent=buy"), null);
	assertEquals(readViewIntent("?intent="), null);
	assertEquals(readViewIntent("?type=services"), null);
});

Deno.test("withViewIntent — appends after the other parameters and keeps the hash", () => {
	assertEquals(
		withViewIntent("/view/sv-1?type=services", "book"),
		"/view/sv-1?type=services&intent=book",
	);
	assertEquals(withViewIntent("/@juno", "contact"), "/@juno?intent=contact");
	assertEquals(
		withViewIntent("/view/sv-1?type=services#reviews", "contact"),
		"/view/sv-1?type=services&intent=contact#reviews",
	);
});

Deno.test("withViewIntent — replaces an intent the href already carried", () => {
	assertEquals(
		withViewIntent("/view/sv-1?intent=apply&type=services", "book"),
		"/view/sv-1?type=services&intent=book",
	);
});

Deno.test("withoutViewIntent — strips every intent and keeps the rest byte for byte", () => {
	assertEquals(
		withoutViewIntent("/view/sv-1?q=a%20b&intent=book&type=services#x"),
		"/view/sv-1?q=a%20b&type=services#x",
	);
	assertEquals(withoutViewIntent("/view/sv-1?intent=book"), "/view/sv-1");
	assertEquals(withoutViewIntent("/view/sv-1?%69ntent=book&intent=apply"), "/view/sv-1");
	assertEquals(withoutViewIntent("/view/sv-1?type=services"), "/view/sv-1?type=services");
});

Deno.test("guestIntentRedirect — a guest's intent signs in first and returns to the same URL", () => {
	const url = new URL("https://projective.test/view/sv-1?type=services&intent=book");
	assertEquals(
		guestIntentRedirect(url, false),
		`/login?redirectTo=${encodeURIComponent("/view/sv-1?type=services&intent=book")}`,
	);
	assertEquals(guestIntentRedirect(url, true), null);
	assertEquals(guestIntentRedirect(new URL("https://projective.test/view/sv-1"), false), null);
	assertEquals(
		guestIntentRedirect(new URL("https://projective.test/view/sv-1?intent=buy"), false),
		null,
	);
});

Deno.test("honouredIntent — book only where the primary opens the slot or seat panel, enabled", () => {
	assertEquals(honouredIntent("book", facts()), "book");
	assertEquals(honouredIntent("book", facts({ offer: offer("open_scheduler", true) })), null);
	assertEquals(honouredIntent("book", facts({ offer: offer("unavailable", true) })), null);
	assertEquals(honouredIntent("book", facts({ offer: offer("reserve_seat") })), "book");
	assertEquals(honouredIntent("book", facts({ offer: offer("reserve_seat", true) })), null);
	assertEquals(honouredIntent("book", facts({ offer: offer("join_waitlist") })), null);
	assertEquals(honouredIntent("book", facts({ offer: offer("buy_now") })), null);
	assertEquals(honouredIntent("book", facts({ offer: offer("instantiate_pipeline") })), null);
	assertEquals(honouredIntent("book", facts({ offer: null })), null);
});

Deno.test("honouredIntent — contact wherever an offer renders its Contact control", () => {
	assertEquals(honouredIntent("contact", facts({ offer: offer("buy_now") })), "contact");
	assertEquals(honouredIntent("contact", facts({ offer: null })), null);
});

Deno.test("honouredIntent — apply only on a project", () => {
	assertEquals(honouredIntent("apply", facts({ archetype: "project", offer: null })), "apply");
	assertEquals(honouredIntent("apply", facts({ archetype: "product" })), null);
});

Deno.test("readViewIntent — Message is a link to a DM, never an intent", () => {
	assertEquals(readViewIntent("?intent=message"), null);
	assertEquals(readViewIntent("?type=projects&intent=message"), null);
});

Deno.test("Message client — a person is messaged directly", () => {
	const person: MessageOwner = { handle: "@hannahcole", name: "Hannah Cole", kind: "user" };
	assertEquals(messageRecipient(person), { handle: "@hannahcole", name: "Hannah Cole" });
	assertEquals(messageHrefFor({ owner: person }), "/messages/dm-hannahcole");
	assertEquals(
		messageHrefFor({ owner: { ...person, kind: "freelancer" } }),
		"/messages/dm-hannahcole",
	);
});

Deno.test("Message client — a team's or a business's brief reaches its owner (#422 (b))", () => {
	for (const kind of ["team", "business"] as const) {
		const entity: MessageOwner = {
			handle: "@atlaslabs",
			name: "Atlas Labs",
			kind,
			messageTo: { handle: "@danielokafor", name: "Daniel Okafor" },
		};
		assertEquals(
			messageRecipient(entity),
			{ handle: "@danielokafor", name: "Daniel Okafor" },
			kind,
		);
		assertEquals(messageHrefFor({ owner: entity }), "/messages/dm-danielokafor", kind);
	}
});

Deno.test("Message client — withheld when an entity names nobody, never dm-{slug}", () => {
	for (const kind of ["team", "business"] as const) {
		const entity: MessageOwner = { handle: "@atlaslabs", name: "Atlas Labs", kind };
		assertEquals(messageRecipient(entity), null, kind);
		assertEquals(messageHrefFor({ owner: entity }), null, kind);
	}
});

Deno.test("honouredIntent — nothing for a guest, a restricted lane or an inert rendering", () => {
	assertEquals(honouredIntent(null, facts()), null);
	assertEquals(honouredIntent("book", facts({ authed: false })), null);
	assertEquals(honouredIntent("contact", facts({ blocked: true })), null);
	assertEquals(honouredIntent("apply", facts({ archetype: "project", inert: true })), null);
});
