import type { JSX } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/showcase-grid.css";
import { cx } from "../../core/cx.ts";
import { Icon } from "../../icons/mod.ts";
import { Tooltip } from "../../feedback/mod.ts";
import DndContext from "../../dnd/islands/DndContext.tsx";
import { useDnd } from "../../dnd/core/context.ts";
import { useSortable } from "../../dnd/hooks/useSortable.ts";
import type { DragEndEvent } from "../../dnd/core/types.ts";
import { useId } from "../../fields/hooks/useId.ts";
import { ProgressiveImage } from "../components/ProgressiveImage.tsx";
import {
	addPositions,
	filledPositions,
	legalMove,
	nextMoveTarget,
	refusalMessage,
	SHOWCASE_GRID_SLOTS,
	type ShowcaseGridSlot,
} from "../core/showcase.ts";

export type { ShowcaseGridSlot } from "../core/showcase.ts";

/** Props for {@link ShowcaseGrid}. */
export interface ShowcaseGridProps {
	/** The filled slots, sparse — a missing position renders empty. */
	slots: readonly ShowcaseGridSlot[];
	/** Slot 1's label (default "1 · Cover"). */
	coverLabel?: string;
	/** What slot 1 is called in sentences (default "cover"), e.g. "thumbnail". */
	coverName?: string;
	/** An empty slot was pressed: every empty position, the pressed one first. */
	onAdd: (positions: number[]) => void;
	onReplace: (position: number) => void;
	onRemove: (position: number) => void;
	/** A legal move of the item at `from` onto `to`. Never called for a refused move. */
	onReorder: (from: number, to: number) => void;
	onEditAlt?: (position: number) => void;
	/** From `--bp-lg` up the cover spans two columns and two rows. */
	hero?: boolean;
	disabled?: boolean;
	class?: string;
}

/** The keyboard move in flight: the lifted slot and where it would land. */
interface KeyboardLift {
	from: number;
	target: number;
}

const DRAG_TYPE = "ui-showgrid-slot";
const idOf = (position: number) => `ui-showgrid-${position}`;
const positionOf = (id: string | null) => (id ? Number(id.slice("ui-showgrid-".length)) : NaN);

/**
 * ShowcaseGrid — six 16:10 media slots with slot-1 cover semantics.
 *
 * Pure presentation: the host owns the media and the picker; the grid reports intent. An empty slot is
 * a dashed button (a control, so it may be outlined — §B.4). A filled one shows its still with Replace,
 * Alt text, Remove and Move on hover or focus, and always on a surface without hover.
 *
 * Reordering moves one filled slot onto another; gaps stay gaps. A pointer drags the tile through
 * `@projective/ui/dnd`. A keyboard lifts with Space on the Move control, steps with the arrows
 * (mirrored under RTL), drops with Space and cancels with Escape, each step announced. A move that
 * would put a video in slot 1 is refused with its reason and `onReorder` is not called.
 */
