import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Grid } from "@projective/ui/layout";
import { MetaLine } from "@projective/ui/display";
import { Button, InputText } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { TabMenu } from "@projective/ui/navigation";
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
import {
	openCreate,
	publishRosterFirstRun,
	rosterTabOr,
	rosterView,
	selectRosterTab,
} from "../core/workspace-state.ts";
import { displayZoom, gridColWidth, workspaceZoom } from "../core/view-state.ts";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import {
	filterRoster,
	isFiltered,
	isFirstRun,
	ROSTER_TABS,
	rosterCanvasControls,
	rosterCanvasState,
	rosterCountLine,
	rosterEmptyCopy,
	rosterFirstRunCopy,
	rosterHeadMeta,
	rosterSearch,
	type RosterTab,
	rosterTabBadge,
	rosterTabCounts,
	rosterTabIndex,
	rosterToolsShown,
	rosterTrackWidth,
	toRosterTab,
} from "../core/roster-model.ts";
import { restoredNotice } from "../core/settings-model.ts";
import { tierProps } from "../core/create-model.ts";
import { cloneGlyph, DeclineGlyph, SearchGlyph } from "../core/workspace-glyphs.tsx";
import { WorkspaceCard, type WorkspaceCardAction } from "../components/WorkspaceCard.tsx";
import { WorkspaceTable } from "../components/WorkspaceTable.tsx";
import { InvitationStrip } from "../components/InvitationStrip.tsx";
import { RosterFiltered, RosterFirstRun } from "../components/RosterEmpty.tsx";
import CreateWorkspaceModal from "./CreateWorkspaceModal.island.tsx";

/**
 * WorkspaceRoster — the body of the `/teams` and `/businesses` INDEX, built on `@projective/ui`
 * primitives (Teams work order R1).
 *
 * One island serves both kinds; everything that differs is a lookup in the SSOT's per-kind copy table
 * ({@link kindCopy}) or in `roster-model.ts`, never a branch on kind in markup. Every rule it renders
 * — the five canvas states, the controls each state draws and their Button-matrix tiers, the head's
 * facts, the address — is a pure function there, pinned by `roster-model.test.ts`; this island only
 * binds them.
 *
 *   - **Head** — the kind's title in the display register over ONE `MetaLine` (`3 teams · 1
 *     invitation waiting · Acting as North Loop`), the search field, and the partition `TabMenu`
 *     (All · Owned · Member · Invitations · Archived, each with its count `Badge`). No filled button:
 *     the index's one structural create is the lane footer's, and the canvas never duplicates it.
 *   - **Body** — the invitation strip, then the cards or the `DataTable`, whichever the shared zoom
 *     selects; a ui `EmptyState` in first run (with the create, which the lane and the footer band's
 *     rig then withhold) and
 *     when a filter leaves nothing (with a tier-5 Clear filters); a danger `InlineNotice` with a
 *     tier-4 Try again when the roster could not be read.
 *
 * **One partition across roots.** The TabMenu and the lane's segmented control write the ONE
 * `rosterTab` signal (`workspace-state`); each renders its server-resolved `?view=` until a control
 * picks one, so the first painted byte and the hydrated frame agree. The address follows from a
 * `useSignalEffect` here — `?view=` and `?q=` through `replaceState`, the one-shot `?notice=` and the
 * pre-R1 `?tab=` dropped — so it tracks the lane's picks too.
 *
 * **Thin by construction.** The first paint comes from the SSR-resolved roster passed in as
 * `initial`; filtering is pure and local. Only answering an invitation, archiving, and switching the
 * acting context go over the wire, each through the thin {@link WorkspaceService} (root CLAUDE.md §2),
 * and a mutation is reconciled by re-reading the roster, never patched locally.
 */

// #region Props
/** Props for {@link WorkspaceRoster}. */
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
	/** The partition the URL asked for (`?view=`, or the pre-R1 `?tab=`). */
	initialTab?: string | null;
	/** The free-text filter the URL carried (`?q=`). */
	initialSearch?: string;
	/**
	 * Open the creation modal on mount — set by the `/teams/create` and `/businesses/create` addresses,
	 * so a deep link lands on the same modal the lane's New opens rather than a separate page.
	 */
	autoCreate?: boolean;
	/**
	 * Why the viewer was sent here (`?notice=`). `unavailable` — a console they followed a link to is not
	 * theirs to open; the line says so without saying whether the entity exists.
	 */
	initialNotice?: RosterNotice | null;
}
// #endregion

