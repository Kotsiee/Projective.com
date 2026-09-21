import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { Toast, Tooltip, useToast } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { PublicCallOffer } from "@projective/types/scheduling";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import SignInPrompt from "@features/auth/islands/SignInPrompt.island.tsx";
import { MigratingBack } from "@features/shell/components/MigratingBack.tsx";
import { EXPLORE_FALLBACK } from "@features/explore/core/explore-history.ts";
import { BookingService } from "@features/view/core/BookingService.ts";
import { useBookingSeam } from "@features/view/core/booking-seam.ts";
// The service modal's preview renders the `/view` page's own parts and the booking modals reuse its
// date rail + slot picker, so both sheets must ride THIS island's bundle (§C.1 — a sheet reached only
// through a server component never ships). `explore.css` carries the `.ex-status` rules the seller
// line's earned signals render with.
import "@features/explore/styles/explore.css";
import "@features/view/styles/entity-view.css";
import "@features/view/styles/service-booking.css";
import "../styles/profile.css";
import "../styles/profile-hire.css";
import { AvatarEditor } from "../components/AvatarEditor.tsx";
import { ProfileMetrics } from "../components/ProfileMetrics.tsx";
import { ProfileRig } from "../components/ProfileRig.tsx";
import { ProfileShowcase } from "../components/ProfileShowcase.tsx";
import { ENTITY_META, TIER_META } from "../components/profile-glyphs.tsx";
import ConsultationModal from "../components/hire/ConsultationModal.tsx";
import CreateProjectWizard from "../components/hire/CreateProjectWizard.tsx";
import ProjectAssignModal from "../components/hire/ProjectAssignModal.tsx";
import ServiceDetailModal from "../components/hire/ServiceDetailModal.tsx";
import { type EstimatedSpend, type HireProject, isSellerKind } from "../core/profile-model.ts";
import { announce, NOTE_TTL_MS } from "../core/rig-actions.ts";
import {
	addMenuOpen,
	consultOpen,
	editedAvatar,
	editedShowcase,
	hireMenuOpen,
	liveConsultation,
	pickedProject,
	pickedService,
	wizardOpen,
} from "../core/profile-state.ts";
import { withPrimaryImage } from "../core/showcase-model.ts";
import { useMigratingHeader } from "@features/shell/hooks/useMigratingHeader.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { useReturnFocus } from "../hooks/useReturnFocus.ts";
import type { ProfileView, ServiceItem } from "../types/profile-types.ts";
import ProfileMessagePopover from "./ProfileMessagePopover.island.tsx";

/**
 * ProfileHero — the split hero of the `/[handle]` profile: the identity column (the contextual Back
 * control · 72px avatar · name + trust crest · `@handle` and entity kind · the action rig · the
 * inline metrics strip) beside the showcase frame, which is simply absent — no placeholder — when
 * the profile has no showreel or cover.
 *
 * # The rig (root CLAUDE.md §8 Decision #108) is shared, and the flows are mounted HERE
 *
 * The controls are the {@link ProfileRig} — the same component the sticky header band renders once
 * the hero has scrolled away — and what they do lives in `core/rig-actions.ts`. This island is
 * where the flows those controls open are MOUNTED, exactly once: the {@link ServiceDetailModal}, the
 * {@link ProjectAssignModal}, the {@link ConsultationModal} and the {@link CreateProjectWizard} all
 * open on the shared signals in `core/profile-state.ts`, so a Hire row picked in the band's popover
 * opens the same modal a row picked here does, with no second copy of the buyer's inputs.
 *
 * # The scroll probe lives on the rig
 *
 * The shell's shared `useMigratingHeader` watches the action row: the moment its bottom edge scrolls
 * under the line the header band pins to, the band reveals with the same identity and the same rig —
 * so the controls the reader just lost come back where they went, and the two copies of the filled
 * Hire are never on screen together (§B.8.2, mutually exclusive by render condition). The same write
 * withdraws the hero's Back control as the band's copy enters (`MigratingBack`), so there is one way
 * out at every scroll position — the rule the entity view runs on its hero.
 *
 * # A guest is intercepted, not bounced
 *
 * Hire, Follow, Message and every modal primary are claims on the reader's own account. For a
 * signed-out visitor they open the {@link SignInPrompt} — the standard `/login` ⁄ `/join` flow
 * with a `redirectTo` back to this profile — rather than navigating away from the page they were
 * reading. Hire itself still RENDERS for a guest (a control that only appears after signing in is
 * one a guest never learns exists), but its press opens the prompt in place of the listings
 * popover; the modals a member reaches through that popover gate their own primaries the same way.
 *
 * # The consultation offer follows the developer seam
 *
 * The SSR paint carries the server's call offer; the `callOffer` axis of the Dev Context Switcher
 * is a CLIENT seam the server never saw, so the hero re-reads the offer through
 * `/api/services/call-offer` whenever the seam changes (the `BookingPanels` precedent) and writes
 * the answer to the shared `liveConsultation` signal, so BOTH rigs' consultation rows appear or
 * withdraw with it — no reload.
 *
 * An owner changes the profile photo through the {@link AvatarEditor} — the avatar itself is the
 * trigger — and the showcase's primary still through the Asset Picker; each edit lands in a shared
 * `edited*` signal so any other island drawing the same image agrees. Optimistic and session-local,
 * pending the profile write path.
 */
