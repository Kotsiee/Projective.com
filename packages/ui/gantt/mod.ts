/**
 * @projective/ui/gantt — a high-performance, interactive Timeline / Gantt engine (DESIGN_SYSTEM.md
 * §C.1; SYSTEM_ARCHITECTURE.md §Charts). The HTML task list beside an HTML tiered time header over
 * an IMMEDIATE-MODE CANVAS stage, driven by a `@preact/signals` store so a pan, a zoom or a hover
 * moves the pixels with no VDOM render in the path.
 *
 * Generic + CONTROLLED + zod-free: the consumer maps its own domain data (a Zod projection) into the
 * {@link GanttLane}/{@link GanttItem} shapes and reacts to the open/create/move callbacks, so the ONE
 * engine serves the project timeline, the ticket modal's stage run and the calendar's Timeline view.
 * Token-only + BEM (portable). The island is the single hydration boundary.
 */

// #region Island
export { default as Gantt } from "./islands/Gantt.tsx";
// #endregion

// #region Components (composable parts for bespoke layouts)
export { GanttHeader } from "./components/GanttHeader.tsx";
export type { GanttHeaderProps } from "./components/GanttHeader.tsx";
export { GanttTaskList } from "./components/GanttTaskList.tsx";
export type { GanttTaskListProps } from "./components/GanttTaskList.tsx";
export { GanttProbe } from "./components/GanttProbe.tsx";
export type { GanttProbeProps } from "./components/GanttProbe.tsx";
export { GanttPopover } from "./components/GanttPopover.tsx";
export type { GanttPopoverProps } from "./components/GanttPopover.tsx";
// #endregion

// #region Hooks
export { useGanttCanvas } from "./hooks/useGanttCanvas.ts";
export type { GanttCanvasApi, UseGanttCanvasOptions } from "./hooks/useGanttCanvas.ts";
export { useGanttViewport } from "./hooks/useGanttViewport.ts";
export type { GanttViewport, UseGanttViewportOptions } from "./hooks/useGanttViewport.ts";
// #endregion

// #region Core
export type {
	GanttAnchor,
	GanttCommand,
	GanttDraft,
	GanttItem,
	GanttItemActionContext,
	GanttItemKind,
	GanttLane,
	GanttPopoverState,
	GanttProps,
	GanttRange,
} from "./core/types.ts";
export {
	createGanttStore,
	REVEAL_PAD,
	ROW_H_DEFAULT,
	ROW_SCALE_RANGE,
	ROW_SCALE_STEP,
	ZOOM_ANCHOR_HOLD_MS,
} from "./core/gantt-store.ts";
export type { GanttStore, GanttStoreOptions } from "./core/gantt-store.ts";
export {
	AXIS_LIMIT_DAYS,
	clampZoom,
	daysVisible,
	durationLabel,
	fitZoom,
	MAX_TICKS,
	msAtX,
	PX_PER_DAY_DEFAULT,
	PX_PER_DAY_MAX,
	PX_PER_DAY_MIN,
	snapTo,
	snapUnitFor,
	ticksFor,
	tierFor,
	UNIT_RANK,
	unitDays,
	unitNext,
	unitStart,
	weekendSpans,
	xOfMs,
	ZOOM_RANGE_DEFAULT,
	ZOOM_STEP,
	zoomedScrollX,
} from "./core/time-scale.ts";
export type { TimeTick, TimeTier, TimeUnit } from "./core/time-scale.ts";
export {
	BAR_HIT_MIN_PX,
	contentHeight,
	dependencyPath,
	hitBox,
	hitTestItems,
	inBox,
	itemBox,
	laneAtY,
	laneHeight,
	laneTop,
	laneWindow,
	LINK_ELBOW_PX,
	MILESTONE_HIT_PX,
	MIN_BAR_PX,
} from "./core/layout.ts";
export type { ItemBox, RowGeometry } from "./core/layout.ts";
export {
	cssColorToHex,
	onAccentTokenFor,
	readGanttPalette,
	resolveCssColor,
} from "./core/theme-bridge.ts";
export type { GanttAccentPaint, GanttPalette } from "./core/theme-bridge.ts";
export { paintGantt } from "./core/gantt-paint.ts";
export type {
	GanttBox,
	GanttScene,
	PaintReport,
	SceneItem,
	ScenePreview,
	SceneRow,
	SceneRule,
} from "./core/gantt-paint.ts";
// #endregion
