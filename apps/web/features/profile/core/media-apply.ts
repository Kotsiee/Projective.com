import type { MediaCropChoice } from "@web/features/files/core/media/media-pick.ts";
import { broadcastAvatar } from "@web/utils/avatar-sync.ts";
import { type ProfileMediaState, ProfileService } from "./ProfileService.ts";

/** Where a picked picture is being put on a profile. */
export interface ProfileMediaTarget {
	handle: string;
	target: "avatar" | "showcase";
	position?: number;
	/** The person whose account avatar this is, when the profile is an individual's own. */
	avatarUserId?: string | null;
}

/** The outcome of applying a choice: the stored media, or the sentence the picker should show. */
export type ProfileMediaApplied =
	| { ok: true; state: ProfileMediaState }
	| { ok: false; message: string };

/**
 * Apply a File Picker choice to a profile (`POST /api/profile/[handle]/media` — the server cuts the
 * rendition from the library original with the same crop model), then announce a new personal photo
 * through `pj:avatar-changed` so every island on the page updates at once.
 */
export async function applyProfileMedia(
	where: ProfileMediaTarget,
	choice: MediaCropChoice,
): Promise<ProfileMediaApplied> {
	const res = await ProfileService.applyMedia(where.handle, {
		target: where.target,
		position: where.target === "showcase" ? where.position : undefined,
		sourceAssetId: choice.sourceAssetId,
		crop: choice.crop,
		alt: where.target === "showcase" ? choice.alt : undefined,
	});
	if (!res.ok || !res.data) {
		return { ok: false, message: res.message ?? "That couldn't be applied. Try again." };
	}
	if (where.target === "avatar" && where.avatarUserId && res.data.avatar) {
		broadcastAvatar(where.avatarUserId, res.data.avatar.url);
	}
	return { ok: true, state: res.data };
}
