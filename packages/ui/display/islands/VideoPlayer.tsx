import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/video-player.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Icon } from "../../icons/mod.ts";
import { Tooltip } from "../../feedback/islands/Tooltip.tsx";
import {
	clockLabel,
	controlsVisible,
	hasDuration,
	isPlayableSource,
	nextRate,
	pointerRatio,
	progressRatio,
	rateLabel,
	seekValueText,
	stepRatio,
	volumeGlyph,
} from "../core/video.ts";

// #region Props
/** `compact` — Play ⁄ Pause + Mute in one corner. `full` — the transport bar with a scrubber. */
export type VideoPlayerVariant = "compact" | "full";

/** Where the `compact` cluster sits. */
export type VideoPlayerCorner = "top-end" | "bottom-end";

/** Props for {@link VideoPlayer}. */
export interface VideoPlayerProps {
	variant: VideoPlayerVariant;
	/**
	 * The media source. Absent, empty or the stub `"#"` renders the poster with NO controls — a
	 * control whose handler could reach nothing is a defect, not a disabled state.
	 */
	src?: string;
	/** The still drawn before playback (and the only frame a reduced-motion viewer sees). */
	poster?: string;
	/** The video's accessible name — what it SHOWS ("Juno — showreel"), not "video". */
	label: string;
	/**
	 * Start playing on mount. Always silent: browsers refuse an unmuted autoplay, and a video that
	 * starts with sound is the one thing a page must not do to a reader. Ignored under `reduced`.
	 */
	autoplay?: boolean;
	loop?: boolean;
	/** Start silent (default `true` — every video on the platform begins muted). */
	muted?: boolean;
	/** The element's `preload` (default `metadata`). */
	preload?: "none" | "metadata" | "auto";
	/** How the picture fills the box (default `cover`). */
	fit?: "cover" | "contain";
	/**
	 * The viewer asked for no motion (either channel). Nothing auto-plays; the CSS transitions
	 * collapse on their own through the media query and `data-motion`, this only gates the JS half.
	 */
	reduced?: boolean;
	/** `compact` only: which corner the cluster sits in (default `top-end`). */
	corner?: VideoPlayerCorner;
	/** `full` only: the playback rates the speed control cycles (default `[1, 1.5, 2]`). */
	rates?: number[];
	class?: string;
	/**
	 * The `<video>` element, for a host that drives playback itself (a carousel that lets only its
	 * active slide play). The UI mirrors the element's events, so an imperative `play()` or a
	 * `muted = true` written through this ref is reflected without any second channel.
	 */
	videoRef?: (el: HTMLVideoElement | null) => void;
	onPlay?: () => void;
	onPause?: () => void;
	onEnded?: () => void;
	onError?: () => void;
	/**
	 * Layered BETWEEN the picture and the controls: a tile's stretched link and caption, a badge.
	 * A host positions them absolutely against the player's box; the controls stay on top.
	 */
	children?: ComponentChildren;
}
// #endregion

/** After the controls are revealed on a playing video, how long they stay without engagement. */
const AUTO_HIDE_MS = 2500;
/** A press that travelled further than this before release was a drag, not a click. */
const CLICK_SLOP_PX = 8;
const DEFAULT_RATES = [1, 1.5, 2];

type Dragging = "seek" | "volume" | null;

interface PressStart {
	x: number;
	y: number;
	type: string;
}