export function ShowcaseGrid(props: ShowcaseGridProps): JSX.Element {
	const { slots, disabled } = props;
	const coverLabel = props.coverLabel ?? "1 · Cover";
	const coverName = props.coverName ?? "cover";
	const announcement = useMemo(() => signal(""), []);
	const lift = useMemo(() => signal<KeyboardLift | null>(null), []);
	const listRef = useRef<HTMLOListElement>(null);
	const hintId = useId(undefined, "ui-showgrid-hint");

	const byPosition = new Map(slots.map((s) => [s.position as number, s]));
	const filled = filledPositions(slots);

	const say = (text: string) => {
		announcement.value = "";
		queueMicrotask(() => (announcement.value = text));
	};

	const focusMove = (position: number) => {
		setTimeout(() => {
			listRef.current
				?.querySelector<HTMLButtonElement>(`[data-move-position="${position}"]`)
				?.focus();
		}, 0);
	};

	const commit = (from: number, to: number): boolean => {
		if (from === to) {
			say(`Dropped back in slot ${from}.`);
			return false;
		}
		const verdict = legalMove(slots, from, to);
		if (!verdict.ok) {
			say(refusalMessage(verdict.reason));
			return false;
		}
		props.onReorder(from, to);
		say(`Moved to slot ${to}.`);
		return true;
	};

	// #region Keyboard move
	const onMoveKey = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, position: number) => {
		if (disabled) return;
		const current = lift.peek();
		if (!current) {
			if (e.key === " " || e.key === "Spacebar") {
				e.preventDefault();
				lift.value = { from: position, target: position };
				say(`Slot ${position} picked up. Use the arrow keys to move it, Space to drop.`);
			}
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			lift.value = null;
			say("Move cancelled.");
			return;
		}
		if (e.key === " " || e.key === "Spacebar" || e.key === "Enter") {
			e.preventDefault();
			lift.value = null;
			if (commit(current.from, current.target)) focusMove(current.target);
			return;
		}
		if (e.key === "Tab") {
			lift.value = null;
			say("Move cancelled.");
			return;
		}
		const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
		const key = rtl && e.key === "ArrowLeft"
			? "ArrowRight"
			: rtl && e.key === "ArrowRight"
			? "ArrowLeft"
			: e.key;
		const next = nextMoveTarget(filled, current.target, key);
		if (next === null) return;
		e.preventDefault();
		lift.value = { ...current, target: next };
		const verdict = next === current.from
			? { ok: true as const }
			: legalMove(slots, current.from, next);
		say(verdict.ok ? `Over slot ${next}.` : `Over slot ${next}. ${refusalMessage(verdict.reason)}`);
	};

	/** A pointer press on Move: lift here, drop on a second slot's Move, or put it back. */
	const onMoveClick = (e: JSX.TargetedMouseEvent<HTMLButtonElement>, position: number) => {
		if (disabled || e.detail === 0) return;
		const current = lift.peek();
		if (!current) {
			lift.value = { from: position, target: position };
			say(`Slot ${position} picked up. Press Move on another slot to put it there.`);
			return;
		}
		lift.value = null;
		if (current.from === position) {
			say("Move cancelled.");
			return;
		}
		commit(current.from, position);
	};
	// #endregion

	// #region Pointer move
	const onDragEnd = (e: DragEndEvent) => {
		if (e.canceled || disabled) return;
		const from = positionOf(e.active.id);
		const to = positionOf(e.over);
		if (!Number.isFinite(from) || !Number.isFinite(to)) return;
		commit(from, to);
	};
	// #endregion

	const current = lift.value;

	return (
		<DndContext onDragEnd={onDragEnd}>
			<ol
				ref={listRef}
				class={cx("ui-showgrid", props.hero && "ui-showgrid--hero", props.class)}
				role="list"
				aria-disabled={disabled || undefined}
			>
				{Array.from({ length: SHOWCASE_GRID_SLOTS }, (_, i) => {
					const position = i + 1;
					const slot = byPosition.get(position);
					const primary = position === 1;
					const label = primary ? coverLabel : String(position);
					if (!slot) {
						return (
							<li
								key={position}
								class="ui-showgrid__cell"
								data-position={position}
								data-primary={primary ? "true" : undefined}
							>
								<button
									type="button"
									class="ui-showgrid__empty"
									aria-label={`Add to showcase ${position}${primary ? ` (your ${coverName})` : ""}`}
									disabled={disabled}
									onClick={() => props.onAdd(addPositions(slots, position))}
								>
									<Icon name="plus" size="md" />
								</button>
								<span class="ui-showgrid__label">{label}</span>
							</li>
						);
					}
					const keyboardTarget = current && current.target === position && current.from !== position
						? (legalMove(slots, current.from, position).ok ? "true" : "refused")
						: undefined;
					return (
						<FilledCell
							key={position}
							slot={slot}
							slots={slots}
							label={label}
							primary={primary}
							lifted={current?.from === position}
							keyboardTarget={keyboardTarget}
							hintId={hintId}
							disabled={disabled}
							onReplace={props.onReplace}
							onRemove={props.onRemove}
							onEditAlt={props.onEditAlt}
							onMoveKey={onMoveKey}
							onMoveClick={onMoveClick}
							onMoveBlur={() => {
								if (lift.peek()) {
									lift.value = null;
									say("Move cancelled.");
								}
							}}
						/>
					);
				})}
			</ol>
			<span id={hintId} class="ui-visually-hidden">
				Press Space to pick up, the arrow keys to move, Space to drop and Escape to cancel.
			</span>
			<span class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
				{announcement.value}
			</span>
		</DndContext>
	);
}

