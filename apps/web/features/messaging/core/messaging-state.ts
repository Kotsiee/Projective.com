import { signal } from "@preact/signals";

/**
 * messaging-state — the cross-island signal bridge for the `/messages` module. The inbox sidebar
 * mounts the modals, but their open state must be settable from OTHER islands (the root's empty
 * state CTA, the conversation Members tab's "Add members", the conversation header's Settings).
 * These module-level signals connect those mount points (exactly like the projects board/submissions
 * footer↔body bridges). A full navigation reloads the page and resets them — the intended transient
 * scope.
 */

/**
 * The people-picker modal's open state. `null` = closed. `mode: "new"` starts a fresh conversation
 * (`group: true` opens straight into group mode — the name field shows before a second pick);
 * `mode: "add"` adds members to an existing conversation (converting a DM → group), carrying the
 * target `conversationId` and the ids already in it so the picker can leave them out.
 */
export interface ContactPickerRequest {
	mode: "new" | "add";
	group?: boolean;
	conversationId?: string;
	existingIds?: readonly string[];
}
export const contactPicker = signal<ContactPickerRequest | null>(null);

/** Whether the Message Settings modal is open. */
export const settingsModalOpen = signal(false);

/** Open the New message picker — or, with `{ group: true }`, the New group picker. */
export function openNewConversation(options: { group?: boolean } = {}): void {
	contactPicker.value = { mode: "new", group: options.group === true };
}

/** Open the Add Members picker for an existing conversation (DM → group). */
export function openAddMembers(conversationId: string, existingIds: readonly string[] = []): void {
	contactPicker.value = { mode: "add", conversationId, existingIds };
}

/** Close the picker. */
export function closeContactPicker(): void {
	contactPicker.value = null;
}
