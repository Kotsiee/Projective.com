import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/quotes.css";
import { Tag } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import {
	type QuoteActInput,
	type QuoteCardActionKind,
	type QuoteCardView,
	termsReference,
} from "@projective/types/services";
import { basketHref } from "@web/features/checkout/core/basket-model.ts";
import { QuoteService } from "../core/QuoteService.ts";
import { quoteCards, refreshQuoteCards, requestQuoteCard } from "../core/quote-cards-state.ts";
import {
	cardWaitsOnViewer,
	quoteCardStateLabel,
	quoteMoveLabel,
	revisionsLabel,
	shortDate,
	turnaroundLabel,
} from "../core/quote-labels.ts";
import { type QuoteConfirmation, QuoteConfirmDialog } from "./QuoteConfirmDialog.tsx";

/** Props for {@link QuoteThreadCard}. */
export interface QuoteThreadCardProps {
	/** The quote move the message records. */
	eventId: string;
	/** The message's own sentence, shown until the card is read and kept if it cannot be. */
	text: string;
}

const DELIVERABLES_SHOWN = 4;

const ACT_LABELS: Record<QuoteCardActionKind, string> = {
	accept_offer: "Accept offer",
	decline_offer: "Decline",
	checkout: "Continue to checkout",
	withdraw_offer: "Withdraw offer",
};

const CONFIRMS: Partial<Record<QuoteCardActionKind, QuoteConfirmation>> = {
	decline_offer: {
		title: "Decline this offer?",
		body: "The seller is told and can send another.",
		confirmLabel: "Decline offer",
		withReason: false,
	},
	withdraw_offer: {
		title: "Withdraw this offer?",
		body: "The buyer can no longer accept it. You can send a new offer afterwards.",
		confirmLabel: "Withdraw offer",
		withReason: false,
	},
};

/**
 * QuoteThreadCard — one quote move as it sits in a conversation (Decision #522): what happened, the
 * offer's terms exactly as they stood at that move (price, turnaround, deliverables, expiry) with the
 * reference of their SHA-256, where that offer stands now, and the act the viewer may take on it when it
 * is the request's live offer. Rendered inside the message bubble, so nothing in it is boxed again.
 */
export function QuoteThreadCard({ eventId, text }: QuoteThreadCardProps): JSX.Element {
	const busy = useSignal<QuoteCardActionKind | null>(null);
	const notice = useSignal<{ text: string; tone: "error" | "info" } | null>(null);
	const confirming = useSignal<QuoteCardActionKind | null>(null);
	const confirmOpen = useSignal(false);

	useEffect(() => {
		requestQuoteCard(eventId);
	}, [eventId]);

	const card = quoteCards.value[eventId];
	if (!card) return <p class="qte-card__fallback">{text}</p>;

	async function run(kind: QuoteCardActionKind, view: QuoteCardView): Promise<void> {
		if (!view.terms || busy.peek()) return;
		const input: QuoteActInput = kind === "checkout"
			? { action: "accept_offer", offerId: view.terms.offerId }
			: { action: kind, offerId: view.terms.offerId };
		busy.value = kind;
		notice.value = null;
		const res = await QuoteService.act(view.requestId, input);
		busy.value = null;
		confirmOpen.value = false;
		if (!res.ok || !res.data) {
			notice.value = { text: res.message ?? "That didn't go through. Try again.", tone: "error" };
			return;
		}
		if (input.action === "accept_offer" && res.data.basketId) {
			globalThis.location.assign(basketHref(res.data.basketId));
			return;
		}
		notice.value = { text: res.data.confirmation, tone: "info" };
		const siblings = Object.values(quoteCards.peek())
			.filter((c): c is QuoteCardView => !!c && c.requestId === view.requestId)
			.map((c) => c.eventId);
		await refreshQuoteCards(siblings);
	}

	function press(kind: QuoteCardActionKind): void {
		if (CONFIRMS[kind]) {
			confirming.value = kind;
			confirmOpen.value = true;
			return;
		}
		void run(kind, card!);
	}

	const t = card.terms;
	const revisions = revisionsLabel(card.freeRevisions);
	const titleId = `qte-card-${card.eventId}`;
	const shown = t ? t.deliverables.slice(0, DELIVERABLES_SHOWN) : [];
	const more = t ? t.deliverables.length - shown.length : 0;

	return (
		<article class="qte-card" aria-labelledby={titleId}>
			<header class="qte-card__head">
				<p class="qte-card__move" id={titleId}>{quoteMoveLabel(card.kind, card.mine)}</p>
				{card.state && (
					<Tag
						class="qte-card__status"
						value={quoteCardStateLabel(card.state)}
						severity={cardWaitsOnViewer(card.state, card.role) ? "warning" : "secondary"}
						variant="subtle"
					/>
				)}
			</header>
			<a class="qte-card__listing" href={card.listing.href}>{card.listing.title}</a>

			{t && (
				<>
					<p class="qte-card__price">
						<MoneyView minor={t.priceMinor} currency={t.currency} size="key" exact />
					</p>
					<p class="qte-card__meta">
						<span class="qte-card__metapart">{turnaroundLabel(t.turnaroundDays)}</span>
						{revisions && <span class="qte-card__metapart">{revisions}</span>}
						{card.state === "pending" && (
							<span class="qte-card__metapart">Open until {shortDate(t.expiresAt)}</span>
						)}
					</p>
					{shown.length > 0 && (
						<ul class="qte-card__deliverables" aria-label="Deliverables">
							{shown.map((d, i) => <li key={i} class="qte-card__deliverable">{d}</li>)}
							{more > 0 && <li class="qte-card__more">{more} more in the offer</li>}
						</ul>
					)}
					<p class="qte-card__ref">
						<Tooltip content={`SHA-256 of these terms: ${t.hash}`}>
							<span class="qte-card__refcode" tabIndex={0}>Terms ref {termsReference(t.hash)}</span>
						</Tooltip>
						{!card.intact && (
							<span class="qte-card__tamper" role="alert">
								These terms no longer match their record. Contact support before paying.
							</span>
						)}
					</p>
				</>
			)}

			{notice.value && (
				<p
					class={`qte-card__notice${notice.value.tone === "error" ? " qte-card__notice--error" : ""}`}
					role={notice.value.tone === "error" ? "alert" : "status"}
				>
					{notice.value.text}
				</p>
			)}

			{card.actions.length > 0 && card.intact && (
				<div class="qte-card__actions">
					{card.actions.map((kind) =>
						kind === "accept_offer" || kind === "checkout"
							? (
								<Button
									key={kind}
									label={ACT_LABELS[kind]}
									severity="accent"
									size="sm"
									aria-busy={busy.value === kind}
									onClick={() => press(kind)}
								/>
							)
							: (
								<Button
									key={kind}
									label={ACT_LABELS[kind]}
									severity="neutral"
									variant="outlined"
									size="sm"
									aria-busy={busy.value === kind}
									onClick={() => press(kind)}
								/>
							)
					)}
				</div>
			)}

			<QuoteConfirmDialog
				visible={confirmOpen}
				confirmation={confirming.value ? CONFIRMS[confirming.value] ?? null : null}
				busy={busy.value !== null}
				onConfirm={() => confirming.value && void run(confirming.value, card)}
			/>
		</article>
	);
}
