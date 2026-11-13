import { type Signal, useSignal } from "@preact/signals";
import { type DragMoveEvent, useDnd, useDndMonitor } from "@projective/ui/dnd";
import { bandDropAt, type BandRow, type PipelineDrop } from "../core/stage-pipeline.ts";

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

/** Where the pane sits now: its inline extent and the divider above the Available zone. */
export interface PipelineFrame {
	left: number;
	right: number;
	/** The divider's block position, or `null` while the Available zone is withdrawn. */
	divider: number | null;
}

export interface UsePipelineDropOptions {
	/** The included stages' ids, in pipeline order. */
	included: readonly string[];
	/** The included stages' ids grouped by step, in pipeline order. */
	bands: readonly (readonly string[])[];
	/** The pane's frame, or `null` while it is not laid out. */
	frame: () => PipelineFrame | null;
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
 * usePipelineDrop — turns a drag over the stage pane into a pipeline drop: a seam between steps, a
 * join onto a step, or a move into the available zone.
 *
 * A pointer is read against the pane, not against drop targets: anywhere below the divider takes the
 * stage out, and anywhere above it lands on the step rows by their edges and middles, so a card never
 * has to be aimed at a small zone. The keyboard sensor steps through the targets' seams, since the
 * stage menu already offers joins. Must be called inside the DndContext.
 */
export function usePipelineDrop(opts: UsePipelineDropOptions): Signal<PipelineTarget | null> {
	const { store } = useDnd();
	const target = useSignal<PipelineTarget | null>(null);
	const key = useSignal("");

	const rectOf = (id: string): DOMRect | null => store.droppables.get(id)?.getRect() ?? null;

	const keyboardSeam = (e: DragMoveEvent, overStageId: string | null): PipelineDrop => {
		const ids = opts.included;
		if (overStageId === null) return { kind: "seam", before: ids.length };
		const i = ids.indexOf(overStageId);
		const rect = rectOf(stageDndId("included", overStageId));
		if (!rect) return { kind: "seam", before: i };
		const above = rect.top + rect.height / 2 < e.active.rect.top + e.active.rect.height / 2;
		return { kind: "seam", before: above ? i : i + 1 };
	};

	const rows = (): BandRow[] => {
		const out: BandRow[] = [];
		let first = 0;
		for (const band of opts.bands) {
			const rects = band.map((id) => rectOf(stageDndId("included", id)))
				.filter((r): r is DOMRect => r !== null);
			if (rects.length > 0) {
				const top = Math.min(...rects.map((r) => r.top));
				const bottom = Math.max(...rects.map((r) => r.bottom));
				out.push({
					first,
					last: first + band.length - 1,
					opener: band[0],
					top,
					height: bottom - top,
				});
			}
			first += band.length;
		}
		return out;
	};

	const byPointer = (
		e: DragMoveEvent,
		from: { zone: "included" | "available"; stageId: string },
	): PipelineTarget | null => {
		const frame = opts.frame();
		if (!frame || e.pointer.x < frame.left || e.pointer.x > frame.right) return null;
		if (frame.divider !== null && e.pointer.y >= frame.divider) {
			if (from.zone === "available") return null;
			const reason = opts.removalRefusal(from.stageId);
			return reason ? { kind: "refused", reason } : { kind: "exclude" };
		}
		const refusal = from.zone === "available" ? opts.inclusionRefusal() : null;
		if (refusal) return { kind: "refused", reason: refusal };
		const drop = bandDropAt(e.pointer.y, rows());
		return opts.changes(from.stageId, drop) ? drop : null;
	};

	const resolve = (e: DragMoveEvent): PipelineTarget | null => {
		const from = parseStageDndId(String(e.active.id));
		if (!from) return null;
		if (e.active.sensor !== "keyboard") return byPointer(e, from);
		if (e.over === null) return null;
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
		const drop = keyboardSeam(e, onto);
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
