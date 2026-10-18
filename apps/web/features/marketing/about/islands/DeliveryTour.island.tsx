import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { motionReduced } from "@projective/ui/display/editorial";
// The page's own sheet rides this island: /about is server-rendered and this is the one island it
// always mounts, so every state of the page (a failed metrics read included) is styled.
import "../styles/about.css";
import "../styles/delivery-tour.css";
import {
	autoplayNext,
	autoplayRuns,
	stepperKeyTarget,
	TOUR_AUTOPLAY_MS,
	TOUR_VISIBLE_RATIO,
	TOUR_ZONES,
	tourControl,
	type TourMode,
	tourSteps,
} from "../core/delivery-tour.ts";
import { TourFigure } from "../components/TourFigure.tsx";

/** Props for {@link DeliveryTour}. */
export interface DeliveryTourProps {
	/** The platform fee, already formatted from the live `platform_fee_bp` (`5%`). */
	feePercent: string;
}

/** The DOM id prefix — one walkthrough per page. */
const ID = "abt-tour";

/**
 * DeliveryTour — `/about`'s "How delivery works" walkthrough (Decision #277): an inline SVG of one
 * stage's money moving through eight steps, a stepper of eight real buttons (the WAI-ARIA tabs
 * pattern: roving tabindex, arrows / Home / End, automatic activation) controlling one explanation
 * panel, a visually hidden ordered list as the diagram's text equivalent, and a Play / Pause control.
 *
 * Autoplay runs once through the steps, only when the motion setting allows it on BOTH channels
 * (`prefers-reduced-motion` and the in-app `data-motion`), only once the section is on screen, never
 * in a hidden tab, and pauses while a pointer rests on it. Keyboard focus moving into it, or picking
 * a step, stops it for good (the reader is in control) until Play is pressed. Under reduced motion
 * there is no autoplay and no control, and state changes are instant.
 *
 * A dumb island: no fetch, no data — the steps and the fee arrive as props and pure functions.
 */
