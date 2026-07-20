import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import type { KanbanColumnRenderCtx } from "@projective/ui/kanban";
import type { BoardColumn } from "../types/projects-types.ts";
import { StatusGlyph } from "./glyphs.tsx";
import { LockIcon, PlusIcon } from "./board-glyphs.tsx";

/**
 * BoardColumnHeader — the Kanban column header (rendered via `KanbanBoard.renderColumnHeader`). Icon-first
 * (§B.6): a stage column shows its lifecycle {@link StatusGlyph} and, when its order is locked (started/
 * claimed), an icon-only lock with a Tooltip; a client-only ＋ opens the ticket modal pre-seeded to this
 * column (forbidden on Completed / gated by `canCreateTicket` + `viewerIsClient`). The header doubles as
 * the column-reorder drag handle, so the ＋ stops pointer propagation to never start a column drag.
 */
export interface BoardColumnHeaderProps {
	ctx: KanbanColumnRenderCtx<BoardColumn>;
	/** Whether the acting client may create a ticket in this column. */
	canCreate: boolean;
	onCreate: (column: BoardColumn) => void;
}

export function BoardColumnHeader(
	{ ctx, canCreate, onCreate }: BoardColumnHeaderProps,
): JSX.Element {
	const col = ctx.column.data;
	const isStage = col?.kind === "stage";

	return (
		<div class="brd-colhead" data-kind={col?.kind}>
			{isStage && col?.stageStatus
				? (
					<span class="brd-colhead__glyph" data-status={col.stageStatus} aria-hidden="true">
						<StatusGlyph status={col.stageStatus} />
					</span>
				)
				: (
					<span
						class="brd-colhead__dot"
						data-status={col?.status ?? "neutral"}
						aria-hidden="true"
					/>
				)}

			<span class="brd-colhead__title">{ctx.column.title}</span>

			{col?.locked
				? (
					<Tooltip content="This stage has started or been claimed — its order is locked">
						<span class="brd-colhead__lock" role="img" aria-label="Stage order locked" tabIndex={0}>
							<LockIcon size={13} />
						</span>
					</Tooltip>
				)
				: null}

			<span class="brd-colhead__count" aria-label={`${ctx.count} tickets`}>{ctx.count}</span>

			{canCreate && col
				? (
					<Tooltip content={`Create a ticket in ${ctx.column.title}`}>
						<button
							type="button"
							class="brd-colhead__add"
							aria-label={`Create a ticket in ${ctx.column.title}`}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => onCreate(col)}
						>
							<PlusIcon size={15} />
						</button>
					</Tooltip>
				)
				: null}
		</div>
	);
}
