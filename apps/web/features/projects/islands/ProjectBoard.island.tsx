import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/board.css";
import "../styles/ticket-pipeline.css";
import "../styles/ticket-view.css";
// The ticket's Attachments tab mounts the `/files` cards, table and empty state, so this island is
// their carrier here (shared CSS only reaches a page through an island bundle — Decision #39). The
// rich-text editor's own sheet rides along with the component itself.
import "../styles/file-explorer.css";
import "../styles/file-table.css";
// The ticket view mounts the SAME submission tree, cards and file cards `/submissions` does, so it
// needs their stylesheets. Shared `@projective/ui` CSS only reaches a page through an island bundle
// (root CLAUDE.md §8 Decision #39), and this island is the ticket surface's only carrier.
import "../styles/submission-explorer.css";
import "../styles/submission-card.css";
import "../styles/file-card.css";
import "../styles/submission-review.css";
import { KanbanBoard, type KanbanColumnModel, type KanbanItemMove } from "@projective/ui/kanban";
import type { KanbanColumnMove } from "@projective/ui/kanban";
import { InputText, MultiSelect, SortControl } from "@projective/ui/fields";
import {
	type BoardCard,
	type BoardColumn,
	type BoardPage,
	type BoardStageRef,
	type BoardView,
	buildBoardColumns,
	type TicketStatus,
} from "../types/projects-types.ts";
import {
	assigneeOptions,
	BOARD_SORT_OPTIONS,
	boardCardColumn,
	classifyMove,
	filterCards,
	PRIORITY_OPTIONS,
	sortCards,
} from "../core/board-model.ts";
import {
	boardGrouping,
	boardViewMode,
	checkoutOpen,
	createStageOpen,
	createTicketOpen,
	publishBoardCaps,
	resetBoardState,
} from "../core/board-state.ts";
import { BoardService } from "../core/BoardService.ts";
import { SearchIcon } from "../components/file-glyphs.tsx";
import { TicketCard } from "../components/TicketCard.tsx";
import { BoardColumnHeader } from "../components/BoardColumnHeader.tsx";
import { TicketListView } from "../components/TicketListView.tsx";
import { CreateStageModal } from "../components/CreateStageModal.tsx";
import { type BoardWarningKind, BoardWarnings } from "../components/BoardWarnings.tsx";
import { TicketView } from "../components/ticket/TicketView.tsx";
import { SubmissionReviewModal } from "../components/SubmissionReviewModal.tsx";
import { newTicketCard, reconcileCard } from "../core/ticket-model.ts";
import {
	filesAtPath,
	firstUnitUnder,
	reviewForPath,
	type TicketMode,
	ticketStack,
	ticketSubmissionHref,
} from "../core/ticket-view.ts";
import {
	type BoardAccess,
	readDevSeam,
	resolveBoardAccess,
	watchDevSeam,
} from "../core/board-access.ts";
import { resolveSessionKind } from "../core/session-model.ts";

/**
 * ProjectBoard — the single island the Kanban board routes mount, for the project pipeline
 * (`/projects/[projectId]/board`) and the stage-level Tasks board
 * (`/projects/[projectId]/[channelId]/tasks`). It hosts the toolbar (search · Priority · Assignee ·
 * Sort — the /files toolbar layout), the Kanban⁄List surface, and the modal flows: the 2-panel ticket
 * modal, the Create-Stage modal, and the three move warnings (reorder · claimed · revision).
 *
 * THIN: first paint is the SSR-resolved board; the island owns view state and refines client-side (the
 * full card set is loaded — search/priority/assignee filter + Stages⁄Status grouping rebuild locally via
 * the shared column builder). Moves are OPTIMISTIC (persistence lands behind `PROJECTS_BACKEND_LIVE`);
 * the board is controlled, so a consequential move is committed only after its confirmation modal.
 */
export interface ProjectBoardProps {
	scope: "project" | "channel";
	projectId: string;
	channelId?: string;
	initial: BoardPage | null;
}

interface PendingWarning {
	kind: BoardWarningKind;
	label: string;
	apply: () => void;
}

