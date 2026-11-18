import { assertEquals } from "@std/assert";
import type { DeliveryEventOutcome } from "@projective/types/comms";
import { DeliveryEventService, eventArgs, verifySvixSignature } from "./DeliveryEventService.ts";

// #region Fixtures
const KEY = new Uint8Array(24).map((_, i) => i * 7 + 3);
const SECRET = `whsec_${btoa(String.fromCharCode(...KEY))}`;
const NOW = 1_800_000_000_000;

async function sign(id: string, timestamp: number, body: string, key = KEY): Promise<string> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign(
			"HMAC",
			cryptoKey,
			new TextEncoder().encode(`${id}.${timestamp}.${body}`),
		),
	);
	return `v1,${btoa(String.fromCharCode(...mac))}`;
}

async function signed(
	body: string,
	opts: { id?: string; at?: number; signature?: string } = {},
): Promise<Headers> {
	const id = opts.id ?? "msg_2p5Q";
	const at = opts.at ?? NOW / 1000;
	return new Headers({
		"svix-id": id,
		"svix-timestamp": String(at),
		"svix-signature": opts.signature ?? await sign(id, at, body),
	});
}

const BOUNCE = JSON.stringify({
	type: "email.bounced",
	created_at: "2026-11-18T21:00:00.000Z",
	data: {
		email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
		to: ["gone@example.test"],
		subject: "Stage 2 was funded",
		bounce: { type: "Permanent", subType: "Suppressed", message: "550 no such user" },
	},
});

function deps(
	record: (args: Record<string, string | null>) => Promise<DeliveryEventOutcome> = () =>
		Promise.resolve("hard_bounce"),
) {
	const calls: Record<string, string | null>[] = [];
	return {
		calls,
		deps: {
			live: true,
			secret: SECRET,
			nowMs: NOW,
			record: (args: Record<string, string | null>) => {
				calls.push(args);
				return record(args);
			},
		},
	};
}
// #endregion

Deno.test("verifySvixSignature — a valid signature over the raw body passes; any of several v1 entries may match", async () => {
	assertEquals(await verifySvixSignature(BOUNCE, await signed(BOUNCE), SECRET, NOW), "ok");
	const good = await sign("msg_2p5Q", NOW / 1000, BOUNCE);
	const several = await signed(BOUNCE, { signature: `v1,bm9wZQ== ${good}` });
	assertEquals(await verifySvixSignature(BOUNCE, several, SECRET, NOW), "ok");
});

Deno.test("verifySvixSignature — a tampered body, another key, or a missing header is refused", async () => {
	const headers = await signed(BOUNCE);
	assertEquals(
		await verifySvixSignature(BOUNCE.replace("Permanent", "Temporary"), headers, SECRET, NOW),
		"forged",
	);
	const otherKey = await signed(BOUNCE, {
		signature: await sign("msg_2p5Q", NOW / 1000, BOUNCE, KEY.map((b) => b ^ 1)),
	});
	assertEquals(await verifySvixSignature(BOUNCE, otherKey, SECRET, NOW), "forged");
	const bare = new Headers({ "svix-id": "msg_2p5Q", "svix-timestamp": String(NOW / 1000) });
	assertEquals(await verifySvixSignature(BOUNCE, bare, SECRET, NOW), "missing");
});

Deno.test("verifySvixSignature — 300 s of tolerance either way; 301 s is stale", async () => {
	for (const skew of [-300, 300]) {
		const at = NOW / 1000 + skew;
		assertEquals(
			await verifySvixSignature(BOUNCE, await signed(BOUNCE, { at }), SECRET, NOW),
			"ok",
			String(skew),
		);
	}
	for (const skew of [-301, 301]) {
		const at = NOW / 1000 + skew;
		assertEquals(
			await verifySvixSignature(BOUNCE, await signed(BOUNCE, { at }), SECRET, NOW),
			"stale",
			String(skew),
		);
	}
});

Deno.test("verifySvixSignature — no secret, the placeholder, or a non-whsec value verifies nothing", async () => {
	const headers = await signed(BOUNCE);
	for (const secret of [undefined, "XXXX-XXXX", "whsec_", btoa("short")]) {
		assertEquals(
			await verifySvixSignature(BOUNCE, headers, secret, NOW),
			"unconfigured",
			String(secret),
		);
	}
});

