import { assert, assertEquals, assertRejects } from "@std/assert";
import { configuredTransport, mailCanLeave, resendTransport } from "./transport.ts";

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

const MESSAGE = {
	to: "guest@example.com",
	subject: "Hello",
	text: "Body",
	idempotencyKey: "seat-1",
};

Deno.test("resendTransport — one POST with the key, the sender and the idempotency key", async () => {
	const calls: { url: string; init: RequestInit }[] = [];
	const send = ((url: string, init: RequestInit) => {
		calls.push({ url, init });
		return Promise.resolve(new Response("{}", { status: 200 }));
	}) as typeof fetch;

	await resendTransport("re_test", "Projective <no-reply@notify.example.com>", send).send(MESSAGE);

	assertEquals(calls[0].url, "https://api.resend.com/emails");
	const headers = calls[0].init.headers as Record<string, string>;
	assertEquals(headers.authorization, "Bearer re_test");
	assertEquals(headers["idempotency-key"], "seat-1");
	assertEquals(JSON.parse(String(calls[0].init.body)), {
		from: "Projective <no-reply@notify.example.com>",
		to: ["guest@example.com"],
		subject: "Hello",
		text: "Body",
	});
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
	const real = { RESEND_API_KEY: "re_real", MAIL_FROM: "Projective <no-reply@notify.example.com>" };
	withEnv(real, () => assert(configuredTransport()));
	withEnv(
		{ ...real, RESEND_API_KEY: "XXXX-XXXX" },
		() => assertEquals(configuredTransport(), null),
	);
	withEnv({ ...real, RESEND_API_KEY: undefined }, () => assertEquals(configuredTransport(), null));
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
