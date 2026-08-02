import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Backdrop, BodyPortal, useFrameScroll, useFrameState } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { AvatarStack } from "@projective/ui/display";
import { Button, InlineEdit, InputText } from "@projective/ui/fields";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { ContextType } from "@projective/types/auth";
import type { BoardCard, BoardStageRef, ProjectParty } from "../../types/projects-types.ts";
import { isSharedWorkspace } from "../../types/projects-types.ts";
import { statusLabel, statusTone } from "../../core/board-model.ts";
import {
	applyTicketIntensity,
	reconcileCard,
	stageOps,
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
	type TicketTab,
	ticketTabs,
} from "../../core/ticket-view.ts";
import { TicketMetaBar } from "./TicketMetaBar.tsx";
import { TicketActivityPanel } from "./TicketActivityPanel.tsx";
import { StageInspector } from "./StageInspector.tsx";
import { TicketDetailsTab } from "./tabs/TicketDetailsTab.tsx";
import { TicketStagesTab } from "./tabs/TicketStagesTab.tsx";
import { TicketFinanceTab } from "./tabs/TicketFinanceTab.tsx";
import { TicketAttachmentsTab } from "./tabs/TicketAttachmentsTab.tsx";
import { TicketHistoryTab } from "./tabs/TicketHistoryTab.tsx";
import { TicketSubmissionsTab } from "./tabs/TicketSubmissionsTab.tsx";

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
 *    context — recent activity while you read the brief, the selected stage while you compose the
 *    pipeline. It appears on exactly the two tabs that have a second question worth answering, and
 *    nowhere else, because a column that is usually empty teaches the reader to ignore that side.
 *  - **Separation is spacing, tone and a single hairline** — never a box inside a box (§B.4). The
 *    only full borders in here belong to interactive controls.
 *  - **Intensity is never a number.** Low/Standard/High is what a client chose; the multiplier that
 *    turns it into money is arithmetic, and arithmetic belongs on the Finances tab where it can be
 *    shown working rather than asserted on a badge.
 *
 * Edits are STAGED, not live. The working copy diverges from the ticket the modal was opened on, the
 * footer grows a Save the moment it does, and nothing reaches the board until it is pressed — so a
 * half-typed brief is never something a freelancer can read, and Discard is always a real option.
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
	onClose: () => void;
	/** Commit the working copy — creates the ticket, or saves the changes to an existing one. */
	onSubmit: (card: BoardCard) => void;
	/** Open a submission unit — pushes the review frame and rewrites the URL. */
	onOpenSubmission: (path: string[]) => void;
	/** Start a submission against an active stage (provider side). */
	onCreateSubmission: (stageId: string) => void;
}