Deno.test("handleResend — a tampered body or a 301-second-old timestamp is a 400 and records nothing", async () => {
	const tampered = deps();
	const r1 = await DeliveryEventService.handleResend(
		BOUNCE.replace("gone@", "other@"),
		await signed(BOUNCE),
		tampered.deps,
	);
	assertEquals([r1.ok, r1.status, tampered.calls.length], [false, 400, 0]);

	const stale = deps();
	const r2 = await DeliveryEventService.handleResend(
		BOUNCE,
		await signed(BOUNCE, { at: NOW / 1000 - 301 }),
		stale.deps,
	);
	assertEquals([r2.ok, r2.status, stale.calls.length], [false, 400, 0]);
});

Deno.test("handleResend — a valid event is a 200 and reaches the database as named arguments", async () => {
	const live = deps();
	const result = await DeliveryEventService.handleResend(BOUNCE, await signed(BOUNCE), live.deps);
	assertEquals(result.status, 200);
	assertEquals(result.data, { received: true, outcome: "hard_bounce" });
	assertEquals(live.calls, [{
		p_provider: "resend",
		p_provider_event_id: "msg_2p5Q",
		p_event_type: "email.bounced",
		p_provider_ref: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
		p_recipient: "gone@example.test",
		p_bounce_kind: "Permanent",
		p_occurred_at: "2026-11-18T21:00:00.000Z",
	}]);
});

Deno.test("handleResend — a replay is still a 2xx; a database failure asks for a redelivery (503)", async () => {
	const replay = deps(() => Promise.resolve("replayed"));
	const r1 = await DeliveryEventService.handleResend(BOUNCE, await signed(BOUNCE), replay.deps);
	assertEquals([r1.status, r1.data?.outcome], [200, "replayed"]);

	const down = deps(() =>
		Promise.reject(new Error("comms.fn_record_delivery_event failed (57014)"))
	);
	const r2 = await DeliveryEventService.handleResend(BOUNCE, await signed(BOUNCE), down.deps);
	assertEquals([r2.ok, r2.status], [false, 503]);
});

Deno.test("handleResend — a signed body that is not a Resend event is a 400", async () => {
	for (const body of ["not json", JSON.stringify({ hello: "world" })]) {
		const d = deps();
		const r = await DeliveryEventService.handleResend(body, await signed(body), d.deps);
		assertEquals([r.status, d.calls.length], [400, 0], body);
	}
});

Deno.test("eventArgs — a delivered event with a single `to` string and no bounce", () => {
	assertEquals(
		eventArgs("msg_1", { type: "email.delivered", data: { email_id: "e1", to: "a@example.test" } }),
		{
			p_provider: "resend",
			p_provider_event_id: "msg_1",
			p_event_type: "email.delivered",
			p_provider_ref: "e1",
			p_recipient: "a@example.test",
			p_bounce_kind: null,
			p_occurred_at: null,
		},
	);
});

// #region The newsletter's share (CD1 step 5)
const CONTACT = JSON.stringify({
	type: "contact.updated",
	created_at: "2026-11-18T21:05:00.000Z",
	data: { id: "ct-1", email: "reader@example.test", unsubscribed: true },
});

Deno.test("handleResend — a contact event is claimed, then handed to the newsletter, replays included", async () => {
	for (const outcome of ["recorded", "replayed"] as const) {
		const live = deps(() => Promise.resolve(outcome));
		const seen: Array<[string, unknown]> = [];
		const result = await DeliveryEventService.handleResend(CONTACT, await signed(CONTACT), {
			...live.deps,
			newsletter: (id, body) => {
				seen.push([id, body]);
				return Promise.resolve("unsubscribed");
			},
		});
		assertEquals([result.status, result.data?.outcome], [200, outcome]);
		assertEquals(live.calls[0].p_event_type, "contact.updated");
		assertEquals(live.calls[0].p_recipient, null);
		assertEquals(seen, [["msg_2p5Q", JSON.parse(CONTACT)]]);
	}
});

Deno.test("handleResend — the newsletter's door failing asks for a redelivery (503)", async () => {
	const live = deps(() => Promise.resolve("recorded"));
	const result = await DeliveryEventService.handleResend(CONTACT, await signed(CONTACT), {
		...live.deps,
		newsletter: () =>
			Promise.reject(new Error("community.record_newsletter_provider_event failed (57014)")),
	});
	assertEquals([result.ok, result.status], [false, 503]);
});
// #endregion
