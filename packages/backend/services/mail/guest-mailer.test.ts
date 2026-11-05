import { assert, assertEquals } from "@std/assert";
import { guestCodeMessage, guestLink, type GuestMailRow, guestMessage } from "./guest-mailer.ts";

const ROW: GuestMailRow = {
	mail_id: "m1",
	kind: "invite",
	email: "guest@example.com",
	token: "ab".repeat(32),
	title: "Quarterly review",
	starts_at: "2026-12-07T15:00:00+00:00",
	ends_at: "2026-12-07T16:00:00+00:00",
	all_day: false,
	timezone: "Europe/London",
	host_name: "Ada Lin",
};
const APP = "https://projective.example/";

Deno.test("guestLink — absolute, on the rsvp page, one slash", () => {
	assertEquals(guestLink(APP, "abc"), "https://projective.example/rsvp/abc");
});

Deno.test("guestMessage — an invitation names the host, the time and the link", () => {
	const message = guestMessage(ROW, APP);
	assertEquals(message.to, "guest@example.com");
	assertEquals(message.subject, "Invitation: Quarterly review");
	assert(message.text.includes("Ada Lin invited you to Quarterly review."));
	assert(message.text.includes("Mon, 7 Dec 2026, 15:00 to 16:00 (Europe/London)"));
	assert(message.text.includes(`https://projective.example/rsvp/${ROW.token}`));
	assert(message.text.includes("Stop these emails"));
});

Deno.test("guestMessage — a new time asks again, on its own link", () => {
	const message = guestMessage({ ...ROW, kind: "moved" }, APP);
	assertEquals(message.subject, "New time: Quarterly review");
	assert(message.text.includes("Can you still make it?"));
	assert(message.text.includes(`/rsvp/${ROW.token}`));
});

Deno.test("guestMessage — a withdrawal says how to stop these, on a link that does nothing else", () => {
	const message = guestMessage({ ...ROW, kind: "withdrawn" }, APP);
	assertEquals(message.subject, "Cancelled: Quarterly review");
	assert(message.text.includes("Stop these emails"));
	assert(message.text.includes(`/rsvp/${ROW.token}`));
});

Deno.test("guestMessage — a host with no name still reads as a sentence", () => {
	assert(guestMessage({ ...ROW, host_name: null }, APP).text.startsWith("Someone invited you"));
});

Deno.test("guestCodeMessage — says what it is for and how long it lasts", () => {
	const message = guestCodeMessage("guest@example.com", "Quarterly review", "123456");
	assertEquals(message.subject, "Your code for Quarterly review");
	assert(message.text.includes("123456"));
	assert(message.text.includes("until the meeting ends"));
});