export function TicketView(props: TicketViewProps): JSX.Element {
	const { uid, mode, stages, canEdit, isClient, isFreelancer, onClose } = props;
	const creating = mode === "create";

	const stack = useOverlayStack({ active: true, lockScroll: true });
	const panelRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	useFocusTrap({ active: true, containerRef: panelRef });
	// A ticket being composed can be dismissed, but not by a stray click on the backdrop — there is
	// unsaved work in it by definition. Escape and Cancel still close it.
	useDismiss({ open: true, onDismiss: onClose, panelRef, closeOnOutside: !creating });

	// The title is the required field and the first thing to write, so on a new ticket the caret is
	// already in it. The focus trap parks focus on the panel first, so this runs after it.
	useEffect(() => {
		if (!creating) return;
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
	const showActivity = useFrameState<boolean>(ticketStack, uid, "panel", true);
	const selectedStage = useFrameState<string | null>(ticketStack, uid, "stage", null);
	// Keyed PER TAB, not per modal. The tabs share one scroll container, so a single key would let a
	// glance at Finances overwrite where the reader had got to in a long History — the offset belongs
	// to the content, and the content changes with the tab.
	useFrameScroll(ticketStack, uid, `scroll:${tab.value}`, bodyRef);

	const card = draft.value;
	const tabs = ticketTabs(card, mode);
	const totals = ticketTotals(card);
	const gate = ticketGate(card, totals);
	const money = ticketMoney(card);
	const metrics = ticketMetrics(card, mode);
	const stageViews = resolveTicketStages(card, stages);
	const active = activeStagesFor(card);
	const chosen = new Set(card.stages.map((s) => s.stageId));
	const available = stages.filter((s) => !chosen.has(s.id));
	const sharedWorkspace = isSharedWorkspace(props.workspaceKind) && props.clientMembers.length > 0;
	const dirty = ticketFingerprint(card) !== baseline.value;

	const panelKind = panelFor(tab.value);
	const inspected = panelKind === "stage"
		? stageViews.find((v) => v.ref.stageId === selectedStage.value) ?? null
		: null;
	const sidePanel = panelKind === "activity" && showActivity.value
		? "activity"
		: inspected
		? "stage"
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

	/** Jump to a stage: the Stages tab is where a stage is read and configured, so that is where it goes. */
	function openStage(stageId: string): void {
		selectedStage.value = stageId;
		tab.value = "stages";
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
		(e.currentTarget.parentElement?.querySelector(`#${tabId(next.key)}`) as HTMLElement | null)
			?.focus();
	}

	return (
		<BodyPortal>
			<div class="tkv" data-state="open" style={`z-index:${stack.zIndex}`}>
				<Backdrop visible onClick={creating ? undefined : onClose} />
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
											<AvatarStack
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
										<TicketMenu card={card} projectId={props.projectId} canEdit={canEdit} />
									</Popover>
								)
								: null}
							{
								/*
								 * The panel toggle governs the activity feed, and only the Details tab has one. On
								 * the Stages tab the panel follows the selection instead — a toggle there would be
								 * a second, competing way to open the same column.
								 */
							}
							{panelKind === "activity"
								? (
									<Tooltip
										content={showActivity.value ? "Hide recent activity" : "Show recent activity"}
									>
										<button
											type="button"
											class="tkv__act"
											aria-label={showActivity.value
												? "Hide recent activity"
												: "Show recent activity"}
											aria-pressed={showActivity.value}
											onClick={() => (showActivity.value = !showActivity.value)}
										>
											<Icon name="panel-right" size="sm" />
										</button>
									</Tooltip>
								)
								: null}
							<button
								type="button"
								class="tkv__act tkv__act--close"
								aria-label="Close"
								onClick={onClose}
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
							onPatch={patch}
						/>

						<div class="tkv-tabs" role="tablist" aria-label="Ticket views">
							{tabs.map((t, i) => (
								<button
									key={t.key}
									type="button"
									id={tabId(t.key)}
									role="tab"
									class="tkv-tabs__tab"
									data-icononly={t.iconOnly ? "true" : undefined}
									aria-selected={tab.value === t.key}
									aria-controls={panelId(t.key)}
									// Always named, not only when icon-only: below 640px the labels collapse to
									// their glyphs so every tab fits without a hidden horizontal scroller, and a tab
									// that loses its visible text must not lose its name with it. The value is
									// identical to the visible label, so "label in name" (WCAG 2.5.3) holds in
									// both presentations.
									aria-label={t.label}
									tabIndex={tab.value === t.key ? 0 : -1}
									title={t.label}
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
							))}
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
									id={panelId(tab.value)}
									role="tabpanel"
									aria-labelledby={tabId(tab.value)}
									tabIndex={0}
								>
									{tab.value === "details"
										? (
											<TicketDetailsTab
												card={card}
												stageViews={stageViews}
												canEdit={canEdit}
												creating={creating}
												onPatch={patch}
												onOpenStage={openStage}
											/>
										)
										: null}
									{tab.value === "submissions"
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
									{tab.value === "stages"
										? (
											<TicketStagesTab
												stageViews={stageViews}
												available={available}
												selected={selectedStage}
												editable={canEdit}
												onToggle={(id) => {
													const stage = stages.find((s) => s.id === id);
													if (!stage) return;
													patch({
														stages: stageOps.toggle(card.stages, stage, stages, card.intensity),
													});
													if (selectedStage.value === id) selectedStage.value = null;
												}}
												onMove={(from, to) =>
													patch({ stages: stageOps.move(card.stages, from, to, stages) })}
												onParallel={(id, parallel) =>
													patch({
														stages: stageOps.patch(card.stages, id, { parallel }, stages),
													})}
											/>
										)
										: null}
									{tab.value === "finances" ? <TicketFinanceTab card={card} /> : null}
									{tab.value === "attachments"
										? (
											<TicketAttachmentsTab
												card={card}
												canUpload={isClient}
												onPatch={patch}
											/>
										)
										: null}
									{tab.value === "history"
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
											: inspected
											? (
												<StageInspector
													key={inspected.ref.stageId}
													item={inspected}
													stageTickets={props.cards.filter(
														(c) => c.stageId === inspected.ref.stageId && c.id !== card.id,
													)}
													editable={canEdit}
													onClose={() => (selectedStage.value = null)}
													onPatch={(sp) =>
														patch({
															stages: stageOps.patch(
																card.stages,
																inspected.ref.stageId,
																sp,
																stages,
															),
														})}
												/>
											)
											: null}
									</SplitterPanel>
								)
								: null}
						</Splitter>
					</div>
					{/* #endregion */}

					{/* #region Footer — the money first, then what it is made of, then what to do next */}
					<footer class="tkv__foot">
						<div class="tkv-money">
							<span class="tkv-money__fig" data-role="total">
								<span class="tkv-money__k">Ticket cost</span>
								<span
									class="tkv-money__v"
									data-unpriced={money.totalLabel ? undefined : "true"}
								>
									{money.totalLabel ?? "Not priced"}
								</span>
							</span>
							{
								/*
								 * Spent is what has genuinely left the client — settled releases and fees, never a
								 * held escrow, which is their own money ring-fenced against work nobody has
								 * accepted. It is omitted while creating, where the honest figure is "none yet"
								 * and a £0 beside a price would read as a discount.
								 */
							}
							{!creating
								? (
									<Tooltip content="Released to the freelancer and paid in platform fees. Escrow held against unaccepted work is not spent.">
										<span class="tkv-money__fig" data-role="spent" tabIndex={0}>
											<span class="tkv-money__k">Spent</span>
											<span class="tkv-money__v">{money.spentLabel}</span>
										</span>
									</Tooltip>
								)
								: null}
						</div>

						<ul class="tkv-metrics" aria-label="Ticket summary">
							{metrics.map((m) => {
								const content = (
									<>
										<Icon name={m.icon} size="xs" class="tkv-metric__mark" />
										<span class="tkv-metric__value">{m.value}</span>
									</>
								);
								return (
									<li key={m.key}>
										<Tooltip content={m.label}>
											{m.target
												? (
													<button
														type="button"
														class="tkv-metric"
														data-active={m.active ? "true" : undefined}
														aria-label={`${m.label}. Open the ${m.target} view.`}
														onClick={() => (tab.value = m.target as TicketTab)}
													>
														{content}
													</button>
												)
												: (
													<span
														class="tkv-metric"
														data-static="true"
														aria-label={m.label}
														tabIndex={0}
													>
														{content}
													</span>
												)}
										</Tooltip>
									</li>
								);
							})}
						</ul>

						{
							/*
							 * The readiness line speaks only when something is pending. On a saved ticket nobody
							 * is editing, "Ready to purchase once saved" is a sentence about a decision already
							 * made — permanent status text that never changes stops being read.
							 */
						}
						{creating || dirty
							? <p class="tkv__gate" role="status">{gate.message}</p>
							: <span class="tkv__gate tkv__gate--spacer" />}

						<div class="tkv__footacts">
							{isFreelancer && !creating && !dirty && active.length > 0
								? (
									<Button
										variant="filled"
										size="sm"
										onClick={() => props.onCreateSubmission(active[0].stageId)}
									>
										Create submission
									</Button>
								)
								: null}
							{creating
								? (
									<>
										<Button variant="text" size="sm" onClick={onClose}>Cancel</Button>
										<Button
											variant="filled"
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
										<Button
											variant="filled"
											size="sm"
											disabled={!gate.canSave}
											onClick={commit}
										>
											Save changes
										</Button>
									</>
								)
								: null}
						</div>
					</footer>
					{/* #endregion */}
				</div>
			</div>
		</BodyPortal>
	);
}

