/**
 * @projective/ui/gantt — the built-in popover: the metadata panel an item opens, and the composer a
 * drag-to-create leaves beside its draft.
 *
 * DESKTOP: anchored to a painted rectangle through the two-proxy pattern the calendar's popover layer
 * settled. Position is asked of a zero-size proxy PORTALLED beside the panel (so no transformed or
 * filtered ancestor can re-base it); ownership is asked of an INLINE tether (so `overlay-registry`
 * reads a click inside this panel as inside the timeline — which matters when the timeline itself is
 * mounted inside a dialog, as the ticket modal's Timeline tab is). The panel is `BodyPortal`'d for
 * the same reason every anchored surface in this package is.
 *
 * BELOW `--bp-md`: the same content in a bottom sheet (`Drawer position="bottom"`) — a hover popover
 * is the wrong shape for a thumb, and a sheet is the sanctioned floating mobile surface.
 */
import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import { usePresence } from "../../overlay/core/usePresence.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { useId } from "../../hooks/useId.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { Drawer } from "../../feedback/islands/Drawer.tsx";
import { Icon } from "../../icons/mod.ts";
import { fmtDayLabel, fmtFullDate, fmtTime } from "../../calendar/core/time.ts";
import { durationLabel } from "../core/time-scale.ts";
import type {
	GanttAnchor,
	GanttItem,
	GanttItemActionContext,
	GanttLane,
	GanttPopoverState,
	GanttRange,
} from "../core/types.ts";

// #region Contract
export interface GanttPopoverProps {
	state: Signal<GanttPopoverState | null>;
	tz: string;
	hour12: boolean;
	/** Render as a bottom sheet instead of an anchored panel. */
	sheet: boolean;
	renderItemActions?: (ctx: GanttItemActionContext) => JSX.Element | null;
	/** Open the host's full surface for the item. Absent → the title is plain text. */
	onOpenItem?: (item: GanttItem, anchor: GanttAnchor) => void;
	/** Commit a quick-create. Absent → the composer offers no title field. */
	onQuickCreate?: (laneId: string, range: GanttRange, title: string) => void;
	/** Hand the range — and whatever title was already typed — to the host's full creation surface. */
	onExpandCreate?: (laneId: string, range: GanttRange, anchor: GanttAnchor, title: string) => void;
	/** Called when the popover closes for any reason — the host clears its draft here. */
	onClose?: () => void;
	/** Selectors the panel must never intersect. */
	avoid?: readonly string[];
}
// #endregion

const EXIT_MS = 150;
const ANCHOR_OFFSET = 8;
const VIEWPORT_PAD = 12;

// #region Content
function rangeLine(range: GanttRange, tz: string, hour12: boolean, milestone: boolean): string {
	if (milestone) return `${fmtFullDate(range.start, tz)} · ${fmtTime(range.start, tz, hour12)}`;
	const sameDay = fmtDayLabel(range.start, tz) === fmtDayLabel(range.end, tz);
	if (sameDay) {
		return `${fmtFullDate(range.start, tz)} · ${fmtTime(range.start, tz, hour12)} – ${
			fmtTime(range.end, tz, hour12)
		}`;
	}
	return `${fmtDayLabel(range.start, tz)} → ${fmtDayLabel(range.end, tz)}`;
}

