/**
 * @projective/ui/calendar — a high-performance, interactive Calendar & Schedule engine (DESIGN_SYSTEM.md
 * §C.1). Inspired by Google Calendar + Monday.com: a two-panel shell (mini-map mini-month + availability
 * summary · main viewport), Day/Week/Month views over a virtualized, centered, infinitely-scrollable
 * time grid, Ctrl+wheel zoom that also transitions across view thresholds, middle-mouse / Ctrl-drag 2D
 * panning, click + drag-to-select event creation, overlap-aware fractional-column layout, privacy-masked
 * external/availability blocks, public-session attendee counters, and a return-to-present pill.
 *
 * The two timed views draw the same lattice through the same canvas, at different depths.
 *
 * The **Week** `TimeGrid` is a PURE immediate-mode canvas: its viewport holds one `<canvas>` and
 * nothing else, and the hour scale, day columns, working-hours bands, blackout hatch, event cards,
 * current-time rule, drag preview, period markers, depth gauge and return-to-present pill are all
 * pixels from one ordered pass (`paintScene`) over one `GridScene`. There is no scroll container —
 * the offset is a signal `useCanvasViewport` owns — and every gesture is resolved by mapping a
 * pointer into scene coordinates and asking `hitTest` what is there. Because a canvas is opaque to
 * assistive technology and to the keyboard, the viewport ships with a PARALLEL ACCESSIBLE LAYER
 * beside it: the same events as real focusable controls with the same names and handlers, keyboard
 * scrolling and creation, scroll-into-view on focus, and a live region naming what is on screen. Its
 * controls are visually hidden and therefore cannot show a focus ring of their own, so the canvas
 * paints one for each — a card, the return-to-present pill, and the scroll region itself. The canvas
 * is `aria-hidden`: it is the drawing; the layer is the content.
 *
 * The **Day** `DayTimeline` remains HYBRID: the canvas paints its lattice and its events stay HTML
 * cards over it.
 *
 * The canvas holds no colour, font, radius, alpha or length of its own: `useGridCanvas` resolves the
 * whole palette from live computed styles on a hidden swatch subtree authored in `calendar.css`, and
 * re-resolves it when the theme, the contrast/CVD overlays or the dyslexic typeface move — the last
 * of which is a family swap PLUS tracking, word spacing and leading, all four of which travel to the
 * canvas. What does NOT survive the move to pixels is find-in-page, text selection and a native text
 * cursor, which is why the accessible layer is a merge gate rather than a nicety.
 *
 * Generic + CONTROLLED + zod-free: the consumer maps its own domain data (a Zod projection) into the
 * {@link CalendarEvent}/{@link CalendarAvailability} shapes and reacts to the selection/open callbacks,
 * so the ONE engine serves the project/channel calendar, handle availability, and session schedules.
 * Token-only + BEM (portable). The island is the single hydration boundary.
 */

// #region Island
export { default as Calendar } from "./islands/Calendar.tsx";
// #endregion

// #region Components (composable parts for bespoke layouts)
export { CalendarHeader } from "./components/CalendarHeader.tsx";
export type { CalendarHeaderProps } from "./components/CalendarHeader.tsx";
export { MiniMonth } from "./components/MiniMonth.tsx";
export type { MiniMonthProps } from "./components/MiniMonth.tsx";
export { AvailabilityPanel } from "./components/AvailabilityPanel.tsx";
export type { AvailabilityPanelProps } from "./components/AvailabilityPanel.tsx";
export { TimeGrid } from "./components/TimeGrid.tsx";
export type { TimeGridProps } from "./components/TimeGrid.tsx";
export { DayTimeline } from "./components/DayTimeline.tsx";
export type { DayTimelineProps } from "./components/DayTimeline.tsx";
export { MonthGrid } from "./components/MonthGrid.tsx";
export type { MonthGridProps } from "./components/MonthGrid.tsx";
export { GridCanvas } from "./components/GridCanvas.tsx";
export type { GridCanvasProps } from "./components/GridCanvas.tsx";
export { GridProbe } from "./components/GridProbe.tsx";
export type { GridProbeProps } from "./components/GridProbe.tsx";
export { accentFor, EventBlock } from "./components/EventBlock.tsx";
export type { EventBlockProps } from "./components/EventBlock.tsx";
export { EventPopoverLayer } from "./components/EventPopoverLayer.tsx";
export type {
	EventPopoverAnchor,
	EventPopoverLayerProps,
	EventPopoverState,
} from "./components/EventPopoverLayer.tsx";
export { NowIndicator } from "./components/NowIndicator.tsx";
export type { NowIndicatorProps } from "./components/NowIndicator.tsx";
export { OverlayScrollbar } from "./components/OverlayScrollbar.tsx";
export type { OverlayScrollbarProps } from "./components/OverlayScrollbar.tsx";
// #endregion

