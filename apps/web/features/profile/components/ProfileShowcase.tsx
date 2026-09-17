import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { ProgressiveImage } from "@projective/ui/display/image";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	advancePlan,
	dampedDrag,
	resolveSwipe,
	rovingFocusFor,
	slidesOf,
	wrapIndex,
} from "../core/showcase-model.ts";
import type {
	ProfileShowcase as ProfileShowcaseSet,
	ProfileShowcaseItem,
} from "../types/profile-types.ts";

/**
 * ProfileShowcase — the hero's media carousel: the primary still, then up to four slides of stills
 * or full-length videos, on one raised 16:10 frame with a centred pagination rail along its bottom
 * edge (`‹` · dots that swell into a pill for the active slide · `›`).
 *
 * # Playback
 *
 * The carousel advances on its own. A still dwells and moves on; a video PLAYS THROUGH — the
 * advance timer is not armed while it plays — then holds its last frame for the same dwell, so a
 * viewer can press Replay before it moves on. The rule itself is `advancePlan` in
 * `showcase-model.ts`, so the four cases are pinned by test rather than by watching a timer. Two
 * things hold it: the viewer's pointer over the frame or focus inside it (a slide being read is not
 * taken away — the WCAG 2.2.2 pause, reached by hovering or by tabbing to the rail), and either
 * reduced-motion channel, under which nothing moves on its own — the video slide then offers a Play
 * control instead of starting itself. Only the ACTIVE video ever plays; leaving a video slide pauses
 * and rewinds it, so returning starts it fresh.
 *
 * # Navigation
 *
 * The rail is a tablist: ArrowLeft / ArrowRight (Home / End) move the roving focus between the
 * dots WITHOUT selecting — the brief's manual-activation model — and Enter or Space (or a click)
 * selects. The chevrons step. On a pointer, a horizontal drag on the frame follows the finger and
 * commits on distance or a flick (`resolveSwipe`), damped past either end; `touch-action: pan-y`
 * leaves vertical scrolling to the browser. Inactive slides are `inert` so their controls cannot
 * be reached behind the clip.
 *
 * The track moves on `transform` only, in container-query units (`100cqi` of the viewport), so no
 * script measures a width to place a slide; the writing direction flips the sign through
 * `--pf-dir`, and a pointer drag adds its physical offset on top. Reduced motion drops the slide
 * transition so a change lands instantly.
 */
export interface ProfileShowcaseProps {
	showcase: ProfileShowcaseSet;
	/** The entity's name — the accessible name of the region. */
	name: string;
	/** Whether the viewer asked for no motion (either channel). Nothing auto-plays or auto-advances. */
	reduced: boolean;
}

/** How long a pointer may be down before a release no longer counts as a flick, in ms. */
const FLICK_WINDOW_MS = 300;
/** Vertical travel beyond which a touch is a scroll, not a swipe. */
const SCROLL_LOCK_PX = 10;

interface DragStart {
	x: number;
	y: number;
	t: number;
	width: number;
	rtl: boolean;
	pointerId: number;
}

