import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
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
	/**
	 * Fired with the picked ids (+ optional group name for a multi-pick). May return a promise; the
	 * picker awaits it so the confirm button can show a pending state and a failure can be reported
	 * here rather than closing the modal on a silent no-op.
	 */
	onConfirm: (contactIds: string[], groupName?: string) => void | Promise<string | null>;
	onCancel: () => void;
}
// #endregion

export function ContactPicker(props: ContactPickerProps): JSX.Element {
	const contacts = useSignal<MessagingContact[]>([]);
	const loading = useSignal(true);
	const error = useSignal<string | null>(null);
	const submitting = useSignal(false);
	const submitError = useSignal<string | null>(null);
	const query = useSignal("");
	const selected = useSignal<string[]>([]);
	const groupName = useSignal("");

	function load(): void {
		loading.value = true;
		error.value = null;
		MessagingService.contacts(props.role).then((res) => {
			if (!live.current) return;
			// A failed fetch must NOT fall through to `[]` — that renders as "No matching contacts",
			// which is indistinguishable from a genuinely empty list and tells the viewer something
			// untrue about their own account.
			if (res.ok && res.data) {
				const exclude = new Set(props.existingIds ?? []);
				contacts.value = res.data.contacts.contacts.filter((c) => !exclude.has(c.id));
			} else {
				error.value = res.message ?? "Couldn't load your contacts.";
			}
			loading.value = false;
		});
	}

	const live = useRef(true);
	useEffect(() => {
		live.current = true;
		load();
		return () => {
			live.current = false;
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
	const canConfirm = selected.value.length > 0 && !submitting.value;

	/** Confirm, awaiting the caller so the button can show pending and a failure can be shown here. */
	async function submit(): Promise<void> {
		if (selected.value.length === 0) return;
		submitting.value = true;
		submitError.value = null;
		const message = await props.onConfirm(
			selected.value,
			isMulti ? groupName.value.trim() || undefined : undefined,
		);
		if (!live.current) return;
		submitting.value = false;
		if (message) submitError.value = message;
	}

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
					: error.value
					? (
						<div class="msg-picker__failed" role="alert">
							<p class="msg-picker__failed-title">{error.value}</p>
							<Button
								label="Try again"
								variant="outlined"
								severity="secondary"
								size="sm"
								onClick={load}
							/>
						</div>
					)
					: shown.length === 0
					? (
						<p class="msg-picker__empty">
							{needle ? "No contacts match that search." : "You have no contacts to message yet."}
						</p>
					)
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

			{/* A failed create is reported here, where the viewer's selection still is. */}
			{submitError.value && <p class="msg-picker__failed-title" role="alert">{submitError.value}
			</p>}

			{/* Actions — the shared system Button, not a feature-local button family. */}
			<div class="msg-picker__actions">
				<Button
					label="Cancel"
					variant="text"
					severity="secondary"
					disabled={submitting.value}
					onClick={props.onCancel}
				/>
				<Button
					label={confirmLabel}
					disabled={!canConfirm}
					loading={submitting.value}
					onClick={() => void submit()}
				/>
			</div>
		</div>
	);
}
