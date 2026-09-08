import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/timeline.css";
import "../styles/ticket-pipeline.css";
import "../styles/ticket-view.css";
// The ticket modal's Attachments + Submissions tabs mount the `/files` + `/submissions` components,
// whose sheets otherwise ride only those islands (the island-carrier rule, Decision #39).
import "../styles/file-explorer.css";
import "../styles/file-table.css";
import "../styles/submission-explorer.css";
import "../styles/submission-card.css";
import "../styles/file-card.css";
import { Gantt, type GanttItem, type GanttRange } from "@projective/ui/gantt";
import { isSlug } from "@projective/types/slugs";
import { Button } from "@projective/ui/fields";
import {
	type BoardCard,
	type BoardPage,
	type BoardStageRef,
	buildProjectTimeline,
	type TimelinePage,
} from "../types/projects-types.ts";
import { BoardService } from "../core/BoardService.ts";
import { TimelineService } from "../core/TimelineService.ts";
import { TicketView } from "../components/ticket/TicketView.tsx";
import { CreateStageModal } from "../components/CreateStageModal.tsx";
import { newTicketCard, reconcileCard, ticketCommitPayload } from "../core/ticket-model.ts";
import { type TicketMode, ticketStack, ticketSubmissionHref } from "../core/ticket-view.ts";
import { registerTicketSurface } from "../core/ticket-link.ts";
import {
	type BoardAccess,
	readDevSeam,
	resolveBoardAccess,
	watchDevSeam,
} from "../core/board-access.ts";
import { resolveSessionKind } from "../core/session-model.ts";
import { tierWord, timelineItemOf, toGanttItem, toGanttLane } from "../core/timeline-model.ts";
import {
	publishTimelineCaps,
	resetTimelineState,
	restoreTimelineZoom,
	setTimelineZoom,
	timelineCommands,
	timelineCreateStage,
	timelineCreateTicket,
	timelineTier,
	timelineZoom,
} from "../core/timeline-state.ts";

/**
 * ProjectTimeline — the Timeline / Gantt body for `/projects/[id]/timeline` (the whole engagement)
 * and `/projects/[id]/[channel]/timeline` (one stage). It mounts the portable
 * `@projective/ui/gantt` engine over the Zod timeline projection and owns the surface's writes:
 * drag-to-create (a ticket in that stage, due at the range's end), drag-to-move (a ticket's due
 * date), and the SAME ticket modal the board opens, on the same modal stack.
 *
 * THE ONE ARITHMETIC PATH. The island holds the BOARD the page was projected from and re-derives
 * the timeline from it locally with the SSOT's own `buildProjectTimeline` — the same function the
 * server ran — whenever a card changes. So a ticket saved from the modal, a due date dragged, or a
 * stage added all move the pixels without a refetch, and they move them by exactly the rule the
 * server would have applied. The reference instant is the SERVER's (the page's `now`), never the
 * browser's clock: the fixture corpus is pinned to a date, and "overdue" measured from today would
 * put every fixture ticket weeks in the past.
 *
 * Effective capabilities come from `board-access.ts` (Decision #64) — the SSR baseline layered with
 * the Dev Context Switcher — so a persona flip moves the Gantt's write gestures, the footer rig and
 * the modal together.
 */
export interface ProjectTimelineProps {
	scope: "project" | "channel";
	projectId: string;
	channelId?: string;
	initial: TimelinePage | null;
}

/** The layout zones the engine's popover must never sit on top of. */
const POPOVER_AVOID = [".ui-app-shell__sidebar", ".ui-middle-nav__lane"] as const;

