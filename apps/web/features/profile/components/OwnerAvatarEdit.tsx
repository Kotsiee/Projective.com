import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import type { ImagePlaceholder } from "@projective/types/files";
import { MediaCropPicker } from "@web/features/files/components/media-crop/MediaCropPicker.tsx";
import type { MediaCropChoice } from "@web/features/files/core/media/media-pick.ts";
import { applyProfileMedia } from "../core/media-apply.ts";

/**
 * OwnerAvatarEdit — the profile owner's photo in the `/[handle]` hero, with the one edit affordance
 * Preview carries: hovering (or focusing) the photo reveals an edit overlay, and pressing it opens the
 * File Picker in avatar mode. A saved photo replaces this disc at once and is broadcast through
 * `pj:avatar-changed`, so the account button and the sticky band follow without a reload.
 */
export interface OwnerAvatarEditProps {
	handle: string;
	name: string;
	image: string | undefined;
	placeholder?: ImagePlaceholder;
	fallbackImage: string | undefined;
	/** The account whose avatar this is, when the profile is a person's own; `null` for a team. */
	avatarUserId: string | null;
	size: number;
	class?: string;
}

export function OwnerAvatarEdit(props: OwnerAvatarEditProps): JSX.Element {
	const open = useSignal(false);
	const current = useSignal(props.image);
	const placeholder = useSignal(props.placeholder);

	async function save([choice]: MediaCropChoice[]): Promise<string | null> {
		if (!choice) return null;
		const res = await applyProfileMedia({
			handle: props.handle,
			target: "avatar",
			avatarUserId: props.avatarUserId,
		}, choice);
		if (!res.ok) return res.message;
		current.value = res.state.avatar?.url ?? current.peek();
		placeholder.value = res.state.avatar?.placeholder ?? undefined;
		return null;
	}

	return (
		<>
			<button
				type="button"
				class="pf-hero__avatarbtn pf-hero__avatarbtn--edit"
				aria-label={current.value ? "Change your profile photo" : "Add a profile photo"}
				aria-haspopup="dialog"
				aria-expanded={open.value ? "true" : "false"}
				onClick={() => (open.value = true)}
			>
				<Avatar
					image={current.value}
					fallbackImage={props.fallbackImage}
					placeholder={placeholder.value}
					label={props.name}
					size={props.size}
					shape="circle"
					class={props.class}
				/>
				<span class="pf-hero__avataroverlay" aria-hidden="true">
					<Icon name="edit" size="sm" />
				</span>
			</button>
			<MediaCropPicker
				open={open}
				requesterId="profile-hero-avatar"
				target="avatar"
				offerSignInPicture={props.avatarUserId !== null}
				onSave={save}
			/>
		</>
	);
}
