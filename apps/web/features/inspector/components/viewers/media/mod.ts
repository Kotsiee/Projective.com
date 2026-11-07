import type { MenuItem } from "@projective/ui/navigation";
import { AUDIO_SHORTCUTS, formatRate, VIDEO_SHORTCUTS } from "../../../core/media-model.ts";
import { defineViewer } from "../viewer.ts";
import {
	type AudioTools,
	createAudioTools,
	createVideoTools,
	type PlaybackTools,
	type VideoTools,
} from "./media-tools.ts";

/** The speeds the canvas menu offers (Decision #400); the panel's control reaches the rest. */
const MENU_RATES: readonly number[] = [1, 1.5, 2];

/** Play or pause, mute or unmute, and a speed: each labelled for what it will do now. */
function playbackRows(tools: PlaybackTools): MenuItem[] {
	const el = tools.element.peek();
	const playing = el !== null && !el.paused;
	const muted = el?.muted === true;
	return [
		{
			key: "play",
			label: playing ? "Pause" : "Play",
			icon: playing ? "pause" : "play",
			shortcut: "Space",
			command: () => tools.togglePlay(),
		},
		{
			key: "mute",
			label: muted ? "Unmute" : "Mute",
			icon: muted ? "volume" : "volume-off",
			shortcut: "M",
			command: () => tools.toggleMute(),
		},
		{
			key: "speed",
			label: "Speed",
			icon: "clock",
			items: MENU_RATES.map((rate) => ({
				key: `speed-${rate}`,
				label: formatRate(rate),
				icon: tools.speed.peek() === rate ? "check" : undefined,
				command: () => (tools.speed.value = rate),
			})),
		},
	];
}
import { AudioControls } from "./AudioControls.tsx";
import { AudioStage } from "./AudioStage.tsx";
import { VideoControls } from "./VideoControls.tsx";
import { VideoStage } from "./VideoStage.tsx";

/** The video canvas: full transport, frame stepping, speed, loop, fit, turn and flip, PiP, capture. */
export const videoViewer = defineViewer<VideoTools>({
	createTools: createVideoTools,
	Stage: VideoStage,
	Controls: VideoControls,
	shortcuts: VIDEO_SHORTCUTS,
	menu: ({ tools }) => [
		...playbackRows(tools),
		...(tools.pipSupported.peek()
			? [{
				key: "pip",
				label: tools.pip.peek() ? "Exit picture in picture" : "Picture in picture",
				icon: "external-link",
				command: () => tools.togglePip(),
			}]
			: []),
	],
});

/** The audio canvas: the waveform player with skipping, speed, loop, volume and mute. */
export const audioViewer = defineViewer<AudioTools>({
	createTools: createAudioTools,
	Stage: AudioStage,
	Controls: AudioControls,
	shortcuts: AUDIO_SHORTCUTS,
	menu: ({ tools }) => playbackRows(tools),
});

export type { AudioTools, VideoFit, VideoTools } from "./media-tools.ts";
