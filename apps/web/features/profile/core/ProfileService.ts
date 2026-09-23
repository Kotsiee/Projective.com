import { getProfile, sendProfile } from "./api.ts";
import type {
	ApplyMedia,
	ProfileEditModel,
	ProfileSavePatch,
	ProfileTab,
	ProfileTabPayload,
	ProfileView,
	SaveShowcase,
	ShowcaseSlot,
} from "@projective/types/profile";
import type { ImagePlaceholder } from "@projective/types/files";
import type { OwnerAvailability } from "@projective/types/scheduling";
import type { ProfileResult } from "../types/results.ts";

/**
 * ProfileService — the THIN client profile service.
 *
 * A dumb object of named methods; each builds a path and forwards to a `/api/profile/*` route,
 * returning a soft {@link ProfileResult}. No fixtures, no query logic, no scattered `fetch` — islands
 * call these while the fat {@link ProfileBackendService} owns all resolution, every write and every
 * refusal (mirrors ExploreService / AuthService). First paint is SSR-hydrated via props.
 */

/** The profile's media as the editor redraws it after a media write. */
export interface ProfileMediaState {
	avatar: { url: string; full?: string; placeholder?: ImagePlaceholder } | null;
	showcase: ShowcaseSlot[];
}

/** `/api/profile/<handle>` — the bare handle, so the path never carries an encoded `@`. */
function base(handle: string): string {
	return `/api/profile/${encodeURIComponent(handle.replace(/^@+/, ""))}`;
}

export const ProfileService = {
	/** The profile header/overview projection for a `@handle`. */
	overview(handle: string): Promise<ProfileResult<{ profile: ProfileView }>> {
		return getProfile<{ profile: ProfileView }>(base(handle));
	},

	/** One section's payload for a `@handle`. */
	tab(handle: string, tab: ProfileTab): Promise<ProfileResult<{ payload: ProfileTabPayload }>> {
		return getProfile<{ payload: ProfileTabPayload }>(`${base(handle)}?tab=${encodeURIComponent(tab)}`);
	},

	/** Save the owner-editable fields — only the sections in `patch`. Answers with the stored model. */
	save(handle: string, patch: ProfileSavePatch): Promise<ProfileResult<{ model: ProfileEditModel }>> {
		return sendProfile<{ model: ProfileEditModel }>(`${base(handle)}/save`, "POST", patch);
	},

	/** Put a library asset on the profile as its photo or into a showcase slot. */
	applyMedia(handle: string, input: ApplyMedia): Promise<ProfileResult<ProfileMediaState>> {
		return sendProfile<ProfileMediaState>(`${base(handle)}/media`, "POST", input);
	},

	/** Replace the whole showcase grid (empty a slot, move items, edit alt text). */
	saveShowcase(handle: string, input: SaveShowcase): Promise<ProfileResult<ProfileMediaState>> {
		return sendProfile<ProfileMediaState>(`${base(handle)}/showcase`, "PUT", input);
	},

	/** Save the owner's schedule + call settings. */
	saveAvailability(
		handle: string,
		value: OwnerAvailability,
	): Promise<ProfileResult<{ availability: OwnerAvailability; takesCalls: boolean }>> {
		return sendProfile<{ availability: OwnerAvailability; takesCalls: boolean }>(
			`${base(handle)}/availability`,
			"PUT",
			value,
		);
	},

	/** Follow or unfollow the profile. */
	follow(handle: string, follow: boolean): Promise<ProfileResult<{ follows: boolean; followers: number }>> {
		return sendProfile<{ follows: boolean; followers: number }>(`${base(handle)}/follow`, "POST", { follow });
	},
};
