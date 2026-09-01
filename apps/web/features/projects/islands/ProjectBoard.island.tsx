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
	type CommitTicket,
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
import { ProjectSkeleton, useSkeletonDelay } from "../components/ProjectSkeletons.tsx";
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
	/**
	 * What the warning authorises.
	 *
	 * Widened to an optional promise because the consequential moves are the ones that MOVE MONEY —
	 * crossing into a new stage charges the ticket, confirming Done releases escrow — so the persist
	 * has to live inside the acceptance rather than beside it. A synchronous closure could only ever
	 * mutate the board and let the write race the confirmation.
	 */
	apply: () => void | Promise<void>;
}

/**
 * Where a card lands when it is dropped into `col`, as a lifecycle transition rather than a lane.
 *
 * Deliberately narrow: it resolves `status` and `stageId` and NOTHING else. The board used to
 * fabricate `claimed`/`escrowHeld` here — a drag into In Progress asserted that a freelancer had
 * claimed the ticket and that escrow was held for it, which is a financial claim no gesture on this
 * surface is entitled to make. The server's returned card is the authority on both; until it answers,
 * the card keeps whatever it already carried.
 */
function columnTarget(
	card: BoardCard,
	col: BoardColumn,
): { status: TicketStatus; stageId: string | null } {
	if (col.kind === "new") return { status: "backlog", stageId: null };
	if (col.kind === "completed") return { status: "completed", stageId: card.stageId };
	if (col.kind === "stage") {
		return { status: card.claimed ? "in_progress" : "todo", stageId: col.stageId };
	}
	return { status: col.status as TicketStatus, stageId: card.stageId };
}

/**
 * Whether this column is the manual-order lane.
 *
 * `sort_order` is writable only while a ticket is in `backlog` (`trg_ticket_ordering_guard` raises
 * otherwise), so a position sent for any other lane would be dropped server-side at best and refuse
 * the whole statement at worst.
 */
function isManualLane(col: BoardColumn): boolean {
	return col.kind === "new" || (col.kind === "status" && col.status === "backlog");
}

