import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/workspace.css";
import {
	canOpenVerification,
	kindCopy,
	type WorkspaceDetail,
	workspaceHref,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { openInvite, publishDetail } from "../core/workspace-state.ts";
import {
	heroDismissGuard,
	heroDismissKey,
	type OverviewModel,
	overviewModel,
	readHeroDismissed,
	writeHeroDismissed,
} from "../core/overview-model.ts";
import type { OverviewRegion as RegionPlace } from "../core/overview-deck.ts";
import { BUSINESS_REFUSAL_COPY } from "../core/refusal-copy.ts";
import { SetupHero } from "../components/SetupHero.tsx";
import { ProjectList } from "../components/ProjectList.tsx";
import { ActivityFeed } from "../components/ActivityFeed.tsx";
import { VerificationLock } from "../components/VerificationLock.tsx";
import { IdentityBand } from "../components/overview/IdentityBand.tsx";
import { DraftNoticeBand, ProposeNoticeBand } from "../components/overview/OverviewNotices.tsx";
import { TelemetryDeck } from "../components/overview/TelemetryDeck.tsx";
import { NeedsAttention } from "../components/overview/NeedsAttention.tsx";
import { CashFlowPanel } from "../components/overview/CashFlowPanel.tsx";
import { OverviewRegion } from "../components/overview/OverviewRegion.tsx";
import InviteModal from "./InviteModal.island.tsx";

/**
 * WorkspaceOverview — the console's home, for both kinds, and permissionless (Decision #61 (A)): every
 * active member lands here, whatever they hold.
 *
 * Top to bottom it answers: who is this (the identity band), what is left to set up (the setup hero,
 * only while a step is open), what is true right now (the telemetry deck), what is waiting on somebody
 * (needs attention), how money moved (the 30-day cash flow, for a viewer who may see it), what is being
 * delivered (the projects preview) and what has happened (the activity stream) — the command center
 * of Decision #306. Which of those render, and which controls they carry, is `overviewModel`
 * (`core/overview-model.ts`, with the command-center regions in `core/overview-deck.ts`) — pure and
 * unit-tested — so the rules the surface is judged by hold by construction:
 *
 *   - **Real reads only.** Every tile, item and series is a field the read carries; a metric with no
 *     source is absent, never faked.
 *   - **One filled control.** The hero's next step the viewer can act on carries the only fill: the
 *     tier-2 structural Invite member, a business's tier-1 amber Add money, else the tier-3 Publish
 *     or the step's page. With the hero hidden, a draft business's notice carries the tier-3 Publish
 *     instead — never both on screen. The deck holds no control; attention rows and region heads are
 *     links; the cash flow's Try again is a tier-4 utility.
 *   - **No dead controls.** A step the viewer cannot act on (the read's `actionable`) shows none, and
 *     an attention item is listed only for a viewer who may open where it leads.
 *   - **No money they were not answered.** A team's vault tile and cash flow exist only when the read
 *     carried the payout block (`manage_finances`, Decision #233); a business's wallet tiles and cash
 *     flow exactly when the viewer may open Finance (BB9's tiles, answered on the same predicate); the
 *     money movements in the stream were already withheld by the read.
 *   - **A dismissed hero stays dismissed from first paint.** The choice lives in localStorage, which
 *     the server cannot read, so an inline guard ahead of the band marks the stack
 *     (`data-hero-dismissed`) before the band paints, and the stylesheet hides it and reveals the
 *     notices it was carrying. The island never takes that over with a second mechanism: its first
 *     client render reads the same key and carries the same mark (Fresh's revive diffs attributes
 *     against the server's DOM, so a mark the tree lacked would be dropped and the band flash back),
 *     and a dismissal in place sets the mark too. The band and its stand-ins stay rendered; the mark
 *     alone decides which of them shows, from the server's first paint to a click.
 *
 * There is no `kind === "team" ? <TeamOverview/> : <BusinessOverview/>` here: the differences are the
 * server's data (the steps, the payout block, the money tiles) and the SSOT's per-kind copy.
 */

export interface WorkspaceOverviewProps {
	workspace: WorkspaceDetail;
}

/** The first band after `from` that is on screen, or `null`. */
function nextShownBand(from: Element | null): HTMLElement | null {
	let next = from?.nextElementSibling ?? null;
	while (next && (!(next instanceof HTMLElement) || next.getClientRects().length === 0)) {
		next = next.nextElementSibling;
	}
	return next instanceof HTMLElement ? next : null;
}

/**
 * Focus a band. A band is a landmark, not a control, so it takes focus programmatically only
 * (`tabindex="-1"`), never a stop in the tab order.
 */
function focusBand(band: HTMLElement | null): void {
	if (!band?.isConnected) return;
	if (!band.hasAttribute("tabindex")) band.setAttribute("tabindex", "-1");
	band.focus();
}

/**
 * Where focus goes once the hero is hidden: the first band after it that is on screen — the notice
 * standing in for it, else the deck — so a keyboard or screen-reader user is not dropped to the top
 * of the document when the control they pressed disappears.
 */
function focusPastHero(stack: HTMLElement): void {
	focusBand(nextShownBand(stack.querySelector(":scope > .wsp-band--hero")));
}

/** One region of the grid under the deck, by its key. */
function Region(
	{ place, view, ws }: { place: RegionPlace; view: OverviewModel; ws: WorkspaceDetail },
): JSX.Element | null {
	switch (place.key) {
		case "cashflow":
			return view.cashFlow && (
				<OverviewRegion
					place={place}
					titleId="wsp-overview-cashflow"
					title="Cash flow"
					meta="Last 30 days"
					link={{ label: "Open the wallet", href: view.cashFlow.walletHref }}
				>
					<CashFlowPanel source={view.cashFlow} />
				</OverviewRegion>
			);
		case "attention":
			return (
				<OverviewRegion place={place} titleId="wsp-overview-attention" title="Needs attention">
					<NeedsAttention items={view.attention} />
				</OverviewRegion>
			);
		case "projects":
			return (
				<OverviewRegion
					place={place}
					titleId="wsp-overview-projects"
					title="Projects"
					link={{ label: "See all", href: view.projectsHref }}
				>
					<ProjectList
						rows={view.projects}
						empty={ws.kind === "team"
							? "No live engagements yet."
							: "Nothing commissioned is in delivery yet."}
					/>
				</OverviewRegion>
			);
		case "activity":
			return (
				<OverviewRegion place={place} titleId="wsp-overview-activity" title="Activity">
					<ActivityFeed rows={view.activity} />
				</OverviewRegion>
			);
	}
}

export default function WorkspaceOverview(props: WorkspaceOverviewProps): JSX.Element {
	/** The server's projection — replaced wholesale by every write's re-read, never patched here. */
	const detail = useSignal(props.workspace);
	/**
	 * This viewer's remembered choice to hide the setup hero — read on the client's FIRST render, the
	 * same read the pre-paint guard made, so the revive keeps the guard's mark instead of dropping it.
	 * The server cannot see the browser's storage and renders the hero.
	 */
	const dismissed = useSignal(
		typeof document === "undefined" ? false : readHeroDismissed(heroDismissKey(props.workspace)),
	);
	const publishing = useSignal(false);
	const publishError = useSignal<string | null>(null);
	const stackRef = useRef<HTMLDivElement>(null);
	/** A draft business's not-active band, whose Publish removes it. */
	const draftRef = useRef<HTMLElement>(null);

	// The lane, the header band and the footer rig read the same projection through the relay, so a
	// write made here (an invitation, a publish) reaches them without a second fetch.
	useSignalEffect(() => {
		publishDetail(detail.value);
	});

	// Always the composition WITH the hero: a dismissal is the stack's mark (see the header), which
	// hides the band and shows the `standIn` notices without re-rendering either.
	const model = useComputed(() => overviewModel(detail.value, { dismissed: false }));

	const ws = detail.value;
	const view = model.value;
	/** The two-member notice — shown, or standing in behind the pre-paint guard. */
	const propose = view.propose ?? view.standIn.propose;
	/** A draft business's not-active notice — shown, or standing in behind the pre-paint guard. */
	const draft = view.draft ?? view.standIn.draft;
	const notActive = BUSINESS_REFUSAL_COPY.business_not_active;
	/**
	 * The draft notice's words: the fact, then — beside a Publish — that it is one-way, or for anyone
	 * else the ask for the one act a draft needs.
	 */
	const draftText = draft
		? [
			notActive.sentence({ business: ws.name }),
			draft.canPublish
				? "Publishing can't be undone."
				: notActive.ask({ business: ws.name, businessStatus: ws.status }),
		].join(" ")
		: "";
	const copy = kindCopy(ws.kind);
	const canInvite = ws.viewerCapabilities.includes("invite_members");

	function adopt(next: WorkspaceDetail): void {
		detail.value = next;
	}

	/** Publish the entity (draft → active); whether it was published. */
	async function publish(): Promise<boolean> {
		publishing.value = true;
		publishError.value = null;
		const res = await WorkspaceService.update({ kind: ws.kind, id: ws.id, status: "active" });
		publishing.value = false;
		if (!res.ok || !res.data) {
			publishError.value = res.message ?? `Could not publish the ${copy.noun} just now.`;
			return false;
		}
		adopt(res.data);
		return true;
	}

	/**
	 * Publish from the draft notice. A published business has no notice, so the control just pressed
	 * disappears with it: focus moves on to the band after it, found while the notice is still on
	 * screen and focused once the re-read has rendered.
	 */
	async function publishFromNotice(): Promise<void> {
		const after = nextShownBand(draftRef.current);
		if (await publish()) setTimeout(() => focusBand(after), 0);
	}

	/**
	 * Publish from the hero. The step is done once the re-read lands, so its control — the one just
	 * pressed — unmounts, and a business's Publish can sit mid-hero (Decision #248): focus moves to the
	 * hero band while it is still on screen with steps left, else to the band after it, found while the
	 * hero is still there.
	 */
	async function publishFromHero(): Promise<void> {
		const hero = stackRef.current?.querySelector<HTMLElement>(":scope > .wsp-band--hero") ?? null;
		const after = nextShownBand(hero);
		if (!(await publish())) return;
		setTimeout(() => focusBand(hero?.isConnected ? hero : after), 0);
	}

	function dismiss(): void {
		writeHeroDismissed(heroDismissKey(ws));
		dismissed.value = true;
		// The mark the next render writes, written now: the band is hidden and its stand-ins shown at
		// once, so focus can move to what replaced the button that was just pressed.
		const stack = stackRef.current;
		if (!stack) return;
		stack.setAttribute("data-hero-dismissed", "");
		focusPastHero(stack);
	}

	/** Band order as each band's `data-i`, so the entrance stagger reads top to bottom. */
	let band = 0;
	const next = () => band++;

	return (
		<div class="wsp" data-kind={ws.kind}>
			<div
				class="wsp__stack"
				ref={stackRef}
				data-hero-dismissed={view.hero && dismissed.value ? "" : undefined}
			>
				<IdentityBand workspace={ws} i={next()} />

				{/* #region Setup hero */}
				{view.hero && (
					// Hides the band before it paints when this viewer dismissed it earlier — see
					// `heroDismissGuard`. It must stay ahead of the band so it runs first.
					<script dangerouslySetInnerHTML={{ __html: heroDismissGuard(heroDismissKey(ws)) }} />
				)}
				{view.hero && (
					<section
						class="wsp-band wsp-band--hero"
						data-i={next()}
						aria-labelledby="wsp-overview-setup"
					>
						<div class="wsp-band__inner">
							<SetupHero
								hero={view.hero}
								titleId="wsp-overview-setup"
								onInvite={() => openInvite()}
								onPublish={publishFromHero}
								publishing={publishing.value}
								publishError={publishError.value}
								onDismiss={dismiss}
							/>
						</div>
					</section>
				)}
				{/* #endregion */}

				{/* #region Notices — what the hero would say, when it is not on screen to say it */}
				{(view.lock || view.standIn.lock) && (
					<VerificationLock
						kind={ws.kind}
						verification={ws.verification}
						prompt={ws.verificationPrompt}
						href={workspaceHref(ws.kind, ws.handle, "verification")}
						canManage={canOpenVerification(ws.kind, ws.viewerCapabilities)}
						tone="band"
						i={next()}
						heroStandIn={!view.lock}
					/>
				)}
				{propose && (
					<ProposeNoticeBand
						i={next()}
						standIn={!view.propose}
						canInvite={propose.canInvite}
						onInvite={() => openInvite()}
					/>
				)}
				{draft && (
					<DraftNoticeBand
						i={next()}
						standIn={!view.draft}
						bandRef={draftRef}
						name={ws.name}
						text={draftText}
						canPublish={draft.canPublish}
						publishing={publishing.value}
						publishError={publishError.value}
						onPublish={publishFromNotice}
					/>
				)}
				{/* #endregion */}

				{/* #region Telemetry deck */}
				<section
					class="wsp-band wsp-band--deck"
					data-i={next()}
					aria-labelledby="wsp-overview-deck"
				>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title" id="wsp-overview-deck">At a glance</h2>
						</div>
						<TelemetryDeck tiles={view.deck} name={ws.name} />
					</div>
				</section>
				{/* #endregion */}

				{/* #region Command center — attention, cash flow, projects, activity */}
				<div class="wsp-band wsp-band--tail" data-i={next()}>
					<div class="wsp-band__inner">
						<div class="wsp-ovgrid">
							<div class="wsp-ovgrid__grid">
								{view.regions.map((place) => (
									<Region key={place.key} place={place} view={view} ws={ws} />
								))}
							</div>
						</div>
					</div>
				</div>
				{/* #endregion */}
			</div>

			{canInvite && <InviteModal workspace={ws} onUpdated={adopt} />}
		</div>
	);
}
