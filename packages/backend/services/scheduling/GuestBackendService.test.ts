import { assert, assertEquals } from "@std/assert";
import type { EmailDeliveryOutcome } from "@projective/types/org";
import type { GuestMailRow } from "../mail/guest-mailer.ts";
import type { MailMessage } from "../mail/transport.ts";
import { GuestBackendService, guestDeviceKey, parseGuestCode } from "./GuestBackendService.ts";

const ROW: GuestMailRow = {
	mail_id: "m1",
	kind: "invite",
	email: "guest@example.com",
	token: "ab".repeat(32),
	title: "Quarterly review",
	starts_at: "2026-12-07T15:00:00+00:00",
	ends_at: "2026-12-07T16:00:00+00:00",
	all_day: false,
	timezone: "UTC",
	host_name: "Ada Lin",
};

/** A sweep over `rows` whose every delivery answers `outcome`, recording what the doors heard. */
function sweep(rows: GuestMailRow[], outcome: EmailDeliveryOutcome) {
	const finished: unknown[] = [];
	const lines: string[] = [];
	const sent: MailMessage[] = [];
	const run = GuestBackendService.sendDue(25, {
		appUrl: "https://projective.example",
		door: (name, args) => {
			if (name === "finish_guest_mail") finished.push(args);
			return Promise.resolve({
				data: name === "claim_guest_mail" ? rows : null,
				error: null,
			});
		},
		deliver: (message, _what, devLine) => {
			sent.push(message);
			lines.push(devLine);
			return Promise.resolve(outcome);
		},
	});
	return { run, finished, lines, sent };
}

Deno.test("sendDue — what left is finished as sent", async () => {
	const { run, finished, sent } = sweep([ROW], "sent");
	const result = await run;
	assertEquals(result.data, { sent: 1, failed: 0 });
	assertEquals(finished, [{ p_mail: "m1", p_sent: true }]);
	assertEquals(sent[0].to, "guest@example.com");
});

Deno.test("sendDue — a development console counts as delivered, and shows the link", async () => {
	const { run, finished, lines } = sweep([ROW], "logged");
	await run;
	assertEquals(finished, [{ p_mail: "m1", p_sent: true }]);
	assert(lines[0].includes(`/rsvp/${ROW.token}`));
});

Deno.test("sendDue — what could not go is left to be tried again", async () => {
	const { run, finished } = sweep([ROW], "unavailable");
	const result = await run;
	assertEquals(result.data, { sent: 0, failed: 1 });
	assertEquals(finished, [{ p_mail: "m1", p_sent: false }]);
});

Deno.test("sendDue — a zone Intl does not know cannot stop the sweep", async () => {
	const { run, finished } = sweep([{ ...ROW, timezone: "posix/Mars/Olympus" }], "sent");
	assertEquals((await run).data, { sent: 1, failed: 0 });
	assertEquals(finished, [{ p_mail: "m1", p_sent: true }]);
});

Deno.test("invitation — a token of the wrong shape is a dead link, before any read", async () => {
	assertEquals((await GuestBackendService.invitation("../../etc/passwd")).data, {
		state: "dead",
	});
	assertEquals((await GuestBackendService.invitation("AB".repeat(32))).data, { state: "dead" });
});

Deno.test("guestDeviceKey — one device on one link, and nothing that reads across links", async () => {
	const key = await guestDeviceKey("a".repeat(64), "203.0.113.7", "Firefox");
	assertEquals(key.length, 40);
	assertEquals(key, await guestDeviceKey("a".repeat(64), "203.0.113.7", "Firefox"));
	assert(key !== await guestDeviceKey("b".repeat(64), "203.0.113.7", "Firefox"));
	assert(key !== await guestDeviceKey("a".repeat(64), "203.0.113.8", "Firefox"));
	assertEquals(key.includes("203"), false);
});

Deno.test("parseGuestCode — six digits and nothing else", () => {
	assertEquals(parseGuestCode(" 123456 "), "123456");
	assertEquals(parseGuestCode("12345"), null);
	assertEquals(parseGuestCode("12345a"), null);
	assertEquals(parseGuestCode(null), null);
});
