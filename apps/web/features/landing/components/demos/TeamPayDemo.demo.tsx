import "../../styles/demos/splits.css";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import { SplitBar } from "@ui/fields/islands/SplitBar.tsx";
import type { SplitSegment } from "@ui/fields/core/split-bar-model.ts";
import type { DemoComponent, DemoProps } from "@features/landing/core/demos/demo-contract.ts";
import {
	approvedStageLine,
	customSplitOf,
	type DemoStakes,
	evenSplitOf,
	splitAnnouncement,
	TEAM_PAY_COPY,
	TEAM_PAY_FIXTURE,
	teamPayFrames,
	teamPayView,
} from "@features/landing/core/demos/split-model.ts";
import { Ledger, reached, Release } from "./TeamPayPicture.tsx";

// #region Bar
/** Each role's name, by member id, for the bar's segments. */
const ROLE: Readonly<Record<string, string>> = Object.fromEntries(
	TEAM_PAY_FIXTURE.members.map((member) => [member.id, member.role]),
);

/** The split as the product's `SplitBar` takes it: one segment per member, in the fixture's order. */
function segmentsOf(stakes: DemoStakes): SplitSegment[] {
	return stakes.map((stake) => ({
		key: stake.memberId,
		label: ROLE[stake.memberId],
		bp: stake.bp,
	}));
}

/** The split back from the bar. */
function stakesOf(segments: readonly SplitSegment[]): DemoStakes {
	return segments.map((segment) => ({ memberId: segment.key, bp: segment.bp }));
}
// #endregion

// #region Live
/**
 * The live demo: the approved stage and its fee, the split's two examples ("Example even split",
 * "Custom split") beside the vault's fixed line, the product's `SplitBar` over the members' stakes
 * (drag a divider, or focus it and use the arrow keys — the bar keeps the stakes whole), and the
 * ledger, to the penny. The radios apply an example; dragging makes the split custom, as the
 * product reads a split. On arrival the payment settles into its rows once.
 */
function LiveTeamPay({ feeBp, resetSignal, announce }: DemoProps): JSX.Element {
	const stakes = useSignal<DemoStakes>(evenSplitOf());
	/** The custom split the visitor last made, so "Custom split" comes back to it. */
	const custom = useSignal<DemoStakes>(customSplitOf());
	/** Bumped by "Start again", so the payment arrives again. */
	const arrival = useSignal(0);
	const firstReset = useRef(resetSignal);

	const view = useComputed(() => teamPayView(stakes.value, feeBp));
	const segments = useComputed(() => segmentsOf(stakes.value));

	useEffect(() => {
		if (resetSignal === firstReset.current) return;
		firstReset.current = resetSignal;
		stakes.value = evenSplitOf();
		custom.value = customSplitOf();
		arrival.value += 1;
	}, [resetSignal]);

	const apply = (next: "even" | "custom") => {
		stakes.value = next === "even" ? evenSplitOf() : custom.value;
		announce(splitAnnouncement(view.value));
	};

	const drag = (next: readonly SplitSegment[]) => {
		stakes.value = stakesOf(next);
		if (view.value.model === "custom") custom.value = stakes.value;
	};

	const current = view.value;
	const model = current.model;
	return (
		<div class="lp-split" data-mode="live" key={arrival.value}>
			<div class="lp-split__top">
				<p class="lp-split__lead">{approvedStageLine(feeBp)}</p>
				<Release view={current} feeBp={feeBp} />
			</div>

			<div class="lp-split__controls">
				<fieldset class="lp-split__choice">
					<legend class="ui-visually-hidden">{TEAM_PAY_COPY.splitGroup}</legend>
					{(["even", "custom"] as const).map((option) => (
						<label key={option} class="lp-split__option">
							<input
								type="radio"
								class="lp-split__option-input"
								name="lp-split-model"
								value={option}
								checked={model === option}
								onChange={() =>
									apply(option)}
							/>
							<span class="lp-split__option-face">
								{option === "even" ? TEAM_PAY_COPY.even : TEAM_PAY_COPY.custom}
							</span>
						</label>
					))}
				</fieldset>
				<p class="lp-split__fixed">{TEAM_PAY_COPY.vaultLine}</p>
			</div>

			<div class="lp-split__bar">
				<SplitBar
					aria-label={TEAM_PAY_COPY.stakes}
					value={segments.value}
					onValueChange={drag}
					onCommit={() => announce(splitAnnouncement(view.value))}
					legend={false}
				/>
				<p class="lp-demo-note">
					{TEAM_PAY_COPY.dragHint} {TEAM_PAY_COPY.validation}
				</p>
			</div>

			<Ledger view={current} />

			<div class="lp-split__notes">
				{current.dustMinor !== null && current.dustMinor > 0
					? <p class="lp-demo-note">{TEAM_PAY_COPY.dust}</p>
					: null}
				<p class="lp-demo-note">{TEAM_PAY_COPY.comingSoon}</p>
			</div>
		</div>
	);
}
// #endregion

// #region Frames
/**
 * The frame mode (either reduced-motion channel): the six §4.4 frames — "Step n of 6", the frame's
 * words, then a still of the bar and the ledger as far as the frames have told it, and Previous step /
 * Next step. The still's bar is the product's `SplitBar`, held inert: a picture, not a control.
 */
function FrameTeamPay({ feeBp, resetSignal, announce }: DemoProps): JSX.Element {
	const frames = teamPayFrames(feeBp);
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
		announce(`Step ${next + 1} of ${frames.length}. ${frames[next].lines.join(" ")}`);
	};

	const frame = frames[index.value];
	const view = teamPayView(frame.stakes, feeBp);
	const first = index.value === 0;
	const last = index.value === frames.length - 1;
	return (
		<div class="lp-demo-frames lp-split" data-mode="frames" data-phase={frame.phase}>
			<div class="lp-demo-frames__head">
				<p class="lp-demo-counter">Step {index.value + 1} of {frames.length}</p>
				<div class="lp-demo-frames__caption">
					{frame.lines.map((line) => <p key={line}>{line}</p>)}
				</div>
			</div>
			<div class="lp-demo-frames__picture">
				<Release view={view} feeBp={feeBp} />
				<p class="lp-split__fixed">{TEAM_PAY_COPY.vaultLine}</p>
				{reached(frame.phase, "shares")
					? (
						<div class="lp-split__bar" inert>
							<SplitBar
								aria-label={TEAM_PAY_COPY.stakes}
								value={segmentsOf(frame.stakes)}
								readOnly
								legend={false}
							/>
						</div>
					)
					: null}
				<Ledger view={view} phase={frame.phase} />
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
 * TeamPayDemo — the demo stage's Team pay tab (`?demo=splits`; `flows/LANDING.md` §2.3 "demo viewport
 * · ?demo=splits", §4.4, §6 V5). A £2,000 stage reaching a three-person team through
 * `split-model.ts`, the mirror of `finance.fn_team_split_plan`: the fee comes off, then the vault's
 * fixed 10%, then each member's agreed share, to the penny, with any spare penny to the vault. Live
 * when motion is allowed; the labelled frames under either reduced-motion channel. Example only: it
 * never fetches and never writes. Loaded by the demo host's `import()`; never under `islands/`.
 */
const TeamPayDemo: DemoComponent = (props: DemoProps) =>
	props.reducedMotion ? <FrameTeamPay {...props} /> : <LiveTeamPay {...props} />;

export default TeamPayDemo;
// #endregion
