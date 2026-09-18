import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { ContactPicker } from "./ContactPicker.tsx";
import { closeContactPicker, contactPicker } from "../core/messaging-state.ts";
import { ContactsService } from "../core/ContactsService.ts";
import { conversationHref } from "../core/conversation-model.ts";

/**
 * NewConversationModal — the people-picker modal, mounted once by the inbox sidebar and driven by
 * the shared {@link contactPicker} signal (so the root's empty state, the conversation header's
 * "Add members" and the Members tab can open it too).
 *
 * Three requests, one picker:
 *  - **New message** — one pick starts (or reopens) a DM, several start a group.
 *  - **New group** — group mode from the first pick (the name field is already showing).
 *  - **Add members** — every pick joins the conversation the request names; a DM with a third
 *    person becomes a group. The previous version of this modal IGNORED the request's
 *    `conversationId` and created a brand-new group instead of extending the thread — a control
 *    that appeared to work and did something else.
 *
 * A create navigates into the conversation, where the first message lands. On failure the modal
 * STAYS OPEN and returns the message for the picker to render beside the selection that produced
 * it — closing on a silent no-op left the viewer believing a conversation had been started when
 * none had.
 */
export function NewConversationModal(): JSX.Element {
	const open = useSignal(false);
	// Keep the Dialog's open state in lock-step with the shared request signal.
	useSignalEffect(() => {
		open.value = contactPicker.value !== null;
	});
	const req = contactPicker.value;
	// Initial focus lands INSIDE the picker (its first tabbable — the group name or the search field)
	// rather than on the header ×, which is otherwise first in DOM order.
	const bodyRef = useRef<HTMLDivElement>(null);

	async function confirm(contactIds: string[], groupName?: string): Promise<string | null> {
		if (req?.mode === "add" && req.conversationId) {
			const res = await ContactsService.addMembers({
				conversationId: req.conversationId,
				contactIds,
			});
			if (!res.ok || !res.data) {
				return res.message ?? "Couldn't add those people. Please try again.";
			}
			closeContactPicker();
			// The conversation's kind (and so its header, roster and title) may have changed: a
			// full navigation re-renders every band from the server's answer.
			navigate(conversationHref(res.data.id));
			return null;
		}

		const res = await ContactsService.createConversation({ contactIds, groupName });
		if (!res.ok || !res.data) {
			return res.message ?? "Couldn't start that conversation. Please try again.";
		}
		closeContactPicker();
		navigate(conversationHref(res.data.id));
		return null;
	}

	const header = req?.mode === "add" ? "Add members" : req?.group ? "New group" : "New message";

	return (
		<Dialog
			visible={open}
			onVisibleChange={(v) => {
				if (!v) closeContactPicker();
			}}
			header={header}
			width="30rem"
			class="msg-newconv"
			initialFocusRef={bodyRef}
		>
			<div ref={bodyRef}>
				{req && (
					<ContactPicker
						key={`${req.mode}:${req.conversationId ?? ""}:${req.group ? "g" : "d"}`}
						mode={req.mode}
						group={req.group}
						existingIds={req.existingIds}
						onConfirm={confirm}
						onCancel={closeContactPicker}
					/>
				)}
			</div>
		</Dialog>
	);
}

/** A full navigation — every `/messages` route is server-rendered per request (Decision #52). */
function navigate(href: string): void {
	try {
		globalThis.location.href = href;
	} catch { /* SSR / no window — non-fatal */ }
}
