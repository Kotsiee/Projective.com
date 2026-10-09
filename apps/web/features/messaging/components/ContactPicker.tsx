import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Avatar } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { CONVERSATION_PICTURE_FALLBACK_URL } from "@projective/types/messaging";
import { MediaCropPicker } from "@web/features/files/components/media-crop/MediaCropPicker.tsx";
import type { MediaCropChoice } from "@web/features/files/core/media/media-pick.ts";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import { ContactList } from "./ContactList.tsx";
import { useContactSearch } from "../hooks/useContactSearch.ts";
import type { GroupPhotoInput, RankedContact } from "../types/messaging-types.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * ContactPicker — the body of the New message / New group / Add members modal. It renders the
 * ranked {@link ContactList} (suggestions grouped by relationship, a global search once the viewer
 * types), a chip row of the people picked so far, and — for a group — a photo and a name field. The
 * photo is chosen in the shared media crop dialog (the viewer's own library + Upload, cropped 1:1)
 * and travels with the create; nothing is stored until the group is.
 *
 * What a confirm MEANS is the caller's: one contact starts (or reopens) a DM, several start a group,
 * and in `add` mode every pick joins the existing conversation. The picker only collects the
 * selection and reports it, awaiting the caller so the confirm button can show a pending state and
 * a failure can be shown HERE, beside the selection that produced it, rather than closing on a
 * silent no-op.
 *
 * Selected people are remembered by the picker itself rather than looked up in the current list:
 * a search replaces the rows, and a chip for somebody picked before the search must not vanish
 * with them.
 */

// #region Props
export interface ContactPickerProps {
	mode: "new" | "add";
	/** Open straight into group mode — the name field shows before a second pick. */
	group?: boolean;
	/** Ids already in the conversation (left out of the list) — `add` mode. */
	existingIds?: readonly string[];
	/**
	 * Fired with the picked ids (+ the group name and photo when they apply). May return a message to
	 * show beside the selection; `null` means the caller handled it (navigated, closed).
	 */
	onConfirm: (
		contactIds: string[],
		groupName?: string,
		groupPhoto?: GroupPhotoInput,
	) => Promise<string | null>;
	onCancel: () => void;
}
// #endregion

export function ContactPicker(props: ContactPickerProps): JSX.Element {
	const search = useContactSearch({ exclude: props.existingIds });
	const picked = useSignal<RankedContact[]>([]);
	const groupName = useSignal("");
	const groupPhoto = useSignal<MediaCropChoice | null>(null);
	const photoOpen = useSignal(false);
	const submitting = useSignal(false);
	const submitError = useSignal<string | null>(null);
	const live = useRef(true);
	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
		};
	}, []);

	const selectedIds = useComputed(() => picked.value.map((c) => c.id));
	const isGroup = useComputed(() =>
		props.mode === "new" && (props.group === true || picked.value.length > 1)
	);
	const canConfirm = useComputed(() => picked.value.length > 0 && !submitting.value);

	function toggle(id: string): void {
		const current = picked.value;
		if (current.some((c) => c.id === id)) {
			picked.value = current.filter((c) => c.id !== id);
			return;
		}
		const contact = search.contacts.value.find((c) => c.id === id);
		if (contact) picked.value = [...current, contact];
	}

	async function submit(): Promise<void> {
		if (!canConfirm.value) return;
		submitting.value = true;
		submitError.value = null;
		const photo = isGroup.value ? groupPhoto.value : null;
		const message = await props.onConfirm(
			selectedIds.value,
			isGroup.value ? groupName.value.trim() || undefined : undefined,
			photo ? { sourceAssetId: photo.sourceAssetId, crop: photo.crop } : undefined,
		);
		if (!live.current) return;
		submitting.value = false;
		if (message) submitError.value = message;
	}

	const confirmLabel = props.mode === "add"
		? "Add to conversation"
		: isGroup.value
		? "Create group"
		: "Start conversation";

	const emptyNote = props.mode === "add"
		? "Nobody else to suggest yet. Search by name or @handle to find someone."
		: undefined;

	return (
		<div class="msg-picker" data-mode={props.mode}>
			{/* Selected chips — remembered here, so a search cannot take them away. */}
			{picked.value.length > 0 && (
				<ul class="msg-picker__chips" aria-label="Selected">
					{picked.value.map((c) => (
						<li key={c.id} class="msg-picker__chip">
							<UserAvatar image={c.avatar ?? undefined} label={c.name} size={20} shape="circle" />
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

			{/* A group's photo + name — shown as soon as this IS a group, never after the fact. */}
			{isGroup.value && (
				<div class="msg-picker__identity">
					<button
						type="button"
						class="msg-picker__photo"
						aria-label={groupPhoto.value ? "Change group photo" : "Add a group photo"}
						onClick={() => (photoOpen.value = true)}
					>
						<Avatar
							image={groupPhoto.value?.previewUrl}
							fallbackImage={CONVERSATION_PICTURE_FALLBACK_URL}
							label={groupName.value.trim() || "Group"}
							size={40}
							shape="square"
						/>
						<span class="msg-picker__photo-badge" aria-hidden="true">
							<Icon name="image" size="sm" />
						</span>
					</button>
					<input
						type="text"
						class="msg-picker__group-name"
						placeholder="Group name (optional)"
						value={groupName.value}
						aria-label="Group name"
						maxLength={80}
						onInput={(e) => (groupName.value = (e.target as HTMLInputElement).value)}
					/>
					{groupPhoto.value && (
						<Button
							label="Remove photo"
							variant="text"
							severity="secondary"
							size="sm"
							onClick={() => (groupPhoto.value = null)}
						/>
					)}
				</div>
			)}
			<MediaCropPicker
				open={photoOpen}
				requesterId="messaging-new-group-photo"
				target="avatar"
				title="Group photo"
				saveLabel="Use photo"
				onSave={([choice]) => {
					groupPhoto.value = choice ?? null;
					return Promise.resolve(null);
				}}
			/>

			<ContactList
				search={search}
				selected={selectedIds.value}
				onToggle={toggle}
				label={props.mode === "add" ? "People to add" : "People to message"}
				emptyNote={emptyNote}
				autoFocus
			/>

			{/* A failed create is reported here, where the viewer's selection still is. */}
			{submitError.value && <p class="msg-picker__failed-title" role="alert">{submitError.value}
			</p>}

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
					disabled={!canConfirm.value}
					loading={submitting.value}
					onClick={() => void submit()}
				/>
			</div>
		</div>
	);
}
