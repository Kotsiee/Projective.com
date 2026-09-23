import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { ProgressiveImage } from "@projective/ui/display";
import type { ImagePlaceholder } from "@projective/types/files";

/**
 * AvatarLightbox — the profile photo at full size, for a visitor. Rendered only when the OWNER has
 * allowed it (`settings.allowAvatarExpand`, off by default): a face is the owner's to offer at a
 * size somebody could save, not the platform's.
 *
 * The large rendition is a square the pipeline cut for exactly this (the avatar's `lg` tier), so the
 * frame reserves a 1:1 box before it loads and the BlurHash paints beneath it meanwhile.
 */
export interface AvatarLightboxProps {
	open: Signal<boolean>;
	/** The full-size rendition. */
	src: string;
	placeholder?: ImagePlaceholder;
	name: string;
}

export function AvatarLightbox({ open, src, placeholder, name }: AvatarLightboxProps): JSX.Element {
	return (
		<Dialog
			visible={open}
			header={`${name}'s profile photo`}
			width="min(32rem, calc(100vw - 2rem))"
			class="pf-avatarbox"
		>
			<div class="pf-avatarbox__frame">
				<ProgressiveImage
					src={src}
					alt={`${name}'s profile photo`}
					placeholder={placeholder ?? null}
					fit="cover"
					decoding="async"
				/>
			</div>
		</Dialog>
	);
}
