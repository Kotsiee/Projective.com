import type { JSX } from "preact";
import { ProgressiveImage } from "@projective/ui/display/image";
import { VerificationStampBadge } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { Icon } from "@projective/ui/icons";
import { ownerVerificationStamp } from "@projective/types/org";
import type { ConversionLedger, LedgerLine } from "../core/conversion-ledger.ts";
import type { OfferSummary } from "../core/offer-summary.ts";

/**
 * OfferLedger — the right column of a `/view` conversion dialog (Decision #424): the listing as the
 * page names it (cover · title · `@handle` + crest), the buyer's current selection as live line items,
 * the total through `MoneyView`, the listing's terms, and the escrow notice where the format escrows.
 * A solid `--surface-1` region with no border of its own (§B.4.2); nothing in it is a control.
 */
export interface OfferLedgerProps {
	summary: OfferSummary;
	ledger: ConversionLedger;
	/** The format escrows at checkout (`offer.escrows`) — the notice is a protection claim, so only then. */
	escrows: boolean;
}

export function OfferLedger({ summary, ledger, escrows }: OfferLedgerProps): JSX.Element {
	const handle = summary.owner.handle.replace(/^@/, "");
	return (
		<div class="sbk-ledger">
			{summary.cover && (
				<div class="sbk-ledger__cover">
					<ProgressiveImage
						src={summary.cover.src}
						alt={summary.cover.alt}
						placeholder={summary.cover.placeholder}
						loading="lazy"
						class="sbk-ledger__img"
					/>
				</div>
			)}

			<div class="sbk-ledger__head">
				<p class="sbk-ledger__title">{summary.title}</p>
				<p class="sbk-ledger__seller">
					<span>@{handle}</span>
					<VerificationStampBadge stamp={ownerVerificationStamp(summary.owner)} size="sm" />
				</p>
			</div>

			<dl class="sbk-ledger__lines" aria-live="polite">
				{ledger.lines.map((line) => <Line key={line.key} line={line} />)}
			</dl>

			{ledger.total && (
				<div class="sbk-ledger__total">
					<span class="sbk-ledger__totallabel">
						{ledger.total.isFloor ? `${ledger.total.label} · from` : ledger.total.label}
					</span>
					<MoneyView
						minor={ledger.total.amount.minor}
						currency={ledger.total.amount.currency}
						size="figure"
						class="sbk-ledger__money"
					/>
				</div>
			)}
			{ledger.note && <p class="sbk-ledger__note">{ledger.note}</p>}

			{(summary.delivery || summary.revisions) && (
				<dl class="sbk-ledger__terms">
					{summary.delivery && (
						<div class="sbk-ledger__row">
							<dt>Delivery</dt>
							<dd>{summary.delivery}</dd>
						</div>
					)}
					{summary.revisions && (
						<div class="sbk-ledger__row">
							<dt>Revisions</dt>
							<dd>{summary.revisions}</dd>
						</div>
					)}
				</dl>
			)}

			{escrows && (
				<p class="sbk-ledger__escrow">
					<Icon name="shield-check" size="sm" aria-hidden />
					<span>Funds are held in escrow until you approve the work.</span>
				</p>
			)}
		</div>
	);
}

function Line({ line }: { line: LedgerLine }): JSX.Element {
	return (
		<div class="sbk-ledger__row">
			<dt>{line.label}</dt>
			<dd>
				{line.amount
					? (
						<>
							{line.isFloor && <span class="sbk-ledger__from">from</span>}
							<MoneyView
								minor={line.amount.minor}
								currency={line.amount.currency}
								size="micro"
								hideOrigin
							/>
						</>
					)
					: line.text}
			</dd>
		</div>
	);
}
