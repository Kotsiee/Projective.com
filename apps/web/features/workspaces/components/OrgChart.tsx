import type { JSX, RefObject } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { createSpring } from "@ui/core/motion.ts";
import { useId } from "@projective/ui/hooks";
import type { WorkspaceKind, WorkspaceMember, WorkspaceRoleDef } from "@projective/types/workspace";
import { type MemberAction, roleText } from "../core/members-model.ts";
import {
	type ChartBox,
	type ChartLayout,
	type ChartNode,
	type ChartView,
	clampZoom,
	fitView,
	layoutChart,
	managersAbove,
	NODE_H,
	NODE_W,
	revealBox,
	shapeChart,
	zoomAbout,
} from "../core/org-chart-layout.ts";
import {
	CHART_ZOOM_MAX,
	CHART_ZOOM_MIN,
	CHART_ZOOM_STEP,
	chartCommand,
	chartZoom,
} from "../core/view-state.ts";
import { FOLD_H, OrgChartNode } from "./OrgChartNode.tsx";

/**
 * OrgChart — the Members roster read as a reporting structure, on an interactive canvas (Decision
 * #319): the body's whole region becomes an SVG viewport over an endless dotted ground, and the chart
 * is panned by dragging, zoomed by the wheel, a pinch or the footer rig's zoom, and walked by keyboard.
 *
 * **What it draws** is `org-chart-layout.ts`'s geometry: an `OrgChartNode` card per person (avatar and
 * role, name and handle, workload and stake), an elbow connector from each manager to each report, and a "Not placed" group for everyone a
 * reporting line cannot place — a manager who left, a cycle, a roster with nobody at the top. A
 * manager's card carries a fold under it with the number of people below them; folding a branch keeps
 * the card where it was on screen.
 *
 * **Search and filter** are the Members toolbar's, unchanged across the readings: `matches` names who
 * they pick out. Those cards are marked, everyone else's ink recedes (a colour step, never opacity),
 * folded branches open to reveal a match, and the view eases to fit the matches.
 *
 * **The viewport** is ONE transform (`ChartView`), eased on a single over-damped spring from where it
 * is to where it was asked to go — a wheel notch, a footer step, Fit, a reveal — or placed at once for a
 * drag, a pinch or a trackpad's continuous wheel. Every request lands on the target, so a frameless
 * environment (the spring's watchdog) and both reduced-motion channels jump straight there. The footer
 * rig is another hydration root: it asks through `chartCommand` and reads back `chartZoom`.
 *
 * **Keyboard** follows the tree pattern on a flat `role="tree"`: one card holds the tab stop; Up and
 * Down walk the drawn cards in reading order, Right opens a branch or steps into it, Left folds it or
 * steps up to the manager, Home and End jump, Enter or Space opens the member. `+`, `-` and `0` zoom
 * and fit. A focused card is eased on screen.
 *
 * Nothing here is styled inline: geometry is SVG attributes (as a chart's always is), the look is
 * `workspace-people.css` on tokens.
 */

// #region Props
export interface OrgChartProps {
	/** The active members, in the order siblings should read (the toolbar's sort). */
	members: readonly WorkspaceMember[];
	roles: readonly WorkspaceRoleDef[];
	kind: WorkspaceKind;
	/** The viewer sees payout stakes — the cards carry each person's. */
	showStake: boolean;
	/** The member the inspector shows, marked on the chart; `null` while nobody is selected. */
	selectedId: string | null;
	/** Who the toolbar's search and role filter pick out, or `null` when nothing is filtered. */
	matches: ReadonlySet<string> | null;
	onAction: (action: MemberAction, member: WorkspaceMember) => void;
	/**
	 * Chrome floating over the canvas's top edge (the section bar and toolbar). A fit keeps the chart
	 * clear of it.
	 */
	overlayRef?: RefObject<HTMLElement>;
}
// #endregion

// #region Geometry
/** Breathing room around a fit, and around a card eased on screen. */
const FIT_PAD = 48;
const REVEAL_PAD = 32;
/** The ground's dot spacing on screen, kept within [MIN, 2 × MIN) as the zoom changes. */
const GRID_MIN = 20;
/** A pointer must travel this far before a press becomes a drag (so a click stays a click). */
const DRAG_SLOP = 4;
/** A wheel step at least this large is a mouse notch, and eases; smaller ones are a trackpad's. */
const NOTCH = 40;
// #endregion