export default function ProjectBoard(props: ProjectBoardProps): JSX.Element {
	const { scope, channelId, initial } = props;

	// #region State
	const cards = useSignal<BoardCard[]>(initial?.cards ?? []);
	const stages = useSignal<BoardStageRef[]>(initial?.stages ?? []);
	const assigneesList = initial?.assignees ?? [];
	const boardKind: "project" | "stage" = initial?.kind ??
		(scope === "channel" ? "stage" : "project");
	const boardTitle = initial?.title ?? "Board";
	const boardStageId = scope === "channel" ? channelId ?? null : null;

	const query = useSignal("");
	const priorityFilter = useSignal<string[]>([]);
	const assigneeFilter = useSignal<string[]>([]);
	const sortKey = useSignal<string>("manual");
	const sortDir = useSignal<"asc" | "desc">("asc");

	/**
	 * The ticket being composed, if any.
	 *
	 * It is a real {@link BoardCard} rather than a separate draft shape, because the modal that
	 * composes it is the modal that reads it — one surface over one shape. It lives beside `cards`
	 * rather than in it: an unsaved ticket must not appear on the board, be dragged between columns or
	 * be counted in the basket until the client presses Create.
	 */
	const composing = useSignal<BoardCard | null>(null);
	const stageModalOpen = useSignal(false);
	/** Expanded tree keys for the review modal's own navigator (its own state, not the ticket's). */
	const reviewExpanded = useSignal<Set<string>>(new Set());
	/**
	 * The board's own address, captured once. The chain rewrites the URL while a review is open and
	 * restores this on the way back; reading `location` at restore time would read whatever the chain
	 * itself last wrote.
	 */
	const boardUrl = useRef(
		typeof location === "undefined" ? "" : location.pathname + location.search,
	).current;
	const pending = useSignal<PendingWarning | null>(null);
	const warningVisible = useSignal(false);
	const notice = useSignal("");
	const newIdRef = useRef(0);

	/*
	 * Effective capabilities, not the raw SSR flag.
	 *
	 * The server paints one baseline and the Dev Context Switcher can simulate any seat on top of it,
	 * so every gate below reads this signal rather than `initial.viewerIsClient`. It is seeded on mount
	 * (the seam only exists client-side, so SSR must paint the server's own answer or the first frame
	 * would disagree with itself) and re-resolved on every `pj:devcontext` change.
	 */
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
	// #endregion

	// #region Derived (grouping + columns + filtered cards)
	const grouping: BoardView = boardKind === "project" ? boardGrouping.value : "statuses";
	const sortActive = sortKey.value !== "manual";
	const laneOf = (c: BoardCard) => boardCardColumn(c, grouping, boardKind);

	const boardColumns = buildBoardColumns(stages.value, grouping, boardKind);
	const kanbanColumns: KanbanColumnModel<BoardColumn>[] = boardColumns.map((col) => ({
		id: col.id,
		title: col.title,
		reorderable: col.reorderable,
		sortable: col.sortable && !sortActive,
		wipLimit: col.wipLimit,
		data: col,
	}));

	const visible = sortCards(
		filterCards(cards.value, {
			query: query.value,
			priorities: priorityFilter.value,
			assignees: assigneeFilter.value,
		}),
		sortActive ? sortKey.value : "",
		sortDir.value,
	);

	const basketCount = cards.value.filter(
		(c) => c.hasDescription && !c.claimed && c.status === "backlog",
	).length;
	// #endregion

	// #region Cross-island coordination (publish caps · consume footer intents · cleanup)
	useSignalEffect(() => {
		// Re-read `cards` + `access` so the footer republishes as tickets change AND as the developer
		// flips a persona — the rig is a separate hydration root and this signal is its only input.
		const basket = cards.value.filter(
			(c) => c.hasDescription && !c.claimed && c.status === "backlog",
		).length;
		const a = access.value;
		publishBoardCaps({
			isClient: a.isClient,
			isProjectBoard: boardKind === "project",
			basketCount: a.hasTickets ? basket : 0,
			hasTickets: a.hasTickets,
		});
	});
	useSignalEffect(() => {
		if (createTicketOpen.value) {
			createTicketOpen.value = false;
			if (access.value.isClient && access.value.hasTickets) openCompose(boardStageId);
		}
	});
	useSignalEffect(() => {
		if (createStageOpen.value) {
			createStageOpen.value = false;
			if (access.value.isClient && boardKind === "project") stageModalOpen.value = true;
		}
	});
	useSignalEffect(() => {
		if (checkoutOpen.value) {
			checkoutOpen.value = false;
			doCheckout();
		}
	});
	// A seat that loses the client capability mid-flight should not be left sitting in a composer it
	// can no longer submit from. A ticket that already EXISTS stays open — reading one was never the
	// gated part, and the modal degrades to its read-only presentation on its own.
	useSignalEffect(() => {
		const a = access.value;
		if (!a.isClient || !a.hasTickets) {
			if (composing.value) {
				const id = composing.value.id;
				composing.value = null;
				if (ticketStack.top.value?.input?.ticketId === id) ticketStack.close();
			}
			if (stageModalOpen.value) stageModalOpen.value = false;
		}
	});
	// Reset the shared board signals + defensively load if SSR produced no page.
	useSignalEffect(() => {
		if (!initial) void loadFallback();
		return () => resetBoardState();
	});

	// The chain is page-local state; leaving the page discards it (and its caches) rather than
	// leaking frames into whatever mounts next.
	useEffect(() => () => ticketStack.close(), []);
	// #endregion

	// #region Actions
	function toast(msg: string): void {
		notice.value = msg;
		setTimeout(() => {
			if (notice.value === msg) notice.value = "";
		}, 3200);
	}

	async function loadFallback(): Promise<void> {
		const res = await BoardService.list({ projectId: props.projectId, channelId: boardStageId });
		if (res.ok && res.data) {
			cards.value = res.data.page.cards;
			stages.value = res.data.page.stages;
		}
	}

	function doCheckout(): void {
		toast(
			basketCount > 0
				? `Escrow committed for ${basketCount} ticket${basketCount > 1 ? "s" : ""} (stub).`
				: "Nothing to check out yet — add tickets with a description.",
		);
	}

	/** Rewrite a card's status/stage to match the column it was dropped into. */
	function applyColumnToCard(card: BoardCard, col: BoardColumn): BoardCard {
		if (col.kind === "new") {
			return { ...card, stageId: null, status: "backlog", claimed: false, escrowHeld: false };
		}
		if (col.kind === "completed") return { ...card, status: "completed", escrowHeld: false };
		if (col.kind === "stage") {
			return { ...card, stageId: col.stageId, status: card.claimed ? "in_progress" : "todo" };
		}
		const st = col.status as TicketStatus;
		if (st === "backlog") return { ...card, status: "backlog", claimed: false, escrowHeld: false };
		if (st === "todo") return { ...card, status: "todo", claimed: false, escrowHeld: false };
		if (st === "completed") return { ...card, status: "completed", escrowHeld: false };
		return { ...card, status: st, claimed: true, escrowHeld: true }; // in_progress / in_review
	}

	function applyItemMove(move: KanbanItemMove): void {
		const card = cards.value.find((c) => c.id === move.itemId);
		const col = boardColumns.find((c) => c.id === move.toColumn);
		if (!card || !col) return;
		const updated = applyColumnToCard(card, col);
		const rest = cards.value.filter((c) => c.id !== move.itemId);
		const dest = rest.filter((c) => laneOf(c) === move.toColumn);
		let at: number;
		if (dest.length === 0) at = rest.length;
		else if (move.toIndex >= dest.length) {
			at = rest.findIndex((c) => c.id === dest[dest.length - 1].id) + 1;
		} else at = rest.findIndex((c) => c.id === dest[move.toIndex].id);
		cards.value = [...rest.slice(0, at), updated, ...rest.slice(at)];
	}

	function warn(kind: PendingWarning["kind"], label: string, apply: () => void): void {
		pending.value = { kind, label, apply };
		warningVisible.value = true;
	}

	function onItemMove(move: KanbanItemMove): void {
		const card = cards.value.find((c) => c.id === move.itemId);
		const to = boardColumns.find((c) => c.id === move.toColumn);
		if (!card || !to) return;
		if (boardKind === "project" && !access.value.isClient) {
			toast("Only the client can move tickets on the project board.");
			return;
		}
		const toDone = to.kind === "completed" || (to.kind === "status" && to.status === "completed");
		if (toDone && !access.value.isClient) {
			toast("Only the client can move a ticket to Done (confirm delivery).");
			return;
		}
		const kind = classifyMove(card, move.fromColumn, move.toColumn, boardColumns);
		if (kind === "free") {
			applyItemMove(move);
			return;
		}
		warn(kind === "revision" ? "revision" : "claimed", card.title, () => applyItemMove(move));
	}

	function applyColumnMove(move: KanbanColumnMove): void {
		// Column indices → stage indices (the New bookend is column 0).
		const fromStage = move.fromIndex - 1;
		let toStage = move.toIndex - 1;
		if (fromStage < 0 || fromStage >= stages.value.length) return;
		toStage = Math.max(0, Math.min(stages.value.length - 1, toStage));
		const arr = stages.value.slice();
		const [moved] = arr.splice(fromStage, 1);
		arr.splice(toStage, 0, moved);
		stages.value = arr.map((s, i) => ({ ...s, order: i }));
	}

	function onColumnMove(move: KanbanColumnMove): void {
		const col = boardColumns.find((c) => c.id === move.columnId);
		warn("reorder", col?.title ?? "stage", () => applyColumnMove(move));
	}

	// #region Modal chain (the ticket → review chain, one blurred backdrop for all of it)
	/**
	 * Opening a card starts a NEW chain rather than pushing onto whatever is left over. Reading a
	 * ticket is always an entry point, and inheriting a stale chain would leave a "back" that returns
	 * to a ticket the viewer was never looking at.
	 */
	function openDetail(card: BoardCard): void {
		ticketStack.open("ticket", card.id, { ticketId: card.id });
	}

	/**
	 * Start composing a ticket, optionally seeded with the stage column it was opened from.
	 *
	 * It opens the SAME modal a saved ticket opens, on the same chain, in `create` posture — so a
	 * client who composes a ticket and then reads it back is never handed a different surface, and the
	 * chain's own state cache keeps a half-written brief alive across anything that replaces it.
	 */
	function openCompose(stageId: string | null): void {
		const blank = newTicketCard(stageId, stages.value);
		composing.value = blank;
		ticketStack.open("ticket", blank.id, { ticketId: blank.id, mode: "create" });
	}

	/**
	 * Open a submission's review workspace. The ticket frame is not unmounted-and-forgotten but
	 * REPLACED: its tab, scroll offset, open stages and browsed path stay in the frame cache, so
	 * dismissing the review restores exactly the surface the viewer left. The URL follows the review
	 * to the canonical `/submissions/[stage]/[submitter]/[unit]` address, so the deep link a viewer
	 * copies mid-review addresses the submission and not the board.
	 */
	function openSubmission(ticketId: string, rawPath: string[]): void {
		const card = cards.value.find((c) => c.id === ticketId);
		if (!card) return;
		const path = firstUnitUnder(card.submissions, rawPath);
		if (reviewForPath(card, path) === null) return;
		reviewExpanded.value = new Set(path.map((_, i) => path.slice(0, i + 1).join("/")));
		ticketStack.push("review", path.join("/"), { path, ticketId });
		setUrl(ticketSubmissionHref(props.projectId, path, { review: true }));
	}

	/** Pop one frame, restoring the one beneath it with its cached state. */
	function popFrame(): void {
		if (!ticketStack.back()) {
			ticketStack.close();
			return;
		}
		setUrl(boardUrl);
	}

	/**
	 * Point the address bar at whatever the chain is showing — REPLACING the entry rather than
	 * pushing one.
	 *
	 * The obvious design was `pushState` on open and `history.back()` on dismiss, so the browser's
	 * Back button would close the review. Measured, that is unsafe: `history.back()` from a pushState
	 * entry was observed reloading the document, which destroys the whole chain and every cached
	 * frame with it — a Back that loses the ticket is far worse than a Back that simply leaves the
	 * board. Replacing keeps the URL honest (a link copied mid-review still addresses the submission
	 * and reopens it, via `?review=1`) while making it structurally impossible for a traversal to tear
	 * the chain down. Escape, the close button and the review's own actions dismiss it.
	 */
	function setUrl(href: string): void {
		if (typeof history === "undefined") return;
		history.replaceState(history.state, "", href);
	}

	/**
	 * Start a submission against a stage.
	 *
	 * It routes to the Submissions explorer at that stage rather than opening a third create modal
	 * here. Creating a deliverable is a workflow with its own pre-submit checks, task checklist and
	 * upload flow, all of which already exist there — a second implementation inside the ticket would
	 * be the same flow with different rules, which is how two surfaces come to disagree about what a
	 * valid submission is.
	 */
	function onCreateSubmission(stageId: string): void {
		const href = ticketSubmissionHref(props.projectId, [stageId]);
		if (typeof globalThis.location !== "undefined") globalThis.location.href = href;
	}
	// #endregion
	function openCreateForColumn(col: BoardColumn): void {
		openCompose(col.kind === "stage" ? col.stageId : boardStageId);
	}

	/**
	 * Commit the modal's working copy — the one write path for both postures.
	 *
	 * Money and capacity are re-derived through the SAME {@link reconcileCard} the modal's own footer
	 * used, so the figure the client agreed to is the figure the board shows; there is no second
	 * arithmetic path that could round differently. A brand-new ticket joins the board at the top of
	 * the column it was composed for; an existing one is replaced in place, and the modal stays open
	 * on it.
	 */
	function commitTicket(next: BoardCard): void {
		const card = reconcileCard({ ...next, updatedAt: new Date().toISOString() }, stages.value);
		const exists = cards.value.some((c) => c.id === card.id);
		if (exists) {
			cards.value = cards.value.map((c) => (c.id === card.id ? card : c));
			return;
		}
		// A saved ticket gets a board id, so the chain has to be re-pointed at it — the frame was
		// opened on the draft's id and would otherwise resolve to a ticket that no longer exists.
		const saved: BoardCard = { ...card, id: `ticket-${++newIdRef.current}`, dateLabel: "Just now" };
		cards.value = [saved, ...cards.value];
		composing.value = null;
		ticketStack.close();
		ticketStack.open("ticket", saved.id, { ticketId: saved.id });
	}

	function onCreateStage(stage: { name: string; description: string }): void {
		const order = stages.value.length;
		stages.value = [
			...stages.value,
			{
				id: `stage-draft-${order}`,
				name: stage.name,
				order,
				status: "draft",
				locked: false,
				description: stage.description,
				// A brand-new stage has no rate, no roster and no history yet — every one of those is a
				// separate decision the client has not made, so none of them is guessed here.
				unitPriceCents: null,
				categoryWeight: 1,
				members: [],
				ticketCount: 0,
				assignmentMode: "open_pull",
				maxConcurrentIntensity: null,
			},
		];
		stageModalOpen.value = false;
	}

	function acceptWarning(): void {
		pending.value?.apply();
		pending.value = null;
		warningVisible.value = false;
	}
	function cancelWarning(): void {
		pending.value = null;
		warningVisible.value = false;
	}
	// #endregion

	const viewMode = boardViewMode.value;
	// The one frame that renders. Resolved by id rather than held by reference, so an in-place edit
	// re-renders the open modal.
	const frame = ticketStack.top.value;
	const framedTicketId = frame?.input?.ticketId ?? frame?.id ?? null;
	// A composed ticket is not on the board yet, so the chain resolves against both places a card can
	// live. Board first: once Create lands, the saved card is the authority.
	const viewing = framedTicketId
		? cards.value.find((c) => c.id === framedTicketId) ??
			(composing.value?.id === framedTicketId ? composing.value : null)
		: null;
	const ticketMode: TicketMode = frame?.input?.mode === "create" ? "create" : "view";
	const reviewPath = frame?.kind === "review" ? frame.input?.path ?? [] : [];
	const review = frame?.kind === "review" && viewing ? reviewForPath(viewing, reviewPath) : null;

	function toolbar(): JSX.Element {
		return (
			<div class="brd-toolbar">
				<div class="brd-toolbar__search">
					<InputText
						type="search"
						variant="bare"
						size="sm"
						block
						placeholder="Search tickets…"
						aria-label="Search tickets"
						value={query}
						start={
							<span class="brd-toolbar__searchicon" aria-hidden="true">
								<SearchIcon size={16} />
							</span>
						}
					/>
				</div>
				<span class="brd-toolbar__spacer" />
				<MultiSelect
					class="ui-field--bare"
					size="sm"
					display="chip"
					placeholder="Priority"
					aria-label="Filter by priority"
					options={PRIORITY_OPTIONS}
					value={priorityFilter}
				/>
				<MultiSelect
					class="ui-field--bare"
					size="sm"
					display="chip"
					placeholder="Assignee"
					aria-label="Filter by assignee"
					options={assigneeOptions(assigneesList)}
					value={assigneeFilter}
				/>
				<SortControl
					size="sm"
					options={BOARD_SORT_OPTIONS}
					value={sortKey}
					direction={sortDir}
				/>
			</div>
		);
	}

	return (
		<div class="brd" data-scope={scope}>
			{toolbar()}
			<div class="brd-workspace">
				{viewMode === "kanban"
					? (
						<KanbanBoard<BoardCard, BoardColumn>
							columns={kanbanColumns}
							items={visible}
							getItemId={(c) => c.id}
							getItemColumn={laneOf}
							getItemLabel={(c) => c.title}
							renderItem={(c) => <TicketCard card={c} onOpen={openDetail} />}
							renderColumnHeader={(ctx) => (
								<BoardColumnHeader
									ctx={ctx}
									canCreate={access.value.isClient && access.value.hasTickets &&
										!!ctx.column.data?.canCreateTicket}
									onCreate={openCreateForColumn}
								/>
							)}
							itemDraggable={(c) =>
								(boardKind === "project" ? access.value.isClient : true) && !c.frozen}
							onItemMove={onItemMove}
							onColumnMove={onColumnMove}
							columnsReorderable={boardKind === "project" && grouping === "stages" &&
								access.value.isClient}
							emptyColumn={() => <span class="brd-dropzone">Drop tickets here</span>}
							ariaLabel={boardTitle}
						/>
					)
					: <TicketListView cards={visible} laneOf={(c) => laneLabel(c)} onOpen={openDetail} />}
			</div>

			{
				/*
				 * The modal CHAIN, not a pile: exactly one frame renders, so a ticket → review round trip
				 * composites ONE blurred backdrop rather than two, and the ticket's state is restored from
				 * the frame cache rather than rebuilt.
				 */
			}
			{frame?.kind === "ticket" && viewing
				? (
					<TicketView
						key={frame.uid}
						uid={frame.uid}
						mode={ticketMode}
						card={viewing}
						stages={stages.value}
						cards={cards.value}
						canEdit={access.value.canEditTicket}
						isClient={access.value.isClient}
						isFreelancer={access.value.isFreelancer}
						workspaceKind={initial?.workspaceKind ?? "personal"}
						workspaceLabel={initial?.workspaceLabel ?? "Personal"}
						clientMembers={initial?.clientMembers ?? []}
						projectId={props.projectId}
						onClose={() => {
							composing.value = null;
							ticketStack.close();
						}}
						onSubmit={commitTicket}
						onOpenSubmission={(path) => openSubmission(viewing.id, path)}
						onCreateSubmission={onCreateSubmission}
					/>
				)
				: null}

			{frame?.kind === "review" && viewing && review
				? (
					<SubmissionReviewModal
						key={frame.uid}
						open
						review={review}
						files={filesAtPath(viewing, reviewPath)}
						tree={viewing.submissions}
						rootLabel="This ticket"
						rootCount={viewing.submissions.reduce((n, s) => n + s.fileCount, 0)}
						currentPath={reviewPath}
						expanded={reviewExpanded}
						viewerId={initial?.viewerId ?? "viewer"}
						onClose={() => popFrame()}
						onNavigate={(path) => openSubmission(viewing.id, path)}
						onRequestRevision={() => {
							toast("Revision requested — the freelancer has been notified (stub).");
							popFrame();
						}}
						onAccept={() => {
							toast("Submission accepted — escrow release queued (stub).");
							popFrame();
						}}
					/>
				)
				: null}

			<CreateStageModal
				open={stageModalOpen.value}
				projectTitle={boardTitle}
				onClose={() => (stageModalOpen.value = false)}
				onCreate={onCreateStage}
			/>

			<BoardWarnings
				visible={warningVisible}
				warning={pending.value ? { kind: pending.value.kind, label: pending.value.label } : null}
				onAccept={acceptWarning}
				onCancel={cancelWarning}
			/>

			{notice.value ? <div class="brd-notice" role="status">{notice.value}</div> : null}
		</div>
	);

	/** The human column/lane label a card sits in for the active view (List view). */
	function laneLabel(c: BoardCard): string {
		return boardColumns.find((col) => col.id === laneOf(c))?.title ?? "—";
	}
}
