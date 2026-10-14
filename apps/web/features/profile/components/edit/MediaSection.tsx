import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar, moveSlots } from "@projective/ui/display";
import { ConfirmDialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { ShowcaseSlot } from "@projective/types/profile";
import { MediaCropPicker } from "@web/features/files/components/media-crop/MediaCropPicker.tsx";
import { ShowcaseSlots } from "@web/features/files/components/showcase/ShowcaseSlots.tsx";
import type { MediaCropChoice } from "@web/features/files/core/media/media-pick.ts";
import { type ProfileMediaState, ProfileService } from "../../core/ProfileService.ts";
import { applyProfileMedia } from "../../core/media-apply.ts";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";

/**
 * MediaSection — the profile photo and the six-slot showcase grid, as the owner edits them.
 *
 * Media writes are IMMEDIATE, not part of the page's Save: applying a picture cuts a public rendition
 * on the server, so there is nothing to hold in a draft — the grid redraws from what the server says
 * is now stored. The showcase is the shared {@link ShowcaseSlots} grid, so every slot opens the File
 * Picker in media mode, and slots reorder by drag or keyboard. Slot 1 is the thumbnail every card,
 * search result and listing of this profile leads with, so it only ever takes a still.
 *
 * A new profile photo is BROADCAST (`@web/utils/avatar-sync.ts`) so the account button and every other
 * picture of this person already on the page update without a reload.
 */
export interface MediaSectionProps {
	handle: string;
	name: string;
	/** Whether this profile is a person — only a person's photo is also their account avatar. */
	individual: boolean;
	userId: string;
	initial: ProfileMediaState;
	/** Say something in the editor's live region. */
	onNotice: (text: string) => void;
}

export function MediaSection(props: MediaSectionProps): JSX.Element {
	const { handle, name, onNotice } = props;
	const media = useSignal<ProfileMediaState>(props.initial);
	const avatarOpen = useSignal(false);
	const removing = useSignal<number | null>(null);
	const confirmOpen = useSignal(false);
	const busy = useSignal(false);

	async function apply(
		target: "avatar" | "showcase",
		choices: MediaCropChoice[],
	): Promise<string | null> {
		const done: number[] = [];
		for (const choice of choices) {
			const res = await applyProfileMedia({
				handle,
				target,
				position: choice.position,
				avatarUserId: props.individual ? props.userId : null,
			}, choice);
			if (!res.ok) {
				if (done.length > 0) onNotice(`Showcase slots ${done.join(", ")} updated.`);
				return res.message;
			}
			media.value = res.state;
			if (choice.position) done.push(choice.position);
		}
		onNotice(
			target === "avatar"
				? "Profile photo updated."
				: done.length === 1
				? `Showcase slot ${done[0]} updated.`
				: `Showcase slots ${done.join(", ")} updated.`,
		);
		return null;
	}

	async function save(slots: readonly ShowcaseSlot[]) {
		return await ProfileService.saveShowcase(handle, {
			slots: slots.map((s) => ({ position: s.position, fileId: s.fileId, alt: s.alt })),
		});
	}

	async function reorder(from: number, to: number): Promise<void> {
		if (busy.peek()) return;
		busy.value = true;
		const res = await save(moveSlots(media.peek().showcase, from, to));
		busy.value = false;
		if (!res.ok || !res.data) {
			onNotice(res.message ?? "That move couldn't be saved.");
			return;
		}
		media.value = res.data;
		onNotice(`Showcase slot ${from} moved to slot ${to}.`);
	}

	function askRemove(position: number): void {
		removing.value = position;
		confirmOpen.value = true;
	}

	async function remove(): Promise<void> {
		const position = removing.peek();
		if (position === null || busy.peek()) return;
		busy.value = true;
		const res = await save(media.peek().showcase.filter((s) => s.position !== position));
		busy.value = false;
		removing.value = null;
		if (!res.ok || !res.data) {
			onNotice(res.message ?? "That slot couldn't be emptied.");
			return;
		}
		media.value = res.data;
		onNotice(`Showcase slot ${position} emptied.`);
	}

	const avatar = media.value.avatar;

	return (
		<div class="pf-edit__media">
			<div class="pf-edit__avatar">
				<Avatar
					image={avatar?.url}
					fallbackImage={props.individual ? DEFAULT_AVATAR_URL : undefined}
					placeholder={avatar?.placeholder}
					label={name}
					size={96}
					shape="circle"
				/>
				<div class="pf-edit__avatartext">
					<p class="pf-edit__fieldname">Profile photo</p>
					<p class="pf-edit__hint">Shown in a circle everywhere your name appears.</p>
					<Button
						size="sm"
						variant="outlined"
						class="pf-edit__btn"
						icon={<Icon name="image" size="sm" />}
						onClick={() => (avatarOpen.value = true)}
					>
						{avatar ? "Change photo" : "Add photo"}
					</Button>
				</div>
			</div>

			<div class="pf-edit__showcase">
				<p class="pf-edit__fieldname">Showcase</p>
				<p class="pf-edit__hint">
					Up to six pictures or videos at the top of your profile. The first is your thumbnail on
					cards and in search, so it's always a picture.
				</p>
				<ShowcaseSlots
					requesterId="profile-edit-showcase"
					slots={media.value.showcase}
					coverLabel="1 · Thumbnail"
					coverName="thumbnail"
					onSave={(choices) => apply("showcase", choices)}
					onRemove={askRemove}
					onReorder={(from, to) => void reorder(from, to)}
				/>
			</div>

			<MediaCropPicker
				open={avatarOpen}
				requesterId="profile-edit-media"
				target="avatar"
				offerSignInPicture={props.individual}
				onSave={(choices) => apply("avatar", choices)}
			/>
			<ConfirmDialog
				visible={confirmOpen}
				header="Empty this slot?"
				message="The picture leaves your profile. It stays in your library, so you can put it back."
				acceptLabel="Remove"
				rejectLabel="Keep"
				acceptSeverity="danger"
				onAccept={() => void remove()}
				onReject={() => (removing.value = null)}
			/>
		</div>
	);
}
