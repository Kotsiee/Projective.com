import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { ContactPicker } from "./ContactPicker.tsx";
import { closeContactPicker, contactPicker } from "../core/messaging-state.ts";
import { MessagingService } from "../core/MessagingService.ts";
import { conversationHref } from "../core/conversation-model.ts";
import type { MessagingRole } from "../types/messaging-types.ts";

/**
 * NewConversationModal — the contact-picker modal (task §2B), mounted once by the inbox sidebar and
 * driven by the shared {@link contactPicker} signal (so the conversation Members tab's "Add members"
 * can open it too). One pick → a DM; several → a group. On confirm it creates the conversation (a stub
 * that returns the deterministic id) and navigates into it — where the first message seamlessly lands
 * it in `/messages/[conversationId]`.
 */
export function NewConversationModal({ role }: { role?: MessagingRole }): JSX.Element {
	const open = useSignal(false);
	// Keep the Dialog's open state in lock-step with the shared request signal.
	useSignalEffect(() => {
		open.value = contactPicker.value !== null;
	});
	const req = contactPicker.value;

	/**
	 * Create, then navigate. On failure the modal STAYS OPEN and returns the message for the picker to
	 * render beside the selection that produced it — closing on a silent no-op (the previous
	 * behaviour) left the viewer believing a conversation had been started when none had.
	 */
	async function confirm(contactIds: string[], groupName?: string): Promise<string | null> {
		const res = await MessagingService.create({ contactIds, groupName });
		if (!res.ok || !res.data) {
			return res.message ?? "Couldn't start that conversation. Please try again.";
		}
		closeContactPicker();
		try {
			globalThis.location.href = conversationHref(res.data.id);
		} catch { /* SSR / no window — non-fatal */ }
		return null;
	}

	return (
		<Dialog
			visible={open}
			onVisibleChange={(v) => {
				if (!v) closeContactPicker();
			}}
			header={req?.mode === "add" ? "Add members" : "New message"}
			width="30rem"
			class="msg-newconv"
		>
			{req && (
				<ContactPicker
					role={role}
					mode={req.mode}
					onConfirm={confirm}
					onCancel={closeContactPicker}
				/>
			)}
		</Dialog>
	);
}
