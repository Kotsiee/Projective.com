import type { ProfileKind, ProfileView } from "../types/profile-types.ts";

/**
 * owner-edit — what the owner may change in place on `/[handle]` (Decision #439): the blocks this
 * profile's kind has, each named by the anchor that opens its inline editor (`/[handle]#skills`). The
 * save path draws the same line (`ProfileEditModel.sections`, decided in `live-profile.ts`), so a
 * block never offers an editor whose save would be refused.
 *
 * Account-level settings — visibility, the display switches, the handle — are not blocks: they live
 * in Settings, which the owner's page opens as the contextual modal.
 */

/** The owner's editable blocks, in page order. */
export const EDIT_ANCHORS = [
	"showcase",
	"basics",
	"about",
	"location",
	"availability",
	"skills",
	"languages",
	"work",
	"experience",
] as const;
export type EditAnchor = typeof EDIT_ANCHORS[number];

/** The legacy editor anchor that now opens Settings → Profile (`/[handle]/edit#privacy` 308s here). */
export const SETTINGS_ANCHOR = "privacy";

/** What the owner may edit on their page. Plain data, so an island takes it. */
export interface OwnerEdit {
	/** The canonical `@handle`. */
	handle: string;
	kind: ProfileKind;
	/** The blocks this profile has. */
	sections: EditAnchor[];
}

/**
 * The blocks a profile of `kind` has. Availability is withheld from an under-18 account, which
 * publishes no hours (Decision #208); the portfolio is a freelancer's alone (`org.portfolios` hangs
 * off the freelancer row).
 */
export function editAnchorsFor(kind: ProfileKind, options: { scheduling: boolean }): EditAnchor[] {
	const individual = kind === "client" || kind === "freelancer";
	return EDIT_ANCHORS.filter((anchor) => {
		switch (anchor) {
			case "about":
				return kind !== "enterprise";
			case "location":
				return kind !== "team";
			case "availability":
				return options.scheduling;
			case "skills":
			case "work":
				return kind === "freelancer";
			case "languages":
			case "experience":
				return individual;
			default:
				return true;
		}
	});
}

/** The owner's edit rights on `profile`, or `null` unless the database says the viewer owns it. */
export function ownerEditFor(
	profile: Pick<ProfileView, "handle" | "kind" | "viewer">,
	options: { scheduling: boolean },
): OwnerEdit | null {
	if (profile.viewer?.isOwner !== true) return null;
	const handle = profile.handle.startsWith("@") ? profile.handle : `@${profile.handle}`;
	return { handle, kind: profile.kind, sections: editAnchorsFor(profile.kind, options) };
}

/** Whether the owner may edit `anchor` here; always `false` for a visitor. */
export function canEditBlock(edit: OwnerEdit | null | undefined, anchor: EditAnchor): boolean {
	return edit?.sections.includes(anchor) ?? false;
}

/** The block a location hash names (`#skills` → `skills`), or `null`. */
export function anchorOfHash(hash: string): EditAnchor | null {
	const name = hash.replace(/^#/, "");
	return (EDIT_ANCHORS as readonly string[]).includes(name) ? name as EditAnchor : null;
}

/** `/@handle#anchor` — the address that opens one block's editor on the owner's own page. */
export function ownerBlockHref(handle: string, anchor: EditAnchor): string {
	const bare = handle.replace(/^@+/, "");
	return anchor === "experience" ? `/@${bare}/experience#experience` : `/@${bare}#${anchor}`;
}
