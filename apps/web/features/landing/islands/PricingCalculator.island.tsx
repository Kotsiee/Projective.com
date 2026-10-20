/// <reference lib="dom" />
import "../styles/lp-pricing.css";
import "../styles/lp-numbers.css";
import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	calculatorAnnouncement,
	DEFAULT_PRICE_MINOR,
	formatPriceInput,
	parseStagePrice,
	splitStage,
	type StageSplit,
	stepPrice,
} from "../core/pricing-calc.ts";
import { PricingCalculatorView } from "../components/PricingView.tsx";

// #region Contract
/** Props for {@link PricingCalculator}. */
export interface PricingCalculatorProps {
	/**
	 * The platform fee in basis points from the server (`PublicMetricsService` `platformFeeBp`), or
	 * `null` when it is unavailable — then the calculator is hidden (`flows/LANDING.md` §4) and the
	 * island draws nothing, staying only to carry the section's stylesheets.
	 */
	feeBp: number | null;
	/** The same fee formatted on the server ("5%"), for the fee row's label. */
	feeLabel: string;
}

/**
 * How long the field rests before the live region speaks: one announcement for "2000", not one
 * per keystroke. The rows themselves update on every keystroke (§2.7).
 */
const ANNOUNCE_DELAY_MS = 500;
// #endregion

// #region Island
/**
 * PricingCalculator — the Pricing section's calculator (`flows/LANDING.md` §2.1 note 22, §4.9;
 * claims C1–C7, E1, N9). The visitor types a stage price, steps it by £100 or picks one, and sees
 * at once what they pay (the price, nothing on top) and what the team receives once the fee comes
 * off, the fee truncated to the penny exactly as SQL truncates it (`core/pricing-calc.ts`). The
 * figures change instantly; the polite live region speaks once the field rests.
 *
 * The server renders it at £2,000 with the default price as text where the field and its buttons
 * will be — nothing could answer them yet (gate 11) — so with no JavaScript the panel reads as the
 * worked example; on hydration the controls take the same cell, so nothing shifts. It writes
 * nothing and fetches nothing.
 *
 * It carries the stylesheets of Pricing and of "The numbers so far" (a server component's
 * stylesheet reaches no page), so `Pricing` mounts it with or without a fee.
 */
export default function PricingCalculator({ feeBp, feeLabel }: PricingCalculatorProps) {
	return feeBp === null ? null : <Calculator feeBp={feeBp} feeLabel={feeLabel} />;
}

/** The calculator itself, once a fee is known. */
function Calculator({ feeBp, feeLabel }: { feeBp: number; feeLabel: string }): JSX.Element {
	const text = useSignal(formatPriceInput(DEFAULT_PRICE_MINOR));
	const live = useSignal(false);
	const said = useSignal("");
	const shown = useSignal<StageSplit>(splitStage(DEFAULT_PRICE_MINOR, feeBp));
	const input = useComputed(() => parseStagePrice(text.value));
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		live.value = true;
		return () => clearTimeout(timer.current);
	}, []);

	const write = (next: string) => {
		text.value = next;
		const parsed = parseStagePrice(next);
		if (parsed.kind === "ok") shown.value = splitStage(parsed.minor, feeBp);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			said.value = calculatorAnnouncement(parsed, feeBp);
		}, ANNOUNCE_DELAY_MS);
	};

	const settle = () => {
		const parsed = input.peek();
		if (parsed.kind === "ok") text.value = formatPriceInput(parsed.minor);
	};

	const step = (direction: 1 | -1) => {
		const parsed = input.peek();
		write(formatPriceInput(stepPrice(parsed.kind === "ok" ? parsed.minor : null, direction)));
	};

	return (
		<PricingCalculatorView
			feeLabel={feeLabel}
			text={text.value}
			state={input.value.kind}
			split={shown.value}
			live={live.value}
			announcement={said.value}
			onText={write}
			onSettle={settle}
			onStep={step}
			onPick={(minor) => write(formatPriceInput(minor))}
		/>
	);
}
// #endregion
