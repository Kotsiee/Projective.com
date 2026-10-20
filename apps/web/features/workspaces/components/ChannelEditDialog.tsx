import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button, FormControl, InputText, Textarea } from "@projective/ui/fields";
import {
	CHANNEL_EMOJI_MAX,
	CHANNEL_TITLE_MAX,
	CHANNEL_TOPIC_MAX,
	channelLabel,
	type EntityChannel,
	type WorkspaceKind,
} from "@projective/types/workspace";
import type { GroupPhotoInput } from "@projective/types/messaging";
import { MediaCropPicker } from "@web/features/files/components/media-crop/MediaCropPicker.tsx";
import { MessagingService } from "@web/features/messaging/core/MessagingService.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	CHANNEL_EMOJI,
	channelEditChanged,
	type ChannelEditDraft,
	channelEditRefusals,
	channelMarkOf,
} from "../core/channel-model.ts";

const FORM_ID = "wsp-channel-edit";

/** Props for {@link ChannelEditDialog}. */
export interface ChannelEditDialogProps {
	kind: WorkspaceKind;
	/** The entity's row id. */
	entityId: string;
	channel: EntityChannel;
	/** The channel's conversation — the thread its photo is set on. */
	conversationId: string;
	visible: Signal<boolean>;
}

/**
 * ChannelEditDialog — Edit channel (Decision #308): its display name, its mark (an emoji, or an image
 * that wins over it) and its topic. The slug — the channel's address — is shown and never changes, so a
 * rename breaks no link.
 *
 * Save is the dialog's one structural fill (§B.8.1 tier 2) and writes name · topic · emoji in one
 * `update_entity_channel`. The image has its own pipeline — the `/messages` group photo's
 * `MediaCropPicker` cut server-side from the editor's own library — so it applies the moment it is
 * chosen, as a group photo does. Either write reloads the page, so the lane, the header and the panel
 * re-render from the one re-read. A refusal is said in place and changes nothing.
 */
