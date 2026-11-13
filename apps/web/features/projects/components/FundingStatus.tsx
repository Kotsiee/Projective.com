import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/funding-status.css";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { useId } from "@projective/ui/hooks";
import { Icon } from "@projective/ui/icons";
import type {
	FundingState,
	FundingStatus as FundingFacts,
} from "@projective/types/finance";
import { AddToBasketButton } from "@web/features/checkout/components/AddToBasketButton.tsx";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { BoardService } from "../core/BoardService.ts";
import {
	FUNDING_STATE_LABEL,
	FUNDING_TONE,
	fundingAction,
	fundingSentence,
	type FundingSide,
	fundingTagState,
	paidAhead,
	prepaidSentence,
	previewFunding,
} from "../core/funding-ui.ts";

/**
 * FundingStatus — one ticket's answer to "is the money held, and may work start?" (PRODUCT_MANAGEMENT
 * §3.6, Decision #165), with at most ONE decision's controls.
 *
 * It renders the state the server derived (`BoardCard.funding`) and never derives one: the only
 * substitutions are the Dev Context Switcher's forced state (`fundingState` on the dev seam) and, while
 * a card payment is processing, the server's newer answer from polling the ticket read
 * (`pollSlug`, {@link useLiveFunding}). The host owns what the controls do — a control renders only when
 * its handler is passed (§3 gate 11), except Start work, which renders DISABLED with the reason while
 * the ticket is not funded, because a payee who cannot see the control cannot learn why they may not
 * start. Add to basket leads and Buy now closes the row, the region's one fill (§B.8.1, §B.8.2).
 *
 * `compact` is the board card's mark: the status tag alone (a lifecycle status, §B.11.3), with the
 * sentence in its tooltip, and only for the states the card's column does not already say. A host that
 * places the tag itself ({@link FundingTag}) passes `tag={false}`.
 */
export interface FundingStatusProps {
	funding: FundingFacts | null;
	side: FundingSide;
	/** The payee's name, when someone holds the ticket. */
	freelancer?: string | null;
	/** The date the sentence names (`fundingDateLabel`). */
	dateLabel?: string | null;
	compact?: boolean;
	/** Whether the line carries its own status tag (default `true`). */
	tag?: boolean;
	/** The ticket's `tkt-…` slug — re-read every few seconds while a payment is processing. */
	pollSlug?: string;
	/** The names of the later stages already paid for (Decision #430), stated after the sentence. */
	prepaidStages?: readonly string[];
	onBuyNow?: () => void;
	/** Put the ticket in the basket; resolve `true` when a line landed (the control then celebrates). */
	onAddToBasket?: () => Promise<boolean> | boolean;
	/**
	 * Ask which stages to add first (Decision #430): Add to basket opens a popover holding what this
	 * returns, which calls `done(true)` once its lines landed.
	 */
	basketPicker?: (done: (landed: boolean) => void) => JSX.Element;
	/** The open basket already holds this ticket (Decision #428): Add to basket reads In basket. */
	inBasket?: boolean;
	/** Open the basket — what In basket does. */
	onOpenBasket?: () => void;
	onReview?: () => void;
	onRetry?: () => void;
	onStart?: () => void;
	/** A write the host started is in flight — the control shows its spinner. */
	busy?: boolean;
	/**
	 * What the escrow pays for — a ticket (the default) or a session seat, whose sentences follow the
	 * seat's lifecycle (Decision #171). A seat is joined, never started, so its host passes no `onStart`.
	 */
	kind?: "ticket" | "session";
	/** A seat's terms (join lead, payout window) for the session sentences. */
	sessionTerms?: { joinLeadMinutes: number; payoutHours: number };
	class?: string;
}

/** How often a processing payment is re-read. The webhook settles in seconds, not minutes. */
const POLL_MS = 3000;

/** States the board card leaves to its column: a tag there would repeat the lane it sits in. */
const COLUMN_SAYS: ReadonlySet<FundingState> = new Set(["in_progress", "in_review", "released"]);

/**
 * A ticket's funding facts as they stand now: the host's server card, superseded by the ticket read
 * polled every few seconds while a card payment is processing. One call per surface, so the tag and the
 * line it is moved away from always read the same answer.
 */
export function useLiveFunding(funding: FundingFacts | null, pollSlug?: string): FundingFacts | null {
	const polled = useSignal<FundingFacts | null>(null);

	useEffect(() => {
		polled.value = null;
	}, [funding]);

	const facts = polled.value ?? funding;
	const processing = facts?.state === "processing";
	useEffect(() => {
		if (!processing || !pollSlug) return;
		const id = setInterval(async () => {
			const res = await BoardService.ticket(pollSlug);
			const next = res.ok ? res.data?.card.funding : null;
			if (next) polled.value = next;
		}, POLL_MS);
		return () => clearInterval(id);
	}, [processing, pollSlug]);

	return facts;
}

