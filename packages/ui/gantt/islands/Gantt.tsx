/**
 * @projective/ui/gantt — the composed Timeline / Gantt island (DESIGN_SYSTEM.md §C.1): the HTML
 * task list beside the HTML tiered header over an IMMEDIATE-MODE CANVAS stage, with a parallel
 * accessible layer and a built-in popover.
 *
 * WHAT IS INSIDE `.gantt__viewport`: one `<canvas>`, and nothing else. Row washes, weekend bands,
 * the lattice, every bar and milestone, dependency links, the draft block, the today rule and the
 * fly-mode origin are all pixels from ONE ordered pass (`paintGantt`) over ONE `GanttScene`. There
 * is no scroll container: both offsets are signals the store owns (`useGanttViewport` feeds it), and
 * every gesture is resolved by mapping a pointer into content space and asking `hitTestItems` what
 * is there.
 *
 * WHAT IS BESIDE IT: the accessible layer — a real, focusable, screen-reader-visible list of the
 * same items, a live region naming the visible range, and the two grid-wide controls — because a
 * canvas is opaque to assistive technology and to the keyboard. Its controls are visually hidden;
 * the canvas paints a two-tone focus ring for whichever of them has focus.
 *
 * THE GESTURE MAP (§Part B):
 *   - wheel — time · Shift+wheel — lanes · Ctrl+wheel — zoom the time scale, anchored on the cursor
 *     · Ctrl+Shift+wheel — zoom the lanes (row density)
 *   - Ctrl+drag, or middle-drag — 2D pan · middle CLICK — fly mode · Ctrl+middle — strict drag
 *   - Left / Right — scroll time (Shift: a page) · Ctrl+Up/Down — scroll lanes · Up / Down —
 *     previous/next item · Enter — open/close the focused item's popover · Escape — close / stop
 *   - left-drag on empty lane — create (unless read-only) · click an item — its popover
 *   - one finger — 2D pan · two fingers — pinch-zoom the time scale and pan · tap — open
 *
 * NO FRAME IS EVER REQUIRED: the store's writes are synchronous, the paint runs in a layout effect,
 * and every rAF loop is decoration over geometry that is already correct.
 */
import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import "../styles/gantt.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { createSpring, SPRING_SNAPPY } from "../../core/motion.ts";
import { useIsMobile } from "../../hooks/useMediaQuery.ts";
import { Icon } from "../../icons/mod.ts";
import { DAY, fmtDayLabel, fmtTime, localTimezone, startOfDay } from "../../calendar/core/time.ts";
import type { GanttScene, PaintReport, SceneItem, ScenePreview } from "../core/gantt-paint.ts";
import { createGanttStore } from "../core/gantt-store.ts";
import {
	hitTestItems,
	type ItemBox,
	itemBox,
	laneAtY,
	laneHeight,
	laneTop,
	laneWindow,
} from "../core/layout.ts";
import {
	clampZoom,
	PX_PER_DAY_DEFAULT,
	snapTo,
	ticksFor,
	UNIT_RANK,
	weekendSpans,
} from "../core/time-scale.ts";
import type { GanttPalette } from "../core/theme-bridge.ts";
import type {
	GanttAnchor,
	GanttDraft,
	GanttItem,
	GanttLane,
	GanttPopoverState,
	GanttProps,
	GanttRange,
} from "../core/types.ts";
import { useGanttCanvas } from "../hooks/useGanttCanvas.ts";
import { useGanttViewport } from "../hooks/useGanttViewport.ts";
import { GanttHeader } from "../components/GanttHeader.tsx";
import { GanttPopover } from "../components/GanttPopover.tsx";
import { GanttProbe } from "../components/GanttProbe.tsx";
import { GanttTaskList } from "../components/GanttTaskList.tsx";

// #region Constants
/** Pointer travel (px) that turns a press into a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Lanes laid out beyond each viewport edge. */
const LANE_OVERSCAN = 2;
/** How far (px) past each inline edge items are still laid out — a trailing label may reach in. */
const ITEM_OVERSCAN_PX = 320;
/** The default accent for an item that names none. */
const DEFAULT_ACCENT = "--primary";
/** Zones the built-in popover must never overlap when no host list is given. */
const DEFAULT_AVOID = [".ui-app-shell__sidebar", ".ui-middle-nav__lane"] as const;
// #endregion

// #region Gestures
type Gesture =
	| {
		kind: "create";
		laneIndex: number;
		laneId: string;
		fromMs: number;
		toMs: number;
		originX: number;
		moved: boolean;
	}
	| {
		kind: "move";
		item: GanttItem;
		laneIndex: number;
		grabOffsetMs: number;
		startMs: number;
		durationMs: number;
		originX: number;
		originY: number;
		moved: boolean;
		box: ItemBox;
	}
	| {
		kind: "press";
		item: GanttItem;
		box: ItemBox;
		originX: number;
		originY: number;
		moved: boolean;
	};