export function ProfileShowcase({ showcase, name, reduced }: ProfileShowcaseProps): JSX.Element {
	const slides = slidesOf(showcase);
	const count = slides.length;
	const active = useSignal(0);
	const focused = useSignal(0);
	const hovering = useSignal(false);
	const focusWithin = useSignal(false);
	const videoEnded = useSignal(false);
	const videoPlaying = useSignal(false);
	const drag = useSignal<number | null>(null);
	const status = useSignal("");
	const viewport = useRef<HTMLDivElement>(null);
	const dots = useRef<(HTMLButtonElement | null)[]>([]);
	const videos = useRef<(HTMLVideoElement | null)[]>([]);
	const start = useRef<DragStart | null>(null);
	const lastActive = useRef(0);

	const index = wrapIndex(active.value, count);
	const slide = slides[index];
	const paused = hovering.value || focusWithin.value;

	function go(next: number, announce = true): void {
		const target = wrapIndex(next, count);
		if (target === index) return;
		active.value = target;
		focused.value = target;
		videoEnded.value = false;
		if (announce) status.value = `Slide ${target + 1} of ${count}`;
	}

	// #region Video lifecycle — only the active video plays, and it starts fresh each time
	useEffect(() => {
		const changed = lastActive.current !== index;
		lastActive.current = index;
		videos.current.forEach((video, i) => {
			if (!video) return;
			if (i !== index) {
				video.pause();
				if (video.currentTime !== 0) video.currentTime = 0;
				return;
			}
			if (reduced) {
				video.pause();
				return;
			}
			if (changed || video.paused) {
				if (changed) video.currentTime = 0;
				video.play().catch(() => {
					// Autoplay refused (an unmuted policy, a background tab): the Play control takes over.
				});
			}
		});
	}, [index, reduced]);
	// #endregion

	// #region Auto-advance
	useEffect(() => {
		const plan = advancePlan({
			slide,
			count,
			paused,
			reduced,
			videoEnded: videoEnded.value,
		});
		if (plan.kind !== "dwell") return;
		const timer = setTimeout(() => go(index + 1, false), plan.ms);
		return () => clearTimeout(timer);
	}, [index, paused, reduced, videoEnded.value, count]);
	// #endregion

	// #region Swipe
	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (count <= 1 || e.button !== 0) return;
		if ((e.target as HTMLElement).closest("button")) return;
		const el = viewport.current;
		if (!el) return;
		start.current = {
			x: e.clientX,
			y: e.clientY,
			t: performance.now(),
			width: el.getBoundingClientRect().width || 1,
			rtl: getComputedStyle(el).direction === "rtl",
			pointerId: e.pointerId,
		};
		try {
			el.setPointerCapture(e.pointerId);
		} catch {
			start.current = null;
		}
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const s = start.current;
		if (!s || s.pointerId !== e.pointerId) return;
		const dx = e.clientX - s.x;
		const dy = e.clientY - s.y;
		// A mostly-vertical touch is a scroll; hand it back untouched.
		if (drag.value === null && Math.abs(dy) > SCROLL_LOCK_PX && Math.abs(dy) > Math.abs(dx)) {
			endDrag(e.currentTarget, e.pointerId);
			return;
		}
		drag.value = dampedDrag(dx, index, count, s.rtl);
	}

	function onPointerUp(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const s = start.current;
		if (!s || s.pointerId !== e.pointerId) return;
		const dx = e.clientX - s.x;
		const elapsed = Math.max(1, performance.now() - s.t);
		const velocity = elapsed <= FLICK_WINDOW_MS ? dx / elapsed : 0;
		const step = drag.value === null ? 0 : resolveSwipe(dx, s.width, velocity, s.rtl);
		endDrag(e.currentTarget, e.pointerId);
		if (step !== 0) go(index + step);
	}

	function endDrag(el: HTMLDivElement, pointerId: number): void {
		start.current = null;
		drag.value = null;
		if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
	}
	// #endregion

	// #region Rail keyboard — arrows move FOCUS, Enter/Space selects
	function onDotKey(e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, i: number): void {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			go(i);
			return;
		}
		const next = rovingFocusFor(e.key, i, count);
		if (next === null) return;
		e.preventDefault();
		focused.value = next;
		dots.current[next]?.focus();
	}
	// #endregion

	function replay(i: number): void {
		const video = videos.current[i];
		if (!video) return;
		video.currentTime = 0;
		videoEnded.value = false;
		video.play().catch(() => {});
	}

	function onFocusIn(): void {
		focusWithin.value = true;
	}

	function onFocusOut(e: JSX.TargetedFocusEvent<HTMLDivElement>): void {
		const next = e.relatedTarget as Node | null;
		if (next && e.currentTarget.contains(next)) return;
		focusWithin.value = false;
	}

	const trackStyle = `--pf-slide-i:${index};--pf-drag:${drag.value ?? 0}px`;

	return (
		<div
			class="pf-showcase"
			role="region"
			aria-roledescription="carousel"
			aria-label={`${name} — showcase`}
			data-count={count}
			onPointerEnter={(e) => {
				if (e.pointerType === "mouse") hovering.value = true;
			}}
			onPointerLeave={(e) => {
				if (e.pointerType === "mouse") hovering.value = false;
			}}
			onFocusIn={onFocusIn}
			onFocusOut={onFocusOut}
		>
			<div
				ref={viewport}
				class="pf-showcase__viewport"
				data-swipeable={count > 1 ? "true" : undefined}
				data-dragging={drag.value !== null ? "true" : undefined}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={(e) => endDrag(e.currentTarget, e.pointerId)}
			>
				<ul
					class="pf-showcase__track"
					style={trackStyle}
					data-dragging={drag.value !== null ? "true" : undefined}
				>
					{slides.map((item, i) => (
						<Slide
							key={`${i}:${item.src}`}
							item={item}
							index={i}
							count={count}
							active={i === index}
							ended={i === index && videoEnded.value}
							playing={i === index && videoPlaying.value}
							reduced={reduced}
							videoRef={(el) => {
								videos.current[i] = el;
							}}
							onPlay={() => {
								videoPlaying.value = true;
							}}
							onPause={() => {
								videoPlaying.value = false;
							}}
							onEnded={() => {
								videoPlaying.value = false;
								if (i === index) videoEnded.value = true;
							}}
							onError={() => {
								// A video whose media never arrives must not hold the carousel hostage: it is
								// treated as finished, so the slide dwells on its poster and moves on.
								videoPlaying.value = false;
								if (i === index) videoEnded.value = true;
							}}
							onReplay={() => replay(i)}
						/>
					))}
				</ul>
			</div>

			{count > 1 && (
				<div class="pf-showcase__rail">
					<Tooltip content="Previous" placement="top">
						<button
							type="button"
							class="pf-showcase__nav"
							aria-label="Previous slide"
							onClick={() => go(index - 1)}
						>
							<Icon name="chevron-left" size="xs" />
						</button>
					</Tooltip>
					<div class="pf-showcase__dots" role="tablist" aria-label="Slides">
						{slides.map((_, i) => (
							<button
								key={i}
								ref={(el) => {
									dots.current[i] = el;
								}}
								type="button"
								role="tab"
								id={`pf-showcase-tab-${i}`}
								class="pf-showcase__dot ui-hit"
								aria-selected={i === index ? "true" : "false"}
								aria-controls={`pf-showcase-slide-${i}`}
								aria-label={`Slide ${i + 1} of ${count}`}
								tabIndex={i === focused.value ? 0 : -1}
								onClick={() => go(i)}
								onKeyDown={(e) => onDotKey(e, i)}
							/>
						))}
					</div>
					<Tooltip content="Next" placement="top">
						<button
							type="button"
							class="pf-showcase__nav"
							aria-label="Next slide"
							onClick={() => go(index + 1)}
						>
							<Icon name="chevron-right" size="xs" />
						</button>
					</Tooltip>
				</div>
			)}

			<p class="ui-visually-hidden" role="status" aria-live="polite">{status.value}</p>
		</div>
	);
}

