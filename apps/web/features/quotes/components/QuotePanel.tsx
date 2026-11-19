import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/quotes.css";
import { Button, useId } from "@projective/ui/fields";
import type {
	QuotableListing,
	QuoteActInput,
	QuoteActionKind,
	QuoteRole,
	QuoteView,
	SendQuoteOfferInput,
} from "@projective/types/services";
import { basketHref } from "@web/features/checkout/core/basket-model.ts";
import { QuoteService } from "../core/QuoteService.ts";
import { QuoteCard } from "./QuoteCard.tsx";
import { type QuoteConfirmation, QuoteConfirmDialog } from "./QuoteConfirmDialog.tsx";
import { QuoteOfferDialog } from "./QuoteOfferDialog.tsx";

/** Props for {@link QuotePanel}. */
export interface QuotePanelProps {
	/** The other person, `@handle`. */
	handle: string;
	/** Show only the requests where the viewer is on this side (the seller's drawer shows `host`). */
	only?: QuoteRole;
	/** The prefix of the panel's ids; each instance adds its own suffix, so two copies never collide. */
	idBase: string;
	/** The section's heading. */
	heading: string;
	/** Prefix for the section's classes, so a host surface keeps its own section register. */
	sectionClass: string;
	headingClass: string;
	/** Told after an act lands, so a host surface can re-read what the act changed. */
	onChanged?: () => void;
	/**
	 * Offer the viewer's own quote to this person (Decision #522): the panel reads the services the
	 * viewer may quote and, when there are any, shows Send a quote even before a request exists.
	 * `preferListing` is the listing slug to start the composer on (a listing's own Clients view).
	 */
	issuer?: { buyerName: string; preferListing?: string };
}

const CONFIRMATIONS: Partial<Record<QuoteActionKind, QuoteConfirmation>> = {
	withdraw_offer: {
		title: "Withdraw this offer?",
		body: "The buyer can no longer accept it. You can send a new offer afterwards.",
		confirmLabel: "Withdraw offer",
		withReason: false,
	},
	decline_request: {
		title: "Decline this request?",
		body: "The request closes and any open offer is withdrawn. The buyer is told.",
		confirmLabel: "Decline request",
		withReason: true,
	},
	decline_offer: {
		title: "Decline this offer?",
		body: "The seller is told and can send another.",
		confirmLabel: "Decline offer",
		withReason: false,
	},
	withdraw_request: {
		title: "Withdraw your request?",
		body:
			"The request closes for good, and an accepted offer leaves your basket. The seller is told.",
		confirmLabel: "Withdraw request",
		withReason: false,
	},
};

/**
 * QuotePanel — the quote requests between the viewer and one other person: each request's ask, its
 * current offer and the acts the server allows. The buyer accepts (the offer's one line joins their
 * basket and they continue to checkout) or declines; the host sends or revises an offer, withdraws it
 * or declines the request. Renders nothing until there is a request to show.
 */
