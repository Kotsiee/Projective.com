import { assertEquals } from "@std/assert";
import type { CalendarEvent } from "@projective/types/scheduling";
import type { ConnectionsView } from "@projective/types/integrations";
import { canMintOn, checkJoinLink, roomOf } from "./meeting-link.ts";

const view = (rows: unknown[]) => ({ connections: rows }) as unknown as ConnectionsView;

Deno.test("a room needs an active connection that was granted conferencing", () => {
	const zoom = { providerSlug: "zoom", status: "active", grantedKinds: ["conferencing"] } as const;
	assertEquals(canMintOn("zoom", view([zoom])), true);
	assertEquals(canMintOn("google", view([zoom])), false);
	assertEquals(canMintOn("zoom", view([{ ...zoom, status: "expired" }])), false);
	assertEquals(canMintOn("zoom", view([{ ...zoom, grantedKinds: ["calendar"] }])), false);
	assertEquals(
		canMintOn("microsoft_teams", view([{ ...zoom, providerSlug: "outlook" }])),
		true,
	);
});

Deno.test("saving says what the modal showed, and never sends a room's own address back", () => {
	const event = (over: Partial<CalendarEvent>) =>
		({ id: "e", title: "", kind: "sync", start: 0, end: 1, ...over }) as CalendarEvent;
	const meeting = {
		provider: "zoom",
		providerLabel: "Zoom",
		joinUrl: null,
		passcode: null,
		details: null,
		pending: true,
	} as const;
	assertEquals(roomOf(event({ kind: "deadline", meeting })), null);
	assertEquals(roomOf(event({ kind: "busy", meeting })), null);
	assertEquals(roomOf(event({ meeting })), { provider: "zoom", link: null, passcode: null });
	assertEquals(
		roomOf(event({ meeting: { ...meeting, joinUrl: "https://app.example/meet/rom-23456789ab" } }))?.link,
		null,
	);
	assertEquals(
		roomOf(event({ meeting: { ...meeting, provider: "custom", joinUrl: "https://studio.example/room" } }))?.link,
		"https://studio.example/room",
	);
});

Deno.test("a trusted host names its provider, subdomains included", () => {
	assertEquals(checkJoinLink("https://meet.google.com/abc-defg-hij"), {
		ok: true,
		provider: "google",
	});
	assertEquals(checkJoinLink(" https://acme.zoom.us/j/123 "), { ok: true, provider: "zoom" });
	assertEquals(checkJoinLink("https://teams.microsoft.com/l/meetup-join/x"), {
		ok: true,
		provider: "microsoft_teams",
	});
});

Deno.test("a lookalike or unknown https host is a custom link", () => {
	assertEquals(checkJoinLink("https://zoom.us.example.com/j/1"), { ok: true, provider: "custom" });
	assertEquals(checkJoinLink("https://notzoom.us/j/1"), { ok: true, provider: "custom" });
	assertEquals(checkJoinLink("https://jitsi.example.org/room"), { ok: true, provider: "custom" });
});

Deno.test("anything but an https address is refused", () => {
	assertEquals(checkJoinLink("http://zoom.us/j/1").ok, false);
	assertEquals(checkJoinLink("javascript:alert(1)").ok, false);
	assertEquals(checkJoinLink("meet.google.com/abc").ok, false);
});