/**
 * VideoPlayer — the one video surface on the platform, in two sizes.
 *
 * The `<video>` element is the single source of truth. Every control writes to it (`play()`,
 * `muted`, `currentTime`, `volume`, `playbackRate`) and every piece of UI reads back from its
 * events (`play` · `pause` · `ended` · `timeupdate` · `volumechange` · `ratechange` · `error`), so a
 * host that drives the element through {@link VideoPlayerProps.videoRef} — a carousel pausing and
 * rewinding an inactive slide — sees the controls agree without a second channel, and a state the
 * UI could only guess at (autoplay refused by policy, a device that cannot decode the file) is
 * simply what the element reports.
 *
 * # Reveal
 *
 * The overlay controls are hidden at rest and revealed by a mouse pointer over the player, KEYBOARD
 * focus inside it (a pointer click focuses a button too and does not count — `:focus-visible`
 * decides), or — on touch, where there is no hover — a tap on the picture; a second tap hides them
 * again, and a reveal on a PLAYING video withdraws after a short delay unless the reader is engaged
 * with it. The `full` transport also stays while the video is not playing: a paused or finished frame
 * reads as a still, and the bar is what says otherwise. `compact` stays hidden until engaged so a
 * tile that has not been started is media only. The rule is `controlsVisible` in `core/video.ts`.
 *
 * A click on the picture toggles playback with a mouse; on touch a tap while playing toggles the
 * controls and a tap while paused plays (the controls are already showing, so revealing them again
 * would be a tap that does nothing). A press that travelled — a carousel swipe ending on the video —
 * is not a click.
 *
 * # Autoplay and sound
 *
 * Playback starts muted, always. Unmuting is the reader's act, on the Mute control or the volume
 * slider, and a control press never reaches a host's handlers: every control stops propagation, so a
 * tile's stretched link is not followed and a carousel's swipe is not started by a scrub.
 *
 * # Accessibility
 *
 * Every control is a real `<button>` or a `role="slider"` with `aria-value*` state and keyboard
 * operation (arrows step, PageUp ⁄ PageDown page, Home ⁄ End jump), named for what it DOES now (`Play
 * video` ⁄ `Pause video`, `Mute` ⁄ `Unmute`) rather than carrying `aria-pressed` beside a changing
 * label. Icon-only controls carry a portal `Tooltip` (§B.6). The scrubber's spoken value is a time
 * against the duration, never a percentage. The centred play mark is an INDICATOR of the paused state
 * — `aria-hidden`, pointer-transparent — because the bar already holds the accessible control and a
 * second one with the same name would announce twice.
 *
 * # Motion
 *
 * Motion decorates `opacity` and `transform` only. The scrubber's fill and the volume slider's are
 * geometry that ENCODES a fact and are set directly, never transitioned — a fill arriving through a
 * transition in a backgrounded tab would report a position the video is not at.
 */
