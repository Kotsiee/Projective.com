import { assertEquals } from "@std/assert";
import type { MailMessage, MailTransport } from "../mail/transport.ts";
import {
	NEWSLETTER_CONFIRM_SUBJECT,
	newsletterConfirmationMessage,
	newsletterLinks,
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