function ItemPane(
	{ item, lane, tz, hour12, actions, onOpen }: {
		item: GanttItem;
		lane: GanttLane | null;
		tz: string;
		hour12: boolean;
		actions: JSX.Element | null;
		onOpen?: () => void;
	},
): JSX.Element {
	const milestone = item.kind === "milestone" || item.end <= item.start;
	const heading = (
		<>
			<span
				class={cx("gantt-pop__mark", milestone && "gantt-pop__mark--milestone")}
				aria-hidden="true"
				style={styleVars({ "--gantt-pop-accent": `var(${item.accent ?? "--primary"})` })}
			/>
			<span class="gantt-pop__titletext">{item.label}</span>
		</>
	);
	return (
		<div class="gantt-pop__item">
			{onOpen
				? (
					<button type="button" class="gantt-pop__title gantt-pop__title--open" onClick={onOpen}>
						{heading}
					</button>
				)
				: <p class="gantt-pop__title">{heading}</p>}
			<dl class="gantt-pop__facts">
				{lane
					? (
						<div class="gantt-pop__fact">
							<dt>Lane</dt>
							<dd>{lane.label}</dd>
						</div>
					)
					: null}
				<div class="gantt-pop__fact">
					<dt>{milestone ? "When" : "Span"}</dt>
					<dd>{rangeLine(item, tz, hour12, milestone)}</dd>
				</div>
				{!milestone
					? (
						<div class="gantt-pop__fact">
							<dt>Duration</dt>
							<dd>{durationLabel(item.start, item.end)}</dd>
						</div>
					)
					: null}
				{item.status
					? (
						<div class="gantt-pop__fact">
							<dt>Status</dt>
							<dd>{item.status}</dd>
						</div>
					)
					: null}
				{typeof item.progress === "number"
					? (
						<div class="gantt-pop__fact">
							<dt>Progress</dt>
							<dd>
								<span class="gantt-pop__progress" aria-hidden="true">
									<span
										class="gantt-pop__progressfill"
										style={styleVars({
											"--gantt-pop-progress": `${
												Math.round(Math.max(0, Math.min(1, item.progress)) * 100)
											}%`,
											"--gantt-pop-accent": `var(${item.accent ?? "--primary"})`,
										})}
									/>
								</span>
								{Math.round(Math.max(0, Math.min(1, item.progress)) * 100)}%
							</dd>
						</div>
					)
					: null}
				{item.meta
					? (
						<div class="gantt-pop__fact gantt-pop__fact--quiet">
							<dt class="gantt-pop__srdt">Note</dt>
							<dd>{item.meta}</dd>
						</div>
					)
					: null}
			</dl>
			{actions ? <div class="gantt-pop__actions">{actions}</div> : null}
		</div>
	);
}

function CreatePane(
	{ laneLabel, range, tz, hour12, onQuickCreate, onExpand, panelId, inputRef }: {
		laneLabel: string | null;
		range: GanttRange;
		tz: string;
		hour12: boolean;
		onQuickCreate?: (title: string) => void;
		/** Expand to the host's full surface, carrying the title so far — nothing typed is lost. */
		onExpand?: (title: string) => void;
		panelId: string;
		inputRef: { current: HTMLInputElement | null };
	},
): JSX.Element {
	const [title, setTitle] = useState("");
	const canSubmit = title.trim().length > 0 && !!onQuickCreate;
	return (
		<form
			class="gantt-pop__form"
			onSubmit={(e) => {
				e.preventDefault();
				if (!canSubmit) return;
				onQuickCreate?.(title.trim());
			}}
		>
			<p class="gantt-pop__range">
				<Icon name="calendar" size="xs" class="gantt-pop__facticon" />
				<span>
					{laneLabel ? <span class="gantt-pop__rangelane">{laneLabel} ·</span> : null}
					{rangeLine(range, tz, hour12, range.end <= range.start)}
					<span class="gantt-pop__rangedur">{durationLabel(range.start, range.end)}</span>
				</span>
			</p>
			{onQuickCreate
				? (
					<>
						<label class="gantt-pop__label" for={`${panelId}-title`}>Title</label>
						<input
							id={`${panelId}-title`}
							ref={inputRef}
							class="gantt-pop__input"
							type="text"
							value={title}
							placeholder="Name it"
							autocomplete="off"
							onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
						/>
						<button type="submit" class="gantt-pop__submit" disabled={!canSubmit}>
							<Icon name="plus" size="xs" />
							<span>Create</span>
						</button>
					</>
				)
				: null}
			{onExpand
				? (
					/* `type="button"` inside a form is load-bearing: the default is `submit`. */
					<button type="button" class="gantt-pop__expand" onClick={() => onExpand(title.trim())}>
						<Icon name="external-link" size="xs" />
						<span>Open full details</span>
					</button>
				)
				: null}
		</form>
	);
}
// #endregion