// #region Kebab menu
/**
 * The ticket's secondary actions. Copy-link is first because it is the one a reader reaches for
 * mid-conversation; the destructive one is last and separated, and only exists for a seat that can
 * actually perform it.
 */
function TicketMenu(
	props: { card: BoardCard; projectId: string; canEdit: boolean },
): JSX.Element {
	const href = `/projects/${encodeURIComponent(props.projectId)}/board?ticket=${
		encodeURIComponent(props.card.id)
	}`;
	return (
		<div class="tkv-menu__items">
			<button
				type="button"
				class="tkv-menu__item"
				onClick={() => {
					const url = `${globalThis.location?.origin ?? ""}${href}`;
					void navigator.clipboard?.writeText(url);
				}}
			>
				<Icon name="link" size="xs" />
				Copy link
			</button>
			<a class="tkv-menu__item" href={href} target="_blank" rel="noopener noreferrer">
				<Icon name="external-link" size="xs" />
				Open in a new tab
			</a>
			<button type="button" class="tkv-menu__item">
				<Icon name="bookmark" size="xs" />
				Follow this ticket
			</button>
			{props.canEdit
				? (
					<button type="button" class="tkv-menu__item tkv-menu__item--danger">
						<Icon name="archive-box" size="xs" />
						Archive ticket
					</button>
				)
				: null}
		</div>
	);
}
// #endregion