// #region Slide
interface SlideProps {
	item: ProfileShowcaseItem;
	index: number;
	count: number;
	active: boolean;
	/** The active video has finished and is holding its last frame. */
	ended: boolean;
	/** The active video is playing. */
	playing: boolean;
	reduced: boolean;
	videoRef: (el: HTMLVideoElement | null) => void;
	onPlay: () => void;
	onPause: () => void;
	onEnded: () => void;
	onError: () => void;
	onReplay: () => void;
}

function Slide(props: SlideProps): JSX.Element {
	const { item, index, count, active, ended, playing, reduced, videoRef } = props;
	const isVideo = item.kind === "video";
	// A finished video offers Replay; a video that is not playing under reduced motion offers Play.
	const control = isVideo && active
		? ended ? "replay" : (!playing && reduced) ? "play" : null
		: null;
	return (
		<li
			id={`pf-showcase-slide-${index}`}
			class="pf-showcase__slide"
			role="tabpanel"
			aria-roledescription="slide"
			aria-label={`${index + 1} of ${count}`}
			aria-hidden={active ? undefined : "true"}
			inert={active ? undefined : true}
			data-kind={item.kind}
		>
			{isVideo
				? (
					<video
						ref={videoRef}
						class="pf-showcase__media pf-showcase__video"
						src={item.src}
						poster={item.poster}
						muted
						playsInline
						preload="metadata"
						aria-label={item.alt}
						onPlay={props.onPlay}
						onPause={props.onPause}
						onEnded={props.onEnded}
						onError={props.onError}
					/>
				)
				: (
					<ProgressiveImage
						class="pf-showcase__media"
						src={item.src}
						alt={item.alt}
						placeholder={item.placeholder}
						loading={index === 0 ? "eager" : "lazy"}
						decoding="async"
						draggable={false}
					/>
				)}
			{control && (
				<span class="pf-showcase__playslot">
					<Tooltip content={control === "replay" ? "Replay" : "Play"} placement="top">
						<button
							type="button"
							class="pf-showcase__play"
							aria-label={control === "replay" ? "Replay video" : "Play video"}
							onClick={props.onReplay}
						>
							<Icon name={control === "replay" ? "refresh" : "play"} size="md" />
						</button>
					</Tooltip>
				</span>
			)}
		</li>
	);
}
// #endregion
