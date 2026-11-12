import { type Signal, useSignal } from "@preact/signals";
import { type DragMoveEvent, useDnd, useDndMonitor } from "@projective/ui/dnd";
import { cardDropZone, type PipelineDrop, seamAt } from "../core/stage-pipeline.ts";

/** The drag `type` every stage card carries. */
export const STAGE_DRAG = { type: "stage", accepts: ["stage"] } as const;

/** The included list's droppable id. */
export const ZONE_INCLUDED = "zone:included";
/** The available stages' droppable id. */
export const ZONE_AVAILABLE = "zone:available";

/** A stage card's DnD id: `inc:` while in the ticket, `av:` while available. */
export function stageDndId(zone: "included" | "available", stageId: string): string {
	return `${zone === "included" ? "inc" : "av"}:${stageId}`;
}

/** The zone and stage a stage card's DnD id names, or `null` for any other id. */
export function parseStageDndId(
	id: string,
): { zone: "included" | "available"; stageId: string } | null {
	if (id.startsWith("inc:")) return { zone: "included", stageId: id.slice(4) };
	if (id.startsWith("av:")) return { zone: "available", stageId: id.slice(3) };
	return null;
}

/** What the drag in flight would do if dropped now. */
export type PipelineTarget = PipelineDrop | { kind: "refused"; reason: string };

export interface UsePipelineDropOptions {
	/** The included stages' ids, in pipeline order. */
	included: readonly string[];
	/** Why a stage may not leave the ticket, or `null`. */
	removalRefusal: (stageId: string) => string | null;
	/** Why an available stage may not join the ticket, or `null`. */
	inclusionRefusal: () => string | null;
	/** Whether placing `stageId` at `drop` would change the pipeline. */
	changes: (stageId: string, drop: PipelineDrop) => boolean;
	onDrop: (stageId: string, drop: PipelineDrop) => void;
	onRefused: (reason: string) => void;
	onStart?: () => void;
}

/**
 * usePipelineDrop — turns the enclosing DndContext's collisions into a pipeline drop: a seam between
 * cards, a join onto one, or a move into the available zone. A pointer reads the card's edges and
 * middle; the keyboard sensor only steps through seams, since the stage menu already offers joins.
 * Must be called inside the DndContext.
 */
export function usePipelineDrop(opts: UsePipelineDropOptions): Signal<PipelineTarget | null> {
	const { store } = useDnd();
	const target = useSignal<PipelineTarget | null>(null);
	const key = useSignal("");

	const rectOf = (id: string): DOMRect | null => store.droppables.get(id)?.getRect() ?? null;

	const seamFor = (e: DragMoveEvent, overStageId: string | null): PipelineDrop => {
		const ids = opts.included;
		if (overStageId === null) {
			const rects = ids.map((id) => rectOf(stageDndId("included", id)))
				.filter((r): r is DOMRect => r !== null);
			return {
				kind: "seam",
				before: e.active.sensor === "keyboard" ? ids.length : seamAt(e.pointer.y, rects),
			};
		}
		const i = ids.indexOf(overStageId);
		const rect = rectOf(stageDndId("included", overStageId));
		if (!rect) return { kind: "seam", before: i };
		if (e.active.sensor === "keyboard") {
			const above = rect.top + rect.height / 2 < e.active.rect.top + e.active.rect.height / 2;
			return { kind: "seam", before: above ? i : i + 1 };
		}
		const zone = cardDropZone(e.pointer.y, rect, true);
		if (zone === "join") return { kind: "join", stageId: overStageId };
		return { kind: "seam", before: zone === "before" ? i : i + 1 };
	};

	const resolve = (e: DragMoveEvent): PipelineTarget | null => {
		const from = parseStageDndId(String(e.active.id));
		if (!from || e.over === null) return null;
		const over = String(e.over);
		if (over === ZONE_AVAILABLE) {
			if (from.zone === "available") return null;
			const reason = opts.removalRefusal(from.stageId);
			return reason ? { kind: "refused", reason } : { kind: "exclude" };
		}
		const card = parseStageDndId(over);
		if (over !== ZONE_INCLUDED && card?.zone !== "included") return null;
		const refusal = from.zone === "available" ? opts.inclusionRefusal() : null;
		if (refusal) return { kind: "refused", reason: refusal };
		const onto = card && card.stageId !== from.stageId ? card.stageId : null;
		const drop = seamFor(e, onto);
		return opts.changes(from.stageId, drop) ? drop : null;
	};

	const set = (next: PipelineTarget | null) => {
		const k = next === null ? "" : JSON.stringify(next);
		if (k === key.value) return;
		key.value = k;
		target.value = next;
	};

	useDndMonitor({
		onDragStart: () => {
			set(null);
			opts.onStart?.();
		},
		onDragMove: (e) => set(resolve(e)),
		onDragEnd: (e) => {
			const landed = target.value;
			const from = parseStageDndId(String(e.active.id));
			set(null);
			if (e.canceled || !landed || !from) return;
			if (landed.kind === "refused") opts.onRefused(landed.reason);
			else opts.onDrop(from.stageId, landed);
		},
	});

	return target;
}
