import type { EmailDeliveryOutcome } from "@projective/types/org";
import { serverEnv } from "../../core/env.ts";

/**
 * verification-mailer — the seam an email-verification link leaves the server through.
 *
 * ## There is no email transport yet
 *
 * Decision #57(f): the platform has no outbound email provider (no SMTP block, no `send-email` Edge
 * Function, no provider key in the Environment Variable Contract). So this module answers honestly
 * with an {@link EmailDeliveryOutcome} instead of pretending:
 *
 * - **`sent`** — a {@link MailTransport} accepted the message. Only reachable once one is configured
 *   ({@link configuredTransport} returns none today) or injected (tests).
 * - **`logged`** — no transport, outside production: the verification LINK is written to the server
 *   console under a `[dev mail]` prefix, so a developer can click it. The address is real; the inbox
 *   is the terminal.
 * - **`unavailable`** — no transport in production: nothing is sent and a warning is logged WITHOUT
 *   the token or the address. The address stays saved, unverified; the UI says no mail went out.
 *
 * The raw token exists in exactly two places: this call and the message it builds. It is never
 * returned to a caller of the service, never put in a response body, and never logged in production.
 */

// #region Transport
/** One message for a transport to deliver. Plain text: a verification mail needs nothing more. */
export interface MailMessage {
	to: string;
	subject: string;
	text: string;
}

/** Something that can put a message in an inbox. Throws when it could not. */
export interface MailTransport {
	send(message: MailMessage): Promise<void>;
}

/**
 * The transport this environment is configured with. Always `null` until an email provider lands
 * (Decision #57(f)) — and adding one means a key in the Environment Variable Contract
 * (`SYSTEM_ARCHITECTURE.md`) and `core/env.ts` first, never a dependency smuggled in here.
 */
export function configuredTransport(): MailTransport | null {
	return null;
}
// #endregion

// #region Link + message
/** The route that redeems a token: `GET /api/user/emails/verify?token=…`. */
export const VERIFY_PATH = "/api/user/emails/verify";

/** Build the absolute verification link for a token on the given app origin. */
export function verificationLink(appUrl: string, token: string): string {
	const base = appUrl.replace(/\/+$/, "");
	return `${base}${VERIFY_PATH}?token=${encodeURIComponent(token)}`;
}

/** The verification message for one address. */
export function verificationMessage(to: string, link: string): MailMessage {
	return {
		to,
		subject: "Confirm your email address for Projective",
		text: [
			"Someone — hopefully you — added this address to a Projective account.",
			"",
			"Open this link while signed in to that account to confirm it. It works once and expires in 24 hours:",
			link,
			"",
			"If this wasn't you, ignore this email. Nothing changes until the link is opened.",
		].join("\n"),
	};
}
// #endregion

// #region Send
/** Everything {@link sendEmailVerification} reads from its surroundings, injectable for tests. */
export interface MailerDeps {
	/** `development` | `production` (DENO_ENV). */
	appEnv: string;
	transport: MailTransport | null;
	/** Where the development link is written. */
	info: (line: string) => void;
	/** Where a delivery problem is reported (never with the token). */
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
 * Mail a verification link for `token` to `to`, and say how it left (see the module doc). Never
 * throws: a transport failure is `unavailable`, logged without the token.
 */
export async function sendEmailVerification(
	mail: { to: string; token: string; appUrl: string },
	deps: Partial<MailerDeps> = {},
): Promise<EmailDeliveryOutcome> {
	const { appEnv, transport, info, warn } = { ...defaultDeps(), ...deps };
	const link = verificationLink(mail.appUrl, mail.token);

	if (transport) {
		try {
			await transport.send(verificationMessage(mail.to, link));
			return "sent";
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			warn(`[mail] the verification email could not be sent: ${reason}`);
			return "unavailable";
		}
	}

	if (appEnv === "production") {
		warn("[mail] no email transport is configured; a verification email was not sent.");
		return "unavailable";
	}

	info(`[dev mail] Verify ${mail.to} -> ${link}`);
	return "logged";
}
// #endregion
