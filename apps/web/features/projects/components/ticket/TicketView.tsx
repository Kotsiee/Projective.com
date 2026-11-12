import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
/*
 * The ticket surface carries its OWN stylesheet.
 *
 * Shared CSS reaches a page only through an ISLAND's module graph (root CLAUDE.md §8 Decision #39), and
 * this sheet used to be imported by `ProjectBoard.island.tsx` alone. That was invisible for as long as
 * the board was the only thing that opened a ticket — and the moment a second surface mounted one (the
 * basket, from a ticket row) the modal rendered with NO styles at all: `.tkv` computed as a bare
 * `display: block` div at static position with no background, measured.
 *
 * Importing it HERE makes the component self-contained, so any island that mounts a ticket gets the
 * ticket's appearance with it and no call site has to know the list. Vite dedupes, so the board's own
 * import of the same sheet costs nothing. The tabs do the same for the `/files` and `/submissions`
 * sheets they mount.
 */
import "../../styles/ticket-view.css";
import { useSignal } from "@preact/signals";
import { Backdrop, BodyPortal, useFrameScroll, useFrameState } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useMediaQuery, useOverlayStack } from "@projective/ui/hooks";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { Button, InlineEdit, InputText } from "@projective/ui/fields";
import { ConfirmDialog, Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { ContextType } from "@projective/types/auth";
import type {
	BoardCard,
	BoardStageRef,
	ProjectParty,
	TicketStageRef,
} from "../../types/projects-types.ts";
import { isSharedWorkspace, stageIntensityLocked } from "../../types/projects-types.ts";
import { statusLabel, statusTone } from "../../core/board-model.ts";
import {
	applyTicketIntensity,
	blankStageRef,
	patchStageDue,
	reconcileCard,
	stageOps,
	ticketDueMode,
	ticketFingerprint,
	ticketGate,
	ticketTotals,
} from "../../core/ticket-model.ts";
import {
	activeStagesFor,
	panelFor,
	resolveTicketStages,
	ticketMetrics,
	type TicketMode,
	ticketMoney,
	ticketStack,
	type TicketStageView,
	type TicketTab,
	ticketTabs,
} from "../../core/ticket-view.ts";
import { FILE_FRAME_TRIGGER } from "../../core/file-frame.ts";
import { type PipelineDrop, placeStage, swapStage } from "../../core/stage-pipeline.ts";
import { inclusionRefusal, pipelineLocks, removalRefusal } from "../../core/stage-menu.ts";
import { TicketMetaBar } from "./TicketMetaBar.tsx";
import { TicketActivityPanel } from "./TicketActivityPanel.tsx";
import { TicketFooter } from "./TicketFooter.tsx";
import { StageInspector } from "./StageInspector.tsx";
import { TicketDetailsTab } from "./tabs/TicketDetailsTab.tsx";
import { TicketStagesTab } from "./tabs/TicketStagesTab.tsx";
import { TicketFinanceTab } from "./tabs/TicketFinanceTab.tsx";
import { TicketAttachmentsTab } from "./tabs/TicketAttachmentsTab.tsx";
import { TicketHistoryTab } from "./tabs/TicketHistoryTab.tsx";
import { TicketSubmissionsTab } from "./tabs/TicketSubmissionsTab.tsx";
import { TicketTimelineTab } from "./tabs/TicketTimelineTab.tsx";
import { UserAvatarStack } from "@web/components/UserAvatar.tsx";
import { FundingStatus } from "../FundingStatus.tsx";
import {
	draftStep,
	fundingAction,
	fundingDateLabel,
	previewFunding,
} from "../../core/funding-ui.ts";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";

/**
 * TicketView — the ONE ticket surface. Creating, reading and editing a ticket are the same modal.
 *
 * They used to be two components, and the split cost more than it saved: the composer and the detail
 * modal each owned a description field, a task list, an attachment flow and a stage pipeline, which
 * is four pairs of things that had to be kept in agreement by hand. Worse, it made "edit this ticket"
 * a mode switch — you left the document you were reading, arrived somewhere that looked nothing like
 * it, and came back to find your reading position gone. Now the document IS the editor: a seat with
 * the right rewrites what it is reading in place, and a seat without it sees prose and no affordance.
 *
 * Three region rules govern the layout, and none of them is decoration:
 *
 *  - **The left area answers, the right area orients.** Tabs hold content; the side panel holds
 *    context — recent activity while you read a saved ticket's brief, the selected stage while you
 *    work its pipeline, and while a ticket is being CREATED its stages themselves (which ones, and
 *    each one's settings) beside the brief they are priced against. Where the modal is too narrow
 *    for a panel, the stages are worked in the Stages tab, the inspector replacing the list.
 *  - **Separation is spacing, tone and a single hairline** — never a box inside a box (§B.4). The
 *    only full borders in here belong to interactive controls.
 *  - **Intensity names its price, never a badge.** Low/Standard/High is what a client chose; its
 *    controls state the price multiplier (`Low (0.75×)`) or the stage's tier price, and the Finances
 *    tab shows the arithmetic. A stage sold at one fixed intensity reads it as text.
 *
 * Edits are STAGED, not live. The working copy diverges from the ticket the modal was opened on, the
 * footer grows a Save the moment it does, and nothing reaches the board until it is pressed — so a
 * half-typed brief is never something a freelancer can read, and Discard is always a real option.
 * Escape, the scrim and the close control ask before throwing unsaved work away.
 *
 * Mounted through {@link BodyPortal} so its `position: fixed` resolves against the viewport rather
 * than the glass-blurred shell that opened it. Its live UI state — working copy, tab, panel, scroll,
 * submission path — is held in the {@link ticketStack} frame's cache, so opening a review and coming
 * back restores the surface the viewer left, unsaved edits included.
 */
export interface TicketViewProps {
	/** The frame's identity in the modal stack — the key its cached state hangs off. */
	uid: number;
	/** Whether this ticket exists yet. The only thing that differs, and it differs in four places. */
	mode: TicketMode;
	card: BoardCard;
	/** The engagement's live stages, for the facts the ticket never captured (roster, routing, cap). */
	stages: BoardStageRef[];
	/** Every ticket on the board — the stage inspector shows the load already in a stage. */
	cards: BoardCard[];
	/** Whether the viewer may rewrite the ticket's content. */
	canEdit: boolean;
	/**
	 * Whether a create of this ticket is awaiting the server. The host re-points the frame when the
	 * answer lands, which it can only do while the ticket is on top, so nothing replaces it meanwhile.
	 */
	saving?: boolean;
	/** Whether the viewer acts on the provider side — gates the Create Submission actions. */
	isFreelancer: boolean;
	/** Whether the viewer acts on the client side — gates attachment upload + the owner selector. */
	isClient: boolean;
	/** Which workspace owns the buying side — decides whether the owner selector exists at all. */
	workspaceKind: ContextType;
	workspaceLabel: string;
	/** The client-side seats a ticket can be handed to; empty on a personal engagement. */
	clientMembers: ProjectParty[];
	projectId: string;
	/**
	 * The reference instant the Timeline tab measures "overdue" against, epoch ms. A host built from
	 * a fixture corpus passes that corpus's pinned clock; absent → the real clock.
	 */
	now?: number;
	/**
	 * Whether the engagement has a time axis for the Timeline tab to draw — `boardHasTimeline(page)`.
	 * False on a Task, whose one stage would make the tab a single bar. Absent → the tab is offered.
	 */
	hasTimeline?: boolean;
	onClose: () => void;
	/** Commit the working copy — creates the ticket, or saves the changes to an existing one. */
	onSubmit: (card: BoardCard) => void;
	/** Open a submission unit — pushes the review frame and rewrites the URL. */
	onOpenSubmission: (path: string[]) => void;
	/** Start a submission against an active stage (provider side). */
	onCreateSubmission: (stageId: string) => void;
	/** Fund this ticket now — opens Buy Now. Absent where the host cannot (no Buy Now mounted). */
	onBuyNow?: (card: BoardCard) => void;
	/** Put this ticket in the basket. */
	onAddToBasket?: (card: BoardCard) => void;
	/** The payee starts work on a funded ticket (provider side). */
	onStartWork?: (card: BoardCard) => void;
	/** A funding write the host started is in flight. */
	fundingBusy?: boolean;
	/** Self-claim this ticket; passed only while the viewer may claim it. */
	onClaim?: (card: BoardCard) => void;
	/** A claim the host started is in flight. */
	claimBusy?: boolean;
}

export function TicketView(props: TicketViewProps): JSX.Element {
	const { uid, mode, stages, canEdit, isClient, isFreelancer, onClose } = props;
	const creating = mode === "create";

	// `layer: "modal"` is not cosmetic — the default `"popover"` band (1100) put the ticket modal
	// BELOW any sibling that correctly declared itself a modal (1300).
	const stack = useOverlayStack({ active: true, lockScroll: true, layer: "modal" });
	const panelRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const wide = !useMediaQuery("(max-width: 900px)");
	const confirmingClose = useSignal(false);
	const forcedFunding = useSignal(readDevSeam()?.fundingState);
	useEffect(() =>
		subscribeDevSeam((seam) => {
			forcedFunding.value = seam?.fundingState;
		}), []);
	useFocusTrap({ active: true, containerRef: panelRef });
	// The backdrop is the only outside-click channel (§B.10.6 #4), so a press there can only ever
	// belong to this modal; it and Escape both go through the unsaved-work guard.
	useDismiss({
		open: true,
		enabled: stack.isTop,
		onDismiss: () => requestClose(),
		panelRef,
		closeOnOutside: false,
	});

	// The title is the required field and the first thing to write, so on a new ticket the caret is
	// already in it. The focus trap parks focus on the panel first, so this runs after it. A frame
	// restored with a focus-return trigger (back from the picker or a preview) leaves focus to it.
	const restoring = useRef(ticketStack.read<string | null>(uid, FILE_FRAME_TRIGGER, null) !== null)
		.current;
	useEffect(() => {
		if (!creating || restoring) return;
		panelRef.current?.querySelector<HTMLInputElement>(".tkv__titlefield input")?.focus();
	}, [creating]);

	/*
	 * Everything below survives being replaced by a review and restored — that is the whole point of
	 * the frame cache, and the reason none of it is a plain `useSignal`. The WORKING COPY is cached
	 * with the rest: an edit half-made when the reader clicks through to a submission must still be
	 * there when they come back, or the trip out cost them their work.
	 */
	const draft = useFrameState<BoardCard>(ticketStack, uid, "draft", props.card);
	// The fingerprint the Save button measures against. Cached too, so a review round-trip does not
	// reset "has anything changed" to "no".
	const baseline = useFrameState<string>(
		ticketStack,
		uid,
		"baseline",
		ticketFingerprint(props.card),
	);
	const tab = useFrameState<TicketTab>(ticketStack, uid, "tab", "details");
	const showPanel = useFrameState<boolean>(ticketStack, uid, "panel", true);
	const selectedStage = useFrameState<string | null>(ticketStack, uid, "stage", null);
	// Keyed PER TAB, not per modal. The tabs share one scroll container, so a single key would let a
	// glance at Finances overwrite where the reader had got to in a long History — the offset belongs
	// to the content, and the content changes with the tab.
	useFrameScroll(ticketStack, uid, `scroll:${tab.value}`, bodyRef);
	// A server-side change to a ticket nobody is editing (Start work, a settled payment) re-bases the
	// working copy, so the header never states a status the server has already moved on from.
	useEffect(() => {
		if (creating || ticketFingerprint(draft.value) !== baseline.value) return;
		draft.value = props.card;
		baseline.value = ticketFingerprint(props.card);
	}, [props.card]);

	const card = draft.value;
	const hasTimeline = props.hasTimeline !== false;
	const tabs = ticketTabs(card, mode, hasTimeline, wide);
	const current: TicketTab = tabs.some((t) => t.key === tab.value) ? tab.value : "details";
	const totals = ticketTotals(card);
	const gate = ticketGate(card, totals);
	const money = ticketMoney(card);
	const metrics = ticketMetrics(card, mode, wide);
	const stageViews = resolveTicketStages(card, stages);
	const active = activeStagesFor(card);
	const chosen = new Set(card.stages.map((s) => s.stageId));
	const available = stages.filter((s) => !chosen.has(s.id));
	const locks = pipelineLocks(card);
	const sharedWorkspace = isSharedWorkspace(props.workspaceKind) && props.clientMembers.length > 0;
	const dirty = ticketFingerprint(card) !== baseline.value;
	const intensityFixed = stageViews.length > 0 &&
		stageViews.every((v) => stageIntensityLocked(v.stage));

	const panelKind = panelFor(current, mode, wide);
	const inspected = stageViews.find((v) => v.ref.stageId === selectedStage.value) ?? null;
	const sidePanel = panelKind === "activity" && showPanel.value
		? "activity"
		: panelKind === "composer" && showPanel.value
		? "composer"
		: panelKind === "stage" && inspected
		? "stage"
		: null;

	/*
	 * The funding line reads the SERVER card, never the working copy: whether money is held is not
	 * something an unsaved edit can change. It has one home at a time — the Finances tab while that tab
	 * is open, the footer otherwise — so its action is never on screen twice (§D.7.4's moved, never
	 * duplicated). Nothing is said about a ticket that is unsaved or mid-edit.
	 */
	const server = props.card;
	const funding = !creating && !dirty ? server.funding : null;
	const fundingSide = isFreelancer ? "provider" : "client";
	const startPending = isFreelancer && server.claimed && funding !== null &&
		(fundingAction(funding, "provider") ?? "").startsWith("start");
	const fundingLine = (extra?: string, actions = true) =>
		funding && !actions
			? (
				<FundingStatus
					funding={funding}
					side={fundingSide}
					freelancer={server.assignee?.name ?? null}
					dateLabel={fundingDateLabel(server, funding)}
				/>
			)
			: funding
			? (
				<FundingStatus
					class={extra}
					funding={funding}
					side={fundingSide}
					freelancer={server.assignee?.name ?? null}
					dateLabel={fundingDateLabel(server, funding)}
					pollSlug={server.slug}
					busy={props.fundingBusy}
					onBuyNow={isClient && props.onBuyNow ? () => props.onBuyNow?.(server) : undefined}
					onAddToBasket={isClient && props.onAddToBasket
						? () => props.onAddToBasket?.(server)
						: undefined}
					onRetry={isClient && props.onBuyNow ? () => props.onBuyNow?.(server) : undefined}
					onReview={isClient ? () => (tab.value = "submissions") : undefined}
					onStart={isFreelancer && server.claimed && props.onStartWork
						? () => props.onStartWork?.(server)
						: undefined}
				/>
			)
			: null;

	const tabId = (t: TicketTab) => `tkv-tab-${t}`;
	const panelId = (t: TicketTab) => `tkv-panel-${t}`;

	/**
	 * Apply a patch to the working copy, re-deriving everything that follows from it.
	 *
	 * The ticket's own difficulty is the one field that cannot be a plain merge: it is the DEFAULT the
	 * stages beneath it follow, so changing it has to re-stamp them or the headline price lever moves
	 * a word and no money.
	 */
	function patch(next: Partial<BoardCard>): void {
		const { intensity, ...rest } = next;
		let updated = reconcileCard({ ...draft.value, ...rest }, stages);
		if (intensity !== undefined) updated = applyTicketIntensity(updated, intensity, stages);
		draft.value = updated;
	}

	function requestClose(): void {
		if (dirty) confirmingClose.value = true;
		else onClose();
	}

	function focusSoon(selector: string): void {
		setTimeout(() => panelRef.current?.querySelector<HTMLElement>(selector)?.focus(), 0);
	}

	function focusWhenMounted(selector: string, tries = 20): void {
		const el = panelRef.current?.querySelector<HTMLElement>(selector);
		if (el) el.focus();
		else if (tries > 0) setTimeout(() => focusWhenMounted(selector, tries - 1), 50);
	}

	function startDescribing(): void {
		tab.value = "details";
		setTimeout(() => focusWhenMounted('.tkv-doc__sec[aria-label="Description"] .ql-editor'), 0);
	}

	function priceStages(): void {
		globalThis.location.assign(`/projects/${encodeURIComponent(props.projectId)}/details#psu-stages`);
	}

	function selectStage(stageId: string): void {
		selectedStage.value = stageId;
		focusSoon(`.tkc-insp[data-stage-id="${stageId}"]`);
	}

	function closeInspector(): void {
		const stageId = selectedStage.value;
		selectedStage.value = null;
		if (stageId) focusSoon(`.tkc-stage[data-stage-id="${stageId}"] .tkc-stage__surface`);
	}

	function openStage(stageId: string): void {
		const inPane = mode === "create" && wide;
		tab.value = inPane ? "details" : "stages";
		if (inPane) showPanel.value = true;
		selectStage(stageId);
	}

	function patchStage(stageId: string, sp: Partial<TicketStageRef>): void {
		if ("dueAt" in sp) {
			draft.value = patchStageDue(draft.value, stageId, sp.dueAt ?? null, stages);
			return;
		}
		patch({ stages: stageOps.patch(card.stages, stageId, sp, stages) });
	}

	function patchDue(dueDate: string | null): void {
		const dueMode = ticketDueMode(card);
		if (dueMode === "ticket") patch({ dueDate });
		else if (dueMode === "stage") patchStage(card.stages[0].stageId, { dueAt: dueDate });
	}

	function placeInPipeline(stageId: string, drop: PipelineDrop): void {
		const existing = card.stages.find((s) => s.stageId === stageId);
		const lock = locks.stages.get(stageId) ?? null;
		const refused = drop.kind === "exclude"
			? !existing || removalRefusal(card.stages.length, lock) !== null
			: existing
			? lock !== null
			: inclusionRefusal(card.stages.length, locks.ticket) !== null;
		if (refused) return;
		const stage = stages.find((s) => s.id === stageId);
		const moved = existing ?? (stage ? blankStageRef(stage, card.stages.length, card.intensity) : null);
		const next = moved ? placeStage(card.stages, moved, drop) : null;
		if (!next) return;
		patch({ stages: next });
		if (drop.kind === "exclude" && selectedStage.value === stageId) selectedStage.value = null;
	}

	function reshapePipeline(stageId: string, next: TicketStageRef[] | null): void {
		if (next && !locks.stages.has(stageId)) patch({ stages: next });
	}

	function commit(): void {
		if (!gate.canSave || !canEdit) return;
		const committed = reconcileCard({ ...draft.value, title: draft.value.title.trim() }, stages);
		draft.value = committed;
		baseline.value = ticketFingerprint(committed);
		props.onSubmit(committed);
	}

	function discard(): void {
		draft.value = props.card;
		baseline.value = ticketFingerprint(props.card);
	}

	/** Roving-tabindex arrow navigation across the strip (WAI-ARIA tabs pattern). */
	function onTabKey(e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number): void {
		const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
		if (delta === 0) return;
		e.preventDefault();
		const next = tabs[(index + delta + tabs.length) % tabs.length];
		tab.value = next.key;
		// `closest`, not `parentElement`: each tab sits inside its Tooltip's anchor span.
		(e.currentTarget.closest('[role="tablist"]')?.querySelector(`#${tabId(next.key)}`) as
			| HTMLElement
			| null)
			?.focus();
	}

	function pipeline(title?: string): JSX.Element {
		return (
			<TicketStagesTab
				stageViews={stageViews}
				available={available}
				selectedStageId={selectedStage.value}
				editable={canEdit}
				currency={card.currency}
				intensity={card.intensity}
				locks={locks}
				title={title}
				onSelect={selectStage}
				onPlace={placeInPipeline}
				onSwap={(id, direction) => reshapePipeline(id, swapStage(card.stages, id, direction))}
				onParallel={(id, parallel) =>
					reshapePipeline(id, stageOps.patch(card.stages, id, { parallel }, stages))}
			/>
		);
	}

	function inspectorFor(view: TicketStageView, nav: "close" | "back"): JSX.Element {
		return (
			<StageInspector
				key={view.ref.stageId}
				item={view}
				nav={nav}
				stageTickets={props.cards.filter(
					(c) => c.stageId === view.ref.stageId && c.id !== card.id,
				)}
				editable={canEdit}
				currency={card.currency}
				funding={view.ref.stageId === server.stageId ? fundingLine(undefined, false) : null}
				onClose={closeInspector}
				onPatch={(sp) => patchStage(view.ref.stageId, sp)}
			/>
		);
	}

	function footerActions(): JSX.Element | null {
		const claim = props.onClaim && !creating && !dirty
			? (
				<Button
					variant="filled"
					size="sm"
					loading={props.claimBusy}
					onClick={() => props.onClaim?.(server)}
				>
					Claim ticket
				</Button>
			)
			: null;
		// No hold, no work (#165): a submission comes after Start work, never instead of it.
		const submit = isFreelancer && !creating && !dirty && active.length > 0 && !startPending
			? (
				<Button
					variant="filled"
					size="sm"
					onClick={() => props.onCreateSubmission(active[0].stageId)}
				>
					Create submission
				</Button>
			)
			: null;
		const step = isClient && canEdit && funding
			? draftStep(previewFunding(funding, forcedFunding.value))
			: null;
		const advance = step === "describe"
			? (
				<Button variant="filled" size="sm" onClick={startDescribing}>
					Add description
				</Button>
			)
			: step === "price"
			? (
				<Button variant="filled" size="sm" onClick={priceStages}>
					Price stages
				</Button>
			)
			: null;
		const commitPair = creating
			? (
				<>
					<Button variant="text" size="sm" onClick={onClose}>Cancel</Button>
					<Button
						variant="filled"
						structural
						size="sm"
						disabled={!gate.canSave || !canEdit}
						onClick={commit}
					>
						Create ticket
					</Button>
				</>
			)
			: dirty
			? (
				<>
					<Button variant="text" size="sm" onClick={discard}>Discard changes</Button>
					<Button variant="filled" size="sm" disabled={!gate.canSave} onClick={commit}>
						Save changes
					</Button>
				</>
			)
			: null;
		if (!claim && !submit && !advance && !commitPair) return null;
		return (
			<>
				{claim}
				{submit}
				{advance}
				{commitPair}
			</>
		);
	}

	return (
		<BodyPortal>
			<div class="tkv" data-state="open" style={`--z-portal:${stack.zIndex}`}>
				<Backdrop visible onClick={() => requestClose()} />
				<div
					ref={panelRef}
					class="tkv__panel"
					data-state="open"
					data-mode={mode}
					role="dialog"
					aria-modal="true"
					aria-label={creating ? "New ticket" : `Ticket: ${card.title}`}
					tabIndex={-1}
				>
					{/* #region Header — identity, who is on it, and the two controls */}
					<header class="tkv__top">
						<div class="tkv__ident">
							<span class="tkv__status" data-tone={creating ? "info" : statusTone(card.status)}>
								{creating ? "New" : statusLabel(card.status)}
							</span>
							{
								/*
								 * Two postures for one value. On a ticket that exists the title is a HEADING that
								 * happens to be editable, so it reads as one until you click it. On a ticket being
								 * created it is the required field — the first thing to fill in — so it is a field
								 * from the start rather than a placeholder you have to discover is clickable.
								 */
							}
							{creating
								? (
									<InputText
										class="tkv__titlefield"
										variant="bare"
										block
										value={card.title}
										maxLength={200}
										placeholder="Name this ticket"
										aria-label="Ticket title"
										onValueChange={(title: string) => patch({ title })}
									/>
								)
								: (
									<h2 class="tkv__title">
										<InlineEdit
											value={card.title}
											editable={canEdit}
											as="line"
											displayAs="span"
											maxLength={200}
											label="Edit ticket title"
											placeholder="Untitled ticket"
											onCommit={(title) => title && patch({ title })}
										/>
									</h2>
								)}
						</div>

						<div class="tkv__who">
							{card.contributors.length > 0
								? (
									<Tooltip
										content={`Worked on by ${card.contributors.map((c) => c.name).join(", ")}`}
									>
										<span class="tkv__stack" tabIndex={0}>
											<UserAvatarStack
												people={card.contributors}
												max={4}
												size={24}
												ringColor="var(--surface)"
												aria-label={`${card.contributors.length} contributors: ${
													card.contributors.map((c) => c.name).join(", ")
												}`}
											/>
										</span>
									</Tooltip>
								)
								: null}
						</div>

						<div class="tkv__acts">
							{!creating
								? (
									<Popover
										class="tkv-menu"
										placement="bottom-end"
										label="Ticket actions"
										trigger={(api) => (
											<button
												type="button"
												class="tkv__act"
												aria-label="Ticket actions"
												aria-haspopup="menu"
												aria-expanded={api.expanded ? "true" : "false"}
												aria-controls={api.panelId}
												// deno-lint-ignore no-explicit-any
												ref={api.ref as any}
												onClick={api.toggle}
											>
												<Icon name="kebab" size="sm" />
											</button>
										)}
									>
										<TicketMenu card={card} projectId={props.projectId} />
									</Popover>
								)
								: null}
							{
								/*
								 * The panel toggle governs the Details tab's panel: the activity feed of a saved
								 * ticket, the stages of one being created. On the Stages tab the panel follows the
								 * selection instead — a toggle there would be a second, competing way to open it.
								 */
							}
							{panelKind === "activity" || panelKind === "composer"
								? (() => {
									const what = panelKind === "activity" ? "recent activity" : "stages";
									const label = `${showPanel.value ? "Hide" : "Show"} ${what}`;
									return (
										<Tooltip content={label}>
											<button
												type="button"
												class="tkv__act"
												aria-label={label}
												aria-pressed={showPanel.value}
												onClick={() => (showPanel.value = !showPanel.value)}
											>
												<Icon name="panel-right" size="sm" />
											</button>
										</Tooltip>
									);
								})()
								: null}
							<button
								type="button"
								class="tkv__act tkv__act--close"
								aria-label="Close"
								onClick={() => requestClose()}
							>
								<Icon name="close" size="sm" />
							</button>
						</div>
					</header>
					{/* #endregion */}

					{/* #region Meta bar + tab strip */}
					<div class="tkv__bar">
						<TicketMetaBar
							card={card}
							canEdit={canEdit}
							isClient={isClient}
							sharedWorkspace={sharedWorkspace}
							workspaceLabel={props.workspaceLabel}
							clientMembers={props.clientMembers}
							intensityFixed={intensityFixed}
							dueMode={ticketDueMode(card)}
							onPatch={patch}
							onDue={patchDue}
						/>

						<div class="tkv-tabs" role="tablist" aria-label="Ticket views">
							{tabs.map((t, i) => {
								const tabButton = (
									<button
										key={t.key}
										type="button"
										id={tabId(t.key)}
										role="tab"
										class="tkv-tabs__tab"
										data-icononly={t.iconOnly ? "true" : undefined}
										aria-selected={current === t.key}
										aria-controls={panelId(t.key)}
										// Always named, not only when icon-only: below 640px the labels collapse to
										// their glyphs so every tab fits without a hidden horizontal scroller, and a tab
										// that loses its visible text must not lose its name with it. The value is
										// identical to the visible label, so "label in name" (WCAG 2.5.3) holds in
										// both presentations.
										aria-label={t.label}
										tabIndex={current === t.key ? 0 : -1}
										onKeyDown={(e) => onTabKey(e, i)}
										onClick={() => (tab.value = t.key)}
									>
										<Icon name={t.icon} size="xs" class="tkv-tabs__mark" />
										{t.iconOnly ? null : <span class="tkv-tabs__label">{t.label}</span>}
										{!t.iconOnly && t.count ? <span class="tkv-tabs__count">{t.count}</span> : null}
										{t.key === "history" && card.unreadCount > 0
											? <span class="tkv-tabs__dot" aria-hidden="true" />
											: null}
									</button>
								);
								// A labelled tab's name shows only while its label is collapsed to the
								// visually-hidden box (below 640px); the glyph-only History tab always.
								return (
									<Tooltip key={t.key} content={t.label} whenTruncated={!t.iconOnly}>
										{tabButton}
									</Tooltip>
								);
							})}
						</div>
					</div>
					{/* #endregion */}

					{/* #region Body — the splitter: tabs left, the contextual panel right */}
					<div class="tkv__regions">
						<Splitter layout="horizontal" stateKey="ticket-view" class="tkv__split">
							<SplitterPanel
								size={sidePanel ? 68 : 100}
								minSize={sidePanel ? 50 : 100}
								class="tkv__main"
							>
								<div
									ref={bodyRef}
									class="tkv__body"
									id={panelId(current)}
									role="tabpanel"
									aria-labelledby={tabId(current)}
									tabIndex={0}
								>
									{current === "details"
										? (
											<TicketDetailsTab
												card={card}
												stageViews={stageViews}
												canEdit={canEdit}
												creating={creating}
												showStageSummary={sidePanel !== "composer"}
												onPatch={patch}
												onOpenStage={openStage}
											/>
										)
										: null}
									{current === "submissions"
										? (
											<TicketSubmissionsTab
												card={card}
												uid={uid}
												isFreelancer={isFreelancer}
												activeStages={active}
												onOpenSubmission={props.onOpenSubmission}
												onCreateSubmission={props.onCreateSubmission}
											/>
										)
										: null}
									{current === "stages"
										? (!wide && inspected ? inspectorFor(inspected, "back") : pipeline())
										: null}
									{current === "timeline" && hasTimeline
										? (
											<TicketTimelineTab
												card={card}
												stages={stages}
												now={props.now}
												onOpenStage={openStage}
											/>
										)
										: null}
									{current === "finances"
										? <TicketFinanceTab card={card} stages={stages} funding={fundingLine()} />
										: null}
									{current === "attachments"
										? (
											<TicketAttachmentsTab
												card={card}
												uid={uid}
												canUpload={isClient && canEdit}
												saving={props.saving}
												onPatch={patch}
											/>
										)
										: null}
									{current === "history"
										? (
											<TicketHistoryTab
												card={card}
												onFollow={(entry) => {
													if (entry.targetPath.length > 0) {
														tab.value = "submissions";
														ticketStack.write(uid, "path", entry.targetPath);
													}
												}}
											/>
										)
										: null}
								</div>
							</SplitterPanel>

							{sidePanel
								? (
									<SplitterPanel size={32} minSize={22} maxSize={44} class="tkv__side">
										{sidePanel === "activity"
											? (
												<TicketActivityPanel
													card={card}
													hasArchive={!creating}
													onOpenHistory={() => (tab.value = "history")}
													onFollow={(entry) => {
														if (entry.targetPath.length > 0) {
															tab.value = "submissions";
															ticketStack.write(uid, "path", entry.targetPath);
														}
													}}
												/>
											)
											: sidePanel === "composer"
											? (inspected
												? inspectorFor(inspected, "back")
												: <div class="tkv-pane">{pipeline("Stages")}</div>)
											: inspected
											? inspectorFor(inspected, "close")
											: null}
									</SplitterPanel>
								)
								: null}
						</Splitter>
					</div>
					{/* #endregion */}

					{/* #region Footer — the money first, then what it is made of, then what to do next */}
					<TicketFooter
						money={money}
						creating={creating}
						metrics={metrics}
						onOpenTab={(t) => (tab.value = t)}
						status={creating || dirty
							? <p class="tkv__gate" role="status">{gate.message}</p>
							: funding && current !== "finances"
							? fundingLine("tkv__fund")
							: null}
						actions={footerActions()}
					/>
					{/* #endregion */}
				</div>
			</div>
			<ConfirmDialog
				visible={confirmingClose}
				header={creating ? "Discard this ticket?" : "Discard your changes?"}
				message={creating
					? "It has not been created yet, so closing now throws away what you have written."
					: "Closing now throws away the changes you have not saved."}
				acceptLabel={creating ? "Discard ticket" : "Discard changes"}
				rejectLabel="Keep editing"
				acceptSeverity="danger"
				onAccept={onClose}
			/>
		</BodyPortal>
	);
}

// #region Kebab menu
/**
 * The ticket's secondary actions. Copy-link is first because it is the one a reader reaches for
 * mid-conversation.
 *
 * Only actions that do something are offered (root CLAUDE.md §3.11). Following a ticket needs a
 * notification subscription the backend does not have, and the ticket lifecycle has no archived state
 * — the nearest, `cancelled`, is an escrow-bearing transition, not a tidy-up — so neither is drawn
 * until it can be performed.
 */
function TicketMenu(
	props: { card: BoardCard; projectId: string },
): JSX.Element {
	const href = `/projects/${encodeURIComponent(props.projectId)}/board?ticket=${
		encodeURIComponent(props.card.id)
	}`;
	return (
		<div class="tkv-menu__items">
			<button
				type="button"
				class="ui-menu-item tkv-menu__item"
				onClick={() => {
					const url = `${globalThis.location?.origin ?? ""}${href}`;
					void navigator.clipboard?.writeText(url);
				}}
			>
				<Icon name="link" size="xs" class="ui-menu-item__icon" />
				Copy link
			</button>
			<a class="ui-menu-item tkv-menu__item" href={href} target="_blank" rel="noopener noreferrer">
				<Icon name="external-link" size="xs" class="ui-menu-item__icon" />
				Open in a new tab
			</a>
		</div>
	);
}
// #endregion
