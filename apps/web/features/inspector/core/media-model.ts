import type { InspectAsset } from "@projective/types/files";
import type { StageFact } from "./inspector-shell.ts";
import type { KeyStroke } from "./inspector-model.ts";
import type { PeakPlan } from "./media-peaks.ts";

/**
 * media-model — the pure rules of the inspector's video and audio canvases: playback speed steps,
 * seek targets, quarter turns, clock and file-name formatting, the facts each canvas adds to Details,
 * and the keys each canvas honours. DOM-free, so every rule is pinned by a unit test.
 */

// #region Playback speed
/** Slowest playback speed offered. */
export const RATE_MIN = 0.5;
/** Fastest playback speed offered. */
export const RATE_MAX = 2;
/** One speed step. */
export const RATE_STEP = 0.25;

/**
 * The rates the player's own speed button cycles, starting at normal speed so the server-rendered
 * label reads `1×` before the element reports its rate.
 */
export const PLAYER_RATES: readonly number[] = [1, 1.25, 1.5, 2, 0.5, 0.75];

/** Snap a rate onto the {@link RATE_STEP} grid inside `RATE_MIN..RATE_MAX`; non-finite → 1. */
export function clampRate(rate: number): number {
	if (!Number.isFinite(rate)) return 1;
	const snapped = Math.round(rate / RATE_STEP) * RATE_STEP;
	return Math.min(RATE_MAX, Math.max(RATE_MIN, snapped));
}

/** The rate one step slower (`-1`) or faster (`1`) than `rate`. */
export function stepRate(rate: number, direction: -1 | 1): number {
	return clampRate(clampRate(rate) + direction * RATE_STEP);
}

/** `1×` · `1.25×` — the visible and spoken speed. */
export function formatRate(rate: number): string {
	return `${Number(rate.toFixed(2))}×`;
}
// #endregion

// #region Seeking
/** One video frame at the common 30 fps, the step for frame-by-frame review. */
export const FRAME_SECONDS = 1 / 30;
/** The arrow-key nudge. */
export const NUDGE_SECONDS = 5;
/** The J ⁄ L skip. */
export const SKIP_SECONDS = 10;

/** Whether an element duration is a real, finite length. */
export function hasLength(durationS: number): boolean {
	return Number.isFinite(durationS) && durationS > 0;
}

/** Where a seek by `delta` seconds from `current` lands, kept inside the media; `null` if unseekable. */
export function seekTarget(current: number, delta: number, durationS: number): number | null {
	if (!hasLength(durationS)) return null;
	const from = Number.isFinite(current) ? current : 0;
	return Math.min(durationS, Math.max(0, from + delta));
}
// #endregion

// #region Orientation
/** A quarter turn, in degrees clockwise. */
export type QuarterTurn = 0 | 90 | 180 | 270;

const TURNS: readonly QuarterTurn[] = [0, 90, 180, 270];

/** The turn after rotating `turn` a quarter clockwise (`1`) or anticlockwise (`-1`). */
export function nextTurn(turn: QuarterTurn, direction: -1 | 1): QuarterTurn {
	const at = TURNS.indexOf(turn);
	return TURNS[(at + direction + TURNS.length) % TURNS.length];
}

/** Whether the picture lies on its side, so its box swaps width and height. */
export function isSideways(turn: QuarterTurn): boolean {
	return turn === 90 || turn === 270;
}
// #endregion

// #region Formatting
function pad(value: number, width: number): string {
	return String(value).padStart(width, "0");
}

/** `2:05` · `1:02:05` — a length or position to the second. */
export function clockOf(seconds: number): string {
	const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h > 0 ? `${h}:${pad(m, 2)}:${pad(s, 2)}` : `${m}:${pad(s, 2)}`;
}

/** `2:05.033` · `1:02:05.033` — a frame position to the millisecond. */
export function preciseClock(seconds: number): string {
	const totalMs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
	const ms = totalMs % 1000;
	const whole = Math.floor(totalMs / 1000);
	const h = Math.floor(whole / 3600);
	const m = Math.floor((whole % 3600) / 60);
	const s = whole % 60;
	const head = h > 0 ? `${h}:${pad(m, 2)}` : `${m}`;
	return `${head}:${pad(s, 2)}.${pad(ms, 3)}`;
}

