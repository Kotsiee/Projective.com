import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/funding-status.css";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { useId } from "@projective/ui/hooks";
import { Icon } from "@projective/ui/icons";
import type { FundingState, FundingStatus as FundingFacts } from "@projective/types/finance";
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
	previewFunding,
} from "../core/funding-ui.ts";

/**
 * FundingStatus — one ticket's answer to "is the money held, and may work start?" (PRODUCT_MANAGEMENT
 * §3.6, Decision #165), with at most ONE decision's controls.
 *
 * It renders the state the server derived (`BoardCard.funding`) and never derives one: the only
 * substitutions are the Dev Context Switcher's forced state (`fundingState` on the dev seam) and, while
 * a card payment is processing, the server's newer answer from polling the ticket read
 * (`pollSlug`). The host owns what the controls do — a control renders only when its handler is
 * passed (§3 gate 11), except Start work, which renders DISABLED with the reason while the ticket is
 * not funded, because a payee who cannot see the control cannot learn why they may not start.
 *
 * `compact` is the board card's mark: the status tag alone (a lifecycle status, §B.11.3), with the
 * sentence in its tooltip, and only for the states the card's column does not already say.
 */
export interface FundingStatusProps {
	funding: FundingFacts | null;
	side: FundingSide;
	/** The payee's name, when someone holds the ticket. */
	freelancer?: string | null;
	/** The date the sentence names (`fundingDateLabel`). */
	dateLabel?: string | null;
	compact?: boolean;
	/** The ticket's `tkt-…` slug — re-read every few seconds while a payment is processing. */
	pollSlug?: string;
	onBuyNow?: () => void;
	onAddToBasket?: () => void;
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

export function FundingStatus(props: FundingStatusProps): JSX.Element | null {
	const { side, compact = false, pollSlug } = props;
	const forced = useSignal(readDevSeam()?.fundingState);
	const forcedAutoFund = useSignal(readDevSeam()?.autoFundMode);
	const polled = useSignal<FundingFacts | null>(null);
	const lineId = useId(undefined, "fst");

	useEffect(() =>
		subscribeDevSeam((seam) => {
			forced.value = seam?.fundingState;
			forcedAutoFund.value = seam?.autoFundMode;
		}), []);

	// A newer server card supersedes whatever the poll last said.
	useEffect(() => {
		polled.value = null;
	}, [props.funding]);

	const facts = polled.value ?? props.funding;
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

	if (!facts) return null;
	const previewed = previewFunding(facts, forced.value);
	// The Dev Context Switcher's auto-fund mode: Wallet previews the "Auto-funded from wallet" line.
	const f = !forcedAutoFund.value || forcedAutoFund.value === "auto"
		? previewed
		: { ...previewed, autoFunded: forcedAutoFund.value === "from_wallet" };
	const tag = fundingTagState(f);
	const ahead = paidAhead(f);
	const label = ahead ? "Paid" : FUNDING_STATE_LABEL[tag];
	const tone = ahead ? "success" : FUNDING_TONE[tag];
	const sentence = fundingSentence({
		funding: f,
		side,
		freelancer: props.freelancer ?? null,
		dateLabel: props.dateLabel ?? null,
		kind: props.kind,
		sessionTerms: props.sessionTerms,
	});

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
			<span class="fst-tag" data-tone={tone}>{label}</span>
			{/* Polite, so a processing payment that settles is announced without stealing focus. */}
			<p class="fst__line" id={lineId} aria-live="polite">{sentence}</p>
			<div class="fst__acts">
				{action === "fund" && props.onBuyNow
					? (
						<Button
							severity="accent"
							rounded
							size="sm"
							loading={props.busy}
							icon={<Icon name="lock" size="xs" />}
							label="Buy now"
							onClick={props.onBuyNow}
						/>
					)
					: null}
				{action === "fund" && props.onAddToBasket
					? (
						<Button
							severity="neutral"
							variant="outlined"
							rounded
							size="sm"
							icon={<Icon name="basket" size="xs" />}
							label="Add to basket"
							onClick={props.onAddToBasket}
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
