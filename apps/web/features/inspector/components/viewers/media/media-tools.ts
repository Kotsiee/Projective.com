import { type Signal, signal } from "@preact/signals";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import {
	clampRate,
	clockOf,
	formatRate,
	FRAME_SECONDS,
	frameFileName,
	type MediaCommand,
	nextTurn,
	preciseClock,
	type QuarterTurn,
	seekTarget,
	stepRate,
} from "../../../core/media-model.ts";

/**
 * media-tools — the signal state and actions the video and audio canvases share between their Stage
 * and their panel Controls. Creating them touches no DOM (they run during SSR); every action reads
 * the media element the Stage registered and does nothing until there is one.
 */

// #region Shared playback
/** Playback state common to the video and audio canvases. */
export interface PlaybackTools {
	/** The media element, registered by the Stage once mounted. */
	readonly element: Signal<HTMLMediaElement | null>;
	/** Playback speed, mirrored from the element's `ratechange`. */
	readonly speed: Signal<number>;
	readonly loop: Signal<boolean>;
	togglePlay(): void;
	seekBy(deltaS: number): void;
	restart(): void;
	toggleMute(): void;
	/** Run a key command; returns whether the canvas handled it. */
	run(command: MediaCommand): boolean;
}

function createPlayback(
	shell: InspectorShell,
	element: Signal<HTMLMediaElement | null>,
	togglePlay: () => void,
): PlaybackTools {
	const speed = signal(1);
	const loop = signal(false);

	const seekBy = (deltaS: number): void => {
		const el = element.peek();
		if (!el) return;
		const at = seekTarget(el.currentTime, deltaS, el.duration);
		if (at === null) return;
		el.currentTime = at;
		shell.announce(clockOf(at));
	};

	const restart = (): void => {
		const el = element.peek();
		if (!el) return;
		el.currentTime = 0;
		shell.announce("Back to the start");
	};

	const toggleMute = (): void => {
		const el = element.peek();
		if (!el) return;
		const next = !el.muted;
		if (!next && el.volume === 0) el.volume = 1;
		el.muted = next;
		shell.announce(next ? "Muted" : "Sound on");
	};

	const changeSpeed = (direction: -1 | 1): void => {
		const next = stepRate(speed.peek(), direction);
		speed.value = next;
		shell.announce(`Speed ${formatRate(next)}`);
	};

	return {
		element,
		speed,
		loop,
		togglePlay,
		seekBy,
		restart,
		toggleMute,
		run(command: MediaCommand): boolean {
			switch (command.type) {
				case "toggle-play":
					togglePlay();
					return true;
				case "seek":
					seekBy(command.delta);
					return true;
				case "restart":
					restart();
					return true;
				case "speed":
					changeSpeed(command.direction);
					return true;
				case "mute":
					toggleMute();
					return true;
				default:
					return false;
			}
		},
	};
}

/** Write a speed onto an element when it differs, snapped onto the offered grid. */
export function applySpeed(el: HTMLMediaElement, speed: number): void {
	const rate = clampRate(speed);
	if (el.playbackRate !== rate) el.playbackRate = rate;
}
// #endregion

// #region Video
/** How the picture fills the stage. */
export type VideoFit = "contain" | "cover";

/** The video canvas's state and actions. */
export interface VideoTools extends PlaybackTools {
	readonly video: Signal<HTMLVideoElement | null>;
	readonly fit: Signal<VideoFit>;
	readonly turn: Signal<QuarterTurn>;
	readonly flipped: Signal<boolean>;
	/** Whether this video is in picture-in-picture now. */
	readonly pip: Signal<boolean>;
	readonly pipSupported: Signal<boolean>;
	/** Whether a decoded frame exists to save. */
	readonly hasFrame: Signal<boolean>;
	stepFrame(direction: -1 | 1): void;
	rotate(direction: -1 | 1): void;
	toggleFlip(): void;
	togglePip(): void;
	saveFrame(): void;
}

