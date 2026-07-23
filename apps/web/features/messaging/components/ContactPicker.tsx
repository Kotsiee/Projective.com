import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import { MessagingService } from "../core/MessagingService.ts";
import type { MessagingContact, MessagingRole } from "../types/messaging-types.ts";

/**
 * ContactPicker — the body of the New Conversation / Add Members modal (task §2B). It loads the viewer's
 * connections/following (the fat service's contact list), supports free-text search + multi-select, and
 * confirms: one selected contact starts a DM; several start (or extend into) a group chat. In `add` mode
 * it excludes contacts already in the conversation and confirms an "Add members" (DM → group).
 */

// #region Props
export interface ContactPickerProps {
	role?: MessagingRole;
	mode: "new" | "add";
	/** Ids already in the conversation (excluded from the list) — `add` mode. */
	existingIds?: string[];
	/** Fired with the picked ids (+ optional group name for a multi-pick). */
	onConfirm: (contactIds: string[], groupName?: string) => void;
	onCancel: () => void;
}
// #endregion

export function ContactPicker(props: ContactPickerProps): JSX.Element {
	const contacts = useSignal<MessagingContact[]>([]);
	const loading = useSignal(true);
	const query = useSignal("");
	const selected = useSignal<string[]>([]);
	const groupName = useSignal("");

	useEffect(() => {
		let live = true;
		MessagingService.contacts(props.role).then((res) => {
			if (!live) return;
			const exclude = new Set(props.existingIds ?? []);
			contacts.value = (res.ok && res.data ? res.data.contacts.contacts : []).filter((c) =>
				!exclude.has(c.id)
			);
			loading.value = false;
		});
		return () => {
			live = false;
		};
	}, []);

	const needle = query.value.trim().toLowerCase();
	const shown = needle
		? contacts.value.filter((c) =>
			c.name.toLowerCase().includes(needle) || (c.handle ?? "").toLowerCase().includes(needle)
		)
		: contacts.value;

	const selectedContacts = selected.value
		.map((id) => contacts.value.find((c) => c.id === id))
		.filter((c): c is MessagingContact => !!c);

	function toggle(id: string): void {
		const set = new Set(selected.value);
		if (set.has(id)) set.delete(id);
		else set.add(id);
		selected.value = [...set];
	}

	const isMulti = selected.value.length > 1;
	const canConfirm = selected.value.length > 0;
	const confirmLabel = props.mode === "add"
		? "Add to conversation"
		: isMulti
		? "Start group chat"
		: "Start conversation";

	return (
		<div class="msg-picker">
			{/* Selected chips. */}
			{selectedContacts.length > 0 && (
				<ul class="msg-picker__chips" aria-label="Selected">
					{selectedContacts.map((c) => (
						<li key={c.id} class="msg-picker__chip">
							<Avatar image={c.avatar ?? undefined} label={c.name} size={20} shape="circle" />
							<span class="msg-picker__chip-name">{c.name}</span>
							<button
								type="button"
								class="msg-picker__chip-remove"
								aria-label={`Remove ${c.name}`}
								onClick={() => toggle(c.id)}
							>
								<MessagingIcon name="close" />
							</button>
						</li>
					))}
				</ul>
			)}

			{/* Search. */}
			<div class="msg-picker__search">
				<span class="msg-picker__search-icon" aria-hidden="true">
					<MessagingIcon name="search" />
				</span>
				<input
					type="search"
					class="msg-picker__search-input"
					placeholder="Search connections…"
					value={query.value}
					aria-label="Search connections"
					onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
				/>
			</div>

			{/* Optional group name for a multi-pick. */}
			{isMulti && (
				<input
					type="text"
					class="msg-picker__group-name"
					placeholder="Group name (optional)"
					value={groupName.value}
					aria-label="Group name"
					onInput={(e) => (groupName.value = (e.target as HTMLInputElement).value)}
				/>
			)}

			{/* Contact list. */}
			<div
				class="msg-picker__list"
				role="listbox"
				aria-multiselectable="true"
				aria-label="Contacts"
			>
				{loading.value
					? <p class="msg-picker__empty">Loading contacts…</p>
					: shown.length === 0
					? <p class="msg-picker__empty">No matching contacts.</p>
					: (
						shown.map((c) => {
							const on = selected.value.includes(c.id);
							return (
								<button
									key={c.id}
									type="button"
									role="option"
									aria-selected={on}
									class="msg-picker__row"
									data-on={on ? "true" : undefined}
									onClick={() => toggle(c.id)}
								>
									<Avatar image={c.avatar ?? undefined} label={c.name} size={34} shape="circle" />
									<span class="msg-picker__row-text">
										<span class="msg-picker__row-name">{c.name}</span>
										{c.context && <span class="msg-picker__row-context">{c.context}</span>}
									</span>
									<span class="msg-picker__row-check" aria-hidden="true">
										{on && <MessagingIcon name="check" />}
									</span>
								</button>
							);
						})
					)}
			</div>

			{/* Actions. */}
			<div class="msg-picker__actions">
				<button type="button" class="msg-btn msg-btn--ghost" onClick={props.onCancel}>
					Cancel
				</button>
				<button
					type="button"
					class="msg-btn msg-btn--primary"
					disabled={!canConfirm}
					onClick={() =>
						props.onConfirm(
							selected.value,
							isMulti ? groupName.value.trim() || undefined : undefined,
						)}
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	);
}
