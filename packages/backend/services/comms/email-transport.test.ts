import { assert, assertEquals } from "@std/assert";
import type { ClaimedDelivery } from "@projective/types/comms";
import { configuredTransport, type MailMessage } from "../mail/transport.ts";
import { buildDispatchPayload } from "./dispatch-payload.ts";
import { buildNotificationEmail, emailDispatchTransport } from "./email-transport.ts";

const APP = "https://staging.projective.test";

function delivery(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
	return {
		deliveryId: "00000000-0000-4000-8000-000000000001",
		notificationId: "6f3d2b0a-1c4e-4d8a-9b7f-0a1b2c3d4e5f",
		userId: "0b8e6c4a-2d1f-4e3b-8a7c-9d0e1f2a3b4c",
		channel: "email",
		status: "queued",
		attempts: 1,
		suppressedReason: null,
		destination: { address: "ada@example.test" },
		title: "Stage 2 was funded",
		actionUrl: "/projects/prj-abc123",
		type: "escrow.funded",
		category: "money",
		urgency: "high",
		groupKey: null,
		...overrides,
	};
}

function capture() {
	const sent: MailMessage[] = [];
	return {
		sent,
		mail: {
			send(message: MailMessage) {
				sent.push(message);
				return Promise.resolve({ id: "re_msg_123" });
			},
		},
	};
}

Deno.test("buildNotificationEmail — the title, one line, the link; never the body or the payload", () => {
	const d = delivery();
	const message = buildNotificationEmail(
		d,
		"ada@example.test",
		buildDispatchPayload(d, APP),
		APP,
		null,
	);
	assertEquals(message.to, "ada@example.test");
	assertEquals(message.subject, "Stage 2 was funded");
	assertEquals(message.idempotencyKey, d.deliveryId);
	assert(message.text.includes(`Open in Projective: ${APP}/projects/prj-abc123`));
	assert(message.text.includes(`${APP}/settings/notifications`));
	assertEquals(message.headers, undefined);
	assertEquals(message.text.split("\n").filter(Boolean).length, 4);
});

Deno.test("emailDispatchTransport — a send answers sent with Resend's message id, keyed by the delivery id", async () => {
	const { sent, mail } = capture();
	const transport = emailDispatchTransport(mail, {
		appUrl: APP,
		signUnsubscribe: () => Promise.resolve("tok"),
	})!;
	const d = delivery();
	const outcome = await transport.send(d, buildDispatchPayload(d, APP));
	assertEquals(outcome, { status: "sent", provider: "resend", providerRef: "re_msg_123" });
	assertEquals(sent[0].idempotencyKey, d.deliveryId);
});

Deno.test("emailDispatchTransport — Marketing carries the RFC 8058 one-click pair, or is refused without one", async () => {
	const { sent, mail } = capture();
	const signing = emailDispatchTransport(mail, {
		appUrl: APP,
		signUnsubscribe: () => Promise.resolve("abc.def"),
	})!;
	const d = delivery({
		category: "marketing",
		type: "marketing.product_update",
		title: "What's new",
	});
	await signing.send(d, buildDispatchPayload(d, APP));
	assertEquals(sent[0].headers, {
		"List-Unsubscribe": `<${APP}/api/comms/unsubscribe?token=abc.def>`,
		"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
	});
	assert(sent[0].text.includes("Unsubscribe from marketing email:"));

	const unsigned = emailDispatchTransport(mail, {
		appUrl: APP,
		signUnsubscribe: () => Promise.resolve(null),
	})!;
	const refused = await unsigned.send(d, buildDispatchPayload(d, APP));
	assertEquals(refused, { status: "failed", provider: "resend", error: "no_unsubscribe_link" });
	assertEquals(sent.length, 1);
});

Deno.test("emailDispatchTransport — no address is a failure, and no mail transport is no email transport", async () => {
	const { mail } = capture();
	const transport = emailDispatchTransport(mail, {
		appUrl: APP,
		signUnsubscribe: () => Promise.resolve(null),
	})!;
	const d = delivery({ destination: null });
	assertEquals(await transport.send(d, buildDispatchPayload(d, APP)), {
		status: "failed",
		provider: "resend",
		error: "no_address",
	});
	assertEquals(emailDispatchTransport(null), null);
});

Deno.test("configuredTransport — RESEND_API_KEY=XXXX-XXXX is no transport", () => {
	const keep = ["RESEND_API_KEY", "MAIL_FROM"].map((k) => [k, Deno.env.get(k)] as const);
	try {
		Deno.env.set("RESEND_API_KEY", "XXXX-XXXX");
		Deno.env.set("MAIL_FROM", "Projective <no-reply@notify.example.test>");
		assertEquals(configuredTransport(), null);
		Deno.env.set("RESEND_API_KEY", "re_live_key");
		assert(configuredTransport() !== null);
	} finally {
		for (const [k, v] of keep) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
	}
});