export interface ProfileHeroProps {
	profile: ProfileView;
	/** Whether the viewer owns this profile (swaps the rig for Settings ⁄ Share + the image pickers). */
	canEdit: boolean;
	/** Whether the viewer is signed in — a guest's account-bound presses open the sign-in prompt. */
	authed: boolean;
	/** The seller's active listings — the Hire popover's rows. */
	services: ServiceItem[];
	/** The seller's public call offer, or `null` when they take no calls — the popover's footer row. */
	consultation: PublicCallOffer | null;
	/** The estimated spend floor across those listings, for the metrics strip. */
	spend: EstimatedSpend | null;
	/** The VIEWER's open projects — the Add-to-project popover's rows. `[]` for a guest. */
	hireProjects: HireProject[];
	/** The viewer's resolved money context — what a project created here is seeded in. */
	defaultCurrency: string;
	/** The viewer's active workspace id → a created project's `scopeId`. */
	scopeId: string;
}

const PICKER_ID = "profile-image";

export default function ProfileHero(props: ProfileHeroProps): JSX.Element {
	const { profile, canEdit, authed, services, spend, hireProjects, defaultCurrency, scopeId } =
		props;
	const avatar = editedAvatar.value ?? profile.avatar;
	const showcase = withPrimaryImage(
		profile.showcase,
		editedShowcase.value,
		`${profile.name} — showcase`,
	);
	const bareHandle = profile.handle.replace(/^@+/, "");
	const editorOpen = useSignal(false);
	/**
	 * The toast stack the assignment flow reports into. Mounted lazily and only when no other island
	 * has put one up: every `<Toast>` renders the SAME module-level list, so a second stack at another
	 * anchor would draw every toast twice (the `ProjectNoticeHost` precedent).
	 */
	const toastMounted = useSignal(false);
	const toast = useToast();
	/** The live call offer — the server's until the developer seam re-reads it. */
	const consultation = liveConsultation.value === undefined
		? props.consultation
		: liveConsultation.value;
	const rigHost = useRef<HTMLDivElement>(null);

	/**
	 * Focus RETURN for the four flows: when the one in progress closes and focus has fallen to
	 * `<body>`, hand it back to the rig control — in the hero or in the band — that opened the
	 * popover it started from.
	 */
	const hireFlowOpen = pickedService.value !== null || consultOpen.value;
	const addFlowOpen = pickedProject.value !== null || wizardOpen.value;
	useReturnFocus(hireFlowOpen);
	useReturnFocus(addFlowOpen);

	// The band's probe watches the action row itself.
	useMigratingHeader(rigHost);

	const reduced = useReducedMotion();

	// Re-read the call offer when the Dev Context Switcher's `callOffer` axis changes. Inert in
	// production (`useBookingSeam` never fires there); a seam flip re-resolves the SAME derivation the
	// server used, so the consultation row appears or withdraws without a reload — in both rigs.
	useBookingSeam((sim) => {
		void (async () => {
			const res = await BookingService.callOffer(bareHandle, sim);
			if (res.ok && res.data) liveConsultation.value = res.data.callOffer;
		})();
	});

	// The shared flow signals are module-level; leaving the page must not strand a modal open for
	// the next profile this tab renders.
	useEffect(() => () => {
		pickedService.value = null;
		pickedProject.value = null;
		consultOpen.value = false;
		wizardOpen.value = false;
		hireMenuOpen.value = false;
		addMenuOpen.value = false;
		liveConsultation.value = undefined;
	}, []);

	function chooseShowcase(): void {
		openPicker({
			requesterId: PICKER_ID,
			title: "Choose a showcase image",
			kinds: ["image"],
			multiple: false,
		});
	}

	function applyShowcase(assets: AssetItem[]): void {
		const picked = assets[0];
		if (picked) editedShowcase.value = picked.url;
	}

	function applyAvatar(url: string, note: string | null): void {
		editedAvatar.value = url;
		if (note) announce(note, NOTE_TTL_MS);
		else announce("Profile photo updated");
	}

	function ensureToastStack(): void {
		if (!toastMounted.value && !document.querySelector(".ui-toast")) toastMounted.value = true;
	}

	/*
	 * The assignment's outcome is a TOAST, not the rig's status line: the modal has already closed,
	 * so the reader's eye is nowhere in particular, and a toast row carries its own `role="status"`
	 * — saying it on the rig's live region as well would announce it twice.
	 */
	function onAssigned(project: HireProject, placeholder: boolean): void {
		ensureToastStack();
		toast.show({
			severity: "success",
			summary: placeholder ? "Assignment staged" : "Invitation sent successfully",
			detail: placeholder
				? `${profile.name} is staged on ${project.title} — priced when you publish.`
				: `${profile.name} has been invited to ${project.title}.`,
			life: 5000,
		});
	}

	function onAssignFailed(message: string): void {
		ensureToastStack();
		toast.show({
			severity: "danger",
			summary: "Invitation not sent",
			detail: message,
			life: 7000,
		});
	}

	const tier = TIER_META[profile.tier];
	const seller = !canEdit && isSellerKind(profile.kind);

	return (
		<>
			<header class="pf-hero" data-showcase={showcase ? "true" : "false"}>
				<div class="pf-hero__id">
					{
						/* The breadcrumb position: the way back into the Explore tree, above the
					    identity. A real anchor to `/explore` until hydration, then to the exact page
					    the visitor came from (their search, filters intact). */
					}
					<MigratingBack
						placement="page"
						fallback={EXPLORE_FALLBACK}
						fallbackLabel="Back to Explore"
						class="pf-hero__back"
					/>

					<div class="pf-hero__avatarwrap">
						{canEdit
							? (
								// The avatar IS the control: the overlay names what pressing it does, and it
								// is shown on hover and on focus so a keyboard user sees the same promise.
								<button
									type="button"
									class="pf-hero__avatarbtn"
									aria-label="Edit profile photo"
									aria-haspopup="dialog"
									aria-expanded={editorOpen.value ? "true" : "false"}
									onClick={() => (editorOpen.value = true)}
								>
									<Avatar
										image={avatar}
										placeholder={avatar === profile.avatar ? profile.avatarPlaceholder : undefined}
										label={profile.name}
										size={72}
										shape="circle"
										class="pf-hero__avatar"
									/>
									<span class="pf-hero__avataredit" aria-hidden="true">
										<Icon name="edit" size="sm" />
										<span class="pf-hero__avataredit-label">Edit photo</span>
									</span>
								</button>
							)
							: (
								<Avatar
									image={avatar}
									placeholder={avatar === profile.avatar ? profile.avatarPlaceholder : undefined}
									label={profile.name}
									size={72}
									shape="circle"
									class="pf-hero__avatar"
								/>
							)}
					</div>

					<h1 class="pf-hero__name">
						<span class="pf-hero__nametext">{profile.name}</span>
						{profile.verified && (
							<Tooltip content={tier.title} placement="top">
								<Icon
									name="verified"
									filled
									size="md"
									class="pf-hero__crest"
									title={tier.title}
								/>
							</Tooltip>
						)}
					</h1>

					<p class="pf-hero__meta">
						<span class="pf-hero__handle">{profile.handle}</span>
						<span class="pf-hero__dot" aria-hidden="true">·</span>
						<span>{ENTITY_META[profile.kind].label}</span>
					</p>

					{
						/* The probe's subject is the wrapper, not the rig: the rig renders its own root and
					    a ref on a function component never reaches a DOM node. */
					}
					<div ref={rigHost} class="pf-hero__rigslot">
						<ProfileRig
							profile={profile}
							canEdit={canEdit}
							authed={authed}
							services={services}
							consultation={consultation}
							hireProjects={hireProjects}
							variant="hero"
							class="pf-hero__actions"
						/>
					</div>

					<ProfileMetrics profile={profile} spend={spend} />
				</div>

				{showcase && (
					<div class="pf-hero__showcase">
						<ProfileShowcase showcase={showcase} name={profile.name} reduced={reduced} />
						{canEdit && (
							<span class="pf-hero__imgslot pf-hero__imgslot--showcase">
								<Tooltip content="Change showcase image" placement="left">
									<button
										type="button"
										class="pf-hero__imgbtn"
										aria-label="Change showcase image"
										onClick={chooseShowcase}
									>
										<Icon name="image" size="xs" />
									</button>
								</Tooltip>
							</span>
						)}
					</div>
				)}
			</header>

			{!canEdit && authed && <ProfileMessagePopover profile={profile} />}
			{seller && (
				<>
					<ServiceDetailModal
						service={pickedService}
						handle={profile.handle}
						sellerName={profile.name}
						authed={authed}
						onNotice={(text) => announce(text, NOTE_TTL_MS)}
					/>
					<ProjectAssignModal
						project={pickedProject}
						seller={{ name: profile.name, handle: profile.handle }}
						intake={profile.hireIntake ?? []}
						onAssigned={onAssigned}
						onFailed={onAssignFailed}
					/>
					{toastMounted.value && <Toast position="bottom-center" />}
					{consultation && (
						<ConsultationModal
							open={consultOpen}
							handle={bareHandle}
							sellerName={profile.name}
							offer={consultation}
							authed={authed}
							onNotice={(text) => announce(text, NOTE_TTL_MS)}
						/>
					)}
					{authed && (
						<CreateProjectWizard
							open={wizardOpen}
							sellerName={profile.name}
							defaultCurrency={defaultCurrency}
							scopeId={scopeId}
						/>
					)}
				</>
			)}
			{!canEdit && !authed && <SignInPrompt />}
			{canEdit && <AssetPicker requesterId={PICKER_ID} onPick={applyShowcase} />}
			{canEdit && (
				<AvatarEditor
					open={editorOpen}
					source={avatar}
					name={profile.name}
					onSave={applyAvatar}
				/>
			)}
		</>
	);
}