export function QuotePanel(props: QuotePanelProps): JSX.Element | null {
	const quotes = useSignal<QuoteView[] | null>(null);
	const loadError = useSignal<string | null>(null);
	const attempt = useSignal(0);
	const busy = useSignal<{ id: string; kind: QuoteActionKind } | null>(null);
	const notice = useSignal<{ id: string; text: string; tone: "error" | "info" } | null>(null);
	const fieldErrors = useSignal<Record<string, string>>({});
	const target = useSignal<QuoteView | null>(null);
	const offerOpen = useSignal(false);
	const confirmKind = useSignal<QuoteActionKind | null>(null);
	const confirmOpen = useSignal(false);
	const handle = useSignal(props.handle);
	if (handle.peek() !== props.handle) handle.value = props.handle;
	const idBase = useId(undefined, props.idBase);
	const quotable = useSignal<readonly QuotableListing[] | null>(null);
	const issueOpen = useSignal(false);
	const issuing = !!props.issuer;

	useSignalEffect(() => {
		if (!issuing) return;
		let live = true;
		void QuoteService.listings().then((res) => {
			if (!live) return;
			const all = res.ok && res.data ? res.data.listings : [];
			const prefer = props.issuer?.preferListing;
			quotable.value = prefer && all.some((l) => l.slug === prefer)
				? [...all.filter((l) => l.slug === prefer), ...all.filter((l) => l.slug !== prefer)]
				: all;
		});
		return () => {
			live = false;
		};
	});

	async function issue(offer: SendQuoteOfferInput, listing: string | null): Promise<void> {
		if (!listing) return;
		busy.value = { id: "issue", kind: "send_offer" };
		fieldErrors.value = {};
		const res = await QuoteService.issue({
			action: "issue",
			buyer: handle.peek(),
			listing,
			scope: offer.scope,
			deliverables: offer.deliverables,
			priceMinor: offer.priceMinor,
			turnaroundDays: offer.turnaroundDays,
			expiresInDays: offer.expiresInDays,
		});
		busy.value = null;
		if (!res.ok || !res.data) {
			fieldErrors.value = res.errors ?? {};
			notice.value = { id: "issue", text: res.message ?? "That quote didn't go through. Try again.", tone: "error" };
			return;
		}
		const next = res.data.quote;
		const known = (quotes.value ?? []).some((q) => q.id === next.id);
		quotes.value = known
			? (quotes.value ?? []).map((q) => (q.id === next.id ? next : q))
			: [next, ...(quotes.value ?? [])];
		notice.value = { id: next.id, text: res.data.confirmation, tone: "info" };
		issueOpen.value = false;
		props.onChanged?.();
	}

	useSignalEffect(() => {
		const who = handle.value;
		void attempt.value;
		let live = true;
		loadError.value = null;
		void QuoteService.listWith(who).then((res) => {
			if (!live) return;
			if (res.ok && res.data) quotes.value = res.data.quotes;
			else loadError.value = res.message ?? "Quotes could not be loaded just now.";
		});
		return () => {
			live = false;
		};
	});

	async function run(
		quote: QuoteView,
		kind: QuoteActionKind,
		input: QuoteActInput,
	): Promise<boolean> {
		busy.value = { id: quote.id, kind };
		notice.value = null;
		fieldErrors.value = {};
		const res = await QuoteService.act(quote.id, input);
		busy.value = null;
		if (!res.ok || !res.data) {
			notice.value = {
				id: quote.id,
				text: res.message ?? "That didn't go through. Try again.",
				tone: "error",
			};
			fieldErrors.value = res.errors ?? {};
			return false;
		}
		const next = res.data.quote;
		quotes.value = (quotes.value ?? []).map((q) => (q.id === next.id ? next : q));
		props.onChanged?.();
		if (input.action === "accept_offer" && res.data.basketId) {
			globalThis.location.assign(basketHref(res.data.basketId));
			return true;
		}
		notice.value = { id: quote.id, text: res.data.confirmation, tone: "info" };
		return true;
	}

	function act(quote: QuoteView, kind: QuoteActionKind): void {
		target.value = quote;
		if (kind === "send_offer") {
			fieldErrors.value = {};
			offerOpen.value = true;
			return;
		}
		if (kind === "accept_offer" || kind === "checkout") {
			if (quote.offer) void run(quote, kind, { action: "accept_offer", offerId: quote.offer.id });
			return;
		}
		confirmKind.value = kind;
		confirmOpen.value = true;
	}

	async function send(offer: SendQuoteOfferInput): Promise<void> {
		const quote = target.peek();
		if (!quote) return;
		if (await run(quote, "send_offer", offer)) offerOpen.value = false;
	}

	async function confirm(reason: string | undefined): Promise<void> {
		const quote = target.peek();
		const kind = confirmKind.peek();
		if (!quote || !kind) return;
		const input: QuoteActInput | null = kind === "decline_request"
			? { action: "decline_request", reason }
			: kind === "withdraw_request"
			? { action: "withdraw_request" }
			: quote.offer && (kind === "withdraw_offer" || kind === "decline_offer")
			? { action: kind, offerId: quote.offer.id }
			: null;
		if (!input) return;
		await run(quote, kind, input);
		confirmOpen.value = false;
	}

	const shown = (quotes.value ?? []).filter((q) => !props.only || q.role === props.only);
	const headingId = `${idBase}-quotes`;

	if (loadError.value && !quotes.value) {
		return (
			<section class={props.sectionClass} aria-labelledby={headingId}>
				<h3 class={props.headingClass} id={headingId}>{props.heading}</h3>
				<p class="qte-panel__state" role="alert">{loadError.value}</p>
				<Button
					label="Try again"
					size="sm"
					severity="neutral"
					variant="outlined"
					onClick={() => attempt.value++}
				/>
			</section>
		);
	}
	const canIssue = issuing && (quotable.value?.length ?? 0) > 0;
	if (shown.length === 0 && !canIssue) return null;

	return (
		<section class={props.sectionClass} aria-labelledby={headingId}>
			<div class="qte-panel__head">
				<h3 class={props.headingClass} id={headingId}>{props.heading}</h3>
				{canIssue && (
					<Button
						label="Send a quote"
						size="sm"
						severity="neutral"
						variant="outlined"
						onClick={() => {
							fieldErrors.value = {};
							issueOpen.value = true;
						}}
					/>
				)}
			</div>
			{notice.value?.id === "issue" && (
				<p class="qte__notice qte__notice--error" role="alert">{notice.value.text}</p>
			)}
			{shown.length === 0 && (
				<p class="qte-panel__state">
					Price a custom scope on one of your services. It lands in your conversation as a quote card.
				</p>
			)}
			<div class="qte-panel">
				{shown.map((q) => (
					<QuoteCard
						key={q.id}
						quote={q}
						idBase={idBase}
						busy={busy.value?.id === q.id ? busy.value.kind : null}
						notice={notice.value?.id === q.id ? notice.value : null}
						onAct={(kind) => act(q, kind)}
					/>
				))}
			</div>
			{target.value && (
				<QuoteOfferDialog
					visible={offerOpen}
					quote={target.value}
					busy={busy.value?.kind === "send_offer"}
					errors={fieldErrors.value}
					onSend={(offer) => void send(offer)}
				/>
			)}
			{props.issuer && (
				<QuoteOfferDialog
					visible={issueOpen}
					issue={{ buyerName: props.issuer.buyerName, listings: quotable.value }}
					busy={busy.value?.id === "issue"}
					errors={fieldErrors.value}
					onSend={(offer, listing) => void issue(offer, listing)}
				/>
			)}
			<QuoteConfirmDialog
				visible={confirmOpen}
				confirmation={confirmKind.value ? CONFIRMATIONS[confirmKind.value] ?? null : null}
				busy={busy.value !== null}
				onConfirm={(reason) => void confirm(reason)}
			/>
		</section>
	);
}
