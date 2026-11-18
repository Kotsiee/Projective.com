import { assertEquals } from "@std/assert";
import {
	classify,
	pacedContacts,
	resendContacts,
	type TopicSubscription,
} from "./resend-contacts.ts";

/**
 * The Resend contacts client: the exact requests the sync sends (the address only in a create's body
 * and a lookup's path, nothing else about the subscriber), how statuses read, and the pacing.
 */

interface Sent {
	method: string;
	url: string;
	body: unknown;
	auth: string | null;
}

/** A fetch that records each request and answers `status` with `json`. */
function recorder(status = 200, json: unknown = { object: "contact", id: "ct-1" }) {
	const sent: Sent[] = [];
	const send = ((input: string | URL | Request, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		sent.push({
			method: init?.method ?? "GET",
			url: String(input),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
			auth: headers.get("authorization"),
		});
		return Promise.resolve(new Response(JSON.stringify(json), { status }));
	}) as typeof fetch;
	return { sent, send };
}

const TOPICS: TopicSubscription[] = [
	{ id: "t-general", subscription: "opt_in" },
	{ id: "t-changelog", subscription: "opt_out" },
];

Deno.test("a create sends the address, subscribed, the segment and every topic — nothing more", async () => {
	const { sent, send } = recorder();
	const answer = await resendContacts("re_key", send).create("a@b.co", "seg-1", TOPICS);
	assertEquals(answer, { ok: true, id: "ct-1" });
	assertEquals(sent, [{
		method: "POST",
		url: "https://api.resend.com/contacts",
		auth: "Bearer re_key",
		body: {
			email: "a@b.co",
			unsubscribed: false,
			segments: [{ id: "seg-1" }],
			topics: [{ id: "t-general", subscription: "opt_in" }, {
				id: "t-changelog",
				subscription: "opt_out",
			}],
		},
	}]);
});

Deno.test("the other calls address the contact by id, and the topics call sends a bare array", async () => {
	const { sent, send } = recorder();
	const client = resendContacts("re_key", send);
	await client.resubscribe("ct-1");
	await client.addToSegment("ct-1", "seg-1");
	await client.setTopics("ct-1", TOPICS);
	await client.remove("ct-1");
	await client.find("a+b@c.co");
	assertEquals(sent.map((s) => `${s.method} ${s.url}`), [
		"PATCH https://api.resend.com/contacts/ct-1",
		"POST https://api.resend.com/contacts/ct-1/segments/seg-1",
		"PATCH https://api.resend.com/contacts/ct-1/topics",
		"DELETE https://api.resend.com/contacts/ct-1",
		"GET https://api.resend.com/contacts/a%2Bb%40c.co",
	]);
	assertEquals(sent[0].body, { unsubscribed: false });
	assertEquals(sent[1].body, undefined);
	assertEquals(sent[2].body, TOPICS);
	assertEquals(sent[3].body, undefined);
});

Deno.test("statuses: 429 and 5xx end a pass, 404 and 409 steer, any other 4xx is a refusal", () => {
	assertEquals(classify(200), { ok: true, id: null });
	assertEquals(classify(429), { ok: false, kind: "rate_limited", status: 429 });
	assertEquals(classify(503), { ok: false, kind: "unavailable", status: 503 });
	assertEquals(classify(404), { ok: false, kind: "not_found", status: 404 });
	assertEquals(classify(409), { ok: false, kind: "exists", status: 409 });
	assertEquals(classify(422), { ok: false, kind: "refused", status: 422 });
});

Deno.test("a delete of a contact already gone counts as done; a network failure is unavailable", async () => {
	assertEquals(await resendContacts("re_key", recorder(404, {}).send).remove("ct-1"), {
		ok: true,
		id: "ct-1",
	});
	const down = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
	assertEquals(await resendContacts("re_key", down).remove("ct-1"), {
		ok: false,
		kind: "unavailable",
		status: 0,
	});
});

Deno.test("an answer with no id is ok with a null id", async () => {
	assertEquals(
		await resendContacts("re_key", recorder(200, {}).send).create("a@b.co", "s", TOPICS),
		{
			ok: true,
			id: null,
		},
	);
});

Deno.test("pacing leaves at least the gap between two calls", async () => {
	let clock = 1_000;
	const waits: number[] = [];
	const { send } = recorder();
	const client = pacedContacts(resendContacts("re_key", send), 200, (ms) => {
		waits.push(ms);
		clock += ms;
		return Promise.resolve();
	}, () => clock);
	await client.find("a@b.co");
	clock += 50;
	await client.find("a@b.co");
	await client.remove("ct-1");
	assertEquals(waits, [150, 200]);
});
