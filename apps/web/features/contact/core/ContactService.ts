import type {
	ContactAttachment,
	ContactAttachmentDiscarded,
	ContactAttachmentInit,
	ContactAttachmentTicket,
	ContactReceipt,
} from "@projective/types/contact";
import { apiFetch } from "@web/utils/api-client.ts";
import type { ContactEnvelope } from "./contact-respond.ts";

/**
 * ContactService — the THIN client for `/api/contact/*` (Decision #276). A dumb object of named
 * methods the `ContactIntake` island calls; the fat `ContactBackendService` owns every rule. A
 * signed-in reader's requests go through `apiFetch`, so an expired access token is renewed and the
 * request retried rather than refused; a guest's go through plain `fetch`, because a guest's 401 is
 * an answer ("sign in to attach files"), not a lapsed session to recover. Network and parse failures
 * degrade to a retryable envelope, never a throw.
 */

/** The answer every method resolves to — the route's envelope, plus the HTTP status. */
export type ContactResult<T> = ContactEnvelope<T> & { status: number };

const NETWORK = "We couldn't reach Projective. Check your connection and try again.";

async function post<T>(path: string, body: unknown, signedIn: boolean): Promise<ContactResult<T>> {
	try {
		const init: RequestInit = {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(body),
		};
		const res = signedIn ? await apiFetch(path, init) : await fetch(path, init);
		const data = await res.json().catch(() => null) as ContactEnvelope<T> | null;
		if (data && typeof data === "object") return { ...data, status: res.status };
		return {
			ok: false,
			message: "Unexpected response from the server. Please try again.",
			status: res.status,
		};
	} catch {
		return { ok: false, message: NETWORK, status: 0 };
	}
}

export const ContactService = {
	/** File a request; answers its receipt or the refusal's field errors. */
	submit(body: Record<string, unknown>, signedIn: boolean): Promise<ContactResult<ContactReceipt>> {
		return post<ContactReceipt>("/api/contact", body, signedIn);
	},

	/** Step 1 of an attachment: declare it, receive where to PUT the bytes. */
	initAttachment(input: ContactAttachmentInit): Promise<ContactResult<ContactAttachmentTicket>> {
		return post<ContactAttachmentTicket>("/api/contact/attachments/init", input, true);
	},

	/** Step 3 of an attachment: ask the server to check and admit the landed bytes. */
	completeAttachment(attachmentId: string): Promise<ContactResult<ContactAttachment>> {
		return post<ContactAttachment>("/api/contact/attachments/complete", { attachmentId }, true);
	},

	/** Remove: take back an attachment that has not been sent (its row and its bytes go). */
	discardAttachment(attachmentId: string): Promise<ContactResult<ContactAttachmentDiscarded>> {
		return post<ContactAttachmentDiscarded>(
			"/api/contact/attachments/discard",
			{ attachmentId },
			true,
		);
	},
};
