import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import { Avatar } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { PublicCallOffer } from "@projective/types/scheduling";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { profileHref } from "@features/explore/core/routing.ts";
import SignInPrompt from "@features/auth/islands/SignInPrompt.island.tsx";
import { requestShare } from "@web/features/share/core/share-request.ts";
import {
	currentPath,
	requestSignIn,
	type SignInIntent,
} from "@features/auth/core/sign-in-prompt.ts";
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
import { ProfileShowcase } from "../components/ProfileShowcase.tsx";
import { ENTITY_META, TIER_META } from "../components/profile-glyphs.tsx";
import { AddToProjectMenu } from "../components/hire/AddToProjectMenu.tsx";
import { HireMenu } from "../components/hire/HireMenu.tsx";
import ConsultationModal from "../components/hire/ConsultationModal.tsx";
import CreateProjectWizard from "../components/hire/CreateProjectWizard.tsx";
import ProjectAssignModal from "../components/hire/ProjectAssignModal.tsx";
import ServiceDetailModal from "../components/hire/ServiceDetailModal.tsx";
import { type EstimatedSpend, type HireProject, rigFor } from "../core/profile-model.ts";
import {
	editedAvatar,
	editedShowcase,
	following,
	quickMessageOpen,
} from "../core/profile-state.ts";
import { withPrimaryImage } from "../core/showcase-model.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import type { ProfileView, ServiceItem } from "../types/profile-types.ts";
import ProfileMessagePopover from "./ProfileMessagePopover.island.tsx";

