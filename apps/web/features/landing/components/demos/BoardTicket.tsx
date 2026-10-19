import type { JSX } from "preact";
import { type Signal, signal } from "@preact/signals";
import { type DndContextValue } from "@ui/dnd/core/context.ts";
import { createDndStore } from "@ui/dnd/core/store.ts";
import {
	type DemoBeat,
	type DemoCardView,
	FUNDING_TAG_LABEL,
	FUNDING_TAG_TONE,
} from "@features/landing/core/demos/board-model.ts";
import { BOARD_DEMO_COPY, ticketMoney } from "@features/landing/core/demos/board-demo.ts";

// #region Ticket face
/** Props for {@link BoardTicket}. */
export interface BoardTicketProps {
	card: DemoCardView;
	currency: string;
	/** What the last action did to this card, if it changed it: a success tint for a payment or a payout. */
	beat?: DemoBeat["kind"] | null;
	/**
	 * Counts this card's refused moves; each new count re-keys the face so its over-damped nudge
	 * plays again. `0` or absent: no nudge.
	 */
	nudge?: number;
	/**
	 * Draw the card's next control (Pay for this stage, Approve and pay) as a picture inside the face
	 * — for a still, whose controls cannot be used. A live board renders the real buttons beside the
	 * card instead.
	 */
	pictures?: boolean;
	/** Whether the card asks the client to pay its current stage (for {@link pictures}). */
	asksToPay?: boolean;
}

/**
 * BoardTicket — one task's face on the demo stage's Work board, on the product card's anatomy
 * (`TicketCard`, as the hero theatre's face is): the title, then the stage on the left and the
 * funding tag, the price and the assignee on the right. The tag is a lifecycle status, drawn on the
 * product's compact recipe; a card in a work lane wears none, as on the product's card. Rendered
 * inside the real `@projective/ui` kanban card, so it is never interactive itself.
 */
export function BoardTicket(
	{ card, currency, beat = null, nudge = 0, pictures = false, asksToPay = false }: BoardTicketProps,
): JSX.Element {
	const success = beat === "paid" || beat === "team_paid";
	return (
		<div
			key={`${card.id}-${nudge}`}
			class="lp-ticket lp-board-ticket"
			data-lp-beat={success ? beat : undefined}
			data-lp-nudge={nudge > 0 ? "" : undefined}
		>
			<p class="lp-ticket__title">{card.title}</p>
			<div class="lp-ticket__foot">
				<span class="lp-ticket__stage">{card.stageName ?? ""}</span>
				<span class="lp-ticket__end">
					{card.tag
						? (
							<span class="lp-ticket__tag" data-tone={FUNDING_TAG_TONE[card.tag]}>
								{FUNDING_TAG_LABEL[card.tag]}
							</span>
						)
						: null}
					{card.totalMinor !== null
						? <span class="lp-ticket__budget">{ticketMoney(card.totalMinor, currency)}</span>
						: null}
					{card.assignee?.avatar
						? (
							<img
								class="lp-ticket__avatar"
								src={card.assignee.avatar}
								alt=""
								width={20}
								height={20}
								loading="lazy"
								decoding="async"
							/>
						)
						: <span class="lp-ticket__unassigned" />}
				</span>
			</div>
			{pictures && card.awaitsApproval
				? <span class="lp-ticket__approve">{BOARD_DEMO_COPY.approve}</span>
				: null}
			{pictures && asksToPay && !card.awaitsApproval
				? <span class="lp-ticket__approve">{BOARD_DEMO_COPY.pay}</span>
				: null}
		</div>
	);
}
// #endregion

// #region Static kanban
/**
 * The drag context the package's kanban parts need in order to render a still: nothing in it is
 * dragged, its cards are neither draggable nor activatable (so they render with no role and no tab
 * stop), and its sensors are never armed.
 */
export function stillDnd(): DndContextValue {
	return {
		store: createDndStore(),
		armPointer: () => {},
		beginKeyboard: () => {},
		keyboardActive: () => false,
	};
}

/** No drop target: nothing is ever dragged over a still. */
export const NO_DROP: Signal<{ columnId: string; renderIndex: number } | null> = signal(null);
// #endregion
