import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import type { RefObject } from "preact";
import { headerCondensed } from "@features/shell/core/migrating-header.ts";
import { Button } from "@projective/ui/fields";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { PublicCallOffer } from "@projective/types/scheduling";
import { AddToProjectMenu } from "./hire/AddToProjectMenu.tsx";
import { HireMenu } from "./hire/HireMenu.tsx";
import { type HireProject, rigFor } from "../core/profile-model.ts";
import {
	gate,
	noteOpener,
	openMessage,
	openWizard,
	pickConsultation,
	pickProject,
	pickService,
	type RigViewer,
	shareProfile,
	toggleFollow,
} from "../core/rig-actions.ts";
import {
	addMenuOpen,
	followCelebrating,
	following,
	hireMenuOpen,
	rigStatus,
} from "../core/profile-state.ts";
import type { ProfileView, ServiceItem } from "../types/profile-types.ts";

/**
 * ProfileRig — the profile's action rig, rendered in TWO places from one component: the hero, and
 * the sticky header band that takes the rig over once the hero's controls have scrolled away. The
 * two differ only in size (`variant`); what each control DOES lives in `core/rig-actions.ts`, and
 * the flows they open — the service modal, the assignment modal, the consultation and the wizard —
 * are mounted once, by the hero, on the shared signals in `core/profile-state.ts`.
 *
 * Which controls render is `rigFor`'s decision (root CLAUDE.md §8 Decision #108): a SELLER leads
 * with **Hire** and **Add to project** with Message + Follow as icon-only secondaries; a BUYER keeps
 * Message as its text primary with Follow beside it; the OWNER sees Settings + Share. Hire renders
 * for a guest (a listing's preview is public) but its PRESS opens the sign-in prompt in place of the
 * listings popover; Add to project is withheld from a guest outright, because its rows are the
 * viewer's own projects.
 *
 * Both conversion controls open a POPOVER at the button — never a scroll to the Services row — and
 * the popover's rows write to the shared flow signals, so a row picked in the band's popover opens
 * exactly the modal a row picked in the hero's would.
 *
 * # An open popover follows the rig that is on screen
 *
 * The open state of each popover is ONE shared signal (`hireMenuOpen` ⁄ `addMenuOpen`), and each
 * rig presents it only while it is the page's active rig — the hero's until the band has revealed
 * (`headerCondensed`), the band's after. A `Popover` re-anchors on every scroll, so left alone the
 * hero's panel would ride its button up under the sticky header and sit there over the content the
 * reader scrolled to; instead the hero's instance closes the moment the band takes over and the
 * band's opens at ITS button, in the same frame the band reveals, and the reverse on the way back.
 * Each rig keeps a local mirror for its own `Popover` (a controlled signal the popover may write)
 * and forwards a user-driven change to the shared one; a change the mirror made itself is not a
 * user's dismissal and is never forwarded.
 */
export interface ProfileRigProps {
	profile: ProfileView;
	/** Whether the viewer owns this profile (swaps the rig for Settings + Share). */
	canEdit: boolean;
	/** Whether the viewer is signed in — a guest's account-bound presses open the sign-in prompt. */
	authed: boolean;
	/** The seller's active listings — the Hire popover's rows. */
	services: ServiceItem[];
	/** The seller's LIVE call offer, or `null` when they take no calls — the popover's footer row. */
	consultation: PublicCallOffer | null;
	/** The VIEWER's open projects — the Add-to-project popover's rows. `[]` for a guest. */
	hireProjects: HireProject[];
	/** `hero` — the full-size rig with the live region; `band` — the condensed header's compact rig. */
	variant: "hero" | "band";
	/** Extra class on the rig's root (the hero's `pf-hero__actions`, the band's `pf-band__actions`). */
	class?: string;
}

const BURST_DOTS = 6;

