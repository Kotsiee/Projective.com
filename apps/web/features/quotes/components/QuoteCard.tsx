import type { JSX } from "preact";
import { Tag } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { Button } from "@projective/ui/fields";
import { type QuoteActionKind, type QuoteView, termsReference } from "@projective/types/services";
import {
	offerMoneyNote,
	offerStateLabel,
	quoteMoveLabel,
	quoteStatusLabel,
	revisionsLabel,
	shortDate,
	turnaroundLabel,
	waitsOnViewer,
} from "../core/quote-labels.ts";

/** Props for {@link QuoteCard}. */
export interface QuoteCardProps {
	quote: QuoteView;
	/** Distinguishes the docked and slide-over copies' ids. */
	idBase: string;
	/** The act in flight on this request, if any. */
	busy: QuoteActionKind | null;
	/** The last refusal or confirmation on this request. */
	notice: { text: string; tone: "error" | "info" } | null;
	onAct: (kind: QuoteActionKind) => void;
}

const LABELS: Record<Exclude<QuoteActionKind, "send_offer">, string> = {
	withdraw_offer: "Withdraw offer",
	decline_request: "Decline request",
	accept_offer: "Accept offer",
	decline_offer: "Decline offer",
	withdraw_request: "Withdraw request",
	checkout: "Continue to checkout",
};

/** The one filled commit a request offers its viewer: the move that advances it. */
const COMMITS: readonly QuoteActionKind[] = ["send_offer", "accept_offer", "checkout"];

/**
 * QuoteCard — one quote request between two people, from the viewer's side: the ask (with the buyer's
 * answers to the listing's questions), the current offer (its price, turnaround, the revisions the
 * listing includes, its expiry, its deliverables as a checklist and the reference of its terms hash),
 * the request's history of moves, and the acts the server says the viewer may take. Static content is
 * never boxed; the request's lifecycle is the one container.
 */
