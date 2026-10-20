import "../../styles/demos/payments.css";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import type { DemoComponent, DemoProps } from "@features/landing/core/demos/demo-contract.ts";
import {
	FAIR_EXIT_TIERS,
	fairExitLines,
	fairExitPrompt,
	type FairExitTier,
	JOURNEY,
	JOURNEY_LABEL,
	PAYMENTS_COPY,
	PAYMENTS_FIXTURE,
	paymentsFrames,
	type PaymentsView,
	paymentsView,
	projectLine,
	stopLines,
} from "@features/landing/core/demos/payments-model.ts";
import { ExitResults, Ledger, Stages, Stops } from "./PaymentsPicture.tsx";

// #region Constants
/** How long the "Team paid" moment lasts once an approval lands. */
const CELEBRATE_MS = 900;

/** The tier Fair Exit opens on: frame 6's example (§4.4). */
const DEFAULT_TIER: FairExitTier = 50;

/** Lines read out as one announcement: each ends as a sentence. */
function spoken(lines: readonly string[]): string {
	return lines.map((line) => (/[.!?]$/.test(line) ? line : `${line}.`)).join(" ");
}
// #endregion

// #region Live
/**
 * The live demo: the stages, a scrubber across the five stops (a native slider, so the arrow keys,
 * Home and End step it), what is happening at the stop, and the money on both sides. At "You approve"
 * the client's one control is "Approve and pay" (tier 1 amber: money moves, #288 (E)); it lands on
 * "Team paid" with the moment played once. "Try Fair Exit" ends Stage 2 instead, at the tier the
 * radio picks; turning it off goes back to the stop the scrubber held.
 */
