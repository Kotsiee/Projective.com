import { assert, assertEquals } from "@std/assert";
import type { MailMessage, MailTransport } from "../mail/transport.ts";
import {
	isNewsletterSender,
	NEWSLETTER_CONFIRM_SUBJECT,
	newsletterConfirmationMessage,
	newsletterLinks,
	newsletterSender,
	newsletterTransport,
	sendNewsletterConfirmation,
	topicPhrase,
} from "./newsletter-mailer.ts";

/**
 * The newsletter's confirmation mail (PRD-E11): the confirm link and the RFC 8058 pair, and nothing
 * else of the subscription row.
 */

const APP = "https://app.example.test/";
const TOKEN = "0b0e7d5c-34a1-4b7a-9d61-2f1f5c2e9a10";

Deno.test("the links: the confirm page and the one-click endpoint, on the app origin", () => {
	assertEquals(newsletterLinks(APP, TOKEN), {
		confirm: `https://app.example.test/newsletter/confirm?token=${TOKEN}`,
		unsubscribe: `https://app.example.test/api/newsletter/unsubscribe?token=${TOKEN}`,
	});
});

Deno.test("the mail carries the link, the topic names and the List-Unsubscribe pair, and nothing else", () => {
	const links = newsletterLinks(APP, TOKEN);
	const message = newsletterConfirmationMessage(
		"reader@example.com",
		["changelog", "general"],
		links,
	);
	assertEquals(message, {
		to: "reader@example.com",
		subject: NEWSLETTER_CONFIRM_SUBJECT,
		text: [
			"Please confirm you'd like Projective to email you about: Release notes and The Projective newsletter.",
			"",
			"Confirm your subscription (the link works for 7 days):",
			`https://app.example.test/newsletter/confirm?token=${TOKEN}`,
			"",
			"Didn't ask for this? Ignore this email and nothing more will be sent.",
		].join("\n"),
		headers: {
			"List-Unsubscribe": `<https://app.example.test/api/newsletter/unsubscribe?token=${TOKEN}>`,
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	});
});

Deno.test("the send hands the transport that message, and development logs the link instead", async () => {
	const sent: MailMessage[] = [];
	const transport: MailTransport = {
		send: (message) => {
			sent.push(message);
			return Promise.resolve();
		},
	};
	const mail = {
		to: "reader@example.com",
		token: TOKEN,
		topics: ["general"] as const,
		appUrl: APP,
	};

	assertEquals(await sendNewsletterConfirmation(mail, { transport, appEnv: "production" }), "sent");
	assertEquals(sent[0].subject, NEWSLETTER_CONFIRM_SUBJECT);
	assertEquals(sent[0].headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");

	const lines: string[] = [];
	const outcome = await sendNewsletterConfirmation(mail, {
		transport: null,
		appEnv: "development",
		info: (line) => lines.push(line),
	});
	assertEquals(outcome, "logged");
	assertEquals(lines, [
		`[dev mail] Confirm the newsletter for reader@example.com -> https://app.example.test/newsletter/confirm?token=${TOKEN}`,
	]);
});

Deno.test("topic names read as one phrase", () => {
	assertEquals(topicPhrase(["general"]), "The Projective newsletter");
	assertEquals(
		topicPhrase(["changelog", "general"]),
		"Release notes and The Projective newsletter",
	);
});

// #region The newsletter's own sender (#480 (a), PRD-E14)
Deno.test("a sender is one address, with or without a display name, and nothing that could inject", () => {
	assert(isNewsletterSender("Projective <news@news.example.com>"));
	assert(isNewsletterSender("news@news.example.com"));
	assert(!isNewsletterSender(null));
	assert(!isNewsletterSender(""));
	assert(!isNewsletterSender("Projective"));
	assert(!isNewsletterSender("Projective <news@news.example.com>\r\nBcc: x@y.z"));
	assert(!isNewsletterSender("a@b.co, c@d.co"));
});

Deno.test("the sender param is read once a minute, and a malformed one reads as unset", async () => {
	let reads = 0;
	const read = (value: unknown) => () => {
		reads++;
		return Promise.resolve({ data: { value }, error: null });
	};
	const t0 = 10_000_000;
	assertEquals(
		await newsletterSender(read("Projective <news@news.example.com>"), t0),
		"Projective <news@news.example.com>",
	);
	assertEquals(
		await newsletterSender(read("ignored"), t0 + 1_000),
		"Projective <news@news.example.com>",
	);
	assertEquals(reads, 1);
	assertEquals(await newsletterSender(read("not an address"), t0 + 120_000), null);
	assertEquals(await newsletterSender(() => Promise.reject(new Error("down")), t0 + 240_000), null);
});

Deno.test("with a key, newsletter mail leaves from the newsletter's sender, else MAIL_FROM with one warning", async () => {
	const keep = ["RESEND_API_KEY", "MAIL_FROM"].map((k) => [k, Deno.env.get(k)] as const);
	Deno.env.set("RESEND_API_KEY", "re_test_key");
	Deno.env.set("MAIL_FROM", "Projective <no-reply@notify.example.com>");
	const sentFrom: string[] = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = ((_: unknown, init?: RequestInit) => {
		sentFrom.push(JSON.parse(String(init?.body)).from);
		return Promise.resolve(new Response(JSON.stringify({ id: "em-1" }), { status: 200 }));
	}) as typeof fetch;
	try {
		const message = { to: "a@b.co", subject: "s", text: "t" };
		await (await newsletterTransport(() => Promise.resolve("Projective <news@news.example.com>")))!
			.send(message);
		const warnings: string[] = [];
		const fallback = await newsletterTransport(
			() => Promise.resolve(null),
			(line) => warnings.push(line),
		);
		await fallback!.send(message);
		await newsletterTransport(() => Promise.resolve(null), (line) => warnings.push(line));
		assertEquals(sentFrom, [
			"Projective <news@news.example.com>",
			"Projective <no-reply@notify.example.com>",
		]);
		assertEquals(warnings.length, 1);
		assert(!warnings[0].includes("@"));
	} finally {
		globalThis.fetch = realFetch;
		for (const [k, v] of keep) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
	}
});
// #endregion