export default function DeliveryTour({ feePercent }: DeliveryTourProps): JSX.Element {
	const steps = tourSteps(feePercent);
	const total = steps.length;

	const active = useSignal(0);
	const mode = useSignal<TourMode>("auto");
	const motionAllowed = useSignal(false);
	const inView = useSignal(false);
	const hovered = useSignal(false);
	const visible = useSignal(true);

	const rootRef = useRef<HTMLDivElement>(null);
	const controlRef = useRef<HTMLDivElement>(null);
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

	// #region Environment (external DOM APIs: matchMedia, IntersectionObserver, visibility)
	useEffect(() => {
		const sync = () => {
			motionAllowed.value = !motionReduced();
			visible.value = !document.hidden;
		};
		sync();
		const media = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
		media?.addEventListener?.("change", sync);
		document.addEventListener("visibilitychange", sync);
		// The in-app channel can flip while the page is open (Settings → Appearance).
		const attrs = new MutationObserver(sync);
		attrs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });

		let io: IntersectionObserver | null = null;
		const root = rootRef.current;
		if (root && typeof IntersectionObserver === "function") {
			io = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) inView.value = entry.intersectionRatio >= TOUR_VISIBLE_RATIO;
				},
				{ threshold: [0, TOUR_VISIBLE_RATIO, 1] },
			);
			io.observe(root);
		}
		return () => {
			media?.removeEventListener?.("change", sync);
			document.removeEventListener("visibilitychange", sync);
			attrs.disconnect();
			io?.disconnect();
		};
	}, []);
	// #endregion

	// #region Autoplay
	useSignalEffect(() => {
		const runs = autoplayRuns({
			mode: mode.value,
			motionAllowed: motionAllowed.value,
			inView: inView.value,
			hovered: hovered.value,
			visible: visible.value,
		});
		const at = active.value;
		if (!runs) return;
		const timer = setTimeout(() => {
			if (motionReduced()) {
				motionAllowed.value = false;
				return;
			}
			const next = autoplayNext(at, total);
			if (next === null) mode.value = "done";
			else active.value = next;
		}, TOUR_AUTOPLAY_MS);
		return () => clearTimeout(timer);
	});
	// #endregion

	// #region Stepper
	const select = (index: number, focus: boolean) => {
		active.value = index;
		mode.value = "manual";
		if (focus) tabRefs.current[index]?.focus();
	};

	const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number) => {
		const target = stepperKeyTarget(event.key, index, total);
		if (target === null) return;
		event.preventDefault();
		select(target, true);
	};

	/** Focus arriving anywhere but the control stops autoplay for good (WAI-ARIA carousel rule). */
	const onFocusCapture = (event: JSX.TargetedFocusEvent<HTMLDivElement>) => {
		if (controlRef.current?.contains(event.target as Node)) return;
		if (mode.value === "auto") mode.value = "paused";
	};

	const onControl = () => {
		const control = tourControl(mode.peek(), active.peek() === total - 1);
		if (control.rewind) active.value = 0;
		mode.value = control.next;
	};
	// #endregion

	const current = steps[active.value];
	const control = tourControl(mode.value, active.value === total - 1);

	return (
		<div
			class="abt-tour"
			ref={rootRef}
			onPointerEnter={() => (hovered.value = true)}
			onPointerLeave={() => (hovered.value = false)}
			onFocusCapture={onFocusCapture}
		>
			<figure class="abt-tour__figure">
				<TourFigure layout="wide" steps={steps} active={active.value} idBase={ID} />
				<TourFigure layout="narrow" steps={steps} active={active.value} idBase={ID} />
			</figure>

			<ol class="ui-visually-hidden" aria-label="The delivery steps in order">
				{steps.map((step) => (
					<li key={step.id}>
						{`${step.label}. ${TOUR_ZONES[step.zone].where}. ${step.lines[0]} ${step.lines[1]}`}
					</li>
				))}
			</ol>

			<div class="abt-tour__steps" role="tablist" aria-label="Delivery steps">
				{steps.map((step, i) => {
					const selected = i === active.value;
					return (
						<button
							key={step.id}
							ref={(el) => {
								tabRefs.current[i] = el;
							}}
							type="button"
							role="tab"
							id={`${ID}-tab-${step.id}`}
							class="abt-tour__tab"
							aria-selected={selected}
							aria-controls={`${ID}-panel`}
							tabIndex={selected ? 0 : -1}
							onClick={() => select(i, false)}
							onKeyDown={(event) => onKeyDown(event, i)}
						>
							<span class="abt-tour__tab-num" aria-hidden="true">
								{String(i + 1).padStart(2, "0")}
							</span>
							<span class="abt-tour__tab-label">{step.label}</span>
						</button>
					);
				})}
			</div>

			<div
				class="abt-tour__panel"
				id={`${ID}-panel`}
				role="tabpanel"
				aria-labelledby={`${ID}-tab-${current.id}`}
				tabIndex={0}
			>
				<p class="abt-tour__where">
					<span class="abt-tour__where-label">Where the money is</span>
					{TOUR_ZONES[current.zone].where}
				</p>
				<p class="abt-tour__line">{current.lines[0]}</p>
				<p class="abt-tour__line">{current.lines[1]}</p>
			</div>

			<div class="abt-tour__controls" ref={controlRef}>
				<p class="abt-tour__count">
					Step {active.value + 1} of {total}
				</p>
				{motionAllowed.value && (
					<Button
						variant="text"
						size="sm"
						icon={
							<Icon
								name={control.label === "Pause"
									? "pause"
									: control.label === "Play"
									? "play"
									: "refresh"}
							/>
						}
						label={`${control.label} walkthrough`}
						aria-controls={`${ID}-panel`}
						onClick={onControl}
					/>
				)}
			</div>
		</div>
	);
}