export function OrgChart(props: OrgChartProps): JSX.Element {
	const { members, roles, kind, showStake, selectedId, matches, onAction } = props;
	const uid = useId(undefined, "org");

	// #region State
	/** Managers the reader folded. A search opens the ones hiding a match without forgetting them. */
	const closed = useSignal<ReadonlySet<string>>(new Set<string>());
	/** The card holding the tab stop. */
	const focusId = useSignal<string | null>(null);
	/** The transform drawn this frame, and the measured viewport. */
	const view = useSignal<ChartView>({ x: 0, y: 0, k: 1 });
	const ready = useSignal(false);
	const announce = useSignal("");

	const svgRef = useRef<SVGSVGElement>(null);
	const size = useRef({ w: 0, h: 0 });
	/** Where the view is going — every request computes from here, so requests compose mid-flight. */
	const target = useRef<ChartView>({ x: 0, y: 0, k: 1 });
	const from = useRef<ChartView>({ x: 0, y: 0, k: 1 });
	/** Once the reader moves the view, a resize keeps it rather than re-fitting under them. */
	const steered = useRef(false);
	const handled = useRef(chartCommand.peek()?.seq ?? 0);
	const spring = useMemo(() => createSpring(1), []);
	useEffect(() => () => spring.dispose(), []);
	// #endregion

	// #region The chart
	const shape = useMemo(() => shapeChart(members), [members]);
	/** The managers above a match — their folds stay open while the match does. */
	const revealed = useMemo(() => {
		const out = new Set<string>();
		for (const id of matches ?? []) for (const above of managersAbove(shape, id)) out.add(above);
		return out;
	}, [shape, matches]);
	/** The folds as drawn. */
	const drawnFolds = (folds: ReadonlySet<string>): ReadonlySet<string> =>
		revealed.size === 0 ? folds : new Set([...folds].filter((id) => !revealed.has(id)));
	const layout: ChartLayout = useMemo(
		() => layoutChart(members, drawnFolds(closed.value)),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[members, revealed, closed.value],
	);
	const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.member.id, n])), [layout]);
	/** Each card's place among its siblings, for `aria-posinset` / `aria-setsize`. */
	const siblingPlace = useMemo(() => {
		const groups = new Map<string, string[]>();
		for (const n of layout.nodes) {
			const key = n.unplaced ? "~unplaced" : n.parentId ?? "~top";
			groups.set(key, [...(groups.get(key) ?? []), n.member.id]);
		}
		const out = new Map<string, { pos: number; size: number }>();
		for (const ids of groups.values()) {
			ids.forEach((id, i) => out.set(id, { pos: i + 1, size: ids.length }));
		}
		return out;
	}, [layout]);
	const tabStop = focusId.value && byId.has(focusId.value)
		? focusId.value
		: layout.nodes[0]?.member.id ?? null;
	// #endregion

	// #region The viewport
	/** Go to `next`: eased from where the view is now, or placed at once. */
	function go(next: ChartView, animate: boolean): void {
		target.current = next;
		if (chartZoom.peek() !== next.k) chartZoom.value = next.k;
		if (!animate) {
			spring.jump(1);
			from.current = next;
			view.value = next;
			return;
		}
		from.current = view.peek();
		spring.jump(0);
		spring.set(1);
	}

	// One progress value drives x, y and k together, so a point zoomed about stays put mid-flight.
	useSignalEffect(() => {
		const t = spring.value.value;
		const a = from.current;
		const b = target.current;
		view.value = t >= 1
			? b
			: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, k: a.k + (b.k - a.k) * t };
	});

	/** The room the overlaying chrome takes at the top of the viewport. */
	function topInset(): number {
		const overlay = props.overlayRef?.current;
		const svg = svgRef.current;
		if (!overlay || !svg) return 0;
		return Math.max(0, overlay.getBoundingClientRect().bottom - svg.getBoundingClientRect().top);
	}

	/** The view that fits `box` in the part of the viewport the chrome leaves free. */
	function fitted(box: ChartBox): ChartView {
		const inset = topInset();
		const fit = fitView(box, size.current.w, size.current.h - inset, {
			pad: FIT_PAD,
			min: CHART_ZOOM_MIN,
			maxFit: 1,
		});
		return { ...fit, y: fit.y + inset };
	}

	function fitAll(animate: boolean): void {
		go(fitted(layout.bounds), animate);
	}

	/** Zoom about the viewport's centre (a footer step, a key). */
	function zoomTo(k: number, animate: boolean): void {
		const next = clampZoom(k, CHART_ZOOM_MIN, CHART_ZOOM_MAX);
		go(zoomAbout(target.current, next, size.current.w / 2, size.current.h / 2), animate);
	}

	function nodeBox(node: ChartNode): ChartBox {
		return { x: node.x, y: node.y, width: NODE_W, height: NODE_H + FOLD_H / 2 };
	}

	// Measure the viewport; fit on the first measure, and again on a resize until the reader steers.
	useLayoutEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const measure = () => {
			const rect = svg.getBoundingClientRect();
			if (rect.width === size.current.w && rect.height === size.current.h) return;
			size.current = { w: rect.width, h: rect.height };
			if (!steered.current) fitAll(false);
			ready.value = true;
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(svg);
		return () => ro.disconnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// The footer rig's requests. A request made before this chart mounted is not replayed.
	useSignalEffect(() => {
		const command = chartCommand.value;
		if (!command || command.seq === handled.current) return;
		handled.current = command.seq;
		if (command.kind === "fit") {
			steered.current = false;
			fitAll(true);
			return;
		}
		steered.current = true;
		zoomTo(command.value, command.animate);
	});

	// A search or filter eases to fit what it picked out, and says how many it found.
	const matchKey = matches ? [...matches].sort().join(",") : null;
	const firstMatchRun = useRef(true);
	useEffect(() => {
		if (firstMatchRun.current) {
			firstMatchRun.current = false;
			return;
		}
		if (!size.current.w) return;
		if (!matches) {
			announce.value = "";
			fitAll(true);
			return;
		}
		const hits = layout.nodes.filter((n) => matches.has(n.member.id));
		announce.value = hits.length === 0
			? "Nobody on the chart matches."
			: `${hits.length} ${hits.length === 1 ? "person matches" : "people match"}.`;
		if (hits.length === 0) return;
		const minX = Math.min(...hits.map((n) => n.x));
		const minY = Math.min(...hits.map((n) => n.y));
		const maxX = Math.max(...hits.map((n) => n.x + NODE_W));
		const maxY = Math.max(...hits.map((n) => n.y + NODE_H));
		go(fitted({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }), true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [matchKey]);
	// #endregion

	// #region Pointer — drag to pan, wheel and pinch to zoom
	const pointers = useRef(new Map<number, { x: number; y: number }>());
	const drag = useRef<
		{ id: number; x: number; y: number; start: ChartView; moved: boolean } | null
	>(
		null,
	);
	const pinch = useRef<{ distance: number; start: ChartView; x: number; y: number } | null>(null);
	/** Set when a press became a drag, so the click it ends in opens nothing. */
	const swallowClick = useRef(false);

	function local(event: { clientX: number; clientY: number }): { x: number; y: number } {
		const rect = svgRef.current?.getBoundingClientRect();
		return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
	}

	function onPointerDown(event: JSX.TargetedPointerEvent<SVGSVGElement>): void {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		const at = local(event);
		pointers.current.set(event.pointerId, at);
		swallowClick.current = false;
		if (pointers.current.size === 2) {
			const [a, b] = [...pointers.current.values()];
			pinch.current = {
				distance: Math.hypot(b.x - a.x, b.y - a.y) || 1,
				start: target.current,
				x: (a.x + b.x) / 2,
				y: (a.y + b.y) / 2,
			};
			drag.current = null;
			return;
		}
		drag.current = { id: event.pointerId, x: at.x, y: at.y, start: target.current, moved: false };
	}

	function onPointerMove(event: JSX.TargetedPointerEvent<SVGSVGElement>): void {
		if (!pointers.current.has(event.pointerId)) return;
		const at = local(event);
		pointers.current.set(event.pointerId, at);
		const twin = pinch.current;
		if (twin && pointers.current.size >= 2) {
			const [a, b] = [...pointers.current.values()];
			const ratio = (Math.hypot(b.x - a.x, b.y - a.y) || 1) / twin.distance;
			const k = clampZoom(twin.start.k * ratio, CHART_ZOOM_MIN, CHART_ZOOM_MAX);
			const zoomed = zoomAbout(twin.start, k, twin.x, twin.y);
			const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
			steered.current = true;
			go({ ...zoomed, x: zoomed.x + mid.x - twin.x, y: zoomed.y + mid.y - twin.y }, false);
			return;
		}
		const press = drag.current;
		if (!press || press.id !== event.pointerId) return;
		const dx = at.x - press.x;
		const dy = at.y - press.y;
		if (!press.moved) {
			if (Math.hypot(dx, dy) < DRAG_SLOP) return;
			press.moved = true;
			swallowClick.current = true;
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch { /* a pointer that already ended cannot be captured; the drag still tracks it */ }
		}
		steered.current = true;
		go({ x: press.start.x + dx, y: press.start.y + dy, k: press.start.k }, false);
	}

	function onPointerEnd(event: JSX.TargetedPointerEvent<SVGSVGElement>): void {
		pointers.current.delete(event.pointerId);
		if (pointers.current.size < 2) pinch.current = null;
		if (drag.current?.id === event.pointerId) drag.current = null;
	}

	// A non-passive listener, so the wheel zooms the chart instead of scrolling the page — and, being
	// handled, the shell's Ctrl+wheel density zoom leaves it alone (`useCtrlWheelZoom`).
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 800 : 1;
			const dx = event.deltaX * unit;
			const dy = event.deltaY * unit;
			steered.current = true;
			// A sideways swipe pans; everything else zooms about the pointer.
			if (!event.ctrlKey && Math.abs(dx) > Math.abs(dy)) {
				const t = target.current;
				go({ ...t, x: t.x - dx }, false);
				return;
			}
			const base = target.current;
			const k = clampZoom(
				base.k * Math.exp(-dy * (event.ctrlKey ? 0.01 : 0.0015)),
				CHART_ZOOM_MIN,
				CHART_ZOOM_MAX,
			);
			if (k === base.k) return;
			const at = local(event);
			go(zoomAbout(base, k, at.x, at.y), !event.ctrlKey && Math.abs(dy) >= NOTCH);
		};
		svg.addEventListener("wheel", onWheel, { passive: false });
		return () => svg.removeEventListener("wheel", onWheel);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	// #endregion

	// #region Folding and keyboard
	/** Fold or open a branch, keeping its card where it was on screen. */
	function toggle(id: string): void {
		const before = byId.get(id);
		if (!before) return;
		const next = new Set(closed.value);
		if (before.open) next.add(id);
		else next.delete(id);
		closed.value = next;
		const after = layoutChart(members, drawnFolds(next)).nodes.find((n) => n.member.id === id);
		if (!after) return;
		const t = target.current;
		go({ ...t, x: t.x + (before.x - after.x) * t.k, y: t.y + (before.y - after.y) * t.k }, false);
	}

	function focusCard(id: string): void {
		focusId.value = id;
		// After the render that moves the tab stop onto it.
		queueMicrotask(() => {
			svgRef.current?.querySelector<SVGGElement>(`[data-id="${CSS.escape(id)}"]`)?.focus({
				preventScroll: true,
			});
		});
	}

	function open(member: WorkspaceMember): void {
		focusId.value = member.id;
		onAction("open", member);
	}

	function onCardKey(event: JSX.TargetedKeyboardEvent<SVGGElement>, node: ChartNode): void {
		const order = layout.nodes;
		const at = order.findIndex((n) => n.member.id === node.member.id);
		const step = (to: ChartNode | undefined) => {
			if (!to) return;
			event.preventDefault();
			focusCard(to.member.id);
		};
		switch (event.key) {
			case "Enter":
			case " ":
				event.preventDefault();
				open(node.member);
				return;
			case "ArrowDown":
				return step(order[at + 1]);
			case "ArrowUp":
				return step(order[at - 1]);
			case "Home":
				return step(order[0]);
			case "End":
				return step(order.at(-1));
			case "ArrowRight":
				if (node.reports === 0) return;
				event.preventDefault();
				if (!node.open) toggle(node.member.id);
				else step(order.find((n) => n.parentId === node.member.id));
				return;
			case "ArrowLeft":
				event.preventDefault();
				if (node.open) toggle(node.member.id);
				else if (node.parentId) step(byId.get(node.parentId));
				return;
		}
	}

	function onCanvasKey(event: JSX.TargetedKeyboardEvent<SVGSVGElement>): void {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const k = target.current.k;
		if (event.key === "+" || event.key === "=") zoomTo(k + CHART_ZOOM_STEP, true);
		else if (event.key === "-" || event.key === "_") zoomTo(k - CHART_ZOOM_STEP, true);
		else if (event.key === "0") fitAll(true);
		else return;
		event.preventDefault();
		// A fit hands the view back to the chart, so a resize re-fits it again.
		steered.current = event.key !== "0";
	}

	/** A focused card is eased fully on screen — the keyboard reader never steers into the dark. */
	function onCardFocus(node: ChartNode): void {
		focusId.value = node.member.id;
		const next = revealBox(
			target.current,
			nodeBox(node),
			size.current.w,
			size.current.h,
			REVEAL_PAD,
		);
		if (next !== target.current) go(next, true);
	}
	// #endregion

	// #region Render
	const transform = useComputed(() => {
		const v = view.value;
		return `translate(${v.x} ${v.y}) scale(${v.k})`;
	});
	/** The ground: dots that stay a constant size on screen, re-spaced by powers of two as it zooms. */
	const grid = useComputed(() => {
		const v = view.value;
		let s = 24 * v.k;
		while (s < GRID_MIN) s *= 2;
		while (s >= GRID_MIN * 2) s /= 2;
		const mod = (n: number) => ((n % s) + s) % s;
		return { size: s, shift: `translate(${mod(v.x)} ${mod(v.y)})` };
	});
	const gridSize = useComputed(() => grid.value.size);
	const gridShift = useComputed(() => grid.value.shift);
	const filtering = matches !== null;

	return (
		<div
			class="wsp-orgchart"
			data-ready={ready.value ? "true" : undefined}
			data-filtering={filtering ? "true" : undefined}
		>
			<svg
				ref={svgRef}
				class="wsp-orgchart__canvas"
				role="tree"
				aria-label="Reporting structure"
				aria-describedby={`${uid}-help`}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerEnd}
				onPointerCancel={onPointerEnd}
				onKeyDown={onCanvasKey}
			>
				<defs>
					<pattern
						id={`${uid}-dots`}
						patternUnits="userSpaceOnUse"
						width={gridSize}
						height={gridSize}
						patternTransform={gridShift}
					>
						<circle class="wsp-orgchart__dot" cx="1" cy="1" r="1" />
					</pattern>
				</defs>
				<rect
					class="wsp-orgchart__ground"
					width="100%"
					height="100%"
					fill={`url(#${uid}-dots)`}
					aria-hidden="true"
				/>

				<g class="wsp-orgchart__scene" transform={transform}>
					<g aria-hidden="true">
						{layout.edges.map((edge) => (
							<path
								key={edge.id}
								class="wsp-orgchart__edge"
								d={edge.d}
								data-dim={filtering && !(matches.has(edge.from) && matches.has(edge.to))
									? "true"
									: undefined}
							/>
						))}
						{layout.unplacedLabel && (
							<text
								class="wsp-orgchart__group"
								x={layout.unplacedLabel.x}
								y={layout.unplacedLabel.y + 14}
							>
								<tspan class="wsp-orgchart__grouptitle">Not placed</tspan>
								<tspan class="wsp-orgchart__groupnote" x={layout.unplacedLabel.x} dy="18">
									{layout.rooted
										? "Their reporting line points at someone who left, or loops back on itself."
										: "Nobody is at the top yet. Set a reporting line on one person to anchor the chart."}
								</tspan>
							</text>
						)}
					</g>

					{layout.nodes.map((node) => (
						<OrgChartNode
							key={node.member.id}
							node={node}
							role={roleText(node.member, roles)}
							kind={kind}
							showStake={showStake}
							tabbable={node.member.id === tabStop}
							place={siblingPlace.get(node.member.id) ?? { pos: 1, size: 1 }}
							match={filtering ? matches.has(node.member.id) : null}
							selected={selectedId === node.member.id}
							onOpen={() => {
								if (swallowClick.current) return;
								open(node.member);
							}}
							onToggle={() => toggle(node.member.id)}
							onKeyDown={(event) => onCardKey(event, node)}
							onFocus={() => onCardFocus(node)}
						/>
					))}
				</g>
			</svg>

			<p id={`${uid}-help`} class="ui-visually-hidden">
				Drag to move the chart, scroll or pinch to zoom. Arrow keys move between people, Enter opens
				one, plus and minus zoom, zero fits the chart.
			</p>
			<p class="ui-visually-hidden" role="status">{announce.value}</p>
		</div>
	);
	// #endregion
}
