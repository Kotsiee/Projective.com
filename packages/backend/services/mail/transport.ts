import type { EmailDeliveryOutcome } from "@projective/types/org";
import { serverEnv } from "../../core/env.ts";

/**
 * transport — the one seam mail leaves the server through (providers spec §8.5).
 *
 * The transport is Resend, reached with one `fetch` so there is no dependency to carry. It is on only
 * with a real key and a sender: a `re_…` key from `RESEND_API_KEY` and an address in `MAIL_FROM`, so
 * the `XXXX-XXXX` placeholder counts as absent. {@link deliverMail} answers honestly with an
 * {@link EmailDeliveryOutcome} whichever way that goes:
 *
 * - **`sent`** — the transport accepted the message.
 * - **`logged`** — no transport, outside production: a development line goes to the server console,
 *   so a developer can open the link. The address is real; the inbox is the terminal.
 * - **`unavailable`** — no transport in production, or it refused: nothing was delivered, and the
 *   warning carries neither the address nor any token.
 */

// #region Transport
/** One message for a transport to deliver. Plain text: nothing sent here needs more. */
export interface MailMessage {
	to: string;
	subject: string;
	text: string;
	/**
	 * Extra message headers, passed through as given: the newsletter's RFC 8058 pair
	 * (`List-Unsubscribe`, `List-Unsubscribe-Post`). Never an address beyond `to`, never a secret.
	 */
	headers?: Readonly<Record<string, string>>;
	/**
	 * The provider's Idempotency-Key: a notification email sends its delivery id, so a retried send
	 * is one message. A guest's message sends none, because each retry carries a new link and Resend
	 * refuses a reused key with a different body.
	 */
	idempotencyKey?: string;
}

/** What a provider answered for an accepted message: its own message id, when it gave one. */
export interface MailReceipt {
	id: string | null;
}

/** Something that can put a message in an inbox. Throws when it could not. */
export interface MailTransport {
	send(message: MailMessage): Promise<MailReceipt | void>;
}

/** How long one send may take, so a slow provider cannot hold a request or a sweep open. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Resend's HTTP API. An error names the status only, never the recipient. An accepted send answers
 * Resend's message id (`{ id }`), which its delivery webhook quotes as `data.email_id`.
 */
export function resendTransport(
	apiKey: string,
	from: string,
	send: typeof fetch = fetch,
): MailTransport {
	return {
		async send(message) {
			const res = await send("https://api.resend.com/emails", {
				method: "POST",
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
					...(message.idempotencyKey ? { "idempotency-key": message.idempotencyKey } : {}),
				},
				body: JSON.stringify({
					from,
					to: [message.to],
					subject: message.subject,
					text: message.text,
					...(message.headers ? { headers: { ...message.headers } } : {}),
				}),
				signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
			});
			if (!res.ok) {
				await res.body?.cancel();
				throw new Error(`Resend answered ${res.status}`);
			}
			const body = await res.json().catch(() => null) as { id?: unknown } | null;
			return { id: typeof body?.id === "string" ? body.id : null };
		},
	};
}

/** The transport this environment is configured with, or `null` while it has none. */
export function configuredTransport(): MailTransport | null {
	const { resendApiKey, mailFrom } = serverEnv();
	if (!resendApiKey?.startsWith("re_") || !mailFrom?.includes("@")) return null;
	return resendTransport(resendApiKey, mailFrom);
}

/**
 * Can a message reach anybody from here, even if only the development console? Anything that would
 * promise a person an email asks this first, so production with no transport offers no such thing.
 */
export function mailCanLeave(): boolean {
	return configuredTransport() !== null || serverEnv().appEnv !== "production";
}
// #endregion

// #region Deliver
/** Everything {@link deliverMail} reads from its surroundings, injectable for tests. */
export interface MailerDeps {
	/** `development` | `production` (DENO_ENV). */
	appEnv: string;
	transport: MailTransport | null;
	/** Where the development line is written. */
	info: (line: string) => void;
	/** Where a delivery problem is reported. Never with an address or a token. */
	warn: (line: string) => void;
}

function defaultDeps(): MailerDeps {
	return {
		appEnv: serverEnv().appEnv,
		transport: configuredTransport(),
		info: (line) => console.info(line),
		warn: (line) => console.warn(line),
	};
}

/**
 * Send `message`, and say how it left (see the module doc). Never throws: a transport failure is
 * `unavailable`. `what` names the message in a warning; `devLine` is what development logs instead.
 */
export async function deliverMail(
	message: MailMessage,
	what: string,
	devLine: string,
	deps: Partial<MailerDeps> = {},
): Promise<EmailDeliveryOutcome> {
	const { appEnv, transport, info, warn } = { ...defaultDeps(), ...deps };
	if (transport) {
		try {
			await transport.send(message);
			return "sent";
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			warn(`[mail] the ${what} could not be sent: ${reason}`);
			return "unavailable";
		}
	}
	if (appEnv === "production") {
		warn(`[mail] no email transport is configured; a ${what} was not sent.`);
		return "unavailable";
	}
	info(devLine);
	return "logged";
}
// #endregion
