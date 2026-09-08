import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	isTicketSlug,
	onTicketSurfaceChange,
	openTicketOnSurface,
	readTicketParam,
	registerTicketSurface,
	resetTicketSurfaces,
	ticketDeepLinkAllowed,
	withTicketParam,
} from "./ticket-link.ts";

const SLUG = "tkt-abcdefghjk";

// #region Reading + shape
Deno.test("readTicketParam returns the raw value, present or malformed, and null when absent", () => {
	assertEquals(readTicketParam(`?tkv=${SLUG}`), SLUG);
	assertEquals(readTicketParam(`?tab=files&tkv=${SLUG}&x=1`), SLUG);
	// Malformed is STILL returned — the host has to know there is something to strip.
	assertEquals(readTicketParam("?tkv=not-a-slug"), "not-a-slug");
	assertEquals(readTicketParam("?tkv="), null);
	assertEquals(readTicketParam("?tab=files"), null);
	assertEquals(readTicketParam(""), null);
});

Deno.test("isTicketSlug accepts only the minted ticket shape", () => {
	assert(isTicketSlug(SLUG));
	assertFalse(isTicketSlug("prj-abcdefghjk"), "a project slug is not a ticket address");
	assertFalse(isTicketSlug("tkt-abcdefghj"), "nine symbols");
	assertFalse(isTicketSlug("tkt-abcdefghjl"), "`l` is outside the alphabet");
	assertFalse(isTicketSlug("6f1c2e2e-0000-4000-8000-000000000000"), "a uuid does not route");
	assertFalse(isTicketSlug(""));
});
// #endregion

// #region Writing
Deno.test("withTicketParam sets, replaces and strips while preserving every other parameter", () => {
	assertEquals(withTicketParam("/messages", SLUG), `/messages?tkv=${SLUG}`);
	assertEquals(
		withTicketParam("/explore?category=services&sort=recent", SLUG),
		`/explore?category=services&sort=recent&tkv=${SLUG}`,
	);
	assertEquals(
		withTicketParam(`/explore?tkv=tkt-2222222222&sort=recent`, SLUG),
		`/explore?tkv=${SLUG}&sort=recent`,
		"replacing keeps the parameter where it was",
	);
	assertEquals(
		withTicketParam(`/explore?category=services&tkv=${SLUG}&sort=recent`, null),
		"/explore?category=services&sort=recent",
	);
	assertEquals(withTicketParam(`/messages?tkv=${SLUG}`, null), "/messages");
	assertEquals(withTicketParam("/messages", null), "/messages", "nothing to strip");
});

Deno.test("withTicketParam leaves a hash and a `?review=1` hand-off intact", () => {
	assertEquals(
		withTicketParam("/projects/prj-a/chat#m-42", SLUG),
		`/projects/prj-a/chat?tkv=${SLUG}#m-42`,
	);
	assertEquals(
		withTicketParam(`/projects/prj-a/submissions/s1?review=1&tkv=${SLUG}`, null),
		"/projects/prj-a/submissions/s1?review=1",
	);
});

Deno.test("withTicketParam is idempotent, so a sync loop can compare before it writes", () => {
	const once = withTicketParam("/wallet?w=team:1", SLUG);
	assertEquals(withTicketParam(once, SLUG), once);
});
// #endregion

// #region Where it may open
Deno.test("the landing, help, share and auth routes never open a ticket", () => {
	for (
		const path of [
			"/",
			"/about",
			"/help",
			"/help/payments",
			"/share/abc123",
			"/login",
			"/join",
			"/join/",
			"/forgot-password",
			"/verify",
		]
	) {
		assertFalse(ticketDeepLinkAllowed(path), path);
	}
});

Deno.test("exactly the two committing checkout steps are excluded, not the flow around them", () => {
	assertFalse(ticketDeepLinkAllowed("/checkout/details"));
	assertFalse(ticketDeepLinkAllowed("/checkout/payment"));
	assert(ticketDeepLinkAllowed("/checkout"), "the basket step");
	assert(ticketDeepLinkAllowed("/checkout/confirmation"));
	assert(ticketDeepLinkAllowed("/basket"));
});

Deno.test("product surfaces are allowed, including the ones a ticket link is pasted into", () => {
	for (
		const path of [
			"/projects",
			"/projects/prj-abcdefghjk/board",
			"/messages/dm-ivy",
			"/explore",
			"/@ivy",
			"/wallet",
			"/calendar",
			"/files",
			"/helpdesk", // a prefix must match a whole segment, never a substring
			"/aboutus",
		]
	) {
		assert(ticketDeepLinkAllowed(path), path);
	}
});
// #endregion

// #region The surface registry
Deno.test("a registered surface is offered the slug first, and unregistering withdraws it", () => {
	resetTicketSurfaces();
	const opened: string[] = [];
	const off = registerTicketSurface({
		openBySlug: (slug) => {
			if (slug !== SLUG) return false;
			opened.push(slug);
			return true;
		},
	});
	assert(openTicketOnSurface(SLUG));
	assertFalse(openTicketOnSurface("tkt-2222222222"), "a slug the surface does not hold");
	assertEquals(opened, [SLUG]);
	off();
	assertFalse(openTicketOnSurface(SLUG), "nothing left to offer it to");
	resetTicketSurfaces();
});

Deno.test("registration notifies a waiting host, so hydration order does not matter", () => {
	resetTicketSurfaces();
	let notified = 0;
	const stop = onTicketSurfaceChange(() => notified++);
	const off = registerTicketSurface({ openBySlug: () => false });
	assertEquals(notified, 1);
	stop();
	off();
	registerTicketSurface({ openBySlug: () => false });
	assertEquals(notified, 1, "an unsubscribed listener hears nothing");
	resetTicketSurfaces();
});
// #endregion
