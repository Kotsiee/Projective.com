import type { JSX } from "preact";
import { AudioVisualizer } from "@projective/ui/display";
import type { MessageAudio } from "../types/projects-types.ts";

/**
 * MessageAudioPlayer — playback surface for an explicit voice message (task §4). A thin adapter over
 * the shared {@link AudioVisualizer} (`@projective/ui/display`): it forwards the memo's peaks/duration
 * and lets the surrounding `.msg-bubble` tint the waveform through the inherited `--wave-played` /
 * `--wave-rest` custom properties (played = accent, rest = muted; flipped for an "own" bubble).
 *
 * Playback is real when the fixture carries an audio URL and simulated otherwise — the visualizer
 * owns that transport, so this component is presentation-only.
 */
export interface MessageAudioPlayerProps {
	audio: MessageAudio;
}

export function MessageAudioPlayer({ audio }: MessageAudioPlayerProps): JSX.Element {
	return (
		<AudioVisualizer
			src={audio.url}
			peaks={audio.peaks}
			durationMs={audio.durationMs}
			durationLabel={audio.durationLabel}
			showSpeed
			aria-label="Voice message"
		/>
	);
}