/** The ticket as the commit endpoint wants it — the card's own fields, never a re-derived total. */
function commitPayload(projectId: string, clientId: string, card: BoardCard): CommitTicket {
	return {
		projectId,
		clientId,
		title: card.title,
		description: card.description ?? "",
		status: card.status,
		stageId: card.stageId,
		priority: card.priority,
		intensity: card.intensity,
		dueDate: card.dueDate,
		// A party carries a handle, not an id — the handle IS the identifier a member is addressed by
		// across this product (Decision #3), and the server maps it back to the seat.
		ownerId: card.owner?.handle ?? null,
		tasks: card.tasks,
		stages: card.stages,
		// The assets already linked to the ticket. The Attachments tab stages a pick as a COUNT and
		// never writes a fabricated row into `attachments`, so every id here is a real `files.items` id.
		attachmentIds: card.attachments.map((a) => a.id),
	};
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

	/**
	 * The placeholder gate for the ONE fetch this board makes — the defensive fallback taken when SSR
	 * produced no page. Every other narrowing on this surface is client-side over `cards`, so there is
	 * nothing else to wait for and no per-refine placeholder to draw.
	 */
	const skeleton = useSkeletonDelay();

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
		skeleton.begin();
		const res = await BoardService.list({ projectId: props.projectId, channelId: boardStageId });
		// Cleared BEFORE the payload check, so a failed fallback lands on the board's own empty state
		// rather than leaving the placeholder up for the life of the page.
		skeleton.end();
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

	/**
	 * Splice the card into its new lane, optimistically.
	 *
	 * `sortOrder` is written onto the card only for the manual lane, so the number the board renders
	 * and the number the server is asked to store are the same one.
	 */
	function applyItemMove(move: KanbanItemMove, sortOrder: number | null): void {
		const card = cards.value.find((c) => c.id === move.itemId);
		const col = boardColumns.find((c) => c.id === move.toColumn);
		if (!card || !col) return;
		const target = columnTarget(card, col);
		const updated: BoardCard = sortOrder === null
			? { ...card, ...target }
			: { ...card, ...target, sortOrder };
		const rest = cards.value.filter((c) => c.id !== move.itemId);
		const dest = rest.filter((c) => laneOf(c) === move.toColumn);
		let at: number;
		if (dest.length === 0) at = rest.length;
		else if (move.toIndex >= dest.length) {
			at = rest.findIndex((c) => c.id === dest[dest.length - 1].id) + 1;
		} else at = rest.findIndex((c) => c.id === dest[move.toIndex].id);
		cards.value = [...rest.slice(0, at), updated, ...rest.slice(at)];
	}

	/**
	 * Move a ticket and persist it.
	 *
	 * The board splices first so the drag lands under the pointer, then asks the server. On the way
	 * back the RETURNED card replaces the optimistic one wholesale: a move can change claim state,
	 * escrow and ordering, and the board has no standing to guess any of them. On refusal the whole
	 * previous array is restored — not just the card's column, because the splice also reordered its
	 * neighbours — and the reason is stated.
	 */
	async function commitMove(move: KanbanItemMove): Promise<void> {
		const before = cards.value;
		const card = before.find((c) => c.id === move.itemId);
		const col = boardColumns.find((c) => c.id === move.toColumn);
		if (!card || !col) return;

		const target = columnTarget(card, col);
		const sortOrder = isManualLane(col) ? move.toIndex : null;
		applyItemMove(move, sortOrder);

		const res = await BoardService.move({
			projectId: props.projectId,
			ticketId: card.id,
			status: target.status,
			stageId: target.stageId,
			sortOrder,
		});
		if (res.ok && res.data) {
			const saved = res.data.card;
			cards.value = cards.value.map((c) => (c.id === saved.id ? saved : c));
			return;
		}
		cards.value = before;
		toast(res.message ?? "That move could not be saved.");
	}

	function warn(
		kind: PendingWarning["kind"],
		label: string,
		apply: () => void | Promise<void>,
	): void {
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
			void commitMove(move);
			return;
		}
		// The card does not move and nothing is written until the warning is accepted — the whole point
		// of these three is that the consequence is irreversible once it happens.
		warn(kind === "revision" ? "revision" : "claimed", card.title, () => commitMove(move));
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
	 * Re-point the open ticket frame at a different id, keeping whatever sits beneath it.
	 *
	 * A ticket's identity changes twice on the way from composer to board — draft id → optimistic id →
	 * the server's — and the frame was opened on the first of them, so without this the modal would
	 * resolve to a ticket that no longer exists and unmount under the reader. Guarded on the frame
	 * still SHOWING the id being replaced: by the time the server answers the reader may have closed
	 * the modal or opened another ticket, and re-pointing then would haul them back.
	 */
	function repointFrame(fromId: string, toId: string, mode: TicketMode): void {
		const top = ticketStack.top.value;
		if (!top || top.kind !== "ticket") return;
		if ((top.input?.ticketId ?? top.id) !== fromId) return;
		ticketStack.replace(
			"ticket",
			toId,
			mode === "create" ? { ticketId: toId, mode } : { ticketId: toId },
		);
	}

	/**
	 * Commit the modal's working copy — the one write path for both postures.
	 *
	 * The optimistic card is derived through the SAME {@link reconcileCard} the modal's own footer
	 * used, so between the press and the answer the board shows the figure the client agreed to and
	 * not a second one rounded differently. The answer then REPLACES it verbatim: a saved ticket's id,
	 * dates, claim state and money trail are the server's to state.
	 *
	 * The optimistic id is minted with a prefix that no server row can carry. A bare counter produced
	 * `ticket-1` on the first create of every page load, which is a plausible real ticket id — and an
	 * optimistic row that can be mistaken for a persisted one is a row nothing can safely roll back.
	 *
	 * On refusal the board is restored and the reason is stated. A refused CREATE also puts the
	 * composer back on the reader's own draft: the working copy they typed is the only copy of it, and
	 * discarding it because the network failed would lose work that was never the network's to lose.
	 */
	async function commitTicket(next: BoardCard): Promise<void> {
		const card = reconcileCard({ ...next, updatedAt: new Date().toISOString() }, stages.value);
		const clientId = card.id;
		const existing = cards.value.find((c) => c.id === clientId) ?? null;
		const optimisticId = existing ? clientId : `optimistic-${++newIdRef.current}`;

		if (existing) {
			cards.value = cards.value.map((c) => (c.id === clientId ? card : c));
		} else {
			cards.value = [{ ...card, id: optimisticId, dateLabel: "Just now" }, ...cards.value];
			composing.value = null;
			repointFrame(clientId, optimisticId, "view");
		}

		const res = await BoardService.commit(commitPayload(props.projectId, clientId, card));
		if (res.ok && res.data) {
			const saved = res.data.card;
			cards.value = cards.value.map((c) => (c.id === optimisticId ? saved : c));
			if (saved.id !== optimisticId) repointFrame(optimisticId, saved.id, "view");
			return;
		}

		if (existing) {
			cards.value = cards.value.map((c) => (c.id === clientId ? existing : c));
		} else {
			cards.value = cards.value.filter((c) => c.id !== optimisticId);
			composing.value = card;
			repointFrame(optimisticId, clientId, "create");
		}
		toast(res.message ?? "That ticket could not be saved.");
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
		// The dialog closes on acceptance rather than on completion: the move is optimistic, so holding
		// the warning up until the round trip returns would make an accepted decision look undecided.
		const accepted = pending.value;
		pending.value = null;
		warningVisible.value = false;
		void accepted?.apply();
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
				{skeleton.visible.value
					? (
						<ProjectSkeleton
							shape="board"
							label="Loading board…"
							columns={Math.max(kanbanColumns.length, 3)}
						/>
					)
					: viewMode === "kanban"
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