export default function ProjectTimeline(props: ProjectTimelineProps): JSX.Element {
	const { scope, channelId, initial } = props;

	// #region State
	const board = useSignal<BoardPage | null>(initial?.board ?? null);
	const nowMs = useSignal<number>(initial ? Date.parse(initial.now) : Date.now());
	const timezone = initial?.timezone ?? null;
	const loading = useSignal(false);
	const composing = useSignal<BoardCard | null>(null);
	const stageModalOpen = useSignal(false);
	const notice = useSignal("");
	const newIdRef = useRef(0);

	/** The timeline, re-derived from the board on every change by the SSOT's own builder. */
	const page = useComputed<TimelinePage | null>(() =>
		board.value ? buildProjectTimeline(board.value, { nowMs: nowMs.value, timezone }) : null
	);
	const lanes = useComputed(() => page.value?.lanes.map(toGanttLane) ?? []);
	const items = useComputed(() => page.value?.items.map(toGanttItem) ?? []);

	const ssrBaseline = {
		viewerIsClient: initial?.viewerIsClient ?? false,
		sessionKind: resolveSessionKind(initial?.format ?? "pipeline", null),
	};
	const access = useSignal<BoardAccess>(resolveBoardAccess(ssrBaseline, null));
	useEffect(() => {
		const apply = () => (access.value = resolveBoardAccess(ssrBaseline, readDevSeam()));
		apply();
		return watchDevSeam(apply);
	}, [ssrBaseline.viewerIsClient, ssrBaseline.sessionKind]);

	useEffect(() => {
		restoreTimelineZoom();
		if (!initial) void loadFallback();
		// The page's ticket surface for the `?tkv=` deep link: a link opened here lands on this chain
		// with this board's cards (the board island registers the same way).
		const unregister = registerTicketSurface({
			openBySlug: (slug) => {
				const card = cardsOf().find((c) => c.slug === slug);
				if (!card) return false;
				openDetail(card.id);
				return true;
			},
		});
		return () => {
			unregister();
			resetTimelineState();
			ticketStack.close();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// What the footer rig may offer, re-published on every capability or data change.
	useSignalEffect(() => {
		const a = access.value;
		const p = page.value;
		publishTimelineCaps({
			isClient: a.isClient,
			isProjectScope: scope === "project",
			hasTickets: a.hasTickets,
			hasRange: !!p?.range,
			undatedCount: p?.undatedCount ?? 0,
		});
	});

	// Footer intents.
	useSignalEffect(() => {
		if (!timelineCreateTicket.value) return;
		timelineCreateTicket.value = false;
		const a = access.peek();
		if (a.isClient && a.hasTickets) openCompose(scopedStageId(), null);
	});
	useSignalEffect(() => {
		if (!timelineCreateStage.value) return;
		timelineCreateStage.value = false;
		if (access.peek().isClient && scope === "project") stageModalOpen.value = true;
	});

	// A seat that loses the right to compose closes the composer it can no longer submit from.
	useSignalEffect(() => {
		const a = access.value;
		if (a.isClient && a.hasTickets) return;
		if (composing.value) {
			const id = composing.value.id;
			composing.value = null;
			if (ticketStack.top.value?.input?.ticketId === id) ticketStack.close();
		}
		if (stageModalOpen.value) stageModalOpen.value = false;
	});
	// #endregion

	// #region Helpers
	function cardsOf(): BoardCard[] {
		return board.value?.cards ?? [];
	}
	function stagesOf(): BoardStageRef[] {
		return board.value?.stages ?? [];
	}
	function patchBoard(fn: (b: BoardPage) => BoardPage): void {
		if (board.value) board.value = fn(board.value);
	}
	/** The stage a ticket created here lands in: the scoped stage on a stage timeline, else the backlog. */
	function scopedStageId(): string | null {
		if (scope !== "channel") return null;
		return page.value?.lanes.find((l) => l.kind === "stage")?.stageId ?? channelId ?? null;
	}
	/** The stage a lane resolves to (`null` for the backlog lane). */
	function stageOfLane(laneId: string): string | null {
		return page.value?.lanes.find((l) => l.id === laneId)?.stageId ?? null;
	}
	function toast(msg: string): void {
		notice.value = msg;
		setTimeout(() => {
			if (notice.value === msg) notice.value = "";
		}, 3200);
	}
	// #endregion

	// #region Data
	async function loadFallback(): Promise<void> {
		loading.value = true;
		const res = await TimelineService.list({
			projectId: props.projectId,
			channelId: channelId ?? null,
		});
		loading.value = false;
		if (res.ok && res.data) {
			nowMs.value = Date.parse(res.data.page.now);
			board.value = res.data.page.board;
			return;
		}
		toast(res.message ?? "The timeline could not be loaded.");
	}
	// #endregion

	// #region Ticket modal (the board's chain, verbatim)
	function openDetail(ticketId: string): void {
		// The slug rides the frame so the deep-link host can write `?tkv=` for it (the board does the
		// same); a card the board does not hold, or one without an address yet, opens unaddressed.
		const slug = cardsOf().find((c) => c.id === ticketId)?.slug;
		ticketStack.open("ticket", ticketId, { ticketId, slug });
	}

	/** Start composing a ticket in `stageId` (or the backlog), optionally already dated. */
	function openCompose(stageId: string | null, dueDate: string | null): void {
		const blank = reconcileCard(
			{ ...newTicketCard(stageId, stagesOf()), dueDate },
			stagesOf(),
		);
		composing.value = blank;
		ticketStack.open("ticket", blank.id, { ticketId: blank.id, mode: "create" });
	}

	function repointFrame(fromId: string, toId: string, mode: TicketMode, slug?: string): void {
		const top = ticketStack.top.value;
		if (!top || top.kind !== "ticket") return;
		if ((top.input?.ticketId ?? top.id) !== fromId) return;
		ticketStack.replace(
			"ticket",
			toId,
			mode === "create" ? { ticketId: toId, mode } : { ticketId: toId, slug },
		);
	}

	/**
	 * Save a card — optimistically onto the board (and therefore onto the axis), then through the
	 * SAME endpoint the board uses, replacing the optimistic row with the card as the server sees it.
	 */
	async function commitTicket(next: BoardCard): Promise<void> {
		const card = reconcileCard({ ...next, updatedAt: new Date().toISOString() }, stagesOf());
		const clientId = card.id;
		const existing = cardsOf().find((c) => c.id === clientId) ?? null;
		const optimisticId = existing ? clientId : `optimistic-${++newIdRef.current}`;

		if (existing) {
			patchBoard((b) => ({ ...b, cards: b.cards.map((c) => (c.id === clientId ? card : c)) }));
		} else {
			patchBoard((b) => ({
				...b,
				cards: [{ ...card, id: optimisticId, dateLabel: "Just now" }, ...b.cards],
				total: b.total + 1,
			}));
			composing.value = null;
			repointFrame(clientId, optimisticId, "view");
		}

		const res = await BoardService.commit(ticketCommitPayload(props.projectId, clientId, card));
		if (res.ok && res.data) {
			const saved = res.data.card;
			patchBoard((b) => ({ ...b, cards: b.cards.map((c) => (c.id === optimisticId ? saved : c)) }));
			if (saved.id !== optimisticId) repointFrame(optimisticId, saved.id, "view", saved.slug);
			return;
		}

		if (existing) {
			patchBoard((b) => ({ ...b, cards: b.cards.map((c) => (c.id === clientId ? existing : c)) }));
		} else {
			patchBoard((b) => ({
				...b,
				cards: b.cards.filter((c) => c.id !== optimisticId),
				total: b.total - 1,
			}));
			composing.value = card;
			repointFrame(optimisticId, clientId, "create");
		}
		toast(res.message ?? "That ticket could not be saved.");
	}

	function onCreateStage(stage: { name: string; description: string }): void {
		patchBoard((b) => {
			const order = b.stages.length;
			return {
				...b,
				stages: [
					...b.stages,
					{
						id: `stage-draft-${order}`,
						// Deliberately NOT a `stg-…` shape. This stage does not exist yet, so it has no
						// address, and `isSlug` refusing this placeholder is what stops anything linking
						// to a URL the server has never minted.
						slug: `stage-draft-${order}`,
						name: stage.name,
						order,
						status: "draft",
						locked: false,
						description: stage.description,
						// A brand-new stage has no rate, no roster, no history and no schedule yet — every
						// one of those is a separate decision the client has not made, so none is guessed.
						unitPriceCents: null,
						categoryWeight: 1,
						members: [],
						ticketCount: 0,
						assignmentMode: "open_pull",
						maxConcurrentIntensity: null,
						startAt: null,
						endAt: null,
						dependsOnStageId: null,
					},
				],
			};
		});
		stageModalOpen.value = false;
	}
	// #endregion

	// #region Gantt gestures
	/** A drag across empty lane space, expanded to the full modal: a ticket in that stage, due at the end. */
	function onCreateRange(laneId: string, range: GanttRange): void {
		openCompose(stageOfLane(laneId), new Date(range.end).toISOString());
	}

	/** The popover's quick-create: a titled ticket in that stage, due at the range's end, saved at once. */
	function onQuickCreate(laneId: string, range: GanttRange, title: string): void {
		const blank = newTicketCard(stageOfLane(laneId), stagesOf());
		void commitTicket({ ...blank, title, dueDate: new Date(range.end).toISOString() });
	}

	/**
	 * A bar dragged to a new range moves the ticket's DUE DATE and nothing else. The claim instant is
	 * a fact the system recorded when the work was picked up, not a plan the client may redraw — so a
	 * claimed ticket's bar keeps its start and takes the new end.
	 */
	function onMoveItem(item: GanttItem, range: GanttRange): void {
		const wire = timelineItemOf(item);
		if (!wire || wire.subject !== "ticket" || !wire.ticketId) return;
		const card = cardsOf().find((c) => c.id === wire.ticketId);
		if (!card) return;
		void commitTicket({ ...card, dueDate: new Date(range.end).toISOString() });
	}

	/** Open the thing an item stands for: a ticket in the modal, a stage on its own timeline. */
	function onOpenItem(item: GanttItem): void {
		const wire = timelineItemOf(item);
		if (!wire) return;
		if (wire.subject === "ticket" && wire.ticketId) {
			openDetail(wire.ticketId);
			return;
		}
		if (wire.subject === "stage" && wire.stageId && scope === "project") {
			// The stage's ROUTE address, resolved from the board this timeline was built over. `stageId`
			// is a `projects.project_stages` uuid, which the channel route does not resolve — building a
			// path out of it produced a link that rendered, hovered and reached nothing. Absent the
			// stage, no navigation at all: a jump to a URL known not to resolve is worse than a no-op.
			const stageSlug = page.value?.board.stages.find((s) => s.id === wire.stageId)?.slug;
			if (stageSlug && isSlug(stageSlug, "stage")) {
				globalThis.location.href = `/projects/${props.projectId}/${stageSlug}/timeline`;
			}
		}
	}
	// #endregion

	// The one frame that renders. Resolved by id rather than held by reference, so an in-place edit
	// re-renders the open modal.
	const frame = ticketStack.top.value;
	const framedTicketId = frame?.input?.ticketId ?? frame?.id ?? null;
	const viewing = framedTicketId
		? cardsOf().find((c) => c.id === framedTicketId) ??
			(composing.value?.id === framedTicketId ? composing.value : null)
		: null;
	const ticketMode: TicketMode = frame?.input?.mode === "create" ? "create" : "view";
	const canWrite = access.value.isClient && access.value.hasTickets;

	return (
		<div class="tl" data-scope={scope}>
			<div class="tl__workspace">
				{page.value
					? (
						<Gantt
							lanes={lanes.value}
							items={items.value}
							timezone={timezone ?? undefined}
							now={nowMs.value}
							focus={nowMs.value}
							zoom={timelineZoom}
							commands={timelineCommands}
							readOnly={!canWrite}
							canCreate={canWrite}
							laneHeading={scope === "project" ? "Stages" : "Tickets"}
							ariaLabel={page.value.title}
							avoid={POPOVER_AVOID}
							onCreateRange={onCreateRange}
							onQuickCreate={onQuickCreate}
							onMoveItem={canWrite ? onMoveItem : undefined}
							onOpenItem={onOpenItem}
							onZoomChange={setTimelineZoom}
							onTierChange={(t) => (timelineTier.value = tierWord(t.bottom))}
							renderItemActions={(ctx) => {
								const wire = timelineItemOf(ctx.item);
								if (!wire) return null;
								if (wire.subject === "ticket" && wire.ticketId) {
									const id = wire.ticketId;
									return (
										<Button
											size="sm"
											variant="text"
											onClick={() => {
												ctx.close();
												openDetail(id);
											}}
										>
											Open ticket
										</Button>
									);
								}
								if (wire.subject === "stage" && wire.stageId && scope === "project") {
									return (
										<Button
											size="sm"
											variant="text"
											onClick={() => {
												ctx.close();
												onOpenItem(ctx.item);
											}}
										>
											Open stage
										</Button>
									);
								}
								return null;
							}}
							empty={
								<p class="tl-empty">
									{scope === "project"
										? "This engagement has no stages to schedule yet."
										: "No tickets in this stage yet."}
								</p>
							}
						/>
					)
					: (
						<div class="tl-loading" role="status">
							{loading.value ? "Loading timeline…" : "The timeline could not be loaded."}
						</div>
					)}
			</div>

			{frame?.kind === "ticket" && viewing && !frame.input?.standalone
				? (
					<TicketView
						key={frame.uid}
						uid={frame.uid}
						mode={ticketMode}
						card={viewing}
						stages={stagesOf()}
						cards={cardsOf()}
						canEdit={access.value.canEditTicket}
						isClient={access.value.isClient}
						isFreelancer={access.value.isFreelancer}
						workspaceKind={board.value?.workspaceKind ?? "personal"}
						workspaceLabel={board.value?.workspaceLabel ?? "Personal"}
						clientMembers={board.value?.clientMembers ?? []}
						projectId={props.projectId}
						now={nowMs.value}
						onClose={() => {
							composing.value = null;
							ticketStack.close();
						}}
						onSubmit={commitTicket}
						// The review workspace belongs to the Submissions explorer; the timeline hands
						// over to its canonical address rather than mounting a second copy of it.
						onOpenSubmission={(path) => {
							globalThis.location.href = ticketSubmissionHref(props.projectId, path, {
								review: true,
							});
						}}
						onCreateSubmission={(stageId) => {
							globalThis.location.href = ticketSubmissionHref(props.projectId, [stageId]);
						}}
					/>
				)
				: null}

			<CreateStageModal
				open={stageModalOpen.value}
				projectTitle={page.value?.title ?? "Timeline"}
				onClose={() => (stageModalOpen.value = false)}
				onCreate={onCreateStage}
			/>

			{notice.value ? <div class="tl-notice" role="status">{notice.value}</div> : null}
		</div>
	);
}
