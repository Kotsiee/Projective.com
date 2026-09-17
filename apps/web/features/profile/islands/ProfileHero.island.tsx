import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import { Avatar } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { dsConfig } from "@projective/ui/system";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { profileHref } from "@features/explore/core/routing.ts";
import SignInPrompt from "@features/auth/islands/SignInPrompt.island.tsx";
import {
	currentPath,
	requestSignIn,
	type SignInIntent,
} from "@features/auth/core/sign-in-prompt.ts";
import "../styles/profile.css";
import { AvatarEditor } from "../components/AvatarEditor.tsx";
import { ProfileMetrics } from "../components/ProfileMetrics.tsx";
import { ProfileShowcase } from "../components/ProfileShowcase.tsx";
import { ENTITY_META, TIER_META } from "../components/profile-glyphs.tsx";
import {
	ctaFor,
	type EstimatedSpend,
	type HireProject,
	hireProjectHref,
	SERVICES_ANCHOR,
} from "../core/profile-model.ts";
import {
	editedAvatar,
	editedShowcase,
	following,
	quickMessageOpen,
} from "../core/profile-state.ts";
import { withPrimaryImage } from "../core/showcase-model.ts";
import type { ProfileView } from "../types/profile-types.ts";
import ProfileMessagePopover from "./ProfileMessagePopover.island.tsx";

/**
 * ProfileHero — the split hero of the `/[handle]` profile: the identity column (72px avatar · name +
 * trust crest · `@handle` and entity kind · the action rig · the inline metrics strip) beside the
 * showcase frame, which is simply absent — no placeholder — when the profile has no showreel or
 * cover.
 *
 * # The rig has three shapes, decided by `ctaFor`
 *
 * A SELLER leads with **Hire** and folds Message + Follow into icon-only secondaries (each with the
 * portal `Tooltip` + `aria-label` §B.6 requires of an icon-only control). What Hire does is the
 * viewer's situation, resolved server-side so the first byte paints the right control: a guest gets
 * the sign-in prompt; a client with open projects gets a popover listing them (each row lands on that
 * project's roster, which owns the invite flow); a client with none but a listing to buy is scrolled
 * to the Services row (a real anchor, so it works with JavaScript off); and a client with neither gets
 * NO Hire — the rig falls back to the text Message + Follow pair, because a Hire that could only
 * open the conversation would be a Message button wearing the wrong name. A BUYER keeps Message as its
 * text primary with Follow beside it. The OWNER sees Settings + Share and the two image pickers.
 *
 * # A guest is intercepted, not bounced
 *
 * Follow and Message are claims on the reader's own account. For a signed-out visitor they open the
 * {@link SignInPrompt} — the standard `/login` ⁄ `/join` flow with a `redirectTo` back to this
 * profile — rather than navigating away from the page they were reading. The controls keep their
 * shape and position; only what pressing them does differs (the `CardActions` star precedent).
 *
 * # Following is acknowledged
 *
 * A successful follow plays a brief, purely decorative acknowledgement — a `scale(1.15) → 1` settle
 * on the control and a six-dot burst behind it, on `transform` and `opacity` only (§B.12), removed by
 * both reduced-motion channels. The pressed state itself carries the fact; the motion decorates it.
 *
 * An owner changes the profile photo through the {@link AvatarEditor} — the avatar itself is the
 * trigger, with an "Edit profile photo" overlay on hover and focus — and the showcase's primary
 * still through the Asset Picker; each edit lands in a shared `edited*` signal so any other island
 * drawing the same image agrees. Optimistic and session-local, pending the profile write path.
 *
 * The showcase is a carousel ({@link ProfileShowcase}): the primary still and up to four slides,
 * auto-advancing, with a video slide playing through before it moves on. The reduced-motion decision
 * is made HERE — the OS media query or the in-app `dsConfig.reducedMotion` — and passed down, so
 * a viewer who asked for no motion sees nothing move on its own after hydration.
 */
export interface ProfileHeroProps {
	profile: ProfileView;
	/** Whether the viewer owns this profile (swaps the rig for Settings ⁄ Share + the image pickers). */
	canEdit: boolean;
	/** Whether the viewer is signed in — a guest's Hire ⁄ Follow ⁄ Message open the sign-in prompt. */
	authed: boolean;
	/** Whether the seller has active listings — where a Hire control can land. */
	hasServices: boolean;
	/** The estimated spend floor across those listings, for the metrics strip. */
	spend: EstimatedSpend | null;
	/** The VIEWER's open projects — what a Hire control can bring the seller into. `[]` for a guest. */
	hireProjects: HireProject[];
}

const PICKER_ID = "profile-image";

/** The lifecycle word beside a project in the Hire list — a state, so it earns its place (§B.11). */
const HIRE_STATUS: Record<HireProject["status"], string> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
};
const STATUS_TTL_MS = 2500;
/** A note about a saved photo needs longer than a two-word acknowledgement. */
const NOTE_TTL_MS = 8000;
const CELEBRATE_MS = 700;
const BURST_DOTS = 6;

function isAbort(err: unknown): boolean {
	return err instanceof DOMException && err.name === "AbortError";
}