function LivePayments({ feeBp, resetSignal, announce }: DemoProps): JSX.Element {
	const stop = useSignal(0);
	const exitOn = useSignal(false);
	const tier = useSignal<FairExitTier>(DEFAULT_TIER);
	const celebrate = useSignal(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const firstReset = useRef(resetSignal);
	/** The scrubber: "Approve and pay" leaves with its stop, so focus moves on to the slider. */
	const range = useRef<HTMLInputElement>(null);

	const view = useComputed(() =>
		paymentsView({ stop: stop.value, fairExit: exitOn.value ? tier.value : null }, feeBp)
	);

	const clearCelebration = () => {
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = null;
		celebrate.value = false;
	};

	// "Start again": back to the fixture, with nothing playing.
	useEffect(() => {
		if (resetSignal === firstReset.current) return;
		firstReset.current = resetSignal;
		clearCelebration();
		stop.value = 0;
		exitOn.value = false;
		tier.value = DEFAULT_TIER;
	}, [resetSignal]);

	useEffect(() => clearCelebration, []);

	const say = (next: PaymentsView) => {
		announce(spoken([JOURNEY_LABEL[next.stopId], ...stopLines(next, feeBp)]));
	};

	const scrub = (event: JSX.TargetedEvent<HTMLInputElement>) => {
		const next = Number(event.currentTarget.value);
		if (next === stop.value) return;
		clearCelebration();
		stop.value = next;
		say(view.value);
	};

	const approve = () => {
		stop.value = JOURNEY.indexOf("paid");
		clearCelebration();
		celebrate.value = true;
		timer.current = setTimeout(() => {
			timer.current = null;
			celebrate.value = false;
		}, CELEBRATE_MS);
		range.current?.focus();
		say(view.value);
	};

	const sayExit = (withPrompt: boolean) => {
		const lines = fairExitLines(view.value);
		if (!lines) return;
		announce(spoken([...(withPrompt ? [fairExitPrompt()] : []), lines.team, lines.back]));
	};

	const toggleExit = () => {
		clearCelebration();
		exitOn.value = !exitOn.value;
		if (exitOn.value) sayExit(true);
		else say(view.value);
	};

	const pickTier = (next: FairExitTier) => {
		tier.value = next;
		sayExit(false);
	};

	const current = view.value;
	const exiting = exitOn.value;
	const atApprove = current.stopId === "approve";
	return (
		<div class="lp-pay" data-mode="live">
			<div class="lp-pay__head">
				<p class="lp-pay__title">{projectLine()}</p>
				<button
					type="button"
					role="switch"
					class="lp-pay__switch"
					aria-checked={exiting ? "true" : "false"}
					onClick={toggleExit}
				>
					<span class="lp-pay__switch-track" aria-hidden="true" />
					{PAYMENTS_COPY.fairExitToggle}
				</button>
			</div>

			<Stages view={current} celebrate={celebrate.value ? PAYMENTS_FIXTURE.stages[0].id : null} />

			{exiting
				? (
					<div class="lp-pay__control lp-pay__exit">
						<p class="lp-pay__line">{fairExitPrompt()}</p>
						<fieldset class="lp-pay__tiers">
							<legend class="lp-pay__legend">{PAYMENTS_COPY.fairExitQuestion}</legend>
							<div class="lp-pay__tier-row">
								{FAIR_EXIT_TIERS.map((value) => (
									<label key={value} class="lp-pay__tier">
										<input
											type="radio"
											class="lp-pay__tier-input"
											name="lp-pay-tier"
											value={value}
											checked={tier.value === value}
											onChange={() => pickTier(value)}
										/>
										<span class="lp-pay__tier-face">{value}%</span>
									</label>
								))}
							</div>
						</fieldset>
					</div>
				)
				: (
					<div class="lp-pay__control lp-pay__scrubber">
						<Stops stop={current.stop} decorative />
						<input
							ref={range}
							type="range"
							class="lp-pay__range"
							min={0}
							max={JOURNEY.length - 1}
							step={1}
							value={current.stop}
							data-stop={current.stop}
							aria-label={PAYMENTS_COPY.scrubber}
							aria-valuetext={JOURNEY_LABEL[current.stopId]}
							onInput={scrub}
						/>
						<p class="lp-pay__stop-now" aria-hidden="true">{JOURNEY_LABEL[current.stopId]}</p>
					</div>
				)}

			<div class="lp-pay__body">
				<div class="lp-pay__story">
					{exiting
						? (
							<div class="lp-pay__now" key="exit">
								<ExitResults view={current} />
							</div>
						)
						: (
							<div class="lp-pay__now" key={current.stop}>
								{stopLines(current, feeBp).map((line) => (
									<p key={line} class="lp-pay__line">{line}</p>
								))}
							</div>
						)}
					{!exiting && atApprove
						? (
							<button
								type="button"
								class="lp-demo-btn lp-demo-btn--money lp-pay__approve"
								onClick={approve}
							>
								{PAYMENTS_COPY.approve}
							</button>
						)
						: null}
				</div>
				<Ledger view={current} feeBp={feeBp} />
			</div>
		</div>
	);
}
// #endregion

// #region Frames
/**
 * The frame mode (either reduced-motion channel): the six §4.4 frames as a labelled sequence —
 * "Step n of 6", the frame's words, a still of the stages, the stops and the money, and Previous
 * step / Next step. Nothing moves and nothing plays on its own.
 */
function FramePayments({ feeBp, resetSignal, announce }: DemoProps): JSX.Element {
	const frames = paymentsFrames(feeBp);
	const index = useSignal(0);
	const firstReset = useRef(resetSignal);

	useEffect(() => {
		if (resetSignal === firstReset.current) return;
		firstReset.current = resetSignal;
		index.value = 0;
	}, [resetSignal]);

	const go = (delta: number) => {
		const next = Math.min(frames.length - 1, Math.max(0, index.value + delta));
		if (next === index.value) return;
		index.value = next;
		announce(spoken([`Step ${next + 1} of ${frames.length}`, ...frames[next].lines]));
	};

	const frame = frames[index.value];
	const view = paymentsView(frame.choice, feeBp);
	const first = index.value === 0;
	const last = index.value === frames.length - 1;
	return (
		<div class="lp-demo-frames lp-pay" data-mode="frames">
			<div class="lp-demo-frames__head">
				<p class="lp-demo-counter">Step {index.value + 1} of {frames.length}</p>
				<div class="lp-demo-frames__caption">
					{frame.lines.map((line) => <p key={line}>{line}</p>)}
				</div>
			</div>
			<div class="lp-demo-frames__picture">
				<Stages view={view} focus={frame.focus} />
				<div class="lp-pay__body">
					<div class="lp-pay__story">
						{view.exit ? <ExitResults view={view} /> : <Stops stop={view.stop} />}
					</div>
					<Ledger view={view} feeBp={feeBp} />
				</div>
			</div>
			<div class="lp-demo-frames__nav">
				<button
					type="button"
					class="lp-demo-step"
					aria-disabled={first ? "true" : undefined}
					onClick={() => go(-1)}
				>
					Previous step
				</button>
				<button
					type="button"
					class="lp-demo-step"
					aria-disabled={last ? "true" : undefined}
					onClick={() => go(1)}
				>
					Next step
				</button>
			</div>
		</div>
	);
}
// #endregion

// #region Demo
/**
 * PaymentsDemo — the demo stage's Payment protection tab (`?demo=payments`; `flows/LANDING.md` §2.3
 * "demo viewport · ?demo=payments", §4.4, §6 V2). A £5,000 project in three stages over
 * `payments-model.ts`, whose arithmetic is the database's: the live scrubber when motion is allowed,
 * the labelled frames under either reduced-motion channel. Example only: it never fetches and never
 * writes. Loaded by the demo host's `import()`; never under `islands/`.
 */
const PaymentsDemo: DemoComponent = (props: DemoProps) =>
	props.reducedMotion ? <FramePayments {...props} /> : <LivePayments {...props} />;

export default PaymentsDemo;
// #endregion
