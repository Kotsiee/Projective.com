import { profileHref } from "@features/explore/core/routing.ts";
import {
	currentPath,
	requestSignIn,
	type SignInIntent,
} from "@features/auth/core/sign-in-prompt.ts";
import { requestShare } from "@web/features/share/core/share-request.ts";
import { ProfileService } from "./ProfileService.ts";
import type { HireProject } from "./profile-model.ts";
import {
	consultOpen,
	flowOpener,
	followCelebrating,
	following,
	pickedProject,
	pickedService,
	quickMessageOpen,
	rigStatus,
	wizardOpen,
} from "./profile-state.ts";
import type { ProfileView, ServiceItem } from "../types/profile-types.ts";

/**
 * rig-actions — what the profile's action rig DOES, written once.
 *
 * The rig renders in two places — the hero, and the sticky header band that takes over once the
 * hero's controls have scrolled away — and every control in it is a claim on shared state: the
 * follow, the messenger, the four hire ⁄ assign flows whose modals the hero mounts exactly once.
 * Two rigs with two copies of these handlers is how "Hire" in one place comes to open a different
 * modal from "Hire" in the other, so both rigs call these and own nothing but their layout.
 *
 * Every account-bound action takes the viewer's {@link RigViewer} and gates a GUEST through the
 * sign-in prompt in place (the standard `/login` ⁄ `/join` flow with a return path to this profile)
 * rather than navigating them off the page they were reading.
 */

// #region Viewer
/** The facts every gated action needs. */
export interface RigViewer {
	/** Whether the viewer is signed in — a guest's press opens the sign-in prompt instead. */
	authed: boolean;
	/** The profile's display name, for the prompt's sentence and the announcements. */
	name: string;
	/** The profile's `@handle` — the address every write is made to. */
	handle: string;
	/**
	 * The OWNER previewing their own profile: the rig renders exactly as a visitor's, and a press
	 * explains what it does for visitors instead of acting on the owner's own account.
	 */
	preview?: boolean;
	/** Whether the viewer follows the profile, as the server answered it. */
	follows?: boolean;
}

/** What a previewing owner is told when they press a visitor's control. */
export const PREVIEW_NOTE =
	"You're previewing your profile as visitors see it. Visitors use this control to reach you.";

/**
 * Intercept a press that must not act: a previewing owner's (explained in the live region) and a
 * guest's account-bound one (the sign-in prompt). `true` when it was intercepted and the caller must
 * do nothing else.
 */
export function gate(viewer: RigViewer, intent: SignInIntent): boolean {
	if (viewer.preview) {
		announce(PREVIEW_NOTE, NOTE_TTL_MS);
		return true;
	}
	if (viewer.authed) return false;
	requestSignIn({ intent, returnTo: currentPath(), subject: viewer.name });
	return true;
}
// #endregion

// #region Announcements
const STATUS_TTL_MS = 2500;
/** A note about a saved photo or a sent assignment needs longer than a two-word acknowledgement. */
export const NOTE_TTL_MS = 8000;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Put a sentence in the rig's live region for a while. ONE region — the hero's — announces for both
 * rigs; a second `role="status"` in the band would read every acknowledgement twice.
 */
export function announce(text: string, ttl = STATUS_TTL_MS): void {
	rigStatus.value = text;
	clearTimeout(statusTimer);
	statusTimer = setTimeout(() => {
		rigStatus.value = "";
	}, ttl);
}
// #endregion

// #region Focus return
/**
 * Remember which control opened the flow about to start, so focus can come back to it when the
 * flow's modal closes. Every flow here is opened from a POPOVER ROW that closes with its popover
 * the moment it is picked, so the dialog's own restore finds nothing to return to (the Decision #68
 * defect) — the rig control that opened the popover is the honest landing.
 */
export function noteOpener(el: HTMLElement | null): void {
	flowOpener.current = el;
}
// #endregion

// #region Actions
/** Open the in-place messenger (a guest is prompted to sign in). */
export function openMessage(viewer: RigViewer): void {
	if (gate(viewer, "message")) return;
	quickMessageOpen.value = true;
}

/** A Hire popover row was picked: open the service modal for that listing. */
export function pickService(service: ServiceItem): void {
	pickedService.value = service;
}

/** The Hire popover's consultation row was picked. */
export function pickConsultation(): void {
	consultOpen.value = true;
}

/** An Add-to-project row was picked: open the assignment modal for that project. */
export function pickProject(project: HireProject): void {
	pickedProject.value = project;
}

/** The Add-to-project popover's Create row was picked (a guest is prompted to sign in). */
export function openWizard(viewer: RigViewer): void {
	if (gate(viewer, "hire")) return;
	wizardOpen.value = true;
}

const CELEBRATE_MS = 700;
let celebrateTimer: ReturnType<typeof setTimeout> | undefined;
let followInFlight = false;

/** Whether the viewer follows the profile — the client's change, else the server's answer. */
export function isFollowing(viewer: Pick<RigViewer, "follows">): boolean {
	return following.value ?? !!viewer.follows;
}

/**
 * Toggle the follow. Optimistic — the control flips at once — and then written; a refused or failed
 * write puts it back and says why. A follow (never an unfollow) plays the shared acknowledgement for
 * {@link CELEBRATE_MS}. A second press while the first is in flight is ignored rather than queued, so
 * a double-click cannot race two opposite writes.
 */
export function toggleFollow(viewer: RigViewer): void {
	if (gate(viewer, "follow") || followInFlight) return;
	const previous = isFollowing(viewer);
	const next = !previous;
	following.value = next;
	announce(next ? `Following ${viewer.name}` : `Unfollowed ${viewer.name}`);
	clearTimeout(celebrateTimer);
	followCelebrating.value = next;
	if (next) {
		celebrateTimer = setTimeout(() => {
			followCelebrating.value = false;
		}, CELEBRATE_MS);
	}
	followInFlight = true;
	void ProfileService.follow(viewer.handle, next).then((res) => {
		followInFlight = false;
		if (res.ok && res.data) {
			following.value = res.data.follows;
			return;
		}
		following.value = previous;
		followCelebrating.value = false;
		announce(res.message ?? "That didn't save. Try again.", NOTE_TTL_MS);
	});
}

/**
 * Share opens the platform-wide share modal (the `ShareHost` every shell mounts): the ranked people
 * picker, the external intents and Copy link in one place — the same sheet a listing or a project
 * card opens, so a profile is not the one thing on the site with a private share vocabulary.
 */
export function shareProfile(profile: Pick<ProfileView, "handle" | "name">): void {
	requestShare({ href: profileHref(profile.handle), title: profile.name, noun: "profile" });
}
// #endregion
