import type { ProfileKind, ProfileView } from "../types/profile-types.ts";

/**
 * owner-edit — where the owner's Preview (`/[handle]`) sends each block's edit link: the section of
 * `/[handle]/edit` that changes it, by its anchor (Decision #408), or the Availability page for the
 * hours. The editor draws its sections by the profile's kind (`ProfileEditModel.sections`, decided in
 * `live-profile.ts`); {@link editAnchorsFor} states the same rule, so a link never names a section the
 * editor does not draw.
 */

/** The anchors of `/[handle]/edit`'s sections, in the editor's order. */
export const EDIT_ANCHORS = [
	"showcase",
	"basics",
	"about",
	"location",
	"skills",
	"languages",
	"experience",
	"privacy",
] as const;
export type EditAnchor = typeof EDIT_ANCHORS[number];

/** What the Preview's blocks link to, for a profile the viewer owns. Plain data, so an island takes it. */
export interface OwnerEdit {
	/** The canonical `@handle`. */
	handle: string;
	/** The editor sections this profile has. */
	sections: EditAnchor[];
	/** Whether `/[handle]/edit/availability` applies — never for an under-18 account (Decision #208). */
	availability: boolean;
}

/** The editor sections a profile of `kind` has. */
export function editAnchorsFor(kind: ProfileKind): EditAnchor[] {
	const individual = kind === "client" || kind === "freelancer";
	return EDIT_ANCHORS.filter((anchor) => {
		switch (anchor) {
			case "about":
				return kind !== "enterprise";
			case "location":
				return kind !== "team";
			case "skills":
				return kind === "freelancer";
			case "languages":
			case "experience":
				return individual;
			default:
				return true;
		}
	});
}

/** The owner's edit links for `profile`, or `null` unless the database says the viewer owns it. */
export function ownerEditFor(
	profile: Pick<ProfileView, "handle" | "kind" | "viewer">,
	options: { scheduling: boolean },
): OwnerEdit | null {
	if (profile.viewer?.isOwner !== true) return null;
	const handle = profile.handle.startsWith("@") ? profile.handle : `@${profile.handle}`;
	return { handle, sections: editAnchorsFor(profile.kind), availability: options.scheduling };
}

/** `/[handle]/edit#<anchor>`, or `null` when there is no owner or the editor has no such section. */
export function editHrefFor(edit: OwnerEdit | null | undefined, anchor: EditAnchor): string | null {
	return edit?.sections.includes(anchor) ? `/${edit.handle}/edit#${anchor}` : null;
}

/** The owner's Availability page, or `null` where it does not apply. */
export function availabilityHrefFor(edit: OwnerEdit | null | undefined): string | null {
	return edit?.availability ? `/${edit.handle}/edit/availability` : null;
}