/**
 * ProfileHero — the split hero of the `/[handle]` profile: the identity column (72px avatar · name +
 * trust crest · `@handle` and entity kind · the action rig · the inline metrics strip) beside the
 * showcase frame, which is simply absent — no placeholder — when the profile has no showreel or
 * cover.
 *
 * # The rig (root CLAUDE.md §8 Decision #108)
 *
 * A SELLER leads with **Hire** and **Add to project**, with Message + Follow folded into icon-only
 * secondaries beside them (each with the portal `Tooltip` + `aria-label` §B.6 requires). Both
 * conversion controls open a POPOVER at the button — never a scroll to the Services row:
 *
 *  - **Hire** lists the seller's listings (thumbnail · title · starting price · rating), and a
 *    "Book consultation" row carrying its price or Free when the seller takes calls. A listing opens
 *    the {@link ServiceDetailModal}; the consultation opens the {@link ConsultationModal}. It renders
 *    only when there is something to show — a listing or a consultation.
 *  - **Add to project** lists the viewer's open projects, published first, under a persistent
 *    "Create new project" row, behind a leading `plus` glyph. A project opens the
 *    {@link ProjectAssignModal}; Create opens the {@link CreateProjectWizard}. Present for a
 *    SIGNED-IN viewer only — its rows are the viewer's own projects, and a guest has none.
 *
 * Which is the filled primary is `rigFor`'s decision. A BUYER keeps Message as its text primary
 * with Follow beside it. The OWNER sees Settings + Share and the two image pickers.
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
 * `/api/services/call-offer` whenever the seam changes (the `BookingPanels` precedent), and the
 * Hire popover's consultation row appears or withdraws with it — no reload.
 *
 * # Following is acknowledged
 *
 * A successful follow plays a brief, purely decorative acknowledgement — a `scale(1.15) → 1` settle
 * on the control and a six-dot burst behind it, on `transform` and `opacity` only (§B.12), removed by
 * both reduced-motion channels. The pressed state itself carries the fact; the motion decorates it.
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
const STATUS_TTL_MS = 2500;
/** A note about a saved photo or a sent assignment needs longer than a two-word acknowledgement. */
const NOTE_TTL_MS = 8000;
const CELEBRATE_MS = 700;
const BURST_DOTS = 6;

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
	/** The two popovers' open states — controlled, so picking a row can close them. */
	const hireOpen = useSignal(false);
	const addOpen = useSignal(false);
	/** The listing picked in the Hire popover; non-null opens the service modal. */
	const pickedService = useSignal<ServiceItem | null>(null);
	/** The project picked in the Add-to-project popover; non-null opens the assignment modal. */
	const pickedProject = useSignal<HireProject | null>(null);
	const consultOpen = useSignal(false);
	const wizardOpen = useSignal(false);
	/** The live call offer — the SSR one until the developer seam re-reads it. */
	const consultation = useSignal<PublicCallOffer | null>(props.consultation);
	const status = useSignal("");
	const celebrating = useSignal(false);
	const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const celebrateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	/**
	 * The two rig triggers, for focus RETURN. Every flow here is opened from a popover ROW, and the
	 * row closes with its popover the moment it is picked — so when the modal it opened closes,
	 * the dialog's own restore finds the element it remembered disconnected and does nothing, and
	 * focus falls to `<body>` (the Decision #68 defect). Hand it back to the rig control that
	 * opened the popover instead — only on an open → closed transition, and only when focus was
	 * actually lost, so the page's own load focus is never touched.
	 */
	const hireTriggerRef = useRef<HTMLButtonElement | null>(null);
	const addTriggerRef = useRef<HTMLButtonElement | null>(null);
	const hireFlowOpen = pickedService.value !== null || consultOpen.value;
	const addFlowOpen = pickedProject.value !== null || wizardOpen.value;
	useReturnFocus(hireFlowOpen, hireTriggerRef);
	useReturnFocus(addFlowOpen, addTriggerRef);

	const reduced = useReducedMotion();

	useEffect(() => () => {
		clearTimeout(statusTimer.current);
		clearTimeout(celebrateTimer.current);
	}, []);

	// Re-read the call offer when the Dev Context Switcher's `callOffer` axis changes. Inert in
	// production (`useBookingSeam` never fires there); a seam flip re-resolves the SAME derivation the
	// server used, so the consultation row appears or withdraws without a reload.
	useBookingSeam((sim) => {
		void (async () => {
			const res = await BookingService.callOffer(bareHandle, sim);
			if (res.ok && res.data) consultation.value = res.data.callOffer;
		})();
	});

	function announce(text: string, ttl = STATUS_TTL_MS): void {
		status.value = text;
		clearTimeout(statusTimer.current);
		statusTimer.current = setTimeout(() => {
			status.value = "";
		}, ttl);
	}

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

	/**
	 * Share opens the platform-wide share modal (the `ShareHost` every shell mounts): the ranked people
	 * picker, the external intents and Copy link in one place — the same sheet a listing or a project
	 * card opens, so a profile is not the one thing on the site with a private share vocabulary.
	 */
	function share(): void {
		requestShare({ href: profileHref(profile.handle), title: profile.name, noun: "profile" });
	}

	/** A guest's account-bound press opens the prompt; `true` when it was intercepted. */
	function gate(intent: SignInIntent): boolean {
		if (authed) return false;
		requestSignIn({ intent, returnTo: currentPath(), subject: profile.name });
		return true;
	}

	function openMessage(): void {
		if (gate("message")) return;
		quickMessageOpen.value = true;
	}

	// ---- The two popovers' rows ----
	function pickService(service: ServiceItem): void {
		hireOpen.value = false;
		pickedService.value = service;
	}

	function pickConsultation(): void {
		hireOpen.value = false;
		consultOpen.value = true;
	}

	function pickProject(project: HireProject): void {
		addOpen.value = false;
		pickedProject.value = project;
	}

	function openWizard(): void {
		addOpen.value = false;
		if (gate("hire")) return;
		wizardOpen.value = true;
	}

	function onAssigned(project: HireProject, placeholder: boolean): void {
		announce(
			placeholder
				? `${profile.name} staged on ${project.title} — priced when you publish`
				: `Invitation to ${project.title} sent to ${profile.name}`,
			NOTE_TTL_MS,
		);
	}

	function toggleFollow(): void {
		if (gate("follow")) return;
		const next = !following.value;
		following.value = next;
		announce(next ? `Following ${profile.name}` : `Unfollowed ${profile.name}`);
		clearTimeout(celebrateTimer.current);
		celebrating.value = next;
		if (next) {
			celebrateTimer.current = setTimeout(() => {
				celebrating.value = false;
			}, CELEBRATE_MS);
		}
	}

	const rig = rigFor(profile.kind, {
		hasServices: services.length > 0,
		offersConsultation: consultation.value !== null,
		authed,
	});
	const isFollowing = following.value;
	const tier = TIER_META[profile.tier];
	const followLabel = isFollowing ? `Following ${profile.name}` : `Follow ${profile.name}`;
	const followText = isFollowing ? "Following" : "Follow";
	const filled =
		"ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded";
	const outlined =
		"ui-button ui-button--primary ui-button--outlined ui-button--size-md ui-button--rounded";

	const burst = celebrating.value
		? (
			<span class="pf-burst" aria-hidden="true">
				{Array.from(
					{ length: BURST_DOTS },
					(_, i) => <i class="pf-burst__dot" key={i} style={`--pf-burst-i:${i}`} />,
				)}
			</span>
		)
		: null;

	/** The seller rig's icon-only Message + Follow pair. */
	const iconPair = (
		<>
			<Tooltip content="Message" placement="bottom">
				<Button
					rounded
					iconOnly
					size="md"
					variant="outlined"
					class="pf-hero__cta pf-hero__cta--secondary pf-hero__cta--icon"
					aria-label={`Message ${profile.name}`}
					icon={<Icon name="message" size="sm" />}
					onClick={openMessage}
				/>
			</Tooltip>
			<span class="pf-hero__follow" data-celebrate={celebrating.value ? "true" : undefined}>
				<Tooltip content={followText} placement="bottom">
					<Button
						rounded
						iconOnly
						size="md"
						variant="outlined"
						class="pf-hero__cta pf-hero__cta--secondary pf-hero__cta--icon pf-hero__cta--follow"
						aria-label={followLabel}
						aria-pressed={isFollowing}
						icon={<Icon name={isFollowing ? "check" : "user-plus"} size="sm" />}
						onClick={toggleFollow}
					/>
				</Tooltip>
				{burst}
			</span>
		</>
	);

	return (
		<>
			<header class="pf-hero" data-showcase={showcase ? "true" : "false"}>
				<div class="pf-hero__id">
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

					<div class="pf-hero__actions" data-rig={canEdit ? "owner" : rig.layout}>
						{canEdit
							? (
								<>
									<a class={`${filled} pf-hero__cta pf-hero__cta--primary`} href="/settings">
										<span class="ui-button__label">Settings</span>
									</a>
									<Button
										rounded
										size="md"
										variant="outlined"
										class="pf-hero__cta pf-hero__cta--secondary"
										onClick={share}
									>
										Share
									</Button>
								</>
							)
							: rig.layout === "seller"
							? (
								<>
									{rig.hire && (
										<Popover
											open={hireOpen}
											placement="bottom-start"
											class="pf-hiremenu-pop"
											label={`Hire ${profile.name}`}
											trigger={(api) => (
												// A native element: `Button` is a plain function component, so a `ref` on it
												// never reaches the DOM node the popover has to measure.
												<button
													type="button"
													ref={bindTrigger(api.ref as RefObject<HTMLButtonElement>, hireTriggerRef)}
													class={`${filled} pf-hero__cta pf-hero__cta--primary pf-hero__cta--hire`}
													aria-haspopup="dialog"
													aria-expanded={api.expanded ? "true" : "false"}
													aria-controls={api.panelId}
													onClick={() => {
														if (gate("hire")) return;
														api.toggle();
													}}
												>
													<span class="ui-button__label">Hire</span>
												</button>
											)}
										>
											<HireMenu
												services={services}
												consultation={consultation.value}
												sellerName={profile.name}
												onPickService={pickService}
												onPickConsultation={pickConsultation}
											/>
										</Popover>
									)}
									{rig.addToProject && (
										<Popover
											open={addOpen}
											placement="bottom-start"
											class="pf-addmenu-pop"
											label={`Add ${profile.name} to a project`}
											trigger={(api) => (
												<button
													type="button"
													ref={bindTrigger(api.ref as RefObject<HTMLButtonElement>, addTriggerRef)}
													class={`${rig.primary === "add" ? filled : outlined} pf-hero__cta ${
														rig.primary === "add"
															? "pf-hero__cta--primary"
															: "pf-hero__cta--secondary"
													} pf-hero__cta--add`}
													aria-haspopup="dialog"
													aria-expanded={api.expanded ? "true" : "false"}
													aria-controls={api.panelId}
													onClick={api.toggle}
												>
													<span class="ui-button__icon">
														<Icon name="plus" size="sm" aria-hidden />
													</span>
													<span class="ui-button__label">Add to project</span>
												</button>
											)}
										>
											<AddToProjectMenu
												projects={hireProjects}
												sellerName={profile.name}
												onPickProject={pickProject}
												onCreate={openWizard}
											/>
										</Popover>
									)}
									{iconPair}
								</>
							)
							: (
								<>
									<Button
										rounded
										size="md"
										class="pf-hero__cta pf-hero__cta--primary"
										onClick={openMessage}
									>
										Message
									</Button>
									<span
										class="pf-hero__follow"
										data-celebrate={celebrating.value ? "true" : undefined}
									>
										<Button
											rounded
											size="md"
											variant="outlined"
											class="pf-hero__cta pf-hero__cta--secondary pf-hero__cta--follow"
											aria-pressed={isFollowing}
											aria-label={followLabel}
											icon={isFollowing ? <Icon name="check" size="sm" /> : undefined}
											onClick={toggleFollow}
										>
											{followText}
										</Button>
										{burst}
									</span>
								</>
							)}
						<p
							class={status.value ? "pf-hero__status" : "pf-hero__status ui-visually-hidden"}
							role="status"
							aria-live="polite"
						>
							{status.value}
						</p>
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
			{!canEdit && rig.layout === "seller" && (
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
					/>
					{consultation.value && (
						<ConsultationModal
							open={consultOpen}
							handle={bareHandle}
							sellerName={profile.name}
							offer={consultation.value}
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

// #region Focus return
/** Write one DOM node into two refs: the popover's own (it measures the trigger) and ours. */
function bindTrigger(
	popoverRef: RefObject<HTMLButtonElement>,
	own: { current: HTMLButtonElement | null },
): (el: HTMLButtonElement | null) => void {
	return (el) => {
		(popoverRef as { current: HTMLButtonElement | null }).current = el;
		own.current = el;
	};
}

/**
 * When `open` goes true → false and focus has fallen to `<body>`, focus `trigger`.
 *
 * Not immediately: the closing dialog stays MOUNTED for its exit motion — focus still sits on the
 * control that dismissed it and its trap keeps the background `inert` — and a focus call on an
 * inert element is silently ignored. So this polls until the dialog has let go (focus has fallen
 * to `<body>` and the trigger is out from under `[inert]`), because the trap releases from an
 * effect cleanup that fires no event, and gives up after a bounded wait rather than holding a
 * timer for a dialog that never unmounts. Focus that lands anywhere OUTSIDE a dialog meanwhile is
 * somebody else's decision and wins.
 */
function useReturnFocus(open: boolean, trigger: { current: HTMLButtonElement | null }): void {
	const wasOpen = useRef(false);
	useEffect(() => {
		const before = wasOpen.current;
		wasOpen.current = open;
		if (open || !before) return;
		const deadline = Date.now() + RETURN_FOCUS_WAIT_MS;
		let id: ReturnType<typeof setTimeout> | undefined;
		const tick = () => {
			const el = trigger.current;
			if (!el) return;
			const active = document.activeElement;
			const inDialog = !!active?.closest('[role="dialog"]');
			if (active && active !== document.body && !inDialog) return;
			if (inDialog || el.closest("[inert]")) {
				if (Date.now() < deadline) id = setTimeout(tick, RETURN_FOCUS_POLL_MS);
				return;
			}
			el.focus();
		};
		id = setTimeout(tick, 0);
		return () => clearTimeout(id);
	}, [open]);
}

/** How long a closing dialog may keep the background inert before the focus return gives up. */
const RETURN_FOCUS_WAIT_MS = 1500;
const RETURN_FOCUS_POLL_MS = 40;
// #endregion