// #endregion

/** The span every item covers, or `null` with nothing to span. */
function extentOf(items: readonly GanttItem[]): GanttRange | null {
	let start = Infinity;
	let end = -Infinity;
	for (const it of items) {
		start = Math.min(start, it.start);
		end = Math.max(end, it.end);
	}
	return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

export default function Gantt(props: GanttProps): JSX.Element {
	const tz = props.timezone ?? localTimezone();
	const hour12 = props.hour12 ?? true;
	const lanes = props.lanes;
	const items = props.items;
	// "Now" is read once: a fixture-driven host passes its own, and a live one must not re-derive a
	// different instant on every render.
	const nowMs = useRef(props.now ?? Date.now()).current;
	const originMs = useRef(startOfDay(props.focus ?? nowMs, tz)).current;

	const store = useMemo(
		() =>
			createGanttStore({
				originMs,
				timezone: tz,
				pxPerDay: props.zoom ?? PX_PER_DAY_DEFAULT,
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);
	const viewport = useGanttViewport({
		store,
		onZoomSettle: (ppd) => {
			props.onZoomChange?.(ppd);
			if (!props.zoom && props.storageKey && typeof localStorage !== "undefined") {
				try {
					localStorage.setItem(`${props.storageKey}:zoom`, String(ppd));
				} catch { /* storage unavailable */ }
			}
		},
	});
	const mobile = useIsMobile();

	const gesture = useSignal<Gesture | null>(null);
	const internalDraft = useSignal<GanttDraft | null>(null);
	const draft: Signal<GanttDraft | null> = props.draft ?? internalDraft;
	const popover = useSignal<GanttPopoverState | null>(null);
	const builtinPopover = (props.popover ?? "builtin") === "builtin";
	const canCreate = !!props.canCreate && !props.readOnly &&
		(!!props.onCreateRange || (builtinPopover && !!props.onQuickCreate));

	// #region Indexes
	const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l.id, i])), [lanes]);
	const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
	const itemsByLane = useMemo(() => {
		const map = new Map<string, GanttItem[]>();
		for (const it of items) {
			const list = map.get(it.laneId);
			if (list) list.push(it);
			else map.set(it.laneId, [it]);
		}
		for (const list of map.values()) list.sort((a, b) => a.start - b.start);
		return map;
	}, [items]);
	const countByLane = useMemo(() => {
		const map = new Map<string, number>();
		for (const [id, list] of itemsByLane) map.set(id, list.length);
		return map;
	}, [itemsByLane]);
	/** Items in reading order — lane by lane, earliest first. The accessible layer's order. */
	const ordered = useMemo(() => {
		const out: GanttItem[] = [];
		for (const lane of lanes) out.push(...(itemsByLane.get(lane.id) ?? []));
		return out;
	}, [lanes, itemsByLane]);
	const accentKey = useMemo(
		() =>
			Array.from(
				new Set([
					...items.map((i) => i.accent ?? DEFAULT_ACCENT),
					...lanes.map((l) => l.accent ?? ""),
				]),
			)
				.filter(Boolean)
				.sort()
				.join(","),
		[items, lanes],
	);
	const accents = useMemo(() => (accentKey ? accentKey.split(",") : []), [accentKey]);
	// #endregion

	// #region Store sync
	useLayoutEffect(() => {
		store.laneCount.value = lanes.length;
	}, [store, lanes.length]);

	// Restore a persisted zoom once, only while the engine owns it.
	useEffect(() => {
		if (props.zoom || !props.storageKey || typeof localStorage === "undefined") return;
		try {
			const raw = localStorage.getItem(`${props.storageKey}:zoom`);
			if (raw) store.setZoom(clampZoom(Number(raw), store.zoomRange));
		} catch { /* storage unavailable */ }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Centre on the focus instant once the viewport is measured, and again whenever the host moves it.
	const lastFocus = useRef<number | null>(null);
	const centred = useRef(false);
	useLayoutEffect(() => {
		if (centred.current || store.viewportW.value <= 0) return;
		centred.current = true;
		store.centerOn(props.focus ?? nowMs);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [store.viewportW.value]);
	useEffect(() => {
		if (props.focus === undefined || props.focus === lastFocus.current) return;
		lastFocus.current = props.focus;
		if (centred.current) store.centerOn(props.focus);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.focus]);

	// Host commands: act, then clear, so the same instruction can be issued again.
	useSignalEffect(() => {
		const cmd = props.commands?.value;
		if (!cmd || !props.commands) return;
		props.commands.value = null;
		if (cmd.kind === "today") {
			viewport.glideToX(store.xOf(nowMs) - store.viewportW.peek() / 2);
		} else if (cmd.kind === "center") {
			viewport.glideToX(store.xOf(cmd.ms) - store.viewportW.peek() / 2);
		} else {
			const range = cmd.range ?? extentOf(props.items);
			if (range) {
				viewport.cancelMotion();
				store.fitRange(range);
				props.onZoomChange?.(store.pxPerDay.peek());
			}
		}
	});

	// Report the time tier as the zoom moves it — the host's zoom control names the unit.
	const lastTier = useRef<string>("");
	useSignalEffect(() => {
		const tier = store.tier.value;
		const key = `${tier.top}/${tier.bottom}`;
		if (key === lastTier.current) return;
		lastTier.current = key;
		props.onTierChange?.({ top: tier.top, bottom: tier.bottom });
	});

	// Report the centre DAY as it changes — the host's period trail reads it.
	useSignalEffect(() => {
		const x = store.scrollX.value;
		const w = store.viewportW.value;
		if (w <= 0 || !centred.current) return;
		const centreMs = store.msAtViewX(w / 2);
		const day = startOfDay(centreMs, tz);
		if (day === lastFocus.current) return;
		lastFocus.current = day;
		void x;
		props.onFocusChange?.(day);
	});
	// #endregion

	// #region Windows (the cheap-to-recompute keys the DOM parts re-render on)
	const laneWin = useComputed(() =>
		laneWindow(
			store.scrollY.value,
			store.viewportH.value,
			{ rowH: store.rowH.value, laneCount: store.laneCount.value, hoverLane: null, expandPx: 0 },
			LANE_OVERSCAN,
		)
	);
	/**
	 * The visible time range, QUANTISED — so the tick sets, the weekend spans and the accessible list
	 * change only when the viewport crosses a quantum, never per pixel. The quantum grows with the zoom
	 * so it always spans at least 64px of axis.
	 */
	const timeWin = useComputed(() => {
		const r = store.visibleRange.value;
		const ppd = store.pxPerDay.value;
		const quantum = DAY * Math.max(1, Math.pow(2, Math.ceil(Math.log2(Math.max(1e-6, 64 / ppd)))));
		const margin = Math.max(quantum, (r.end - r.start) * 0.5);
		return {
			start: Math.floor((r.start - margin) / quantum) * quantum,
			end: Math.ceil((r.end + margin) / quantum) * quantum,
		};
	});
	const ticksTop = useComputed(() => {
		const t = store.tier.value;
		const w = timeWin.value;
		return ticksFor(t.top, w.start, w.end, tz, { hourStep: t.hourStep, hour12 });
	});
	const ticksBottom = useComputed(() => {
		const t = store.tier.value;
		const w = timeWin.value;
		return ticksFor(t.bottom, w.start, w.end, tz, { hourStep: t.hourStep, hour12 });
	});
	const weekends = useComputed(() => {
		const t = store.tier.value;
		if (UNIT_RANK[t.bottom] > UNIT_RANK.week) return [];
		const w = timeWin.value;
		return weekendSpans(w.start, w.end, tz);
	});
	// #endregion

	// #region Canvas + scene
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const probeRef = useRef<HTMLDivElement>(null);
	const paletteRef = useRef<GanttPalette | null>(null);
	const reportRef = useRef<PaintReport | null>(null);
	/** The boxes laid out for the last frame — what the hit test reads. */
	const boxesRef = useRef<ItemBox[]>([]);
	const canvasApi = useRef<ReturnType<typeof useGanttCanvas> | null>(null);

	const expandSpring = useMemo(() => createSpring(0, { config: SPRING_SNAPPY }), []);
	useEffect(() => {
		const off = expandSpring.value.subscribe((v) => {
			store.expandPx.value = v;
		});
		const offSettled = expandSpring.settled.subscribe((settled) => {
			if (settled && expandSpring.value.peek() <= 0.5 && store.hoverId.peek() === null) {
				store.hoverLane.value = null;
			}
		});
		return () => {
			off();
			offSettled();
			expandSpring.dispose();
		};
	}, [expandSpring, store]);

	function boxOf(item: GanttItem, pal: GanttPalette | null): ItemBox | null {
		const li = laneIndex.get(item.laneId);
		if (li === undefined) return null;
		return itemBox(
			item,
			li,
			store.geometry(),
			store.originMs,
			store.pxPerDay.peek(),
			pal?.barInset ?? 8,
			pal?.milestoneSize ?? 12,
		);
	}

	function previewOf(pal: GanttPalette | null): ScenePreview | null {
		const g = store.geometry();
		const inset = pal?.barInset ?? 8;
		const live = gesture.peek();
		const barH = Math.max(4, g.rowH - inset * 2);
		if (live?.kind === "create") {
			const lo = Math.min(live.fromMs, live.toMs);
			const hi = Math.max(live.fromMs, live.toMs);
			return {
				laneIndex: live.laneIndex,
				x0: store.xOf(lo),
				x1: store.xOf(hi),
				y: laneTop(live.laneIndex, g) + inset,
				h: barH,
				label: hi > lo ? `${fmtDayLabel(lo, tz)} → ${fmtDayLabel(hi, tz)}` : "",
				dashed: false,
			};
		}
		if (live?.kind === "move" && live.moved) {
			return {
				laneIndex: live.laneIndex,
				x0: store.xOf(live.startMs),
				x1: store.xOf(live.startMs + live.durationMs),
				y: laneTop(live.laneIndex, g) + inset,
				h: barH,
				label: live.item.label,
				dashed: false,
			};
		}
		const d = draft.peek();
		if (d) {
			const li = laneIndex.get(d.laneId);
			if (li === undefined) return null;
			return {
				laneIndex: li,
				x0: store.xOf(d.start),
				x1: store.xOf(d.end),
				y: laneTop(li, g) + inset,
				h: barH,
				label: "",
				dashed: true,
			};
		}
		return null;
	}

	function liveScene(): GanttScene {
		const pal = paletteRef.current;
		const g = store.geometry();
		const sx = store.scrollX.peek();
		const sy = store.scrollY.peek();
		const w = store.viewportW.peek();
		const h = store.viewportH.peek();
		const win = laneWindow(sy, h, g, 1);
		const selectedLane = (() => {
			const id = store.selectedId.peek();
			const it = id ? itemById.get(id) : null;
			return it ? laneIndex.get(it.laneId) ?? null : null;
		})();

		const rows = [];
		for (let i = win.first; i <= win.last; i++) {
			rows.push({
				index: i,
				y: laneTop(i, g),
				h: laneHeight(i, g),
				hover: i === g.hoverLane,
				selected: i === selectedLane,
			});
		}

		const rules: { x: number; major: boolean }[] = [];
		const majors = new Set<number>();
		for (const t of ticksTop.peek()) {
			majors.add(t.ms);
			rules.push({ x: store.xOf(t.ms), major: true });
		}
		for (const t of ticksBottom.peek()) {
			if (!majors.has(t.ms)) rules.push({ x: store.xOf(t.ms), major: false });
		}

		const sceneItems: SceneItem[] = [];
		const boxes: ItemBox[] = [];
		const boxById = new Map<string, ItemBox>();
		const x0 = sx - ITEM_OVERSCAN_PX;
		const x1 = sx + w + ITEM_OVERSCAN_PX;
		for (let i = win.first; i <= win.last; i++) {
			const lane = lanes[i];
			if (!lane) continue;
			for (const it of itemsByLane.get(lane.id) ?? []) {
				const box = boxOf(it, pal);
				if (!box) continue;
				boxById.set(it.id, box);
				if (box.x + box.w < x0 || box.x > x1) continue;
				boxes.push(box);
				sceneItems.push({
					...box,
					label: it.label,
					meta: it.meta ?? "",
					accent: it.accent ?? DEFAULT_ACCENT,
					progress: typeof it.progress === "number" ? it.progress : null,
					expanded: i === g.hoverLane,
				});
			}
		}
		boxesRef.current = boxes;

		const links: { from: ItemBox; to: ItemBox }[] = [];
		for (const s of sceneItems) {
			const it = itemById.get(s.id);
			for (const depId of it?.dependsOn ?? []) {
				let from = boxById.get(depId);
				if (!from) {
					const dep = itemById.get(depId);
					const b = dep ? boxOf(dep, pal) : null;
					if (!b) continue;
					from = b;
				}
				links.push({ from, to: s });
			}
		}

		return {
			scrollX: sx,
			scrollY: sy,
			rules,
			weekends: weekends.peek().map((s) => ({ x0: store.xOf(s.start), x1: store.xOf(s.end) })),
			rows,
			items: sceneItems,
			links,
			todayX: store.xOf(nowMs),
			preview: previewOf(pal),
			hoverId: store.hoverId.peek(),
			focusId: store.focusId.peek(),
			fly: store.fly.peek(),
			regionFocus: store.regionFocus.peek(),
		};
	}

	const canvas = useGanttCanvas({
		canvasRef,
		probeRef,
		scene: liveScene,
		accentKey: () => accentKey,
		onPalette: (p) => {
			paletteRef.current = p;
			if (p.rowH > 0 && store.baseRowH.peek() !== p.rowH) store.baseRowH.value = p.rowH;
		},
		onReport: (r) => {
			reportRef.current = r;
		},
	});
	canvasApi.current = canvas;

	// Every fact the frame depends on, repainted through the REF (see `TimeGrid` for why not the const).
	useSignalEffect(() => {
		store.scrollX.value;
		store.scrollY.value;
		store.pxPerDay.value;
		store.rowH.value;
		store.viewportW.value;
		store.viewportH.value;
		store.hoverId.value;
		store.hoverLane.value;
		store.expandPx.value;
		store.focusId.value;
		store.selectedId.value;
		store.fly.value;
		store.regionFocus.value;
		store.rtl.value;
		gesture.value;
		draft.value;
		ticksTop.value;
		ticksBottom.value;
		canvasApi.current?.redraw();
	});
	// #endregion

	// #region Pointer → items
	function viewBoxRect(): DOMRect | null {
		return viewport.hostRef.current?.getBoundingClientRect() ?? null;
	}

	/** A content-space box as a VIEWPORT (client) rect — what the popover anchors to. */
	function anchorFor(box: { x: number; y: number; w: number; h: number }): GanttAnchor {
		const rect = viewBoxRect();
		const vx = box.x - store.scrollX.peek();
		const vy = box.y - store.scrollY.peek();
		if (!rect) return { x: vx, y: vy, w: box.w, h: box.h };
		const physicalX = store.rtl.peek() ? rect.width - vx - box.w : vx;
		return {
			x: rect.left + Math.max(0, Math.min(rect.width - box.w, physicalX)),
			y: rect.top + vy,
			w: Math.min(box.w, rect.width),
			h: box.h,
		};
	}

	function laneOf(item: GanttItem): GanttLane | null {
		const i = laneIndex.get(item.laneId);
		return i === undefined ? null : lanes[i];
	}

	function openItem(item: GanttItem, box: ItemBox): void {
		store.selectedId.value = item.id;
		const anchor = anchorFor(box);
		if (builtinPopover) popover.value = { kind: "item", item, lane: laneOf(item), anchor };
		else props.onOpenItem?.(item, anchor);
	}

	function hitAt(e: PointerEvent): { at: { x: number; y: number }; hit: ItemBox | null } {
		const at = viewport.pointerAt(e);
		const hit = hitTestItems(
			boxesRef.current,
			at.x + store.scrollX.peek(),
			at.y + store.scrollY.peek(),
		);
		return { at, hit };
	}

	function canMove(item: GanttItem): boolean {
		return !props.readOnly && !!props.onMoveItem && item.movable !== false;
	}

	function laneCreatable(lane: GanttLane): boolean {
		return canCreate && lane.creatable !== false;
	}

	/** Was a popover open when this press started — the click-away shield's one input. */
	const popoverWasOpen = useRef(false);
	useEffect(() => {
		if (typeof document === "undefined") return;
		const onDown = () => {
			popoverWasOpen.current = popover.peek() !== null;
		};
		const onUp = () => {
			popoverWasOpen.current = false;
		};
		document.addEventListener("pointerdown", onDown, true);
		globalThis.addEventListener("pointerup", onUp);
		globalThis.addEventListener("pointercancel", onUp);
		return () => {
			document.removeEventListener("pointerdown", onDown, true);
			globalThis.removeEventListener("pointerup", onUp);
			globalThis.removeEventListener("pointercancel", onUp);
		};
	}, [popover]);

	const endGesture = useRef<(() => void) | null>(null);
	useEffect(() => () => endGesture.current?.(), []);

	function trackGesture(commit: (g: Gesture) => void): void {
		const move = (ev: PointerEvent) => {
			const cur = gesture.peek();
			if (!cur) return;
			const at = viewport.pointerAt(ev);
			const ms = store.msAtViewX(at.x);
			const tier = store.tier.peek();
			if (cur.kind === "create") {
				const moved = cur.moved || Math.abs(ev.clientX - cur.originX) >= DRAG_THRESHOLD;
				gesture.value = { ...cur, moved, toMs: snapTo(ms, tier, tz) };
			} else if (cur.kind === "move") {
				const moved = cur.moved ||
					Math.hypot(ev.clientX - cur.originX, ev.clientY - cur.originY) >= DRAG_THRESHOLD;
				gesture.value = { ...cur, moved, startMs: snapTo(ms - cur.grabOffsetMs, tier, tz) };
			} else {
				const moved = cur.moved ||
					Math.hypot(ev.clientX - cur.originX, ev.clientY - cur.originY) >= DRAG_THRESHOLD;
				if (moved !== cur.moved) gesture.value = { ...cur, moved };
			}
		};
		const finish = (keep: boolean) => {
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
			globalThis.removeEventListener("pointercancel", cancel);
			endGesture.current = null;
			const cur = gesture.peek();
			gesture.value = null;
			if (cur && keep) commit(cur);
		};
		const up = () => finish(true);
		const cancel = () => finish(false);
		endGesture.current = cancel;
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", up);
		globalThis.addEventListener("pointercancel", cancel);
	}

	function commitCreate(g: Extract<Gesture, { kind: "create" }>): void {
		if (!g.moved) return;
		const lo = Math.min(g.fromMs, g.toMs);
		const hi = Math.max(g.fromMs, g.toMs);
		if (hi <= lo) return;
		const range: GanttRange = { start: lo, end: hi };
		const lane = lanes[g.laneIndex] ?? null;
		const gm = store.geometry();
		const inset = paletteRef.current?.barInset ?? 8;
		const anchor = anchorFor({
			x: store.xOf(lo),
			y: laneTop(g.laneIndex, gm) + inset,
			w: store.xOf(hi) - store.xOf(lo),
			h: Math.max(4, gm.rowH - inset * 2),
		});
		draft.value = { laneId: g.laneId, start: lo, end: hi };
		if (builtinPopover) {
			popover.value = { kind: "create", laneId: g.laneId, lane, range, anchor };
		} else {
			props.onCreateRange?.(g.laneId, range, anchor);
		}
	}

	function beginTouch(ev: PointerEvent): void {
		viewport.beginPan(ev);
		const originX = ev.clientX;
		const originY = ev.clientY;
		const { at } = hitAt(ev);
		const detach = () => {
			globalThis.removeEventListener("pointerup", up);
			globalThis.removeEventListener("pointercancel", cancel);
			endGesture.current = null;
		};
		const up = (e: PointerEvent) => {
			detach();
			if (Math.hypot(e.clientX - originX, e.clientY - originY) >= DRAG_THRESHOLD) return;
			// A tap: resolved against where the finger LANDED, since the pan may have moved things.
			const hit = hitTestItems(
				boxesRef.current,
				at.x + store.scrollX.peek(),
				at.y + store.scrollY.peek(),
			);
			if (hit) {
				const item = itemById.get(hit.id);
				if (item) openItem(item, hit);
			}
		};
		const cancel = () => detach();
		endGesture.current = cancel;
		globalThis.addEventListener("pointerup", up);
		globalThis.addEventListener("pointercancel", cancel);
	}

	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const ev = e as unknown as PointerEvent;
		if (ev.pointerType === "touch") {
			if (ev.isPrimary !== false) beginTouch(ev);
			return;
		}
		if (viewport.beginPan(ev)) return;
		if (ev.button !== 0) return;
		const { at, hit } = hitAt(ev);
		if (hit) {
			const item = itemById.get(hit.id);
			if (!item) return;
			e.preventDefault();
			const li = laneIndex.get(item.laneId) ?? hit.laneIndex;
			if (canMove(item) && !hit.milestone) {
				const grabMs = store.msAtViewX(at.x);
				gesture.value = {
					kind: "move",
					item,
					laneIndex: li,
					grabOffsetMs: grabMs - item.start,
					startMs: item.start,
					durationMs: item.end - item.start,
					originX: ev.clientX,
					originY: ev.clientY,
					moved: false,
					box: hit,
				};
				trackGesture((cur) => {
					if (cur.kind !== "move") return;
					if (!cur.moved) {
						openItem(cur.item, cur.box);
						return;
					}
					props.onMoveItem?.(cur.item, { start: cur.startMs, end: cur.startMs + cur.durationMs });
				});
			} else {
				gesture.value = {
					kind: "press",
					item,
					box: hit,
					originX: ev.clientX,
					originY: ev.clientY,
					moved: false,
				};
				trackGesture((cur) => {
					if (cur.kind === "press" && !cur.moved) openItem(cur.item, cur.box);
				});
			}
			return;
		}
		// THE CLICK-AWAY SHIELD: a press on empty ground while a popover is open dismisses it and
		// does nothing else — "get this out of my way" must not produce another thing in the way.
		if (popoverWasOpen.current) return;
		const li = laneAtY(at.y + store.scrollY.peek(), store.geometry());
		if (li === null) return;
		const lane = lanes[li];
		if (!lane || !laneCreatable(lane)) return;
		e.preventDefault();
		const ms = snapTo(store.msAtViewX(at.x), store.tier.peek(), tz);
		gesture.value = {
			kind: "create",
			laneIndex: li,
			laneId: lane.id,
			fromMs: ms,
			toMs: ms,
			originX: ev.clientX,
			moved: false,
		};
		trackGesture((cur) => {
			if (cur.kind === "create") commitCreate(cur);
		});
	}

	function retargetHover(item: GanttItem | null): void {
		const pal = paletteRef.current;
		if (!item || !pal) {
			expandSpring.set(0);
			return;
		}
		const li = laneIndex.get(item.laneId);
		if (li === undefined) return;
		const truncated = reportRef.current?.truncated.has(item.id) ?? false;
		const wants = truncated || !!item.meta;
		store.hoverLane.value = li;
		expandSpring.set(wants ? pal.rowExpand : 0);
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const ev = e as unknown as PointerEvent;
		if (ev.pointerType === "touch") return;
		if (gesture.peek() || store.fly.peek()) return;
		const { hit } = hitAt(ev);
		const next = hit?.id ?? null;
		if (next === store.hoverId.peek()) return;
		store.hoverId.value = next;
		retargetHover(next ? itemById.get(next) ?? null : null);
	}

	function onPointerLeave(): void {
		if (gesture.peek()) return;
		if (store.hoverId.peek() !== null) {
			store.hoverId.value = null;
			retargetHover(null);
		}
	}

	const live = gesture.value;
	const cursor = live?.kind === "move" && live.moved
		? "grabbing"
		: store.panning.value
		? "grabbing"
		: store.fly.value
		? "fly"
		: store.hoverId.value
		? "pointer"
		: canCreate
		? "cell"
		: "default";
	// #endregion

	// #region Accessible layer
	function focusItem(item: GanttItem): void {
		store.focusId.value = item.id;
		const li = laneIndex.get(item.laneId);
		if (li !== undefined) store.revealLane(li);
		const box = boxOf(item, paletteRef.current);
		if (box) store.revealX(box.x, box.x + box.w);
	}

	function moveFocus(delta: number): void {
		if (ordered.length === 0) return;
		const cur = store.focusId.peek();
		const i = cur ? ordered.findIndex((it) => it.id === cur) : -1;
		const next = ordered[(i + delta + ordered.length) % ordered.length];
		const el = a11yRef.current?.querySelector<HTMLElement>(
			`[data-gantt-item="${CSS.escape(next.id)}"]`,
		);
		if (el) el.focus({ preventScroll: true });
		else focusItem(next);
	}

	const a11yRef = useRef<HTMLDivElement>(null);
	function onRegionKey(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		const ev = e as unknown as KeyboardEvent;
		const ctrl = ev.ctrlKey || ev.metaKey;
		if (ev.key === "Escape") {
			if (popover.peek()) {
				popover.value = null;
				draft.value = null;
			}
			viewport.endFly();
			return;
		}
		if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && !ctrl) {
			ev.preventDefault();
			moveFocus(ev.key === "ArrowDown" ? 1 : -1);
			return;
		}
		if (ev.key === "Enter" && store.focusId.peek()) {
			// The item's own button handles Enter as a click; the region only ever sees the key when
			// focus is on the region itself, where opening the focused item is still the right answer.
			const item = itemById.get(store.focusId.peek()!);
			const box = item ? boxOf(item, paletteRef.current) : null;
			if (item && box) {
				ev.preventDefault();
				if (popover.peek()?.kind === "item") popover.value = null;
				else openItem(item, box);
			}
			return;
		}
		viewport.handleKey(ev);
	}

	const visibleText = useComputed(() => {
		const r = store.visibleRange.value;
		if (store.viewportW.value <= 0) return "";
		return `Showing ${fmtDayLabel(r.start, tz)} to ${fmtDayLabel(r.end, tz)}`;
	});

	const awayFromNow = useComputed<"before" | "after" | null>(() => {
		const x = store.xOf(nowMs) - store.scrollX.value;
		const w = store.viewportW.value;
		if (w <= 0) return null;
		if (x < 0) return "before";
		if (x > w) return "after";
		return null;
	});

	function itemName(item: GanttItem): string {
		const lane = laneOf(item);
		const milestone = item.kind === "milestone" || item.end <= item.start;
		const when = milestone
			? `${fmtDayLabel(item.start, tz)} ${fmtTime(item.start, tz, hour12)}`
			: `${fmtDayLabel(item.start, tz)} to ${fmtDayLabel(item.end, tz)}`;
		return [
			item.label,
			lane?.label,
			milestone ? `milestone, ${when}` : when,
			item.status,
			item.meta,
		]
			.filter(Boolean)
			.join(", ");
	}
	// #endregion

	// #region Draft ↔ popover
	function clearDraft(): void {
		if (draft.peek() !== null) draft.value = null;
	}
	// #endregion

	const win = laneWin.value;
	const listed = ordered.filter((it) => {
		const li = laneIndex.get(it.laneId);
		return li !== undefined && li >= win.first && li <= win.last;
	});
	const selectedLane = (() => {
		const id = store.selectedId.value;
		const it = id ? itemById.get(id) : null;
		return it ? laneIndex.get(it.laneId) ?? null : null;
	})();

	if (lanes.length === 0) {
		return (
			<div class={cx("gantt", "gantt--empty", props.class)}>
				<p class="gantt__empty">{props.empty ?? "Nothing on this timeline yet."}</p>
			</div>
		);
	}

	return (
		<div
			class={cx(
				"gantt",
				props.hideTaskList && "gantt--nolanes",
				mobile && "gantt--sheet",
				props.class,
			)}
			style={props.laneWidth ? styleVars({ "--gantt-lanes-w": props.laneWidth }) : undefined}
		>
			{props.hideTaskList ? null : (
				<div class="gantt__lanes">
					<div class="gantt__lanehead" aria-hidden="true">
						<span class="gantt__laneheading">{props.laneHeading ?? "Lanes"}</span>
					</div>
					<GanttTaskList
						store={store}
						lanes={lanes}
						window={laneWin}
						countByLane={countByLane}
						heading={props.laneHeading ?? "Lanes"}
						selectedLane={selectedLane}
					/>
				</div>
			)}

			<div class="gantt__main">
				<GanttHeader store={store} top={ticksTop} bottom={ticksBottom} nowMs={nowMs} />
				<div
					class="gantt__viewport"
					data-cursor={cursor}
					ref={viewport.hostRef}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerLeave={onPointerLeave}
				>
					<canvas ref={canvasRef} class="gantt__canvas" aria-hidden="true" />
				</div>
				{awayFromNow.value
					? (
						<button
							type="button"
							class="gantt__today"
							data-direction={awayFromNow.value}
							onClick={() => viewport.glideToX(store.xOf(nowMs) - store.viewportW.peek() / 2)}
						>
							<Icon
								name={awayFromNow.value === "before" ? "chevron-left" : "chevron-right"}
								size="xs"
							/>
							<span>Today</span>
						</button>
					)
					: null}
			</div>

			<GanttProbe probeRef={probeRef} accents={accents} />

			{
				/*
				 * THE ACCESSIBLE LAYER: everything the canvas draws that a reader can act on, as real focusable
				 * elements. Visually hidden — the drawing is on screen, and the canvas paints the focus ring.
				 */
			}
			<div
				ref={a11yRef}
				class="gantt__a11y"
				role="region"
				aria-label={props.ariaLabel ?? "Timeline"}
				tabIndex={0}
				onKeyDown={onRegionKey}
				onFocus={(e) => {
					if (e.target === e.currentTarget) store.regionFocus.value = true;
				}}
				onBlur={(e) => {
					if (e.target === e.currentTarget) store.regionFocus.value = false;
				}}
			>
				<p>
					Left and Right scroll through time, Shift with them moves a screen. Control with Up and
					Down scrolls the rows. Up and Down move between items, Enter opens the focused item.
				</p>
				<p role="status" aria-live="polite">{visibleText.value}</p>
				{awayFromNow.value
					? (
						<button
							type="button"
							class="gantt__a11yitem"
							onClick={() => viewport.glideToX(store.xOf(nowMs) - store.viewportW.peek() / 2)}
						>
							Return to today
						</button>
					)
					: null}
				<ul class="gantt__a11ylist">
					{listed.map((item) => (
						<li key={item.id}>
							<button
								type="button"
								class="gantt__a11yitem"
								data-gantt-item={item.id}
								onFocus={() => focusItem(item)}
								onBlur={() => {
									if (store.focusId.peek() === item.id) store.focusId.value = null;
								}}
								onClick={() => {
									const box = boxOf(item, paletteRef.current);
									if (box) openItem(item, box);
								}}
							>
								{itemName(item)}
							</button>
						</li>
					))}
				</ul>
			</div>

			{builtinPopover
				? (
					<GanttPopover
						state={popover}
						tz={tz}
						hour12={hour12}
						sheet={mobile}
						renderItemActions={props.renderItemActions}
						onOpenItem={props.onOpenItem}
						onQuickCreate={props.onQuickCreate
							? (laneId, range, title) => {
								clearDraft();
								props.onQuickCreate?.(laneId, range, title);
							}
							: undefined}
						onExpandCreate={props.onCreateRange
							? (laneId, range, anchor, title) => {
								clearDraft();
								props.onCreateRange?.(laneId, range, anchor, title);
							}
							: undefined}
						onClose={clearDraft}
						avoid={props.avoid ?? DEFAULT_AVOID}
					/>
				)
				: null}
		</div>
	);
}
