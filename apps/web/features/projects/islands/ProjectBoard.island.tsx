import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/board.css";
import "../styles/ticket-modal.css";
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
import { type TicketDraft, TicketModal } from "../components/TicketModal.tsx";

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
	const viewerIsClient = initial?.viewerIsClient ?? false;
	const boardKind: "project" | "stage" = initial?.kind ??
		(scope === "channel" ? "stage" : "project");
	const boardTitle = initial?.title ?? "Board";
	const boardStageId = scope === "channel" ? channelId ?? null : null;

	const query = useSignal("");
	const priorityFilter = useSignal<string[]>([]);
	const assigneeFilter = useSignal<string[]>([]);
	const sortKey = useSignal<string>("manual");
	const sortDir = useSignal<"asc" | "desc">("asc");

	const editing = useSignal<
		{ mode: "create" | "edit"; card: BoardCard | null; stageId: string | null } | null
	>(null);
	const stageModalOpen = useSignal(false);
	const pending = useSignal<PendingWarning | null>(null);
	const warningVisible = useSignal(false);
	const notice = useSignal("");
	const newIdRef = useRef(0);
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
		// Re-read `cards` so the basket count republishes as tickets change.
		const basket = cards.value.filter(
			(c) => c.hasDescription && !c.claimed && c.status === "backlog",
		).length;
		publishBoardCaps({
			isClient: viewerIsClient,
			isProjectBoard: boardKind === "project",
			basketCount: basket,
		});
	});
	useSignalEffect(() => {
		if (createTicketOpen.value) {
			createTicketOpen.value = false;
			if (viewerIsClient) editing.value = { mode: "create", card: null, stageId: boardStageId };
		}
	});
	useSignalEffect(() => {
		if (createStageOpen.value) {
			createStageOpen.value = false;
			if (viewerIsClient && boardKind === "project") stageModalOpen.value = true;
		}
	});
	useSignalEffect(() => {
		if (checkoutOpen.value) {
			checkoutOpen.value = false;
			doCheckout();
		}
	});
	// Reset the shared board signals + defensively load if SSR produced no page.
	useSignalEffect(() => {
		if (!initial) void loadFallback();
		return () => resetBoardState();
	});
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
		if (boardKind === "project" && !viewerIsClient) {
			toast("Only the client can move tickets on the project board.");
			return;
		}
		const toDone = to.kind === "completed" || (to.kind === "status" && to.status === "completed");
		if (toDone && !viewerIsClient) {
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

	function openEdit(card: BoardCard): void {
		editing.value = { mode: "edit", card, stageId: null };
	}
	function openCreateForColumn(col: BoardColumn): void {
		editing.value = {
			mode: "create",
			card: null,
			stageId: col.kind === "stage" ? col.stageId : boardStageId,
		};
	}

	function onTicketSubmit(draft: TicketDraft): void {
		if (draft.id) {
			cards.value = cards.value.map((c) =>
				c.id === draft.id
					? {
						...c,
						title: draft.title,
						description: draft.description || null,
						hasDescription: draft.description.trim().length > 0,
						priority: draft.priority,
						tags: draft.tags,
						budgetLabel: draft.budgetCents != null
							? `$${Math.round(draft.budgetCents / 100)}`
							: c.budgetLabel,
						stages: draft.stages.map((s, i) => ({
							stageId: s.stageId,
							name: stages.value.find((st) => st.id === s.stageId)?.name ?? s.stageId,
							order: i,
							status: stages.value.find((st) => st.id === s.stageId)?.status ?? "draft",
							required: true,
						})),
					}
					: c
			);
		} else {
			const originStage = editing.value?.stageId ?? null;
			const card: BoardCard = {
				id: `draft-${++newIdRef.current}`,
				title: draft.title,
				description: draft.description || null,
				hasDescription: draft.description.trim().length > 0,
				status: "backlog",
				stageId: originStage,
				assignee: null,
				claimed: false,
				escrowHeld: false,
				priority: draft.priority,
				tags: draft.tags,
				budgetLabel: draft.budgetCents != null ? `$${Math.round(draft.budgetCents / 100)}` : null,
				activity: null,
				frozen: false,
				commentCount: 0,
				attachmentCount: 0,
				checklistDone: 0,
				checklistTotal: 0,
				stages: draft.stages.map((s, i) => ({
					stageId: s.stageId,
					name: stages.value.find((st) => st.id === s.stageId)?.name ?? s.stageId,
					order: i,
					status: stages.value.find((st) => st.id === s.stageId)?.status ?? "draft",
					required: true,
				})),
				updatedAt: new Date().toISOString(),
				dateLabel: "Just now",
				sortOrder: 0,
			};
			cards.value = [card, ...cards.value];
		}
		editing.value = null;
	}

	function onCreateStage(stage: { name: string; description: string }): void {
		const order = stages.value.length;
		stages.value = [
			...stages.value,
			{ id: `stage-draft-${order}`, name: stage.name, order, status: "draft", locked: false },
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
							renderItem={(c) => <TicketCard card={c} onOpen={openEdit} />}
							renderColumnHeader={(ctx) => (
								<BoardColumnHeader
									ctx={ctx}
									canCreate={viewerIsClient && !!ctx.column.data?.canCreateTicket}
									onCreate={openCreateForColumn}
								/>
							)}
							itemDraggable={(c) => (boardKind === "project" ? viewerIsClient : true) && !c.frozen}
							onItemMove={onItemMove}
							onColumnMove={onColumnMove}
							columnsReorderable={boardKind === "project" && grouping === "stages" &&
								viewerIsClient}
							emptyColumn={() => <span class="brd-dropzone">Drop tickets here</span>}
							ariaLabel={boardTitle}
						/>
					)
					: <TicketListView cards={visible} laneOf={(c) => laneLabel(c)} onOpen={openEdit} />}
			</div>

			<TicketModal
				open={editing.value !== null}
				mode={editing.value?.mode ?? "create"}
				card={editing.value?.card ?? null}
				stages={stages.value}
				defaultStageId={editing.value?.stageId ?? null}
				viewerIsClient={viewerIsClient}
				onClose={() => (editing.value = null)}
				onSubmit={onTicketSubmit}
			/>

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
