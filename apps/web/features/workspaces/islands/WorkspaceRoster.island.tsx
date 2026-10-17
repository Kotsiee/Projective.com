import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Grid } from "@projective/ui/layout";
import { InputText } from "@projective/ui/fields";
import { InlineNotice, Message } from "@projective/ui/feedback";
import {
	type IncomingInvite,
	kindCopy,
	walletHrefFor,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceRoster as RosterPage,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import type { RosterNotice } from "../core/console-route.ts";
import { useContextSwitch } from "../core/useContextSwitch.ts";
import { useInvitationAnswers } from "../core/useInvitationAnswers.ts";
import {
	invitationStripDismissible,
	invitationStripIsTheList,
	invitationStripShown,
} from "../core/invitation-strip-model.ts";
import { openCreate, rosterView } from "../core/workspace-state.ts";
import { displayZoom, gridColWidth, workspaceZoom } from "../core/view-state.ts";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import {
	countLabel,
	filterRoster,
	ROSTER_TABS,
	type RosterTab,
	rosterTabCounts,
	toRosterTab,
} from "../core/workspace-model.ts";
import { cloneGlyph, SearchGlyph } from "../core/workspace-glyphs.tsx";
import { WorkspaceCard, type WorkspaceCardAction } from "../components/WorkspaceCard.tsx";
import { WorkspaceTable } from "../components/WorkspaceTable.tsx";
import { InvitationStrip } from "../components/InvitationStrip.tsx";
import { RosterBlank, RosterEmpty } from "../components/RosterEmpty.tsx";
import CreateWorkspaceModal from "./CreateWorkspaceModal.island.tsx";

/**
 * WorkspaceRoster — the body of the `/teams` and `/businesses` INDEX.
 *
 * One island serves both kinds; everything that differs is a lookup in the SSOT's per-kind copy table
 * ({@link kindCopy}), never a branch on kind in markup. It answers three questions at a glance: which of
 * these am I acting as, which one needs me, and how do I make another.
 *
 * **Thin by construction.** The first paint comes from the SSR-resolved roster passed in as `initial`, so
 * the cards are in the first byte; filtering and tab partitioning are PURE (`filterRoster`) and run
 * locally with no round-trip, because the roster is a handful of rows the server already sent. Only the
 * three things that genuinely change server state — answering an invitation, archiving, switching the
 * acting context — go over the wire, each through the thin {@link WorkspaceService} (root CLAUDE.md §2:
 * islands `fetch` internal API routes and nothing else).
 *
 * **The grid⇄table control is not here.** It lives in the middle-nav footer band and writes the shared
 * `rosterView` signal, which this island only reads — the footer band is a separate hydration root, so a
 * module-level signal is the sanctioned channel between them (`workspace-state.ts`).
 *
 * **A mutation is reconciled from the server, never patched locally.** Answering an invitation resolves to
 * a fully refreshed roster and that replaces the whole page state, so a membership the server clamped or
 * refused cannot survive on screen as a row the reader believes in.
 */

// #region Props
export interface WorkspaceRosterProps {
	/** The entity kind this index addresses — the route base it was reached through. */
	kind: WorkspaceKind;
	/** The SSR-resolved roster, so the first paint already carries the cards. */
	initial: RosterPage;
	/**
	 * Set when the server could not read the roster. The page then says so and offers a retry, instead
	 * of drawing the selling empty state — "you have no teams yet" is a false statement about somebody
	 * whose teams merely failed to load.
	 */
	initialError?: string | null;
	/** The partition the URL asked for (`?tab=`). */
	initialTab?: string | null;
	/** The free-text filter the URL carried (`?q=`). */
	initialSearch?: string;
	/**
	 * Open the creation modal on mount — set by the `/teams/create` and `/businesses/create` addresses,
	 * so a deep link or a shared URL lands on the same modal the ＋ New control opens rather than a
	 * separate page that would have to be kept in step with it.
	 */
	autoCreate?: boolean;
	/**
	 * Why the viewer was sent here (`?notice=`). `unavailable` — a console they followed a link to is not
	 * theirs to open; the line says so without saying whether the entity exists.
	 */
	initialNotice?: RosterNotice | null;
}
// #endregion

export default function WorkspaceRoster(props: WorkspaceRosterProps): JSX.Element {
	const copy = kindCopy(props.kind);

	// #region State
	const roster = useSignal<RosterPage>(props.initial);
	const tab = useSignal<RosterTab>(toRosterTab(props.initialTab ?? null));
	const search = useSignal(props.initialSearch ?? "");
	const stripDismissed = useSignal(false);
	/** A failure the reader can act on — rendered as an alert with a retry. */
	const notice = useSignal<string | null>(props.initialError ?? null);
	/** A confirmation of something that worked — rendered as a quiet status, never as an alert. */
	const info = useSignal<string | null>(null);
	/** Whether the roster on screen is a real read; `false` until a failed first read is retried. */
	const loaded = useSignal(!props.initialError);
	const refreshing = useSignal(false);

	const { switching, error: switchError, switchTo, exitToPersonal } = useContextSwitch();

	// The `/create` deep link opens the modal once on arrival. Keyed on the flag rather than run bare, so
	// a re-render cannot reopen a modal the user has just dismissed.
	useEffect(() => {
		if (props.autoCreate) openCreate(props.kind);
	}, [props.autoCreate, props.kind]);
	// #endregion

	// #region Derived
	const invitations = useComputed(() => roster.value.invitations);
	/** The strip's answers: optimistic, restored with their refusal; a landed one re-reads the roster. */
	const answers = useInvitationAnswers(invitations, () => refresh());
	const invites = answers.visible;
	const counts = useComputed(() => rosterTabCounts(roster.value.items, invites.value));
	const rows = useComputed(() => filterRoster(roster.value.items, tab.value, search.value));
	const searching = useComputed(() => search.value.trim().length > 0);
	/** Nothing at all yet — the only condition that earns the selling empty state. */
	const firstRun = useComputed(() =>
		loaded.value && roster.value.items.length === 0 && invites.value.length === 0 &&
		!searching.value
	);
	const stripVisible = useComputed(() =>
		invitationStripShown({
			waiting: invites.value.length,
			answeredHere: answers.answeredHere.value,
			dismissed: stripDismissed.value,
			onInvitationsTab: tab.value === "invitations",
		})
	);
	/** On the Invitations tab the strip is the one list and its one empty line; the body defers to it. */
	const stripIsTheList = useComputed(() =>
		invitationStripIsTheList({
			shown: stripVisible.value,
			onInvitationsTab: tab.value === "invitations",
		})
	);
	// #endregion

	// #region URL memory
	/**
	 * Keep the partition and the search term in the address bar so a filtered roster is a shareable link
	 * and a reload lands where the reader was.
	 *
	 * `replaceState`, not `pushState`: flicking between five partitions is not five navigations, and
	 * making Back undo a tab click would strand the reader inside the page instead of returning them to
	 * wherever they came from.
	 */
	useEffect(() => {
		const url = new URL(globalThis.location.href);
		const nextTab = tab.value;
		const nextSearch = search.value.trim();
		if (nextTab === "all") url.searchParams.delete("tab");
		else url.searchParams.set("tab", nextTab);
		if (nextSearch) url.searchParams.set("q", nextSearch);
		else url.searchParams.delete("q");
		const next = `${url.pathname}${url.search}`;
		if (next !== globalThis.location.pathname + globalThis.location.search) {
			globalThis.history.replaceState(null, "", next);
		}
	}, [tab.value, search.value]);
	// #endregion

	// #region Server reads
	/** Re-read the roster after a mutation whose response is not itself a roster. Resolves `true` on success. */
	async function refresh(): Promise<boolean> {
		refreshing.value = true;
		const res = await WorkspaceService.roster(props.kind);
		refreshing.value = false;
		if (res.ok && res.data) {
			roster.value = res.data;
			loaded.value = true;
			notice.value = null;
			return true;
		}
		notice.value = res.message ?? `Couldn't refresh your ${copy.plural}.`;
		return false;
	}
	// #endregion

	// #region Invitations
	/**
	 * Answer from the strip. A page-level message about an earlier act is stale once the reader moves
	 * on; the answer's own outcome, or its refusal, is the strip's to show beside the row.
	 */
	function respond(invite: IncomingInvite, accept: boolean): void {
		notice.value = null;
		info.value = null;
		void answers.respond(invite, accept);
	}
	// #endregion

	// #region Card + row actions
	async function onAction(action: WorkspaceCardAction, summary: WorkspaceSummary): Promise<void> {
		notice.value = null;
		info.value = null;
		switch (action) {
			case "act":
				// Landing inside the entity is the point of switching, so the destination is its console.
				await switchTo(props.kind, summary.id, {
					destination: workspaceHref(summary.kind, summary.handle),
					handle: summary.handle,
				});
				return;
			case "exit":
				await exitToPersonal();
				return;
			case "profile":
				navigate(`/@${summary.handle}`);
				return;
			case "wallet":
				navigate(walletHrefFor(summary.kind, summary.id));
				return;
			case "copy":
				await copyLink(workspaceHref(summary.kind, summary.handle), summary.name);
				return;
			case "archive":
			case "restore": {
				const status = action === "archive" ? "archived" : "active";
				const res = await WorkspaceService.update({ kind: summary.kind, id: summary.id, status });
				if (!res.ok) {
					notice.value = res.message ??
						`Couldn't ${action} ${summary.name}. Nothing was changed.`;
					return;
				}
				if (await refresh()) {
					info.value = action === "archive"
						? `${summary.name} is archived. It is still restorable from the Archived tab.`
						: `${summary.name} is active again.`;
				}
				return;
			}
		}
	}

	async function copyLink(href: string, name: string): Promise<void> {
		try {
			const url = new URL(href, globalThis.location.origin).toString();
			await globalThis.navigator.clipboard.writeText(url);
			info.value = `Link to ${name} copied.`;
		} catch {
			notice.value = "Couldn't reach the clipboard — copy the address from the URL bar instead.";
		}
	}

	function navigate(href: string): void {
		try {
			globalThis.location.assign(href);
		} catch { /* no window — non-fatal */ }
	}
	// #endregion

	const bodyId = "wsp-roster-body";
	const bodyRef = useRef<HTMLDivElement>(null);

	// `Ctrl`+wheel / pinch over the collection scales it, the same gesture the File Explorer answers —
	// so the reader reaches the density without travelling to the footer band at all.
	useCtrlWheelZoom(bodyRef, workspaceZoom);

	return (
		<div class="wsp" data-kind={props.kind}>
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" data-i={0}>
					<div class="wsp-band__inner">
						<div class="wsp-roster">
							<div class="wsp-roster__head">
								<div>
									<h1 class="wsp-roster__title">{copy.Plural}</h1>
									<p class="wsp-roster__pitch">{copy.pitch}</p>
								</div>

								<div class="wsp-roster__tools">
									<InputText
										value={search}
										type="search"
										variant="bare"
										size="sm"
										placeholder={`Search ${copy.plural}`}
										aria-label={`Search your ${copy.plural}`}
										start={<span aria-hidden="true">{cloneGlyph(SearchGlyph)}</span>}
									/>
									<div
										class="wsp-roster__tabs"
										role="tablist"
										aria-label={`Filter ${copy.plural}`}
									>
										{ROSTER_TABS.map((option) => (
											<button
												key={option.value}
												type="button"
												role="tab"
												class="wsp-roster__tab"
												aria-selected={tab.value === option.value}
												aria-controls={bodyId}
												onClick={() => (tab.value = option.value)}
											>
												{option.label}
												<span class="wsp-roster__tab-count wsp-num">
													{counts.value[option.value]}
												</span>
											</button>
										))}
									</div>
								</div>
							</div>
						</div>
					</div>
				</section>

				{stripVisible.value && (
					<section class="wsp-band wsp-band--plain" data-i={1}>
						<div class="wsp-band__inner">
							<InvitationStrip
								invitations={invites.value}
								actions={answers.actions.value}
								refusals={answers.refusals.value}
								outcome={answers.outcome.value}
								onRespond={respond}
								dismissible={invitationStripDismissible({
									onInvitationsTab: tab.value === "invitations",
								})}
								onDismiss={() => (stripDismissed.value = true)}
							/>
						</div>
					</section>
				)}

				<section class="wsp-band wsp-band--page" data-i={2}>
					<div class="wsp-band__inner">
						{
							/*
							 * A context switch is a full page load, so it must be announced rather than left to
							 * look like an unresponsive click (the hook's stated obligation on its callers).
							 */
						}
						{switching.value && (
							<p class="wsp-roster__count" role="status" aria-live="polite" aria-busy="true">
								Switching context…
							</p>
						)}

						{props.initialNotice === "unavailable" && (
							<InlineNotice align="start" text={`That ${copy.noun} isn't available to you`} />
						)}

						{(notice.value ?? switchError.value) && (
							<div class="wsp-error">
								<Message
									class="wsp-error__alert"
									severity="danger"
									variant="subtle"
									text={notice.value ?? switchError.value ?? ""}
								/>
								<button
									type="button"
									class="wsp-error__retry"
									onClick={() => void refresh()}
								>
									Try again
								</button>
							</div>
						)}
						{info.value && !notice.value && (
							<Message
								class="wsp-error__alert"
								severity="success"
								variant="subtle"
								text={info.value}
							/>
						)}

						<div
							ref={bodyRef}
							id={bodyId}
							class="wsp-roster__body"
							role="tabpanel"
							aria-busy={refreshing.value ? "true" : undefined}
						>
							{firstRun.value
								? (
									<RosterEmpty
										kind={props.kind}
										canCreate={roster.value.canCreate}
										blockedReason={roster.value.createBlockedReason}
										onCreate={() => openCreate(props.kind)}
									/>
								)
								: !stripIsTheList.value && (
									<>
										<p class="wsp-roster__count" aria-live="polite">
											{countLabel(props.kind, rows.value.length)}
											{searching.value ? " matching" : ""}
										</p>
										<RosterBody
											kind={props.kind}
											tab={tab.value}
											rows={rows.value}
											busy={switching.value}
											searching={searching.value}
											onAction={onAction}
											onClearSearch={() => (search.value = "")}
											onCreate={() => openCreate(props.kind)}
										/>
									</>
								)}
						</div>
					</div>
				</section>
			</div>

			{
				/*
				 * Mounted HERE, once, because the index is where creation belongs and this island is on every
				 * `/teams` · `/businesses` index render. A console route must mount it itself — see the note in
				 * `CreateWorkspaceModal`; two mounted instances would paint two dialogs.
				 */
			}
			<CreateWorkspaceModal kind={props.kind} />
		</div>
	);
}

// #region The collection
/**
 * The rows themselves, in whichever presentation the footer band has selected.
 *
 * Split out of the root so a grid⇄table flip re-renders only the collection and not the page head, the
 * search field or the invitation strip — the `rosterView` signal is read here and nowhere above.
 */
function RosterBody(
	props: {
		kind: WorkspaceKind;
		tab: RosterTab;
		rows: WorkspaceSummary[];
		busy: boolean;
		searching: boolean;
		onAction: (action: WorkspaceCardAction, summary: WorkspaceSummary) => void;
		onClearSearch: () => void;
		onCreate: () => void;
	},
): JSX.Element {
	const copy = kindCopy(props.kind);
	const label = `Your ${copy.plural}`;

	if (props.rows.length === 0) {
		if (props.tab === "invitations") {
			return (
				<RosterBlank
					text="No invitations waiting."
					hint={`Anyone can invite you to a ${copy.noun}; when they do, it appears here and at the top of this page.`}
				/>
			);
		}
		if (props.searching) {
			return (
				<RosterBlank
					text={`Nothing matches that.`}
					hint="Try a shorter term, or clear the search to see everything again."
				/>
			);
		}
		if (props.tab === "archived") {
			return (
				<RosterBlank
					text="Nothing archived."
					hint={`A ${copy.noun} you are finished with is archived rather than deleted, and shows up here.`}
				/>
			);
		}
		return (
			<RosterBlank
				text={props.tab === "owned"
					? `You do not own a ${copy.noun} yet.`
					: `You are not a member of anyone else's ${copy.noun}.`}
				hint={props.tab === "owned"
					? `Creating one takes a name — everything else you finish inside.`
					: `You will appear here once you accept an invitation.`}
			/>
		);
	}

	if (rosterView.value === "table") {
		return (
			<WorkspaceTable
				items={props.rows}
				hrefFor={(s) => workspaceHref(s.kind, s.handle)}
				busy={props.busy}
				label={label}
				onAction={props.onAction}
			/>
		);
	}

	return (
		/* The card size is the zoom's grid half, so the slider scales the cards themselves rather than
		   merely choosing between two fixed presentations. */
		<Grid
			class="wsp-grid"
			role="list"
			aria-label={label}
			minChildWidth={`${gridColWidth(displayZoom.value)}px`}
			fit="exact"
			maxCols={4}
			gap={4}
		>
			{props.rows.map((summary) => (
				<WorkspaceCard
					key={summary.id}
					summary={summary}
					href={workspaceHref(summary.kind, summary.handle)}
					busy={props.busy}
					onAction={props.onAction}
				/>
			))}
		</Grid>
	);
}
// #endregion
