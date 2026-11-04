import { assertEquals } from "@std/assert";
import { checkJoinLink } from "./meeting-link.ts";

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
