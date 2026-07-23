import { signal } from "@preact/signals";

/**
 * messaging-state — the cross-island signal bridge for the `/messages` module. The inbox sidebar
 * mounts the modals, but their open state must be settable from OTHER islands (the conversation
 * Members tab's "Add members", the conversation header's Settings). These module-level signals connect
 * those mount points (exactly like the projects board/submissions footer↔body bridges). A full
 * navigation reloads the page and resets them — the intended transient scope.
 */

/**
 * The contact-picker modal's open state (task §2B). `null` = closed. `mode: "new"` starts a fresh
 * conversation; `mode: "add"` adds members to an existing conversation (converting a DM → group),
 * carrying the target `conversationId`.
 */
export interface ContactPickerRequest {
	mode: "new" | "add";
	conversationId?: string;
}
export const contactPicker = signal<ContactPickerRequest | null>(null);

/** Whether the Message Settings modal (task §2D) is open. */
export const settingsModalOpen = signal(false);

/** Open the New Conversation picker. */
export function openNewConversation(): void {
	contactPicker.value = { mode: "new" };
}

/** Open the Add Members picker for an existing conversation (DM → group). */
export function openAddMembers(conversationId: string): void {
	contactPicker.value = { mode: "add", conversationId };
}

/** Close the contact picker. */
export function closeContactPicker(): void {
	contactPicker.value = null;
}