// #region Filled cell
interface FilledCellProps {
	slot: ShowcaseGridSlot;
	slots: readonly ShowcaseGridSlot[];
	label: string;
	primary: boolean;
	lifted: boolean;
	keyboardTarget: "true" | "refused" | undefined;
	hintId: string;
	disabled?: boolean;
	onReplace: (position: number) => void;
	onRemove: (position: number) => void;
	onEditAlt?: (position: number) => void;
	onMoveKey: (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, position: number) => void;
	onMoveClick: (e: JSX.TargetedMouseEvent<HTMLButtonElement>, position: number) => void;
	onMoveBlur: () => void;
}

function FilledCell(props: FilledCellProps): JSX.Element {
	const { slot, slots, disabled } = props;
	const position = slot.position;
	const dnd = useDnd();
	const sortable = useSortable({
		id: idOf(position),
		data: { type: DRAG_TYPE, accepts: [DRAG_TYPE] },
		disabled,
		roleDescription: "showcase slot",
	});
	const pointerFrom = positionOf(dnd.store.active.value?.id ?? null);
	const pointerTarget =
		sortable.isOver.value && Number.isFinite(pointerFrom) && pointerFrom !== position
			? (legalMove(slots, pointerFrom, position).ok ? "true" : "refused")
			: undefined;
	const dropTarget = props.keyboardTarget ?? pointerTarget;
	const dragging = props.lifted || sortable.isDragging.value;

	return (
		<li
			class="ui-showgrid__cell"
			data-position={position}
			data-primary={props.primary ? "true" : undefined}
			data-dragging={dragging ? "true" : undefined}
			data-drop-target={dropTarget}
		>
			<div
				ref={sortable.setNodeRef}
				class="ui-showgrid__filled"
				onPointerDown={disabled ? undefined : sortable.listeners.onPointerDown}
			>
				<ProgressiveImage
					src={slot.thumb}
					alt={slot.alt || `Showcase ${position}`}
					placeholder={slot.placeholder ?? null}
					loading="lazy"
				/>
				{slot.kind === "video" && (
					<span class="ui-showgrid__mark" aria-hidden="true">
						<Icon name="play" size="xs" filled />
					</span>
				)}
				{slot.pending && (
					<span class="ui-showgrid__status" aria-live="polite">Preparing 16:10 rendition…</span>
				)}
				{!disabled && (
					<span class="ui-showgrid__overlay">
						<Tooltip content="Replace" placement="top">
							<button
								type="button"
								class="ui-showgrid__action"
								aria-label={`Replace showcase ${position}`}
								onClick={() => props.onReplace(position)}
							>
								<Icon name="refresh" size="sm" />
							</button>
						</Tooltip>
						{props.onEditAlt && (
							<Tooltip content="Alt text" placement="top">
								<button
									type="button"
									class="ui-showgrid__action"
									aria-label={`Edit the alt text of showcase ${position}`}
									onClick={() => props.onEditAlt?.(position)}
								>
									<Icon name="edit" size="sm" />
								</button>
							</Tooltip>
						)}
						<Tooltip content="Remove" placement="top">
							<button
								type="button"
								class="ui-showgrid__action"
								aria-label={`Remove showcase ${position}`}
								onClick={() => props.onRemove(position)}
							>
								<Icon name="trash" size="sm" />
							</button>
						</Tooltip>
						{slots.length > 1 && (
							<Tooltip content="Move" placement="top">
								<button
									type="button"
									class="ui-showgrid__action"
									data-move-position={position}
									aria-label={`Move showcase ${position}`}
									aria-describedby={props.hintId}
									aria-pressed={props.lifted}
									onKeyDown={(e) => props.onMoveKey(e, position)}
									onClick={(e) => props.onMoveClick(e, position)}
									onBlur={props.onMoveBlur}
								>
									<Icon name="grip" size="sm" />
								</button>
							</Tooltip>
						)}
					</span>
				)}
			</div>
			<span class="ui-showgrid__label">{props.label}</span>
		</li>
	);
}
// #endregion
