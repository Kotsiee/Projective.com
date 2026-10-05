import { dmConversationId } from "@projective/types/messaging";
import { openPopout } from "@web/features/messaging/core/popout-state.ts";
import { conversationHref } from "@web/features/messaging/core/conversation-model.ts";

/**
 * member-chat — the roster's Message action: open the viewer's direct conversation with a person.
 *
 * It is the SAME conversation a profile's Message control opens — the unified `dm-{handle}` thread —
 * handed to the global floating messenger (`ChatPopoutHost`, a draggable window that survives
 * navigation) through {@link openPopout}. Below the mobile breakpoint the host renders nothing, so the
 * thread opens as its own page instead.
 */

/** The person a Message action addresses. */
export interface ChatTarget {
	name: string;
	/** The platform `@handle`; a person without one (an email-only invitee) cannot be messaged. */
	handle: string | null;
	avatar: string | null;
}

/** Whether the person can be messaged at all. */
export function canMessage(target: ChatTarget): boolean {
	return !!target.handle;
}

/** The inbox address of the viewer's conversation with this person. */
export function memberChatHref(handle: string): string {
	return conversationHref(dmConversationId(handle.replace(/^@+/, "")));
}

/**
 * Open the conversation — in the floating window on desktop, as the inbox page on mobile. No-op for a
 * person without a handle.
 */
export function openMemberChat(target: ChatTarget, mobile: boolean): void {
	if (!target.handle) return;
	const id = dmConversationId(target.handle.replace(/^@+/, ""));
	const href = conversationHref(id);
	if (mobile) {
		globalThis.location.assign(href);
		return;
	}
	openPopout({
		scope: "conversation",
		projectId: id,
		channelId: id,
		conversationId: id,
		title: target.name,
		href,
		source: "profile",
		avatar: target.avatar,
	});
}
