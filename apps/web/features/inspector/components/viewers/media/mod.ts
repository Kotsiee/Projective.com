import { AUDIO_SHORTCUTS, VIDEO_SHORTCUTS } from "../../../core/media-model.ts";
import { defineViewer } from "../viewer.ts";
import {
	type AudioTools,
	createAudioTools,
	createVideoTools,
	type VideoTools,
} from "./media-tools.ts";
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
});

/** The audio canvas: the waveform player with skipping, speed, loop, volume and mute. */
export const audioViewer = defineViewer<AudioTools>({
	createTools: createAudioTools,
	Stage: AudioStage,
	Controls: AudioControls,
	shortcuts: AUDIO_SHORTCUTS,
});

export type { AudioTools, VideoFit, VideoTools } from "./media-tools.ts";