/** The Dev Context Switcher's forced funding state and auto-fund mode, kept current. */
function useFundingPreview(): {
	forced: Signal<FundingState | "auto" | undefined>;
	autoFund: Signal<string | undefined>;
} {
	const forced = useSignal(readDevSeam()?.fundingState);
	const autoFund = useSignal<string | undefined>(readDevSeam()?.autoFundMode);
	useEffect(() =>
		subscribeDevSeam((seam) => {
			forced.value = seam?.fundingState;
			autoFund.value = seam?.autoFundMode;
		}), []);
	return { forced, autoFund };
}

/** The tag's word and tone for a (previewed) state. */
function tagOf(f: FundingFacts): { label: string; tone: string; tag: FundingState } {
	const tag = fundingTagState(f);
	const ahead = paidAhead(f);
	return {
		tag,
		label: ahead ? "Paid" : FUNDING_STATE_LABEL[tag],
		tone: ahead ? "success" : FUNDING_TONE[tag],
	};
}

/**
 * FundingTag — the funding line's lifecycle tag on its own (§B.11.3), for a host that places it
 * elsewhere: the ticket modal sets it beside the ticket's status, next to the title.
 */
export function FundingTag(props: { funding: FundingFacts; class?: string }): JSX.Element {
	const { forced } = useFundingPreview();
	const { label, tone } = tagOf(previewFunding(props.funding, forced.value));
	return (
		<span class={`fst-tag${props.class ? ` ${props.class}` : ""}`} data-tone={tone}>
			{label}
		</span>
	);
}

export function FundingStatus(props: FundingStatusProps): JSX.Element | null {
	const { side, compact = false, pollSlug } = props;
	const { forced, autoFund } = useFundingPreview();
	const lineId = useId(undefined, "fst");
	const facts = useLiveFunding(props.funding, pollSlug);

	if (!facts) return null;
	const previewed = previewFunding(facts, forced.value);
	// The Dev Context Switcher's auto-fund mode: Wallet previews the "Auto-funded from wallet" line.
	const f = !autoFund.value || autoFund.value === "auto"
		? previewed
		: { ...previewed, autoFunded: autoFund.value === "from_wallet" };
	const { tag, label, tone } = tagOf(f);
	const ahead = paidAhead(f);
	const base = fundingSentence({
		funding: f,
		side,
		freelancer: props.freelancer ?? null,
		dateLabel: props.dateLabel ?? null,
		kind: props.kind,
		sessionTerms: props.sessionTerms,
	});
	const prepaid = prepaidSentence(props.prepaidStages ?? []);
	const sentence = prepaid ? `${base} ${prepaid}` : base;

	if (compact) {
		if (COLUMN_SAYS.has(f.state) || f.state === "refunded") return null;
		return (
			<Tooltip content={sentence}>
				{f.state === "funded" || ahead
					? (
						<span class="fst-mark" role="img" aria-label={`${label}. ${sentence}`} tabIndex={0}>
							<Icon name="check" size="2xs" />
						</span>
					)
					: (
						<span
							class="fst-tag fst-tag--compact"
							data-tone={tone}
							aria-label={`${label}. ${sentence}`}
							tabIndex={0}
						>
							{/* The card's foot is narrow; the full label and sentence are in the name and tooltip. */}
							{tag === "needs_funding" ? "Unfunded" : label}
						</span>
					)}
			</Tooltip>
		);
	}

	const action = fundingAction(f, side);
	return (
		<div class={`fst${props.class ? ` ${props.class}` : ""}`} data-state={f.state}>
			{props.tag === false ? null : <span class="fst-tag" data-tone={tone}>{label}</span>}
			{/* Polite, so a processing payment that settles is announced without stealing focus. */}
			<p class="fst__line" id={lineId} aria-live="polite">{sentence}</p>
			<div class="fst__acts">
				{action === "fund" && props.onAddToBasket
					? (
						<AddToBasketButton
							inBasket={!!props.inBasket && !!props.onOpenBasket}
							onAdd={async () => (await props.onAddToBasket?.()) === true}
							onOpenBasket={() => props.onOpenBasket?.()}
							picker={props.basketPicker}
							pickerLabel="Choose the stages to add to your basket"
						/>
					)
					: null}
				{action === "fund" && props.onBuyNow
					? (
						<Button
							severity="accent"
							rounded
							size="sm"
							loading={props.busy}
							icon={<Icon name="arrow-right" size="xs" />}
							iconPos="right"
							label="Buy now"
							onClick={props.onBuyNow}
						/>
					)
					: null}
				{action === "review" && props.onReview
					? <Button rounded size="sm" label="Review" onClick={props.onReview} />
					: null}
				{action === "retry" && props.onRetry
					? (
						<Button
							severity="accent"
							rounded
							size="sm"
							loading={props.busy}
							icon={<Icon name="wallet" size="xs" />}
							label="Retry from wallet"
							onClick={props.onRetry}
						/>
					)
					: null}
				{(action === "start" || action === "start-blocked") && props.onStart
					? (
						<Button
							rounded
							size="sm"
							loading={props.busy}
							disabled={action === "start-blocked"}
							aria-describedby={action === "start-blocked" ? lineId : undefined}
							icon={<Icon name="play" size="xs" />}
							label="Start work"
							onClick={props.onStart}
						/>
					)
					: null}
			</div>
		</div>
	);
}
