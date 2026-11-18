import type { ClaimedDelivery } from "@projective/types/comms";

/**
 * dispatch-payload — the whole of what one outbound notification carries off Projective.
 *
 * A provider (a mail service, a push gateway, an SMS carrier) is a third party, so a delivery carries
 * the title, an absolute deep link back into the app and the notification's id, and nothing else
 * (EPI §3.5 rules 2 and 4; COMMS hard rule "no private-zone content reaches any SaaS"). The body and
 * the payload can hold private-zone content, so they are never read here: the claim does not even
 * return them (`comms.fn_claim_deliveries`).
 */

// #region Payload
/** What leaves Projective for one delivery. */
export interface DispatchPayload {
	readonly notificationId: string;
	readonly title: string;
	/** Absolute, and always on the app's own origin. */
	readonly link: string;
}

/** Where a notification with no deep link, or an unusable one, points: the in-app inbox. */
export const INBOX_PATH = "/notifications";

/**
 * The absolute deep link for `actionUrl` on `appUrl`'s origin. Only a plain same-origin path is kept;
 * anything else (an absolute URL, a protocol-relative `//host`, a backslash path a browser may read
 * as one) falls back to the inbox, so a link can never send its reader off-site.
 */
export function deepLink(actionUrl: string | null, appUrl: string): string {
	const origin = new URL(appUrl).origin;
	const inbox = new URL(INBOX_PATH, origin).href;
	const path = actionUrl?.trim() ?? "";
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return inbox;
	const url = new URL(path, origin);
	return url.origin === origin ? url.href : inbox;
}

/** The payload for one claimed delivery: three fields, copied by name. */
export function buildDispatchPayload(
	delivery: Pick<ClaimedDelivery, "notificationId" | "title" | "actionUrl">,
	appUrl: string,
): DispatchPayload {
	return {
		notificationId: delivery.notificationId,
		title: delivery.title,
		link: deepLink(delivery.actionUrl, appUrl),
	};
}
// #endregion
