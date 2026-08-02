/**
 * @projective/ui/calendar — a high-performance, interactive Calendar & Schedule engine (DESIGN_SYSTEM.md
 * §C.1). Inspired by Google Calendar + Monday.com: a two-panel shell (mini-map mini-month + availability
 * summary · main viewport), Day/Week/Month views over a virtualized, centered, infinitely-scrollable
 * time grid, Ctrl+wheel zoom that also transitions across view thresholds, middle-mouse / Ctrl-drag 2D
 * panning, click + drag-to-select event creation, overlap-aware fractional-column layout, privacy-masked
 * external/availability blocks, public-session attendee counters, and a return-to-present pill.
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
export { DayColumn } from "./components/DayColumn.tsx";
export type { DayColumnProps, WorkingWindow } from "./components/DayColumn.tsx";
export { accentFor, EventBlock } from "./components/EventBlock.tsx";
export type { EventBlockProps } from "./components/EventBlock.tsx";
// #endregion

// #region Hooks
export { useCalendarViewport } from "./hooks/useCalendarViewport.ts";
export type {
	CalendarViewport,
	HourRow,
	UseCalendarViewportOptions,
} from "./hooks/useCalendarViewport.ts";
export { gridGeometry } from "./hooks/useCalendarViewport.ts";
export { useNowTick } from "./hooks/useNowTick.ts";
export type { NowTick } from "./hooks/useNowTick.ts";
// #endregion

// #region Core (types · time-matrix · overlap geometry)
export type {
	AvailabilityRule,
	BlackoutDate,
	CalendarAvailability,
	CalendarEvent,
	CalendarEventKind,
	CalendarEventStatus,
	CalendarIntegration,
	CalendarProps,
	CalendarRange,
	CalendarViewMode,
} from "./core/types.ts";
export { allDayEvents, packDayEvents } from "./core/layout.ts";
export type { DaySlot } from "./core/layout.ts";
export * as calendarTime from "./core/time.ts";
// #endregion
