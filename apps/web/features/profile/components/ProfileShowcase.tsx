import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { ProgressiveImage } from "@projective/ui/display/image";
import { VideoPlayer } from "@projective/ui/display/video";
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
 * reduced-motion channel, under which nothing moves on its own — the video slide then shows its
 * transport instead of starting itself. Only the ACTIVE video ever plays; leaving a video slide
 * pauses, rewinds AND re-mutes it, so returning starts it fresh and silent — a viewer who unmuted
 * one slide has not asked the next lap of the carousel to play sound at them.
 *
 * A video slide is the shared `@projective/ui` {@link VideoPlayer} in its `full` variant: the
 * transport bar (play ⁄ pause · mute + an expanding volume slider · the clock · a seekable scrubber ·
 * a speed cycle) revealed on hover, on focus, or by a tap, and standing while the video is not
 * playing. The carousel still OWNS playback — it plays, pauses and rewinds the element through the
 * player's `videoRef` — and the player's controls mirror the element, so a pause pressed on the bar
 * holds the slide exactly as the pointer resting on it does (a paused video is `await-video` to
 * `advancePlan`, and nothing arms). The bar sits above the pagination rail, which keeps its place.
 *
 * # Navigation
 *
 * The rail is a tablist: ArrowLeft / ArrowRight (Home / End) move the roving focus between the
 * dots WITHOUT selecting — the brief's manual-activation model — and Enter or Space (or a click)
 * selects. The chevrons step. On a pointer, a horizontal drag on the frame follows the finger and
 * commits on distance or a flick (`resolveSwipe`), damped past either end; `touch-action: pan-y`
 * leaves vertical scrolling to the browser. Inactive slides are `inert` so their controls cannot
 * be reached behind the clip. A swipe takes pointer capture only once the pointer has TRAVELLED:
 * capturing on the press itself would retarget the release to the viewport, and the click a still
 * pointer produces would never reach the video surface whose click toggles playback.
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
/** Horizontal travel before a press becomes a swipe and takes the pointer. */
const SWIPE_START_PX = 6;

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
	/**
	 * Slides whose video has FAILED. The element is server-rendered with its source, so an
	 * undecodable or unreachable clip raises `error` at hydration — while slide one is active — and
	 * never again; arriving on such a slide later must treat it as finished at once, or the carousel
	 * would await a video that can never end.
	 */
	const failed = useRef(new Set<number>());

	const index = wrapIndex(active.value, count);
	const slide = slides[index];
	const paused = hovering.value || focusWithin.value;

	function go(next: number, announce = true): void {
		const target = wrapIndex(next, count);
		if (target === index) return;
		active.value = target;
		focused.value = target;
		videoEnded.value = failed.current.has(target);
		if (announce) status.value = `Slide ${target + 1} of ${count}`;
	}

	// #region Video lifecycle — only the active video plays, and it starts fresh and silent each time
	useEffect(() => {
		const changed = lastActive.current !== index;
		lastActive.current = index;
		videos.current.forEach((video, i) => {
			if (!video) return;
			if (i !== index) {
				video.pause();
				if (video.currentTime !== 0) video.currentTime = 0;
				if (!video.muted) video.muted = true;
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
		// A control (a button, a slider) owns its own press; a swipe never starts on one.
		if ((e.target as HTMLElement).closest("button, [role=slider]")) return;
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
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const s = start.current;
		if (!s || s.pointerId !== e.pointerId) return;
		const dx = e.clientX - s.x;
		const dy = e.clientY - s.y;
		if (drag.value === null) {
			// A mostly-vertical touch is a scroll; hand it back untouched.
			if (Math.abs(dy) > SCROLL_LOCK_PX && Math.abs(dy) > Math.abs(dx)) {
				endDrag(e.currentTarget, e.pointerId);
				return;
			}
			// Not yet a swipe: a still press stays a click for whatever sits under it.
			if (Math.abs(dx) < SWIPE_START_PX) return;
			try {
				e.currentTarget.setPointerCapture(e.pointerId);
			} catch {
				start.current = null;
				return;
			}
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
							videoRef={(el) => {
								videos.current[i] = el;
							}}
							onPlay={() => {
								videoPlaying.value = true;
								// A replay from the bar restarts a finished video; the hold is over.
								if (i === index) videoEnded.value = false;
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
								// treated as finished, so the slide dwells on its poster and moves on — now, if
								// it is the active slide, and whenever the carousel next arrives on it if not.
								failed.current.add(i);
								videoPlaying.value = false;
								if (i === index) videoEnded.value = true;
							}}
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
	videoRef: (el: HTMLVideoElement | null) => void;
	onPlay: () => void;
	onPause: () => void;
	onEnded: () => void;
	onError: () => void;
}

function Slide(props: SlideProps): JSX.Element {
	const { item, index, count, active, videoRef } = props;
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
			{item.kind === "video"
				? (
					<VideoPlayer
						variant="full"
						class="pf-showcase__media pf-showcase__player"
						src={item.src}
						poster={item.poster}
						label={item.alt}
						muted
						preload="metadata"
						videoRef={videoRef}
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
		</li>
	);
}
// #endregion