const BODY_ID = "wsp-roster-body";
const TABS_ID = "wsp-roster-tabs";
const SEARCH_ID = "wsp-roster-search";

export default function WorkspaceRoster(props: WorkspaceRosterProps): JSX.Element {
	const copy = kindCopy(props.kind);
	const resolvedTab = toRosterTab(props.initialTab);

	// #region State
	const roster = useSignal<RosterPage>(props.initial);
	const search = useSignal(props.initialSearch ?? "");
	const stripDismissed = useSignal(false);
	const noticeDismissed = useSignal(false);
	/** Why the last roster READ failed — the danger notice with Try again. */
	const readError = useSignal<string | null>(props.initialError ?? null);
	/** Why the last ACT failed (archive, restore, copy) — said, with no retry: the menu repeats it. */
	const actionError = useSignal<string | null>(null);
	/** A confirmation of something that worked — a quiet status line, never an alert. */
	const info = useSignal<string | null>(null);
	/** Whether a roster read has succeeded since the page loaded. */
	const loaded = useSignal(!props.initialError);
	const refreshing = useSignal(false);

	const { switching, error: switchError, switchTo, exitToPersonal } = useContextSwitch();

	// The `/create` deep link opens the modal once on arrival; it reads no signal, so it never re-runs
	// and cannot reopen a modal the reader has just dismissed.
	useSignalEffect(() => {
		if (props.autoCreate) openCreate(props.kind);
	});
	// #endregion

	// #region Derived
	/** The ONE shared partition, or this page's server-resolved one until a control picks one. */
	const tab = useComputed<RosterTab>(() => rosterTabOr(resolvedTab));
	/** The TabMenu binds a writable index; it follows the shared partition whichever root picked it. */
	const tabIndex = useSignal(rosterTabIndex(resolvedTab));
	useSignalEffect(() => {
		tabIndex.value = rosterTabIndex(tab.value);
	});

	const invitations = useComputed(() => roster.value.invitations);
	/** The strip's answers: optimistic, restored with their refusal; a landed one re-reads the roster. */
	const answers = useInvitationAnswers(invitations, () => refresh());
	const invites = answers.visible;
	const counts = useComputed(() => rosterTabCounts(roster.value.items, invites.value));
	const rows = useComputed(() => filterRoster(roster.value.items, tab.value, search.value));
	const filtered = useComputed(() => isFiltered(tab.value, search.value));

	const stripVisible = useComputed(() =>
		invitationStripShown({
			waiting: invites.value.length,
			answeredHere: answers.answeredHere.value,
			dismissed: stripDismissed.value,
			onInvitationsTab: tab.value === "invitations",
		})
	);
	/** On the Invitations partition the strip is the one list and its one empty line. */
	const stripIsTheList = useComputed(() =>
		invitationStripIsTheList({
			shown: stripVisible.value,
			onInvitationsTab: tab.value === "invitations",
		})
	);

	const firstRun = useComputed(() =>
		isFirstRun({
			loaded: loaded.value,
			entityCount: roster.value.items.length,
			invitationCount: invites.value.length,
		})
	);
	const state = useComputed(() =>
		rosterCanvasState({
			loaded: loaded.value,
			entityCount: roster.value.items.length,
			invitationCount: invites.value.length,
			rowCount: rows.value.length,
			stripIsTheList: stripIsTheList.value,
		})
	);
	const controls = useComputed(() =>
		rosterCanvasControls({
			kind: props.kind,
			state: state.value,
			canCreate: roster.value.canCreate,
			filtered: filtered.value,
			readError: readError.value !== null,
		})
	);
	const control = (key: "create" | "clear" | "retry") =>
		controls.value.find((c) => c.key === key) ?? null;
	const tools = useComputed(() => rosterToolsShown(state.value));

	const actingName = useComputed(() =>
		roster.value.items.find((item) => item.isActing)?.name ?? null
	);

	// The lane's footer and the footer band's rig withhold their creates while this canvas's first-run
	// state carries it; both are other hydration roots, so the reading travels through the shared signal.
	useSignalEffect(() => {
		publishRosterFirstRun(firstRun.value);
	});
	// #endregion

	// #region URL memory
	/**
	 * Keep the partition and the search term in the address bar so a filtered roster is a shareable link
	 * and a reload lands where the reader was — whichever root picked the partition. `replaceState`, not
	 * `pushState`: flicking between partitions is not a navigation, and making Back undo a tab click
	 * would strand the reader inside the page instead of returning them to wherever they came from.
	 */
	useSignalEffect(() => {
		const location = globalThis.location;
		const history = globalThis.history;
		const next = rosterSearch(location.search, tab.value, search.value);
		if (next === location.search) return;
		try {
			history.replaceState(history.state, "", `${location.pathname}${next}${location.hash}`);
		} catch { /* an address that cannot be rewritten still leaves the page on the picked view */ }
	});
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
			readError.value = null;
			return true;
		}
		readError.value = res.message ?? `We couldn't load your ${copy.plural} just now.`;
		return false;
	}

	/**
	 * Try again. The notice and its button leave once the read lands, so focus — if it rode on the
	 * button — moves to the body that now holds the answer instead of dropping to the page.
	 */
	async function retry(event: Event): Promise<void> {
		const held = event.currentTarget === globalThis.document.activeElement;
		if (await refresh() && held) bodyRef.current?.focus();
	}
	// #endregion

	// #region Invitations
	/**
	 * Answer from the strip. A page-level message about an earlier act is stale once the reader moves
	 * on; the answer's own outcome, or its refusal, is the strip's to show beside the row.
	 */
	function respond(invite: IncomingInvite, accept: boolean): void {
		actionError.value = null;
		info.value = null;
		void answers.respond(invite, accept);
	}
	// #endregion

	// #region Card + row actions
	async function onAction(action: WorkspaceCardAction, summary: WorkspaceSummary): Promise<void> {
		actionError.value = null;
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
				// A restore lands where the server decides (Decision #250 (c)): live if it ever was.
				const status = action === "archive" ? "archived" : "restore";
				const res = await WorkspaceService.update({ kind: summary.kind, id: summary.id, status });
				if (!res.ok) {
					actionError.value = res.message ??
						`Couldn't ${action} ${summary.name}. Nothing was changed.`;
					return;
				}
				if (await refresh()) {
					info.value = action === "archive"
						? `${summary.name} is archived. It is still restorable from Archived.`
						: restoredNotice(summary.kind, summary.name, res.data?.status);
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
			actionError.value =
				"Couldn't reach the clipboard — copy the address from the URL bar instead.";
		}
	}

	function navigate(href: string): void {
		try {
			globalThis.location.assign(href);
		} catch { /* no window — non-fatal */ }
	}
	// #endregion

	// #region Focus continuity
	/**
	 * Land focus on the search field — the head's first control — or, without one, on the body. Called
	 * when the control that held it (Clear filters, the notice's Dismiss) is about to unmount.
	 */
	function landFocus(): void {
		const field = globalThis.document.getElementById(SEARCH_ID);
		if (field) field.focus();
		else bodyRef.current?.focus();
	}

	/** Clear filters: every entity again — the All partition on every root, and no search term. */
	function clearFilters(): void {
		landFocus();
		search.value = "";
		selectRosterTab("all");
	}
	// #endregion

	const bodyRef = useRef<HTMLDivElement>(null);

	// `Ctrl`+wheel / pinch over the collection scales it, the same gesture the File Explorer answers —
	// so the reader reaches the density without travelling to the footer band at all.
	useCtrlWheelZoom(bodyRef, workspaceZoom);

	const failure = actionError.value ?? switchError.value;
	const retryControl = control("retry");
	const createControl = control("create");
	const clearControl = control("clear");

	return (
		<div class="wsp" data-kind={props.kind}>
			<div class="wsp__stack">
				{/* #region Head */}
				<section class="wsp-band wsp-band--head" data-i={0}>
					<div class="wsp-band__inner">
						<div class="wsp-roster">
							<div class="wsp-roster__head">
								<div class="wsp-roster__heading">
									<h1 class="wsp-roster__title">{copy.Plural}</h1>
									<MetaLine
										class="wsp-roster__meta"
										items={rosterHeadMeta(props.kind, {
											state: state.value,
											liveCount: counts.value.all,
											invitationCount: invites.value.length,
											actingName: actingName.value,
										})}
									/>
								</div>
								{tools.value && (
									<InputText
										id={SEARCH_ID}
										class="wsp-roster__search"
										value={search}
										type="search"
										variant="bare"
										size="sm"
										placeholder={`Search ${copy.plural}`}
										aria-label={`Search your ${copy.plural}`}
										start={<span aria-hidden="true">{cloneGlyph(SearchGlyph)}</span>}
									/>
								)}
							</div>
							{tools.value && (
								<TabMenu
									id={TABS_ID}
									class="wsp-roster__tabs"
									model={ROSTER_TABS.map((option) => ({
										key: option.value,
										label: option.label,
										badge: rosterTabBadge(option.value, counts.value),
									}))}
									activeIndex={tabIndex}
									onActiveIndexChange={(index) => {
										const next = ROSTER_TABS[index];
										if (next) selectRosterTab(next.value);
									}}
									panelId={BODY_ID}
									aria-label={`Show ${copy.plural}`}
								/>
							)}
						</div>
					</div>
				</section>
				{/* #endregion */}

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

				{/* #region Body */}
				<section class="wsp-band wsp-band--page" data-i={2}>
					<div class="wsp-band__inner">
						{props.initialNotice === "unavailable" && !noticeDismissed.value && (
							<InlineNotice
								class="wsp-roster__notice"
								align="start"
								text={`That ${copy.noun} isn't available to you`}
								actionLabel="Dismiss"
								onAction={() => {
									landFocus();
									noticeDismissed.value = true;
								}}
							/>
						)}

						{
							/*
							 * A context switch is a full page load, so it is announced rather than left to look
							 * like an unresponsive click (the hook's stated obligation on its callers).
							 */
						}
						{switching.value && (
							<p class="wsp-roster__status" role="status" aria-live="polite" aria-busy="true">
								Switching context…
							</p>
						)}

						{readError.value && (
							<div class="wsp-roster__error">
								<RosterAlert text={readError.value} />
								{retryControl && (
									<Button
										{...tierProps(retryControl.tier)}
										size="sm"
										label={retryControl.label}
										loading={refreshing.value}
										onClick={(event) => void retry(event)}
									/>
								)}
							</div>
						)}
						{failure && <RosterAlert text={failure} />}
						{info.value && !failure && (
							<InlineNotice class="wsp-roster__notice" align="start" text={info.value} />
						)}

						<div
							ref={bodyRef}
							id={BODY_ID}
							class="wsp-roster__body"
							role={tools.value ? "tabpanel" : undefined}
							aria-labelledby={tools.value ? `${TABS_ID}-tab-${tabIndex.value}` : undefined}
							aria-busy={refreshing.value ? "true" : undefined}
							tabIndex={-1}
						>
							{tools.value && (
								<p class="wsp-roster__count" aria-live="polite">
									{rosterCountLine(props.kind, {
										state: state.value,
										tab: tab.value,
										search: search.value,
										rowCount: rows.value.length,
									})}
								</p>
							)}
							{state.value === "first-run" && (
								<RosterFirstRun
									copy={rosterFirstRunCopy(
										props.kind,
										roster.value.canCreate ? null : roster.value.createBlockedReason,
									)}
									create={createControl}
									onCreate={() => openCreate(props.kind)}
								/>
							)}
							{state.value === "empty" && (
								<RosterFiltered
									copy={rosterEmptyCopy(props.kind, {
										tab: tab.value,
										search: search.value,
										archivedCount: counts.value.archived,
										stripShown: stripVisible.value,
									})}
									clear={clearControl}
									onClear={clearFilters}
								/>
							)}
							{state.value === "populated" && (
								<RosterBody
									kind={props.kind}
									rows={rows.value}
									busy={switching.value}
									onAction={onAction}
								/>
							)}
						</div>
					</div>
				</section>
				{/* #endregion */}
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

// #region Alerts
/**
 * A failure the reader must hear: an assertive `InlineNotice` whose leading mark carries the danger
 * hue (the sentence stays in the meta ink, as the create dialog's refusals do).
 */
function RosterAlert(props: { text: string }): JSX.Element {
	return (
		<InlineNotice
			assertive
			align="start"
			class="wsp-roster__alert"
			icon={<span class="wsp-roster__alert-mark">{cloneGlyph(DeclineGlyph)}</span>}
			text={props.text}
		/>
	);
}
// #endregion

// #region The collection
/**
 * The rows themselves, in whichever presentation the shared zoom selects.
 *
 * Split out of the root so a grid⇄table flip re-renders only the collection and not the head, the
 * search field or the invitation strip — the `rosterView` signal is read here and nowhere above.
 */
function RosterBody(
	props: {
		kind: WorkspaceKind;
		rows: WorkspaceSummary[];
		busy: boolean;
		onAction: (action: WorkspaceCardAction, summary: WorkspaceSummary) => void;
	},
): JSX.Element {
	const label = `Your ${kindCopy(props.kind).plural}`;

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
		/* The card size is the zoom's grid half, so the slider scales the cards themselves; a single
		   column takes the whole row (`rosterTrackWidth`). */
		<Grid
			class="wsp-grid"
			role="list"
			aria-label={label}
			minChildWidth={rosterTrackWidth(gridColWidth(displayZoom.value))}
			fit="exact"
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
