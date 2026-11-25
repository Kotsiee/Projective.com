import { assert, assertEquals, assertRejects } from "@std/assert";
import {
	configuredTransport,
	deliverMailWithReceipt,
	inviteTransport,
	mailCanLeave,
	resendTransport,
} from "./transport.ts";

/** Run `fn` with these variables set, an `undefined` one removed, and put them back. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
	const apply = (name: string, value: string | undefined) =>
		value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
	const before = Object.keys(vars).map((name) => [name, Deno.env.get(name)] as const);
	Object.entries(vars).forEach(([name, value]) => apply(name, value));
	try {
		fn();
	} finally {
		before.forEach(([name, value]) => apply(name, value));
	}
}

const MESSAGE = { to: "guest@example.com", subject: "Hello", text: "Body" };

Deno.test("resendTransport — one POST with the key and the sender", async () => {
	const calls: { url: string; init: RequestInit }[] = [];
	const send = ((url: string, init: RequestInit) => {
		calls.push({ url, init });
		return Promise.resolve(new Response("{}", { status: 200 }));
	}) as typeof fetch;

	await resendTransport("re_test", "Projective <no-reply@notify.example.com>", send).send(
		MESSAGE,
	);

	assertEquals(calls[0].url, "https://api.resend.com/emails");
	const headers = calls[0].init.headers as Record<string, string>;
	assertEquals(headers.authorization, "Bearer re_test");
	assertEquals(JSON.parse(String(calls[0].init.body)), {
		from: "Projective <no-reply@notify.example.com>",
		to: ["guest@example.com"],
		subject: "Hello",
		text: "Body",
	});
});

Deno.test("resendTransport — a message's own headers ride the POST as Resend's `headers`", async () => {
	const bodies: unknown[] = [];
	const send = ((_url: string, init: RequestInit) => {
		bodies.push(JSON.parse(String(init.body)));
		return Promise.resolve(new Response("{}", { status: 200 }));
	}) as typeof fetch;
	const headers = {
		"List-Unsubscribe": "<https://app.example.test/api/newsletter/unsubscribe?token=t>",
		"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
	};

	await resendTransport("re_test", "Projective <no-reply@notify.example.com>", send).send({
		...MESSAGE,
		headers,
	});

	assertEquals((bodies[0] as { headers: unknown }).headers, headers);
});

Deno.test("resendTransport — a refusal throws the status, and never the recipient", async () => {
	const send = (() => Promise.resolve(new Response("nope", { status: 422 }))) as typeof fetch;
	const error = await assertRejects(() =>
		resendTransport("re_test", "a@b.example", send).send(MESSAGE)
	);
	assert(String(error).includes("422"));
	assertEquals(String(error).includes("guest@example.com"), false);
});

Deno.test("configuredTransport — only a real key and a sender turn it on", () => {
	const real = {
		RESEND_API_KEY: "re_real",
		MAIL_FROM: "Projective <no-reply@notify.example.com>",
	};
	withEnv(real, () => assert(configuredTransport()));
	withEnv(
		{ ...real, RESEND_API_KEY: "XXXX-XXXX" },
		() => assertEquals(configuredTransport(), null),
	);
	withEnv(
		{ ...real, RESEND_API_KEY: undefined },
		() => assertEquals(configuredTransport(), null),
	);
	withEnv({ ...real, MAIL_FROM: "XXXX-XXXX" }, () => assertEquals(configuredTransport(), null));
});

Deno.test("mailCanLeave — production with no transport promises nothing", () => {
	const off = { RESEND_API_KEY: undefined, MAIL_FROM: undefined };
	withEnv({ ...off, DENO_ENV: "production" }, () => assertEquals(mailCanLeave(), false));
	withEnv({ ...off, DENO_ENV: "development" }, () => assertEquals(mailCanLeave(), true));
	withEnv(
		{ RESEND_API_KEY: "re_real", MAIL_FROM: "a@b.example", DENO_ENV: "production" },
		() => assertEquals(mailCanLeave(), true),
	);
});

Deno.test("deliverMailWithReceipt — a sent message carries the provider's id; nothing else does", async () => {
	const quiet = { info: () => {}, warn: () => {} };
	const accepted = { send: () => Promise.resolve({ id: "4ef9a417" }) };
	const refused = { send: () => Promise.reject(new Error("Resend answered 422")) };
	assertEquals(
		await deliverMailWithReceipt(MESSAGE, "test", "dev", { ...quiet, transport: accepted }),
		{ outcome: "sent", id: "4ef9a417" },
	);
	assertEquals(
		await deliverMailWithReceipt(MESSAGE, "test", "dev", { ...quiet, transport: refused }),
		{ outcome: "unavailable", id: null },
	);
	assertEquals(
		await deliverMailWithReceipt(MESSAGE, "test", "dev", {
			...quiet,
			transport: null,
			appEnv: "development",
		}),
		{ outcome: "logged", id: null },
	);
});

Deno.test("inviteTransport — invitations leave from MAIL_FROM_INVITES, else from MAIL_FROM", async () => {
	const froms: unknown[] = [];
	const real = globalThis.fetch;
	globalThis.fetch = ((_url: string, init: RequestInit) => {
		froms.push(JSON.parse(String(init.body)).from);
		return Promise.resolve(new Response("{}", { status: 200 }));
	}) as typeof fetch;
	const transports: ReturnType<typeof inviteTransport>[] = [];
	try {
		const base = {
			RESEND_API_KEY: "re_real",
			MAIL_FROM: "Projective <no-reply@notify.example.com>",
		};
		withEnv({ ...base, MAIL_FROM_INVITES: "Projective <invites@invites.example.com>" }, () => {
			transports.push(inviteTransport());
		});
		withEnv({ ...base, MAIL_FROM_INVITES: "XXXX-XXXX" }, () => transports.push(inviteTransport()));
		withEnv({ ...base, MAIL_FROM_INVITES: undefined }, () => transports.push(inviteTransport()));
		for (const transport of transports) await transport?.send(MESSAGE);
	} finally {
		globalThis.fetch = real;
	}
	assertEquals(froms, [
		"Projective <invites@invites.example.com>",
		"Projective <no-reply@notify.example.com>",
		"Projective <no-reply@notify.example.com>",
	]);
});