export function ProfileRig(props: ProfileRigProps): JSX.Element {
	const { profile, canEdit, authed, services, consultation, hireProjects, variant } = props;
	const viewer: RigViewer = { authed, name: profile.name };
	const compact = variant === "band";
	const size = compact ? "sm" : "md";
	/**
	 * The two popovers' open states, as THIS rig's `Popover`s see them: the shared fact, gated on
	 * this rig being the active one. Controlled, so picking a row can close them.
	 */
	const hireOpen = useSignal(false);
	const addOpen = useSignal(false);
	useSignalEffect(() => {
		const mine = (headerCondensed.value ? "band" : "hero") === variant;
		hireOpen.value = hireMenuOpen.value && mine;
		addOpen.value = addMenuOpen.value && mine;
	});
	/** A user's open ⁄ dismiss on this rig's popover becomes the shared fact. */
	function forward(shared: { value: boolean }): (open: boolean) => void {
		return (open) => {
			const mine = (headerCondensed.peek() ? "band" : "hero") === variant;
			if (mine) shared.value = open;
		};
	}

	const rig = rigFor(profile.kind, {
		hasServices: services.length > 0,
		offersConsultation: consultation !== null,
		authed,
	});
	const isFollowing = following.value;
	const celebrating = followCelebrating.value;
	const followLabel = isFollowing ? `Following ${profile.name}` : `Follow ${profile.name}`;
	const followText = isFollowing ? "Following" : "Follow";
	const filled =
		`ui-button ui-button--primary ui-button--filled ui-button--size-${size} ui-button--rounded`;
	const outlined =
		`ui-button ui-button--primary ui-button--outlined ui-button--size-${size} ui-button--rounded`;

	const burst = celebrating
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
					size={size}
					variant="outlined"
					class="pf-rig__cta pf-rig__cta--secondary pf-rig__cta--icon"
					aria-label={`Message ${profile.name}`}
					icon={<Icon name="message" size="sm" />}
					onClick={() => openMessage(viewer)}
				/>
			</Tooltip>
			<span class="pf-rig__follow" data-celebrate={celebrating ? "true" : undefined}>
				<Tooltip content={followText} placement="bottom">
					<Button
						rounded
						iconOnly
						size={size}
						variant="outlined"
						class="pf-rig__cta pf-rig__cta--secondary pf-rig__cta--icon pf-rig__cta--follow"
						aria-label={followLabel}
						aria-pressed={isFollowing}
						icon={<Icon name={isFollowing ? "check" : "user-plus"} size="sm" />}
						onClick={() => toggleFollow(viewer)}
					/>
				</Tooltip>
				{burst}
			</span>
		</>
	);

	/** Picking a row closes the popover it was picked in — for BOTH rigs — then opens the flow. */
	function pick<A extends unknown[]>(
		shared: { value: boolean },
		act: (...args: A) => void,
	): (...args: A) => void {
		return (...args) => {
			shared.value = false;
			act(...args);
		};
	}

	return (
		<div
			class={`pf-rig pf-rig--${variant}${props.class ? ` ${props.class}` : ""}`}
			data-rig={canEdit ? "owner" : rig.layout}
		>
			{canEdit
				? (
					<>
						<a class={`${filled} pf-rig__cta pf-rig__cta--primary`} href="/settings">
							<span class="ui-button__label">Settings</span>
						</a>
						<Button
							rounded
							size={size}
							variant="outlined"
							class="pf-rig__cta pf-rig__cta--secondary"
							onClick={() => shareProfile(profile)}
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
								onOpenChange={forward(hireMenuOpen)}
								placement="bottom-start"
								class="pf-hiremenu-pop"
								label={`Hire ${profile.name}`}
								trigger={(api) => (
									// A native element: `Button` is a plain function component, so a `ref` on it
									// never reaches the DOM node the popover has to measure.
									<button
										type="button"
										ref={api.ref as RefObject<HTMLButtonElement>}
										class={`${filled} pf-rig__cta pf-rig__cta--primary pf-rig__cta--hire`}
										aria-haspopup="dialog"
										aria-expanded={api.expanded ? "true" : "false"}
										aria-controls={api.panelId}
										onClick={(e) => {
											if (gate(viewer, "hire")) return;
											noteOpener(e.currentTarget);
											api.toggle();
										}}
									>
										<span class="ui-button__label">Hire</span>
									</button>
								)}
							>
								<HireMenu
									services={services}
									consultation={consultation}
									sellerName={profile.name}
									onPickService={pick(hireMenuOpen, pickService)}
									onPickConsultation={pick(hireMenuOpen, pickConsultation)}
								/>
							</Popover>
						)}
						{rig.addToProject && (
							<Popover
								open={addOpen}
								onOpenChange={forward(addMenuOpen)}
								placement="bottom-start"
								class="pf-addmenu-pop"
								label={`Add ${profile.name} to a project`}
								trigger={(api) => (
									<button
										type="button"
										ref={api.ref as RefObject<HTMLButtonElement>}
										class={`${rig.primary === "add" ? filled : outlined} pf-rig__cta ${
											rig.primary === "add" ? "pf-rig__cta--primary" : "pf-rig__cta--secondary"
										} pf-rig__cta--add`}
										// The visible label, restated: the band folds this control to its glyph on a
										// phone, and the name must survive the fold.
										aria-label="Add to project"
										aria-haspopup="dialog"
										aria-expanded={api.expanded ? "true" : "false"}
										aria-controls={api.panelId}
										onClick={(e) => {
											noteOpener(e.currentTarget);
											api.toggle();
										}}
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
									onPickProject={pick(addMenuOpen, pickProject)}
									onCreate={pick(addMenuOpen, () => openWizard(viewer))}
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
							size={size}
							class="pf-rig__cta pf-rig__cta--primary"
							onClick={() => openMessage(viewer)}
						>
							Message
						</Button>
						<span class="pf-rig__follow" data-celebrate={celebrating ? "true" : undefined}>
							<Button
								rounded
								size={size}
								variant="outlined"
								class="pf-rig__cta pf-rig__cta--secondary pf-rig__cta--follow"
								aria-pressed={isFollowing}
								aria-label={followLabel}
								icon={isFollowing ? <Icon name="check" size="sm" /> : undefined}
								onClick={() => toggleFollow(viewer)}
							>
								{followText}
							</Button>
							{burst}
						</span>
					</>
				)}
			{
				/* ONE live region for both rigs — the hero's. A second `role="status"` in the band
				   would read every acknowledgement twice. */
			}
			{variant === "hero" && (
				<p
					class={rigStatus.value ? "pf-rig__status" : "pf-rig__status ui-visually-hidden"}
					role="status"
					aria-live="polite"
				>
					{rigStatus.value}
				</p>
			)}
		</div>
	);
}
