import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { AudioVisualizer } from "@projective/ui/display";
import { drawWaveform } from "@ui/display/core/audio.ts";
import { decodeAudio } from "../../../core/media-decode.ts";
import { audioFacts, type AudioProbe, waveformNote } from "../../../core/media-model.ts";
import { peakPlan } from "../../../core/media-peaks.ts";
import type { ViewerProps } from "../viewer.ts";
import { applySpeed, type AudioTools } from "./media-tools.ts";
import { useStageKeys } from "./use-stage-keys.ts";

function cssToken(style: CSSStyleDeclaration, ...names: string[]): string | null {
	for (const name of names) {
		const value = style.getPropertyValue(name).trim();
		if (value.length > 0) return value;
	}
	return null;
}

/**
 * Repaint the visualizer's waveform at its new size. The visualizer paints only when its progress
 * moves, so a stage resized while paused would otherwise show stretched bars.
 */
function repaintWave(root: HTMLElement, peaks: number[], audio: HTMLMediaElement | null): void {
	const canvas = root.querySelector<HTMLCanvasElement>(".ui-audioviz__wave");
	if (!canvas) return;
	const style = getComputedStyle(canvas);
	const playedColor = cssToken(style, "--wave-played", "--primary");
	const restColor = cssToken(style, "--wave-rest", "--text-secondary");
	if (playedColor === null || restColor === null) return;
	const length = audio?.duration ?? NaN;
	const progress = audio && Number.isFinite(length) && length > 0 ? audio.currentTime / length : 0;
	drawWaveform(canvas, { peaks, progress, playedColor, restColor });
}

/**
 * The audio canvas: the platform's audio player (`AudioVisualizer`) drawn large in the stage. The
 * waveform is the one stored at upload, or decoded here within a memory budget, or flat with a note.
 */
export function AudioStage({ shell, tools }: ViewerProps<AudioTools>): JSX.Element {
	const { asset } = shell;
	const root = useRef<HTMLDivElement>(null);
	useStageKeys(root, tools, "audio");

	const plan = peakPlan({
		peaks: asset.peaks,
		sizeBytes: asset.sizeBytes,
		durationMs: asset.durationMs,
		ext: asset.ext,
	});
	const peaks = useSignal<number[] | null>(plan === "decode" ? null : asset.peaks ?? []);
	const probe = useSignal<AudioProbe>({
		durationS: asset.durationMs === null ? null : asset.durationMs / 1000,
		channels: null,
		waveform: plan === "decode" ? "pending" : plan,
	});

	// #region Waveform
	useEffect(() => {
		if (plan !== "decode") return;
		const abort = new AbortController();
		decodeAudio(asset.src, abort.signal).then(
			(decoded) => {
				if (abort.signal.aborted) return;
				peaks.value = decoded.peaks;
				probe.value = {
					durationS: probe.peek().durationS ??
						(decoded.durationMs === null ? null : decoded.durationMs / 1000),
					channels: decoded.channels,
					waveform: decoded.peaks.length > 0 ? "decode" : "failed",
				};
			},
			() => {
				if (abort.signal.aborted) return;
				peaks.value = [];
				probe.value = { ...probe.peek(), waveform: "failed" };
			},
		);
		return () => abort.abort();
	}, [asset, plan]);

	useSignalEffect(() => {
		shell.facts.value = audioFacts(asset, probe.value);
	});
	// #endregion

	const drawn = peaks.value;
	const mounted = drawn !== null;

	// #region Element
	useEffect(() => {
		if (!mounted) return;
		const host = root.current;
		const player = host?.querySelector<HTMLElement>(".ui-audioviz") ?? null;
		const audio = host?.querySelector("audio") ?? null;
		if (!host || !audio) {
			shell.fail("This audio can't be played here. Download it to listen in another app.");
			return;
		}
		tools.player.value = player;
		tools.element.value = audio;

		const onError = () =>
			shell.fail(
				"This audio can't be played in this browser. Download it to listen in another app.",
			);
		const onMetadata = () => {
			if (
				probe.peek().durationS === null && Number.isFinite(audio.duration) && audio.duration > 0
			) {
				probe.value = { ...probe.peek(), durationS: audio.duration };
			}
		};
		const onVolume = () => {
			tools.muted.value = audio.muted;
			tools.volume.value = Math.round(audio.volume * 100);
		};
		const onRate = () => (tools.speed.value = audio.playbackRate);
		audio.addEventListener("error", onError);
		audio.addEventListener("loadedmetadata", onMetadata);
		audio.addEventListener("volumechange", onVolume);
		audio.addEventListener("ratechange", onRate);
		if (audio.error) onError();
		if (audio.readyState >= 1) onMetadata();

		const resize = new ResizeObserver(() => {
			const current = peaks.peek();
			if (current) repaintWave(host, current, audio);
		});
		resize.observe(host);

		if (shell.status.peek() === "loading") shell.status.value = "ready";

		return () => {
			resize.disconnect();
			audio.removeEventListener("error", onError);
			audio.removeEventListener("loadedmetadata", onMetadata);
			audio.removeEventListener("volumechange", onVolume);
			audio.removeEventListener("ratechange", onRate);
			audio.pause();
			tools.player.value = null;
			tools.element.value = null;
		};
	}, [mounted, shell, tools]);

	useSignalEffect(() => {
		const el = tools.element.value;
		if (!el) return;
		applySpeed(el, tools.speed.value);
		el.loop = tools.loop.value;
		const volume = Math.min(1, Math.max(0, tools.volume.value / 100));
		if (el.volume !== volume) el.volume = volume;
		if (el.muted !== tools.muted.value) el.muted = tools.muted.value;
	});
	// #endregion

	const durationS = probe.value.durationS;
	const note = waveformNote(probe.value.waveform);
	return (
		<div ref={root} class="ins-media ins-media--audio">
			{drawn !== null
				? (
					<div class="ins-media__audio">
						<AudioVisualizer
							class="ins-media__wave"
							peaks={drawn}
							durationMs={durationS === null ? 0 : Math.round(durationS * 1000)}
							durationLabel={asset.durationLabel ?? undefined}
							src={asset.src}
							variant="player"
							rates={[tools.speed.value]}
							aria-label={`${asset.name} player`}
						/>
						{note ? <p class="ins-media__note">{note}</p> : null}
					</div>
				)
				: null}
		</div>
	);
}