export function QuoteCard(props: QuoteCardProps): JSX.Element {
	const q = props.quote;
	const offer = q.offer;
	const titleId = `${props.idBase}-qte-${q.id}`;
	const revisions = revisionsLabel(q.freeRevisions);
	const moneyNote = offerMoneyNote(q);

	const button = (kind: QuoteActionKind) => {
		const label = kind === "send_offer"
			? (offer?.state === "pending" ? "Revise offer" : "Send offer")
			: LABELS[kind];
		const pressed = () => {
			if (!props.busy) props.onAct(kind);
		};
		return COMMITS.includes(kind)
			? (
				<Button
					key={kind}
					label={label}
					severity="accent"
					size="sm"
					aria-busy={props.busy === kind}
					onClick={pressed}
				/>
			)
			: (
				<Button
					key={kind}
					label={label}
					severity="neutral"
					variant="outlined"
					size="sm"
					aria-busy={props.busy === kind}
					onClick={pressed}
				/>
			);
	};

	return (
		<article class="qte" aria-labelledby={titleId}>
			<header class="qte__head">
				<h4 class="qte__title" id={titleId}>
					<a class="qte__link" href={q.listing.href}>{q.listing.title}</a>
				</h4>
				<Tag
					class="qte__status"
					value={quoteStatusLabel(q.status, q.role)}
					severity={waitsOnViewer(q) ? "warning" : "secondary"}
					variant="subtle"
				/>
			</header>
			<p class="qte__meta">
				<span class="qte__meta-part">
					{q.origin === "host"
						? (q.role === "host" ? "Your quote" : "Quote from the seller")
						: q.listing.privateCohort
						? "Private cohort"
						: "Custom scope"}
				</span>
				<span class="qte__meta-part">Requested {shortDate(q.requestedAt)}</span>
				{q.offersSent > 1 && <span class="qte__meta-part">{q.offersSent} offers sent</span>}
			</p>

			{q.origin === "buyer" && (
			<section class="qte__sec" aria-label={q.role === "host" ? "Their request" : "Your request"}>
				<h5 class="qte__label">{q.role === "host" ? "Their request" : "Your request"}</h5>
				<p class="qte__text">{q.scope}</p>
				{q.answerLines.length > 0 && (
					<ul class="qte__deliverables" aria-label={q.role === "host" ? "Their answers" : "Your answers"}>
						{q.answerLines.map((line, i) => <li key={i} class="qte__text">{line}</li>)}
					</ul>
				)}
				{((q.budgetMinor !== null && q.budgetCurrency) || q.timeline) && (
					<p class="qte__meta">
						{q.budgetMinor !== null && q.budgetCurrency && (
							<span class="qte__meta-part">
								Budget{" "}
								<MoneyView minor={q.budgetMinor} currency={q.budgetCurrency} size="micro" exact />
							</span>
						)}
						{q.timeline && <span class="qte__meta-part">{q.timeline}</span>}
					</p>
				)}
			</section>
			)}

			{offer && (
				<section class="qte__sec" aria-label={offerStateLabel(offer.state)}>
					<h5 class="qte__label">{offerStateLabel(offer.state)}</h5>
					<p class="qte__price">
						<MoneyView minor={offer.priceMinor} currency={offer.currency} size="key" exact />
					</p>
					<p class="qte__meta">
						<span class="qte__meta-part">{turnaroundLabel(offer.turnaroundDays)}</span>
						{revisions && <span class="qte__meta-part">{revisions}</span>}
						{offer.state === "pending" && (
							<span class="qte__meta-part">Open until {shortDate(offer.expiresAt)}</span>
						)}
						{offer.state === "accepted" && !q.ordered && (
							<span class="qte__meta-part">
								{q.role === "buyer" ? "Pay by" : "Payable until"} {shortDate(offer.expiresAt)}
							</span>
						)}
						{offer.state === "expired" && (
							<span class="qte__meta-part">Expired {shortDate(offer.expiresAt)}</span>
						)}
					</p>
					<p class="qte__text">{offer.scope}</p>
					{offer.deliverables.length > 0 && (
						<ul class="qte__deliverables" aria-label="Deliverables">
							{offer.deliverables.map((d, i) => <li key={i} class="qte__deliverable">{d}</li>)}
						</ul>
					)}
					{moneyNote && <p class="qte__escrow">{moneyNote}</p>}
					<p class={offer.termsIntact ? "qte__ref" : "qte__ref qte__ref--broken"} title={offer.termsHash}>
						{offer.termsIntact
							? `Terms ref ${termsReference(offer.termsHash)}`
							: "These terms no longer match their record. Contact support before paying."}
					</p>
				</section>
			)}

			{q.history.length > 0 && (
				<details class="qte-history">
					<summary class="qte-history__toggle">History · {q.history.length} {q.history.length === 1 ? "move" : "moves"}</summary>
					<ol class="qte-history__list">
						{q.history.map((e) => (
							<li key={e.id} class="qte-history__row">
								<span class="qte-history__what">
									{quoteMoveLabel(e.kind, e.by === q.role)}
									{e.termsHash ? ` · ref ${termsReference(e.termsHash)}` : ""}
								</span>
								<time class="qte-history__when" dateTime={e.at}>{shortDate(e.at)}</time>
							</li>
						))}
					</ol>
				</details>
			)}

			{q.declineReason && (
				<p class="qte__meta">
					<span class="qte__meta-part">Reason: {q.declineReason}</span>
				</p>
			)}

			{props.notice && (
				<p
					class={`qte__notice${props.notice.tone === "error" ? " qte__notice--error" : ""}`}
					role={props.notice.tone === "error" ? "alert" : "status"}
				>
					{props.notice.text}
				</p>
			)}

			{q.actions.length > 0 && <div class="qte__actions">{q.actions.map(button)}</div>}
		</article>
	);
}
