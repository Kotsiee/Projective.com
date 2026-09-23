import { SessionKeys, writeStored } from "@web/utils/storage-keys.ts";

/** How long the Resend control stays locked after a verification code is sent (seconds). */
export const RESEND_COOLDOWN_S = 30;

/** The epoch-ms instant Resend unlocks again for a code sent at `sentAt`. */
export function resendDeadline(sentAt: number): number {
	return sentAt + RESEND_COOLDOWN_S * 1000;
}

/**
 * Lock Resend for a code that has just been sent, persisting the deadline `/verify` resumes on mount.
 * Called by the join form before it navigates, so the reader lands on a running countdown instead of
 * an invitation to send a second copy of the email already in their inbox.
 */
export function armResendCooldown(sentAt: number = Date.now()): number {
	const deadline = resendDeadline(sentAt);
	writeStored("session", SessionKeys.VERIFY_RESEND_DEADLINE, String(deadline));
	return deadline;
}
