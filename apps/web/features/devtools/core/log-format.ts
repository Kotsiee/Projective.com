/**
 * log-format.ts — presentation helpers shared by the Log & API Inspector.
 *
 * Maps a {@link LogLevel} to its inspector metadata (label, tonal key for the CSS, severity glyph) and
 * builds the per-entry search haystack + timestamp. Kept out of the component so the row renderer and
 * the filter chips agree on one vocabulary. Dev-only (imported by the build-excluded Dev Tools island).
 */

import type { JSX } from "preact";
import type { LogEntry, LogLevel } from "@projective/types/logging";
import { IconError, IconInfo, IconNetwork, IconWarn } from "../components/dev-glyphs.tsx";

/** Per-level inspector metadata. */
export interface LevelMeta {
	/** Human label for chips/rows. */
	label: string;
	/** `data-tone` value the CSS colours from. */
	tone: LogLevel;
	/** Severity glyph component. */
	Glyph: () => JSX.Element;
}

/** The levels shown as filter chips, in display order. */
export const LEVELS: readonly LogLevel[] = ["info", "warn", "error", "network"];

/** Level → inspector metadata. */
export const LEVEL_META: Record<LogLevel, LevelMeta> = {
	debug: { label: "Debug", tone: "debug", Glyph: IconInfo },
	info: { label: "Info", tone: "info", Glyph: IconInfo },
	warn: { label: "Warn", tone: "warn", Glyph: IconWarn },
	error: { label: "Error", tone: "error", Glyph: IconError },
	network: { label: "Network", tone: "network", Glyph: IconNetwork },
};

/** Two-digit / three-digit zero pad. */
function pad(n: number, width = 2): string {
	return String(n).padStart(width, "0");
}

/** Format an epoch-ms timestamp as `HH:MM:SS.mmm` (local time). */
export function formatTime(at: number): string {
	const d = new Date(at);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${
		pad(d.getMilliseconds(), 3)
	}`;
}

/** The structured payload an entry carries (network fields vs. `data`), for the JSON viewer. */
export function payloadOf(entry: LogEntry): unknown {
	if (entry.level === "network") {
		return {
			method: entry.method,
			url: entry.url,
			status: entry.status,
			durationMs: entry.durationMs,
			request: entry.request,
			response: entry.response,
		};
	}
	return entry.data;
}

/** Whether an entry has an expandable payload. */
export function hasPayload(entry: LogEntry): boolean {
	if (entry.level === "network") return true;
	return entry.data !== undefined && entry.data !== null;
}

/**
 * Build a lowercase search haystack for an entry: its message, network method/url/status, and a
 * serialized copy of any payload — so a keyword search reaches into request/response bodies.
 */
export function searchHaystack(entry: LogEntry): string {
	const parts: string[] = [entry.message, entry.level];
	if (entry.scope) parts.push(entry.scope);
	if (entry.method) parts.push(entry.method);
	if (entry.url) parts.push(entry.url);
	if (entry.status !== undefined) parts.push(String(entry.status));
	const payload = payloadOf(entry);
	if (payload !== undefined && payload !== null) {
		try {
			parts.push(JSON.stringify(payload));
		} catch {
			// non-serializable — skip
		}
	}
	return parts.join(" ").toLowerCase();
}