export function GanttPopover(props: GanttPopoverProps): JSX.Element | null {
	const { state, tz, hour12, sheet } = props;
	const live = state.value;
	const isOpen = live !== null;
	// The last non-null state, kept so the exit transition has something to draw.
	const lastRef = useRef<GanttPopoverState | null>(null);
	if (live) lastRef.current = live;
	const shown = live ?? lastRef.current;

	const { mounted, state: presence } = usePresence(isOpen, EXIT_MS);
	const panelRef = useRef<HTMLDivElement>(null);
	const anchorRef = useRef<HTMLDivElement>(null);
	const tetherRef = useRef<HTMLSpanElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const panelId = useId(undefined, "gantt-pop");

	const stack = useOverlayStack({ active: mounted && !sheet, layer: "popover" });
	const floating = useFloating({
		open: mounted && !sheet,
		triggerRef: anchorRef,
		panelRef,
		placement: "bottom-start",
		offset: ANCHOR_OFFSET,
		collisionPadding: VIEWPORT_PAD,
		avoid: props.avoid,
	});

	const onCloseRef = useRef(props.onClose);
	onCloseRef.current = props.onClose;
	const close = useCallback(() => {
		if (state.peek() === null) return;
		state.value = null;
		onCloseRef.current?.();
	}, [state]);

	useFocusTrap({
		active: mounted && !sheet,
		containerRef: panelRef,
		initialFocusRef: inputRef,
		inertBackground: false,
	});
	useDismiss({
		open: mounted && !sheet,
		enabled: stack.isTop,
		onDismiss: close,
		panelRef,
		triggerRef: tetherRef,
	});

	// #region Anchor tracking
	const placedRef = useRef<GanttAnchor | null>(null);
	const place = useCallback((a: GanttAnchor) => {
		const el = anchorRef.current;
		if (!el) return;
		const prev = placedRef.current;
		if (prev && prev.x === a.x && prev.y === a.y && prev.w === a.w && prev.h === a.h) return;
		placedRef.current = { ...a };
		el.style.setProperty("--gantt-pop-anchor-x", `${a.x}px`);
		el.style.setProperty("--gantt-pop-anchor-y", `${a.y}px`);
		el.style.setProperty("--gantt-pop-anchor-w", `${a.w}px`);
		el.style.setProperty("--gantt-pop-anchor-h", `${a.h}px`);
		// The reposition is requested through the hook's own live listener.
		if (typeof globalThis.dispatchEvent === "function") {
			globalThis.dispatchEvent(new Event("resize"));
		}
	}, []);
	const anchor = shown?.anchor;
	useLayoutEffect(() => {
		if (!mounted || !anchor || sheet) return;
		place(anchor);
	}, [mounted, anchor, anchor?.x, anchor?.y, anchor?.w, anchor?.h, place, sheet]);
	useLayoutEffect(() => {
		if (!mounted) placedRef.current = null;
	}, [mounted]);
	// #endregion

	if (!shown) return null;

	const label = shown.kind === "create"
		? "New item"
		: shown.item.status
		? `${shown.item.label}, ${shown.item.status}`
		: shown.item.label;

	const actions = shown.kind === "item" && props.renderItemActions
		? props.renderItemActions({ item: shown.item, lane: shown.lane, close })
		: null;

	const body = shown.kind === "item"
		? (
			<ItemPane
				item={shown.item}
				lane={shown.lane}
				tz={tz}
				hour12={hour12}
				actions={actions}
				onOpen={props.onOpenItem
					? () => {
						props.onOpenItem?.(shown.item, shown.anchor);
						close();
					}
					: undefined}
			/>
		)
		: (
			<CreatePane
				key={`${shown.laneId}:${shown.range.start}`}
				laneLabel={shown.lane?.label ?? null}
				range={shown.range}
				tz={tz}
				hour12={hour12}
				panelId={panelId}
				inputRef={inputRef}
				onQuickCreate={props.onQuickCreate
					? (title) => {
						props.onQuickCreate?.(shown.laneId, shown.range, title);
						close();
					}
					: undefined}
				onExpand={props.onExpandCreate
					? (title) => {
						props.onExpandCreate?.(shown.laneId, shown.range, shown.anchor, title);
						close();
					}
					: undefined}
			/>
		);

	if (sheet) {
		return (
			<Drawer
				visible={isOpen}
				position="bottom"
				header={label}
				class="gantt-sheet"
				onVisibleChange={(v) => {
					if (!v) close();
				}}
			>
				<div class="gantt-pop__sheetbody">{body}</div>
			</Drawer>
		);
	}

	if (!mounted) return null;
	return (
		<>
			<span class="gantt-pop__tether" ref={tetherRef} aria-hidden="true" />
			<BodyPortal>
				<div class="gantt-pop__anchor" ref={anchorRef} aria-hidden="true" />
				<div
					ref={panelRef}
					id={panelId}
					role="dialog"
					aria-label={label}
					data-state={presence}
					data-placement={floating?.placement ?? "bottom-start"}
					class="gantt-pop"
					style={styleVars({
						"--float-top": floating ? `${floating.top}px` : undefined,
						"--float-left": floating ? `${floating.left}px` : undefined,
						"--float-available-h": floating?.availableHeight != null
							? `${floating.availableHeight}px`
							: undefined,
						"--z-portal": String(stack.zIndex),
					})}
					tabIndex={-1}
				>
					<div class="gantt-pop__panel">
						<button type="button" class="gantt-pop__close" aria-label="Close" onClick={close}>
							<Icon name="close" size="xs" />
						</button>
						{body}
					</div>
				</div>
			</BodyPortal>
		</>
	);
}
