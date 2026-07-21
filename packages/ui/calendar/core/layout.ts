/**
 * @projective/ui/calendar — overlap geometry. Given the timed events of a single day, compute each
 * event's COLUMN index + the column count of its overlap cluster, so concurrent events render
 * side-by-side (fractional widths) instead of obscuring one another (§Part 1.4 Overlap Handling).
 * Pure and unit-free: it works in epoch ms only, so the pixel/timezone mapping stays in the view.
 */

import type { CalendarEvent } from "./types.ts";

/** A timed event with its resolved column geometry within a day. */
export interface DaySlot {
	event: CalendarEvent;
	/** 0-based column index inside the overlap cluster. */
	col: number;
	/** Total columns the cluster resolved to. */
	cols: number;
	/** How many columns wide this event may render (>= 1) — it expands into free trailing columns. */
	span: number;
}

interface Placed {
	event: CalendarEvent;
	col: number;
}

/** Whether column `target` is free for the whole span of `placed` within `cluster`. */
function columnFree(cluster: Placed[], placed: Placed, target: number): boolean {
	for (const other of cluster) {
		if (other === placed || other.col !== target) continue;
		if (other.event.start < placed.event.end && other.event.end > placed.event.start) return false;
	}
	return true;
}

/**
 * Assign column geometry to the timed events of one day. Events are grouped into transitively
 * overlapping clusters; within a cluster each event takes the first column free at its start; the
 * cluster's column count is the width divisor; finally each event expands into any free trailing
 * columns so isolated events reclaim space.
 */
export function packDayEvents(events: CalendarEvent[]): DaySlot[] {
	const timed = events
		.filter((e) => !e.allDay && e.end > e.start)
		.slice()
		.sort((a, b) => a.start - b.start || b.end - a.end);

	const out: DaySlot[] = [];
	let cluster: Placed[] = [];
	let columnsEnd: number[] = [];
	let clusterEnd = -Infinity;

	const flush = () => {
		if (!cluster.length) return;
		const cols = cluster.reduce((m, c) => Math.max(m, c.col + 1), 0);
		for (const placed of cluster) {
			let span = 1;
			while (placed.col + span < cols && columnFree(cluster, placed, placed.col + span)) span++;
			out.push({ event: placed.event, col: placed.col, cols, span });
		}
		cluster = [];
		columnsEnd = [];
		clusterEnd = -Infinity;
	};

	for (const ev of timed) {
		if (cluster.length && ev.start >= clusterEnd) flush();
		let col = 0;
		while (col < columnsEnd.length && columnsEnd[col] > ev.start) col++;
		columnsEnd[col] = ev.end;
		cluster.push({ event: ev, col });
		clusterEnd = Math.max(clusterEnd, ev.end);
	}
	flush();
	return out;
}

/** The all-day / multi-day events for a day, stacked (no column packing needed). */
export function allDayEvents(events: CalendarEvent[]): CalendarEvent[] {
	return events.filter((e) => e.allDay).sort((a, b) => a.start - b.start || a.end - b.end);
}