/** The file name a saved frame downloads as: `clip-frame-0-12-345.png`. */
export function frameFileName(fileName: string, seconds: number): string {
	const dot = fileName.lastIndexOf(".");
	const printable = Array.from(dot > 0 ? fileName.slice(0, dot) : fileName)
		.filter((ch) => ch.charCodeAt(0) >= 32)
		.join("");
	const stem = printable.replace(/[\\/:*?"<>|]+/g, "-").trim().replace(/^[-.]+|-+$/g, "");
	const at = preciseClock(seconds).replace(/[:.]/g, "-");
	return `${stem.length > 0 ? stem : "frame"}-frame-${at}.png`;
}

/** `Mono` · `Stereo` · `6 channels`. */
export function channelLabel(channels: number): string {
	if (channels === 1) return "Mono";
	if (channels === 2) return "Stereo";
	return `${channels} channels`;
}
// #endregion

// #region Facts
/** What the video element reported once its metadata loaded. */
export interface VideoProbe {
	width: number;
	height: number;
	durationS: number;
}

/**
 * The facts only the playing element can tell: its picture size when the stored one is missing or
 * differs, and its length when none was stored.
 */
export function videoFacts(
	asset: Pick<InspectAsset, "width" | "height" | "durationLabel">,
	probe: VideoProbe,
): StageFact[] {
	const facts: StageFact[] = [];
	if (probe.width > 0 && probe.height > 0) {
		const stored = asset.width === probe.width && asset.height === probe.height;
		if (!stored) facts.push({ label: "Resolution", value: `${probe.width} × ${probe.height} px` });
	}
	if (asset.durationLabel === null && hasLength(probe.durationS)) {
		facts.push({ label: "Duration", value: clockOf(probe.durationS) });
	}
	return facts;
}

/** What the audio canvas learned while drawing its waveform. */
export interface AudioProbe {
	durationS: number | null;
	channels: number | null;
	waveform: PeakPlan | "failed" | "pending";
}

/** The facts the audio canvas adds: length when none was stored, channel layout, waveform source. */
export function audioFacts(
	asset: Pick<InspectAsset, "durationLabel">,
	probe: AudioProbe,
): StageFact[] {
	const facts: StageFact[] = [];
	if (asset.durationLabel === null && probe.durationS !== null && hasLength(probe.durationS)) {
		facts.push({ label: "Duration", value: clockOf(probe.durationS) });
	}
	if (probe.channels !== null && probe.channels > 0) {
		facts.push({ label: "Channels", value: channelLabel(probe.channels) });
	}
	const waveform = waveformNote(probe.waveform);
	if (waveform !== null) facts.push({ label: "Waveform", value: waveform });
	return facts;
}

/** Why the waveform is flat, or `null` when it is drawn (or still being drawn). */
export function waveformNote(waveform: AudioProbe["waveform"]): string | null {
	if (waveform === "too-large") return "Not drawn for a file this long";
	if (waveform === "failed") return "This browser couldn't read the waveform";
	return null;
}
// #endregion

// #region Keys
/** The media canvas a key press is aimed at. */
export type MediaKind = "video" | "audio";

/** A key press as the media canvases read it. */
export interface MediaKeyStroke extends KeyStroke {
	shiftKey: boolean;
}

/** A command a key press asks a media canvas for. */
export type MediaCommand =
	| { type: "toggle-play" }
	| { type: "seek"; delta: number }
	| { type: "frame"; direction: -1 | 1 }
	| { type: "speed"; direction: -1 | 1 }
	| { type: "restart" }
	| { type: "mute" }
	| { type: "rotate"; direction: -1 | 1 }
	| { type: "flip" };

/**
 * The command a key press asks for, or `null`. Modified presses (Ctrl, ⌘, Alt) are never commands;
 * frame steps, rotation and flipping exist only for video.
 */
export function mediaCommand(stroke: MediaKeyStroke, kind: MediaKind): MediaCommand | null {
	if (stroke.ctrlKey || stroke.metaKey || stroke.altKey) return null;
	const video = kind === "video";
	switch (stroke.key) {
		case " ":
		case "k":
		case "K":
			return { type: "toggle-play" };
		case "ArrowLeft":
			return { type: "seek", delta: -NUDGE_SECONDS };
		case "ArrowRight":
			return { type: "seek", delta: NUDGE_SECONDS };
		case "j":
		case "J":
			return { type: "seek", delta: -SKIP_SECONDS };
		case "l":
		case "L":
			return { type: "seek", delta: SKIP_SECONDS };
		case "Home":
		case "0":
			return { type: "restart" };
		case ",":
			return video ? { type: "frame", direction: -1 } : null;
		case ".":
			return video ? { type: "frame", direction: 1 } : null;
		case "<":
			return { type: "speed", direction: -1 };
		case ">":
			return { type: "speed", direction: 1 };
		case "m":
		case "M":
			return { type: "mute" };
		case "r":
		case "R":
			return video ? { type: "rotate", direction: stroke.shiftKey ? -1 : 1 } : null;
		case "h":
		case "H":
			return video ? { type: "flip" } : null;
		default:
			return null;
	}
}

const PLAYBACK_SHORTCUTS: readonly { keys: string[]; label: string }[] = [
	{ keys: ["Space"], label: "Play or pause" },
	{ keys: ["K"], label: "Play or pause" },
	{ keys: ["←"], label: `Back ${NUDGE_SECONDS} seconds` },
	{ keys: ["→"], label: `Forward ${NUDGE_SECONDS} seconds` },
	{ keys: ["J"], label: `Back ${SKIP_SECONDS} seconds` },
	{ keys: ["L"], label: `Forward ${SKIP_SECONDS} seconds` },
	{ keys: ["Home"], label: "Back to the start" },
	{ keys: ["<"], label: "Slower" },
	{ keys: [">"], label: "Faster" },
	{ keys: ["M"], label: "Mute or unmute" },
];

/** The keys the video canvas honours, as the panel lists them. */
export const VIDEO_SHORTCUTS: readonly { keys: string[]; label: string }[] = [
	...PLAYBACK_SHORTCUTS,
	{ keys: [","], label: "Previous frame" },
	{ keys: ["."], label: "Next frame" },
	{ keys: ["R"], label: "Rotate clockwise" },
	{ keys: ["Shift", "R"], label: "Rotate anticlockwise" },
	{ keys: ["H"], label: "Flip horizontally" },
];

/** The keys the audio canvas honours, as the panel lists them. */
export const AUDIO_SHORTCUTS: readonly { keys: string[]; label: string }[] = PLAYBACK_SHORTCUTS;
// #endregion