export function ChannelEditDialog(props: ChannelEditDialogProps): JSX.Element {
	const { channel } = props;
	const name = useSignal(channel.name ?? "");
	const topic = useSignal(channel.topic ?? "");
	const emoji = useSignal(channel.emoji ?? "");
	const busy = useSignal(false);
	const photoOpen = useSignal(false);
	const refusal = useSignal<string | null>(null);
	const nameRef = useRef<HTMLDivElement>(null);

	const draft: ChannelEditDraft = { name: name.value, topic: topic.value, emoji: emoji.value };
	const problems = channelEditRefusals(draft);
	const changed = channelEditChanged(channel, draft);
	const mark = channelMarkOf({ avatar: channel.avatar, emoji: emoji.value.trim() || null });

	function close(): void {
		props.visible.value = false;
		name.value = channel.name ?? "";
		topic.value = channel.topic ?? "";
		emoji.value = channel.emoji ?? "";
		refusal.value = null;
	}

	async function submit(): Promise<void> {
		if (busy.value || Object.keys(problems).length > 0) return;
		if (!changed) {
			close();
			return;
		}
		busy.value = true;
		refusal.value = null;
		const res = await WorkspaceService.updateChannel({
			kind: props.kind,
			id: props.entityId,
			channelId: channel.id,
			name: name.value.trim(),
			topic: topic.value.trim(),
			emoji: emoji.value.trim(),
		});
		busy.value = false;
		if (!res.ok) {
			refusal.value = res.message ?? "The channel couldn't be saved. Nothing was changed.";
			return;
		}
		globalThis.location.reload();
	}

	/** Set or clear the channel's image; resolves the failure to show, or `null` once it applied. */
	async function savePhoto(photo: GroupPhotoInput | null): Promise<string | null> {
		const res = await MessagingService.setGroupPhoto(props.conversationId, photo);
		if (!res.ok) return res.message ?? "The image couldn't be changed. Try again.";
		globalThis.location.reload();
		return null;
	}

	return (
		<>
			<Dialog
				visible={props.visible}
				header="Edit channel"
				modal
				width="30rem"
				initialFocusRef={nameRef}
				onVisibleChange={(open) => {
					if (!open) close();
				}}
				footer={
					<div class="wsp-dialog__actions">
						<Button severity="secondary" variant="text" size="sm" label="Cancel" onClick={close} />
						<Button
							structural
							size="sm"
							type="submit"
							form={FORM_ID}
							label={busy.value ? "Saving…" : "Save changes"}
							loading={busy.value}
						/>
					</div>
				}
			>
				<form
					id={FORM_ID}
					class="wsp-dialog"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					{/* #region Mark — the image wins over the emoji, the emoji over the `#` */}
					<div class="wsp-chan-edit__mark">
						<span class="wsp-chan-mark wsp-chan-mark--lg" aria-hidden="true">
							{mark.kind === "photo"
								? <Avatar image={mark.src} label={channelLabel(channel)} size={48} shape="square" />
								: mark.kind === "emoji"
								? <span class="wsp-chan-mark__emoji">{mark.emoji}</span>
								: <span class="wsp-chan-mark__hash">#</span>}
						</span>
						<div class="wsp-chan-edit__mark-actions">
							<Button
								severity="secondary"
								variant="outlined"
								size="sm"
								icon={<Icon name="image" size="sm" />}
								label={channel.avatar ? "Change image" : "Upload image"}
								onClick={() => (photoOpen.value = true)}
							/>
							{channel.avatar && (
								<Button
									severity="secondary"
									variant="text"
									size="sm"
									label="Remove image"
									onClick={() =>
										void savePhoto(null).then((message) => {
											if (message) refusal.value = message;
										})}
								/>
							)}
						</div>
					</div>

					<FormControl
						label="Emoji"
						hintMode="inline"
						hint={channel.avatar
							? "The image shows while the channel has one."
							: "Shown in place of the #."}
						error={problems.emoji}
					>
						{({ id, describedBy }) => (
							<div class="wsp-chan-edit__emoji">
								<div class="wsp-chan-edit__grid" role="radiogroup" aria-label="Channel emoji">
									<button
										type="button"
										role="radio"
										class="wsp-chan-edit__swatch"
										aria-checked={emoji.value.trim() === ""}
										aria-label="No emoji"
										onClick={() => (emoji.value = "")}
									>
										#
									</button>
									{CHANNEL_EMOJI.map((e) => (
										<button
											key={e}
											type="button"
											role="radio"
											class="wsp-chan-edit__swatch"
											aria-checked={emoji.value.trim() === e}
											aria-label={e}
											onClick={() => (emoji.value = e)}
										>
											{e}
										</button>
									))}
								</div>
								<InputText
									id={id}
									aria-describedby={describedBy}
									value={emoji}
									onValueChange={() => (refusal.value = null)}
									placeholder="Or type any emoji"
									maxLength={CHANNEL_EMOJI_MAX}
									autoComplete="off"
									class="wsp-chan-edit__custom"
								/>
							</div>
						)}
					</FormControl>
					{/* #endregion */}

					<div ref={nameRef} class="wsp-dialog__field">
						<FormControl
							label="Name"
							hintMode="inline"
							hint={`Its address stays # ${channel.slug}, so links keep working.`}
							error={problems.name}
						>
							{({ id, describedBy }) => (
								<InputText
									id={id}
									aria-describedby={describedBy}
									value={name}
									onValueChange={() => (refusal.value = null)}
									placeholder={channel.slug}
									maxLength={CHANNEL_TITLE_MAX}
									autoComplete="off"
									block
								/>
							)}
						</FormControl>
					</div>

					<FormControl
						label="Description"
						hint="What the channel is for — optional."
						error={problems.topic}
					>
						{({ id, describedBy }) => (
							<Textarea
								id={id}
								aria-describedby={describedBy}
								value={topic}
								onValueChange={() => (refusal.value = null)}
								placeholder="Handoffs between design and build"
								rows={3}
								autoResize
								maxLength={CHANNEL_TOPIC_MAX}
							/>
						)}
					</FormControl>

					{refusal.value && <InlineNotice align="start" assertive text={refusal.value} />}
				</form>
			</Dialog>
			<MediaCropPicker
				open={photoOpen}
				requesterId="workspace-channel-photo"
				target="avatar"
				title="Channel image"
				saveLabel="Save image"
				onSave={([choice]) =>
					choice
						? savePhoto({ sourceAssetId: choice.sourceAssetId, crop: choice.crop })
						: Promise.resolve(null)}
			/>
		</>
	);
}