export default function ProfileHero(
	{ profile, canEdit, authed, hasServices, spend, hireProjects }: ProfileHeroProps,
): JSX.Element {
	const avatar = editedAvatar.value ?? profile.avatar;
	const showcase = withPrimaryImage(
		profile.showcase,
		editedShowcase.value,
		`${profile.name} — showcase`,
	);
	const editorOpen = useSignal(false);
	const envReduced = useSignal(false);
	const status = useSignal("");
	const celebrating = useSignal(false);
	const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const celebrateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const reduced = envReduced.value || dsConfig.value.reducedMotion;

	useEffect(() => {
		const mql = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
		const sync = () => {
			envReduced.value = (mql?.matches ?? false) ||
				document.documentElement.dataset.motion === "reduced";
		};
		sync();
		mql?.addEventListener("change", sync);
		return () => mql?.removeEventListener("change", sync);
	}, []);

	useEffect(() => () => {
		clearTimeout(statusTimer.current);
		clearTimeout(celebrateTimer.current);
	}, []);

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

	async function share(): Promise<void> {
		const url = new URL(profileHref(profile.handle), globalThis.location.origin).href;
		if (typeof navigator.share === "function") {
			try {
				await navigator.share({ title: profile.name, url });
				return;
			} catch (err) {
				if (isAbort(err)) return;
			}
		}
		try {
			await navigator.clipboard.writeText(url);
			announce("Link copied");
		} catch {
			announce("Couldn't copy the link — copy it from the address bar");
		}
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

	/**
	 * The Services anchor, scrolled smoothly. The `href` still carries the jump for a reader without
	 * JavaScript; here the default is replaced so the landing is animated — or immediate under either
	 * reduced-motion channel, because arriving is the function and the glide is decoration.
	 */
	function scrollToServices(e: Event): void {
		const el = document.getElementById(SERVICES_ANCHOR);
		if (!el) return;
		e.preventDefault();
		el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
		history.replaceState(history.state, "", `#${SERVICES_ANCHOR}`);
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

	const cta = ctaFor(profile.kind, {
		authed,
		hasServices,
		openProjectCount: hireProjects.length,
	});
	const hireClass = "pf-hero__cta pf-hero__cta--primary pf-hero__cta--hire";
	const isFollowing = following.value;
	const tier = TIER_META[profile.tier];
	const followLabel = isFollowing ? `Following ${profile.name}` : `Follow ${profile.name}`;
	const followText = isFollowing ? "Following" : "Follow";

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

					<div class="pf-hero__actions" data-rig={canEdit ? "owner" : cta.layout}>
						{canEdit
							? (
								<>
									<a
										class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded pf-hero__cta pf-hero__cta--primary"
										href="/settings"
									>
										<span class="ui-button__label">Settings</span>
									</a>
									<Button
										rounded
										size="md"
										variant="outlined"
										class="pf-hero__cta pf-hero__cta--secondary"
										onClick={() => void share()}
									>
										Share
									</Button>
								</>
							)
							: cta.layout === "hire"
							? (
								<>
									{cta.target === "services" && (
										<a
											class={`ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded ${hireClass}`}
											href={`#${SERVICES_ANCHOR}`}
											onClick={scrollToServices}
										>
											<span class="ui-button__label">{cta.primary}</span>
										</a>
									)}
									{cta.target === "signin" && (
										<Button
											rounded
											size="md"
											class={hireClass}
											onClick={() => gate("hire")}
										>
											{cta.primary}
										</Button>
									)}
									{cta.target === "projects" && (
										<Popover
											placement="bottom-start"
											class="pf-hire"
											label={`Hire ${profile.name}`}
											trigger={(api) => (
												// A native element: `Button` is a plain function component, so a `ref` on it
												// never reaches the DOM node the popover has to measure.
												<button
													type="button"
													ref={api.ref as RefObject<HTMLButtonElement>}
													class={`ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded ${hireClass}`}
													aria-haspopup="dialog"
													aria-expanded={api.expanded ? "true" : "false"}
													aria-controls={api.panelId}
													onClick={api.toggle}
												>
													<span class="ui-button__label">{cta.primary}</span>
												</button>
											)}
										>
											<p class="pf-hire__lead">
												Bring {profile.name} into one of your projects
											</p>
											<ul class="pf-hire__list" role="list">
												{hireProjects.map((project) => (
													<li key={project.slug}>
														<a class="pf-hire__item" href={hireProjectHref(project)}>
															<span class="pf-hire__title">{project.title}</span>
															<span class="pf-hire__meta">
																{project.scopeLabel} · {HIRE_STATUS[project.status]}
															</span>
														</a>
													</li>
												))}
											</ul>
											<a class="pf-hire__new" href="/projects?create=1">
												<Icon name="plus" size="xs" />
												Start a new project
											</a>
										</Popover>
									)}
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
									<span
										class="pf-hero__follow"
										data-celebrate={celebrating.value ? "true" : undefined}
									>
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
							)
							: (
								<>
									<Button
										rounded
										size="md"
										class="pf-hero__cta pf-hero__cta--primary"
										onClick={openMessage}
									>
										{cta.primary}
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
