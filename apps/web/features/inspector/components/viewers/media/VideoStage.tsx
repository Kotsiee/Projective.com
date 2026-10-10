import type { JSX } from "preact";
import { useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { VideoPlayer } from "@projective/ui/display/video";
import { isSideways, PLAYER_RATES, videoFacts } from "../../../core/media-model.ts";
import type { ViewerProps } from "../viewer.ts";
import { applySpeed, type VideoTools } from "./media-tools.ts";
import { useStageKeys } from "./use-stage-keys.ts";

const READY_FALLBACK_MS = 4000;
const RATES = [...PLAYER_RATES];

/**
 * The video canvas: the platform's one video surface (`VideoPlayer`, full transport) letterboxed in
 * the stage, turned and flipped by the panel, with the media keys bound to the stage.
 */
export function VideoStage({ shell, tools }: ViewerProps<VideoTools>): JSX.Element {
	const { asset } = shell;
	const root = useRef<HTMLDivElement>(null);
	useStageKeys(root, tools, "video");

	const register = (el: HTMLVideoElement | null): void => {
		if (!el) return;
		tools.video.value = el;
		tools.element.value = el;
	};

	useEffect(() => {
		const video = tools.video.peek();
		if (!video) return;
		const doc = video.ownerDocument;
		tools.pipSupported.value = doc.pictureInPictureEnabled === true &&
			typeof video.requestPictureInPicture === "function" && !video.disablePictureInPicture;

		const onMetadata = () => {
			shell.facts.value = videoFacts(asset, {
				width: video.videoWidth,
				height: video.videoHeight,
				durationS: video.duration,
			});
			if (shell.status.peek() === "loading") shell.status.value = "ready";
		};
		const onFrame = () => (tools.hasFrame.value = video.videoWidth > 0 && video.readyState >= 2);
		const onRate = () => (tools.speed.value = video.playbackRate);
		const onEnterPip = () => (tools.pip.value = true);
		const onLeavePip = () => (tools.pip.value = false);

		video.addEventListener("loadedmetadata", onMetadata);
		video.addEventListener("durationchange", onMetadata);
		video.addEventListener("loadeddata", onFrame);
		video.addEventListener("seeked", onFrame);
		video.addEventListener("playing", onFrame);
		video.addEventListener("ratechange", onRate);
		video.addEventListener("enterpictureinpicture", onEnterPip);
		video.addEventListener("leavepictureinpicture", onLeavePip);
		if (video.readyState >= 1) onMetadata();
		onFrame();
		onRate();

		const fallback = setTimeout(() => {
			if (shell.status.peek() === "loading") shell.status.value = "ready";
		}, READY_FALLBACK_MS);

		return () => {
			clearTimeout(fallback);
			video.removeEventListener("loadedmetadata", onMetadata);
			video.removeEventListener("durationchange", onMetadata);
			video.removeEventListener("loadeddata", onFrame);
			video.removeEventListener("seeked", onFrame);
			video.removeEventListener("playing", onFrame);
			video.removeEventListener("ratechange", onRate);
			video.removeEventListener("enterpictureinpicture", onEnterPip);
			video.removeEventListener("leavepictureinpicture", onLeavePip);
			if (doc.pictureInPictureElement === video) {
				doc.exitPictureInPicture().catch(() => (tools.pip.value = false));
			}
			tools.video.value = null;
			tools.element.value = null;
			tools.pip.value = false;
			tools.hasFrame.value = false;
		};
	}, [shell, tools, asset]);

	useSignalEffect(() => {
		const el = tools.element.value;
		const speed = tools.speed.value;
		if (el) applySpeed(el, speed);
	});

	const turn = tools.turn.value;
	return (
		<div
			ref={root}
			class="ins-media ins-media--video"
			data-sideways={isSideways(turn) ? "true" : undefined}
			style={{
				"--ins-media-turn": `${turn}deg`,
				"--ins-media-flip": tools.flipped.value ? "-1" : "1",
			}}
		>
			<VideoPlayer
				variant="full"
				class="ins-media__player"
				src={asset.src}
				label={asset.name}
				muted={false}
				preload="metadata"
				fit={tools.fit.value}
				loop={tools.loop.value}
				rates={RATES}
				videoRef={register}
				onError={() =>
					shell.fail(
						"This video can't be played in this browser. Download it to watch it in another app.",
					)}
			/>
		</div>
	);
}
