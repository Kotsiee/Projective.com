import type { ClaimedDelivery, NotificationCategory } from "@projective/types/comms";
import { serverEnv } from "../../core/env.ts";
import { configuredTransport, type MailMessage, type MailTransport } from "../mail/transport.ts";
import type { DispatchPayload } from "./dispatch-payload.ts";
import type { DispatchTransport, TransportOutcome } from "./dispatch-transports.ts";
import { signUnsubscribeToken, unsubscribeUrl } from "./unsubscribe-token.ts";

/**
 * email-transport — the dispatcher's email channel (COMMS NT3, Resend; providers spec §8.5).
 *
 * A notification email carries the title as its subject, one sentence for the category, an "Open in
 * Projective" link to the absolute deep link and a link to choose which emails arrive. Never the
 * body or the payload (EPI §3.5 rule 4): the dispatcher's payload holds neither. Each send carries the
 * delivery id as its Idempotency-Key, so a retried send is one message, and answers Resend's message
 * id, which the webhook quotes back (`DeliveryEventService`).
 *
 * Marketing mail also carries the RFC 8058 one-click pair (`List-Unsubscribe` +
 * `List-Unsubscribe-Post`) to `POST /api/comms/unsubscribe`, and is refused rather than sent without
 * one. The suppression the dispatcher's claim consults (`fn_is_suppressed`) keeps it from an address
 * that has opted out or bounced.
 */

// #region Message
/** The one line under the title, by category: news without a word of the notification's content. */
const CATEGORY_LINE: Readonly<Record<NotificationCategory, string>> = {
	money: "There's an update about money on your Projective account.",
	work: "There's an update on your work in Projective.",
	messages: "You have something new to read in Projective.",
	schedule: "There's an update to your schedule in Projective.",
	discovery: "There's something new for you on Projective.",
	account: "There's an update about your Projective account.",
	system: "There's an important notice for you on Projective.",
	marketing: "Here's what's new on Projective.",
};

/** Where a person chooses which emails they get. */
const PREFERENCES_PATH = "/settings/notifications";

/** The message for one delivery. `unsubscribe` is the one-click URL (Marketing only), else null. */
export function buildNotificationEmail(
	delivery: Pick<ClaimedDelivery, "deliveryId" | "category">,
	address: string,
	payload: DispatchPayload,
	appUrl: string,
	unsubscribe: string | null,
): MailMessage {
	const preferences = new URL(PREFERENCES_PATH, new URL(appUrl).origin).href;
	const lines = [
		payload.title,
		"",
		CATEGORY_LINE[delivery.category] ?? CATEGORY_LINE.system,
		"",
		`Open in Projective: ${payload.link}`,
		"",
		`Choose which emails you get: ${preferences}`,
	];
	if (unsubscribe) lines.push(`Unsubscribe from marketing email: ${unsubscribe}`);
	return {
		to: address,
		subject: payload.title.slice(0, 200),
		text: lines.join("\n"),
		idempotencyKey: delivery.deliveryId,
		...(unsubscribe
			? {
				headers: {
					"List-Unsubscribe": `<${unsubscribe}>`,
					"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
				},
			}
			: {}),
	};
}
// #endregion

// #region Transport
/** What the email transport reads from its surroundings, injectable for tests. */
export interface EmailTransportDeps {
	appUrl: string;
	signUnsubscribe: (userId: string) => Promise<string | null>;
}

const liveDeps = (): EmailTransportDeps => ({
	appUrl: serverEnv().appUrl,
	signUnsubscribe: (userId) => signUnsubscribeToken(userId),
});

/**
 * The email `DispatchTransport` over `mail`, or `null` while no mail transport is configured (no
 * well-formed `RESEND_API_KEY` and `MAIL_FROM`), so the channel stays unclaimed and unshown.
 */
export function emailDispatchTransport(
	mail: MailTransport | null = configuredTransport(),
	deps: EmailTransportDeps = liveDeps(),
): DispatchTransport | null {
	if (!mail) return null;
	return {
		channel: "email",
		provider: "resend",
		async send(delivery, payload): Promise<TransportOutcome> {
			const address = delivery.destination && "address" in delivery.destination
				? delivery.destination.address
				: null;
			if (!address) return { status: "failed", provider: "resend", error: "no_address" };

			let unsubscribe: string | null = null;
			if (delivery.category === "marketing") {
				const token = await deps.signUnsubscribe(delivery.userId);
				if (!token) return { status: "failed", provider: "resend", error: "no_unsubscribe_link" };
				unsubscribe = unsubscribeUrl(token, deps.appUrl);
			}

			const receipt = await mail.send(
				buildNotificationEmail(delivery, address, payload, deps.appUrl, unsubscribe),
			);
			return { status: "sent", provider: "resend", providerRef: receipt?.id ?? null };
		},
	};
}
// #endregion