export function VideoPlayer(props: VideoPlayerProps): JSX.Element {
	const {
		variant,
		src,
		poster,
		label,
		autoplay = false,
		loop = false,
		muted: initialMuted = true,
		preload = "metadata",
		fit = "cover",
		reduced = false,
		corner = "top-end",
		rates = DEFAULT_RATES,
		class: className,
		videoRef,
		children,
	} = props;

	const playable = isPlayableSource(src);
	const el = useRef<HTMLVideoElement | null>(null);
	const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const press = useRef<PressStart | null>(null);

	const playing = useSignal(false);
	const ended = useSignal(false);
	const failed = useSignal(false);
	const muted = useSignal(initialMuted);
	const volume = useSignal(1);
	const current = useSignal(0);
	const duration = useSignal(NaN);
	const rate = useSignal(rates[0] ?? 1);
	const hover = useSignal(false);
	const focusWithin = useSignal(false);
	const tapped = useSignal(false);
	const dragging = useSignal<Dragging>(null);
	/** The ratio under the pointer while the scrubber is held — the fill tracks the finger 1:1. */
	const scrub = useSignal<number | null>(null);

	function setVideo(node: HTMLVideoElement | null): void {
		el.current = node;
		videoRef?.(node);
	}

	// #region Mount — mirror whatever state the element already has, and stop it on the way out.
	// The element is server-rendered WITH its `src`, so the browser starts on it before hydration
	// attaches a single listener: an `autoplay` may already be playing, and — the case that bites —
	// an undecodable or unreachable source has already raised `error`, an event nobody was there to
	// hear. Reading `video.error` here is what keeps a dead video from wearing live controls.
	useEffect(() => {
		const video = el.current;
		if (!video) return;
		muted.value = video.muted;
		volume.value = video.volume;
		rate.value = video.playbackRate;
		if (hasDuration(video.duration)) duration.value = video.duration;
		playing.value = !video.paused && !video.ended;
		ended.value = video.ended;
		if (video.error) onMediaError();
		return () => {
			clearTimeout(hideTimer.current);
			video.pause();
		};
	}, []);
	// #endregion

	// #region Auto-hide
	function scheduleHide(): void {
		clearTimeout(hideTimer.current);
		hideTimer.current = setTimeout(() => {
			if (dragging.value === null) tapped.value = false;
		}, AUTO_HIDE_MS);
	}

	/** Reveal by touch; on a playing video the reveal withdraws on its own. */
	function reveal(): void {
		tapped.value = true;
		if (playing.value) scheduleHide();
	}
	// #endregion

	// #region Transport
	function play(): void {
		const video = el.current;
		if (!video) return;
		if (video.ended) video.currentTime = 0;
		video.play().catch(() => {
			// Refused (policy, a background tab, a decode error): the element stays paused and the
			// controls keep saying so — there is nothing truer to draw.
		});
	}

	function togglePlay(): void {
		const video = el.current;
		if (!video) return;
		if (video.paused || video.ended) play();
		else video.pause();
	}

	function toggleMute(): void {
		const video = el.current;
		if (!video) return;
		const next = !video.muted;
		// Unmuting into silence is a control that does nothing; a zero volume comes back to full.
		if (!next && video.volume === 0) video.volume = 1;
		video.muted = next;
	}

	function setVolume(ratio: number): void {
		const video = el.current;
		if (!video) return;
		video.volume = ratio;
		video.muted = ratio === 0;
	}

	function seek(ratio: number): void {
		const video = el.current;
		if (!video || !hasDuration(video.duration)) return;
		const at = ratio * video.duration;
		video.currentTime = at;
		current.value = at;
	}

	function cycleRate(): void {
		const video = el.current;
		if (!video) return;
		video.playbackRate = nextRate(rates, video.playbackRate);
	}
	// #endregion

	// #region Sliders — pointer capture on the slider, so a drag that leaves the track still lands
	function sliderRatio(e: PointerEvent, target: HTMLElement): number {
		const rect = target.getBoundingClientRect();
		const rtl = getComputedStyle(target).direction === "rtl";
		return pointerRatio(e.clientX, rect.left, rect.width, rtl);
	}

	function onSeekPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		const target = e.currentTarget;
		try {
			target.setPointerCapture(e.pointerId);
		} catch {
			// The pointer is already gone (a synthetic event): seek once and do not hold.
		}
		dragging.value = "seek";
		const ratio = sliderRatio(e, target);
		scrub.value = ratio;
		seek(ratio);
	}

	function onSeekPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (dragging.value !== "seek") return;
		const ratio = sliderRatio(e, e.currentTarget);
		scrub.value = ratio;
		seek(ratio);
	}

	function onSeekPointerUp(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (dragging.value !== "seek") return;
		const target = e.currentTarget;
		if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
		dragging.value = null;
		scrub.value = null;
		if (tapped.value && playing.value) scheduleHide();
	}

	function onSeekKey(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		if (e.key === " " || e.key === "Enter") {
			e.preventDefault();
			togglePlay();
			return;
		}
		const next = stepRatio(progressRatio(current.value, duration.value), e.key);
		if (next === null) return;
		e.preventDefault();
		seek(next);
	}

	function onVolumePointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		const target = e.currentTarget;
		try {
			target.setPointerCapture(e.pointerId);
		} catch {
			// As above: set once, do not hold.
		}
		dragging.value = "volume";
		setVolume(sliderRatio(e, target));
	}

	function onVolumePointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (dragging.value !== "volume") return;
		setVolume(sliderRatio(e, e.currentTarget));
	}

	function onVolumePointerUp(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (dragging.value !== "volume") return;
		const target = e.currentTarget;
		if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
		dragging.value = null;
		if (tapped.value && playing.value) scheduleHide();
	}

	function onVolumeKey(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		const next = stepRatio(effectiveVolume(), e.key);
		if (next === null) return;
		e.preventDefault();
		setVolume(next);
	}

	function effectiveVolume(): number {
		return muted.value ? 0 : volume.value;
	}
	// #endregion

	// #region Surface — a click toggles playback; on touch a tap reveals
	function onSurfacePointerDown(e: JSX.TargetedPointerEvent<HTMLVideoElement>): void {
		press.current = { x: e.clientX, y: e.clientY, type: e.pointerType };
	}

	function onSurfaceClick(e: JSX.TargetedMouseEvent<HTMLVideoElement>): void {
		const start = press.current;
		press.current = null;
		if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP_PX) return;
		if (start?.type === "touch") {
			if (!playing.value) play();
			else if (tapped.value) tapped.value = false;
			else reveal();
			return;
		}
		togglePlay();
	}

	function onPointerEnter(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (e.pointerType !== "touch") hover.value = true;
	}

	function onPointerLeave(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (e.pointerType !== "touch") hover.value = false;
	}

	/**
	 * Focus reveals the controls only when it is KEYBOARD focus. A pointer click also focuses the
	 * button it lands on, and counting that would pin the controls to a tile after every press even
	 * once the pointer has left — so the engine's own `:focus-visible` heuristic decides.
	 */
	function onFocusIn(e: JSX.TargetedFocusEvent<HTMLDivElement>): void {
		const target = e.target as Element | null;
		let visible = true;
		try {
			visible = !target || target.matches(":focus-visible");
		} catch {
			// An engine without `:focus-visible` cannot tell; err toward showing.
		}
		focusWithin.value = visible;
	}

	function onFocusOut(e: JSX.TargetedFocusEvent<HTMLDivElement>): void {
		const next = e.relatedTarget as Node | null;
		if (next && e.currentTarget.contains(next)) return;
		focusWithin.value = false;
	}

	/** A control press is the player's own: it must not follow a host's link or start its swipe. */
	function swallow(e: Event): void {
		e.stopPropagation();
	}
	// #endregion

	// #region Media events — the element reports, the UI mirrors
	function onMediaPlay(): void {
		playing.value = true;
		ended.value = false;
		// A video started by touch has its controls showing; give the reader a beat, then clear.
		if (tapped.value) scheduleHide();
		props.onPlay?.();
	}

	function onMediaPause(): void {
		playing.value = false;
		props.onPause?.();
	}

	function onMediaEnded(): void {
		playing.value = false;
		ended.value = true;
		props.onEnded?.();
	}

	function onMediaError(): void {
		failed.value = true;
		playing.value = false;
		props.onError?.();
	}

	function onMediaTime(e: JSX.TargetedEvent<HTMLVideoElement>): void {
		if (dragging.value === "seek") return;
		current.value = e.currentTarget.currentTime;
	}

	function onMediaDuration(e: JSX.TargetedEvent<HTMLVideoElement>): void {
		duration.value = e.currentTarget.duration;
	}

	function onMediaVolume(e: JSX.TargetedEvent<HTMLVideoElement>): void {
		muted.value = e.currentTarget.muted;
		volume.value = e.currentTarget.volume;
	}

	function onMediaRate(e: JSX.TargetedEvent<HTMLVideoElement>): void {
		rate.value = e.currentTarget.playbackRate;
	}
	// #endregion

	const showControls = playable && !failed.value && controlsVisible({
		variant,
		hover: hover.value,
		focusWithin: focusWithin.value,
		playing: playing.value,
		tapped: tapped.value,
		dragging: dragging.value !== null,
	});
	const state = !playable
		? "unavailable"
		: failed.value
		? "failed"
		: playing.value
		? "playing"
		: ended.value
		? "ended"
		: "paused";
	const isPlaying = playing.value;
	const playLabel = isPlaying ? "Pause video" : ended.value ? "Replay video" : "Play video";
	const playTip = isPlaying ? "Pause" : ended.value ? "Replay" : "Play";
	const playGlyph = isPlaying ? "pause" : ended.value ? "refresh" : "play";
	const muteLabel = muted.value ? "Unmute" : "Mute";
	const volumeNow = effectiveVolume();
	const progress = scrub.value ?? progressRatio(current.value, duration.value);

	const playButton = (
		<Tooltip content={playTip} placement="top">
			<button
				type="button"
				class="ui-video__btn"
				aria-label={playLabel}
				onPointerDown={swallow}
				onClick={(e) => {
					swallow(e);
					togglePlay();
				}}
			>
				<Icon name={playGlyph} size="sm" />
			</button>
		</Tooltip>
	);

	const muteButton = (
		<Tooltip content={muteLabel} placement="top">
			<button
				type="button"
				class="ui-video__btn"
				aria-label={muteLabel}
				onPointerDown={swallow}
				onClick={(e) => {
					swallow(e);
					toggleMute();
				}}
			>
				<Icon name={volumeGlyph(muted.value, volume.value)} size="sm" />
			</button>
		</Tooltip>
	);

	return (
		<div
			class={cx("ui-video", `ui-video--${variant}`, className)}
			style={styleVars({ "--video-fit": fit })}
			data-state={state}
			data-controls={showControls ? "visible" : "hidden"}
			data-dragging={dragging.value ?? undefined}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			onFocusIn={onFocusIn}
			onFocusOut={onFocusOut}
		>
			<video
				ref={setVideo}
				class="ui-video__media"
				src={playable ? src : undefined}
				poster={poster}
				preload={playable ? preload : "none"}
				muted={initialMuted || autoplay}
				autoplay={playable && autoplay && !reduced}
				loop={loop}
				playsInline
				aria-label={label}
				onPointerDown={onSurfacePointerDown}
				onClick={onSurfaceClick}
				onPlay={onMediaPlay}
				onPause={onMediaPause}
				onEnded={onMediaEnded}
				onError={onMediaError}
				onTimeUpdate={onMediaTime}
				onLoadedMetadata={onMediaDuration}
				onDurationChange={onMediaDuration}
				onVolumeChange={onMediaVolume}
				onRateChange={onMediaRate}
			/>

			{children}

			{variant === "full" && playable && !failed.value && !isPlaying && (
				<span class="ui-video__centre" aria-hidden="true">
					<Icon name={ended.value ? "refresh" : "play"} size="md" />
				</span>
			)}

			{playable && !failed.value && variant === "compact" && (
				<div
					class="ui-video__controls ui-video__cluster"
					role="group"
					aria-label="Video controls"
					data-corner={corner}
				>
					{playButton}
					{muteButton}
				</div>
			)}

			{playable && !failed.value && variant === "full" && (
				<div class="ui-video__controls ui-video__bar" role="group" aria-label="Video controls">
					{playButton}
					<div class="ui-video__vol">
						{muteButton}
						<div
							class="ui-video__slider ui-video__slider--volume"
							role="slider"
							tabIndex={0}
							aria-label="Volume"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={Math.round(volumeNow * 100)}
							aria-valuetext={`${Math.round(volumeNow * 100)}%`}
							style={styleVars({ "--video-ratio": volumeNow })}
							onPointerDown={onVolumePointerDown}
							onPointerMove={onVolumePointerMove}
							onPointerUp={onVolumePointerUp}
							onPointerCancel={onVolumePointerUp}
							onKeyDown={onVolumeKey}
							onClick={swallow}
						>
							<span class="ui-video__track">
								<span class="ui-video__fill" />
							</span>
							<span class="ui-video__handle" />
						</div>
					</div>
					<span class="ui-video__time">{clockLabel(current.value, duration.value)}</span>
					<div
						class="ui-video__slider ui-video__slider--seek"
						role="slider"
						tabIndex={0}
						aria-label="Seek"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(progress * 100)}
						aria-valuetext={seekValueText(
							scrub.value !== null && hasDuration(duration.value)
								? scrub.value * duration.value
								: current.value,
							duration.value,
						)}
						style={styleVars({ "--video-ratio": progress })}
						onPointerDown={onSeekPointerDown}
						onPointerMove={onSeekPointerMove}
						onPointerUp={onSeekPointerUp}
						onPointerCancel={onSeekPointerUp}
						onKeyDown={onSeekKey}
						onClick={swallow}
					>
						<span class="ui-video__track">
							<span class="ui-video__fill" />
						</span>
						<span class="ui-video__handle" />
					</div>
					{rates.length > 1 && (
						<Tooltip content="Playback speed" placement="top">
							<button
								type="button"
								class="ui-video__rate"
								aria-label={`Playback speed ${rateLabel(rate.value)}`}
								onPointerDown={swallow}
								onClick={(e) => {
									swallow(e);
									cycleRate();
								}}
							>
								{rateLabel(rate.value)}
							</button>
						</Tooltip>
					)}
				</div>
			)}
		</div>
	);
}
