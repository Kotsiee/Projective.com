import { type ReadonlySignal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { MessageAttachmentMode } from "@projective/types/projects";
import { ContactsService } from "@features/messaging/core/ContactsService.ts";
import type { RankedContact } from "@features/messaging/types/messaging-types.ts";
import type { ShareRequest } from "../core/share-request.ts";
import { shareMessage } from "../core/share-mode.ts";
import { type SendOutcome, type SendSummary, sendSummary } from "../core/share-select.ts";

/** The share surface's send: one direct message per chosen person, all at once. */
export interface ShareSend {
	sending: ReadonlySignal<boolean>;
	/** Send to each person; answers what was reached and what is left to retry. */
	send: (
		people: readonly RankedContact[],
		note: string,
		mode: MessageAttachmentMode,
	) => Promise<SendSummary | null>;
}

/**
 * Send a share to several people as SEPARATE direct messages (Decision #406) — each through
 * `ContactsService.createConversation` with one contact, which reopens the pair's DM or opens one, so
 * nobody is put in a group with strangers. Every send is settled on its own; a refusal names the person
 * and never unsends the others.
 */
export function useShareSend(request: ShareRequest): ShareSend {
	const sending = useSignal(false);
	const live = useRef(true);
	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
		};
	}, []);

	async function send(
		people: readonly RankedContact[],
		note: string,
		mode: MessageAttachmentMode,
	): Promise<SendSummary | null> {
		if (sending.peek() || people.length === 0) return null;
		sending.value = true;
		const body = shareMessage(request, note, mode);
		const settled = await Promise.allSettled(
			people.map((person) =>
				ContactsService.createConversation({ contactIds: [person.id], ...body })
			),
		);
		if (!live.current) return null;
		sending.value = false;
		const outcomes: SendOutcome[] = settled.map((result, i) => {
			const person = people[i];
			if (result.status === "rejected") {
				return { id: person.id, name: person.name, ok: false, message: null };
			}
			const res = result.value;
			const ok = res.ok && res.data?.messageAccepted === true;
			return { id: person.id, name: person.name, ok, message: ok ? null : res.message ?? null };
		});
		return sendSummary(outcomes);
	}

	return { sending, send };
}