// #region Hooks
export { useCalendarViewport } from "./hooks/useCalendarViewport.ts";
export type {
	CalendarViewport,
	HourRow,
	UseCalendarViewportOptions,
} from "./hooks/useCalendarViewport.ts";
export { gridGeometry, scrollBehaviorFor } from "./hooks/useCalendarViewport.ts";
export { useCanvasViewport } from "./hooks/useCanvasViewport.ts";
export type { CanvasViewport, UseCanvasViewportOptions } from "./hooks/useCanvasViewport.ts";
export { useNowTick } from "./hooks/useNowTick.ts";
export type { NowTick } from "./hooks/useNowTick.ts";
export { useGridCanvas } from "./hooks/useGridCanvas.ts";
export type { GridCanvasApi, UseGridCanvasOptions } from "./hooks/useGridCanvas.ts";
export { forwardWheel, useOverlayScrollbar } from "./hooks/useOverlayScrollbar.ts";
export type {
	OverlayScrollbarApi,
	UseOverlayScrollbarOptions,
} from "./hooks/useOverlayScrollbar.ts";
// #endregion

// #region Core (types · time-matrix · overlap geometry)
export type {
	AvailabilityRule,
	BlackoutDate,
	CalendarAttendee,
	CalendarAvailability,
	CalendarComposeRequest,
	CalendarEvent,
	CalendarEventKind,
	CalendarEventStatus,
	CalendarProps,
	CalendarRange,
	CalendarViewMode,
	EventPopoverActionContext,
	WorkingWindow,
} from "./core/types.ts";
export {
	allDayEvents,
	DEFAULT_MAX_LANES,
	INSTANT_FOLD_PX,
	MAX_NEST_DEPTH,
	MIN_LANE_PX,
	NEST_HEADER_PX,
	NEST_INSET_FRAC,
	NEST_MIN_H,
	packDayEvents,
} from "./core/layout.ts";
export type { DaySlot, PackOptions, PlacementMode } from "./core/layout.ts";
export {
	GAUGE_MAX_RATIO,
	GAUGE_MIN,
	handleLength,
	joystickVelocity,
	LEVER_DEAD_ZONE_PX,
	LEVER_DT_CAP_MS,
	LEVER_MAX_PX,
	LEVER_MAX_THROW_PX,
	LEVER_MAX_V,
	leverBall,
	leverScrollDelta,
	leverThrowPx,
} from "./core/chrome.ts";
export type { LeverState } from "./core/chrome.ts";
export { columnGeometry, paintGrid, parseCssColor, toCanvasColor } from "./core/grid-paint.ts";
export type {
	AccentPaint,
	ColumnGeometry,
	GridBox,
	GridPalette,
	GridRegion,
	GridRule,
	GridScene,
	Rgba,
	SceneEvent,
	SceneFace,
	SceneHourLabel,
	SceneMarker,
	SceneNowLine,
	ScenePalette,
	ScenePresent,
	SceneRecede,
	SceneScrollbar,
	SceneSelection,
	TextStyle,
} from "./core/grid-paint.ts";
export { fitsWhole, fitText, hoverExpansionFor, paintScene } from "./core/scene-paint.ts";
export {
	AVATAR_MAX,
	buildSceneEvents,
	edgeHoldVelocity,
	eventAccessibleName,
	eventRect,
	gaugeGeometry,
	hitTest,
	initialsOf,
	inRect,
	MOMENTUM_DECAY,
	MOMENTUM_MIN_RELEASE_V,
	MOMENTUM_MIN_V,
	presentRect,
	scrollbarRect,
	selectionRange,
	snapMinutes,
	STACK_SHADOW_MAX,
	VELOCITY_WINDOW_MS,
} from "./core/scene-build.ts";
export type {
	BuildSceneEventsOptions,
	HitMetrics,
	Rect,
	SceneColumnSpec,
	SceneHit,
} from "./core/scene-build.ts";
export {
	CALENDAR_ACCENTS,
	CALENDAR_KIND_LABEL,
	CALENDAR_KIND_PATH,
	CALENDAR_KIND_SINGULAR,
	calendarKindLabel,
	effectiveAccent,
	maskLabel,
	onAccentFor,
} from "./core/kinds.ts";
export * as calendarTime from "./core/time.ts";
// #endregion
export { sceneCost } from "./core/scene-paint.ts";
export type { FrameStats } from "./core/scene-paint.ts";
export { resolveAvatar, watchAvatarLoads } from "./core/avatar-cache.ts";