/** Create the video canvas's tools. SSR-safe. */
export function createVideoTools(shell: InspectorShell): VideoTools {
	const video = signal<HTMLVideoElement | null>(null);
	const element = signal<HTMLMediaElement | null>(null);
	const fit = signal<VideoFit>("contain");
	const turn = signal<QuarterTurn>(0);
	const flipped = signal(false);
	const pip = signal(false);
	const pipSupported = signal(false);
	const hasFrame = signal(false);

	const togglePlay = (): void => {
		const el = video.peek();
		if (!el) return;
		if (el.paused || el.ended) {
			if (el.ended) el.currentTime = 0;
			el.play().catch(() => shell.announce("The browser didn't allow playback to start."));
		} else {
			el.pause();
		}
	};

	const playback = createPlayback(shell, element, togglePlay);

	const stepFrame = (direction: -1 | 1): void => {
		const el = video.peek();
		if (!el) return;
		if (!el.paused) el.pause();
		const at = seekTarget(el.currentTime, direction * FRAME_SECONDS, el.duration);
		if (at === null) return;
		el.currentTime = at;
		shell.announce(`Frame at ${preciseClock(at)}`);
	};

	const rotate = (direction: -1 | 1): void => {
		turn.value = nextTurn(turn.peek(), direction);
		shell.announce(`Rotated to ${turn.peek()}°`);
	};

	const toggleFlip = (): void => {
		flipped.value = !flipped.peek();
		shell.announce(flipped.peek() ? "Flipped horizontally" : "Flip removed");
	};

	const togglePip = (): void => {
		const el = video.peek();
		if (!el || !pipSupported.peek()) return;
		const doc = el.ownerDocument;
		const change = doc.pictureInPictureElement === el
			? doc.exitPictureInPicture()
			: el.requestPictureInPicture().then(() => undefined);
		change.catch(() => shell.announce("Picture in picture isn't available right now."));
	};

	const saveFrame = (): void => {
		const el = video.peek();
		if (!el || el.videoWidth === 0 || el.videoHeight === 0) return;
		const doc = el.ownerDocument;
		const canvas = doc.createElement("canvas");
		canvas.width = el.videoWidth;
		canvas.height = el.videoHeight;
		const context = canvas.getContext("2d");
		if (!context) {
			shell.announce("Couldn't save this frame.");
			return;
		}
		const at = el.currentTime;
		try {
			context.drawImage(el, 0, 0);
			canvas.toBlob((blob) => {
				if (!blob) {
					shell.announce("Couldn't save this frame.");
					return;
				}
				const url = URL.createObjectURL(blob);
				const link = doc.createElement("a");
				link.href = url;
				link.download = frameFileName(shell.asset.name, at);
				link.hidden = true;
				doc.body.append(link);
				link.click();
				link.remove();
				setTimeout(() => URL.revokeObjectURL(url), 1000);
				shell.announce(`Saved the frame at ${preciseClock(at)}`);
			}, "image/png");
		} catch {
			shell.announce("This frame can't be saved.");
		}
	};

	const run = (command: MediaCommand): boolean => {
		switch (command.type) {
			case "frame":
				stepFrame(command.direction);
				return true;
			case "rotate":
				rotate(command.direction);
				return true;
			case "flip":
				toggleFlip();
				return true;
			default:
				return playback.run(command);
		}
	};

	return {
		...playback,
		run,
		video,
		fit,
		turn,
		flipped,
		pip,
		pipSupported,
		hasFrame,
		stepFrame,
		rotate,
		toggleFlip,
		togglePip,
		saveFrame,
	};
}
// #endregion

// #region Audio
/** The audio canvas's state and actions. */
export interface AudioTools extends PlaybackTools {
	/** The visualizer's root, whose own toggle owns the playing state. */
	readonly player: Signal<HTMLElement | null>;
	/** Volume, 0–100. */
	readonly volume: Signal<number>;
	readonly muted: Signal<boolean>;
}

/** Create the audio canvas's tools. SSR-safe. */
export function createAudioTools(shell: InspectorShell): AudioTools {
	const element = signal<HTMLMediaElement | null>(null);
	const player = signal<HTMLElement | null>(null);

	const togglePlay = (): void => {
		const toggle = player.peek()?.querySelector<HTMLButtonElement>(".ui-audioviz__toggle");
		toggle?.click();
	};

	const playback = createPlayback(shell, element, togglePlay);
	return { ...playback, player, volume: signal(100), muted: signal(false) };
}
// #endregion
