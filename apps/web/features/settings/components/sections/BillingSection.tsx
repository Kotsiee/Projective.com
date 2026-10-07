import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { type CardsPayload, CardsService } from "@features/checkout/core/CardsService.ts";
import type { CheckoutContext, SavedCard } from "@features/checkout/types/checkout-types.ts";
import {
	IDLE,
	OutLink,
	type SaveState,
	SaveStatus,
	SectionHead,
	SettingsBlock,
} from "../SettingsParts.tsx";
import { sectionMeta } from "../../core/settings-registry.ts";

/**
 * Settings → Billing (Decision #150): the cards saved against the acting account — which one a card
 * payment pre-selects, and removing one — through the checkout's own `/api/cards` routes and
 * `CardsService`, so the default here is the default at checkout. Adding a card stays where Stripe's
 * card field already lives (checkout and the wallet): nothing in this section can take a card number.
 */

/** The acting account's own cards — no basket, the active context, no display override. */
const ACTING: CheckoutContext = { basketId: null, owner: null, display: null };

const BRAND: Readonly<Record<string, string>> = {
	visa: "Visa",
	mastercard: "Mastercard",
	amex: "American Express",
	discover: "Discover",
	diners: "Diners Club",
	jcb: "JCB",
	unionpay: "UnionPay",
};

function cardName(card: SavedCard): string {
	const brand = BRAND[String(card.brand).toLowerCase()] ?? "Card";
	return card.last4 ? `${brand} ending ${card.last4}` : brand;
}

function expiry(card: SavedCard): { text: string; expired: boolean } {
	if (!card.expMonth || !card.expYear) return { text: "", expired: false };
	const now = new Date();
	const expired = card.expYear < now.getFullYear() ||
		(card.expYear === now.getFullYear() && card.expMonth < now.getMonth() + 1);
	return {
		text: `${expired ? "Expired" : "Expires"} ${String(card.expMonth).padStart(2, "0")}/${
			String(card.expYear).slice(-2)
		}`,
		expired,
	};
}

export function BillingSection(): JSX.Element {
	const meta = sectionMeta("billing");
	const payload = useSignal<CardsPayload | null>(null);
	const loadError = useSignal<string | null>(null);
	const busy = useSignal<string | null>(null);
	const confirming = useSignal<string | null>(null);
	const status = useSignal<SaveState>(IDLE);

	useEffect(() => {
		CardsService.list(ACTING).then((res) => {
			if (res.ok && res.data) payload.value = res.data;
			else loadError.value = res.message ?? "Your saved cards couldn't be loaded just now.";
		});
	}, []);

	async function act(
		key: string,
		call: () => ReturnType<typeof CardsService.list>,
		done: string,
	): Promise<void> {
		busy.value = key;
		status.value = { tone: "busy", text: "Working…" };
		const res = await call();
		busy.value = null;
		confirming.value = null;
		if (res.ok && res.data) {
			payload.value = res.data;
			status.value = { tone: "saved", text: done };
		} else {
			status.value = { tone: "error", text: res.message ?? "That didn't work just now." };
		}
	}

	const p = payload.value;
	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />
			<SettingsBlock
				anchor="cards"
				title="Saved cards"
				description="The default card is pre-selected when you pay by card. Card details are held by Stripe, never by Projective."
			>
				{loadError.value
					? <InlineNotice align="start" text={loadError.value} />
					: p === null
					? <p class="stg-note">Loading…</p>
					: p.cards.length === 0
					? <p class="stg-note">No saved cards. You can save one the next time you pay by card.</p>
					: (
						<ul class="stg-cards" aria-label="Saved cards">
							{p.cards.map((card) => {
								const exp = expiry(card);
								const isDefault = p.defaultCardId === card.id;
								return (
									<li key={card.id} class="stg-cards__item">
										<div class="stg-cards__main">
											<span class="stg-cards__name">{cardName(card)}</span>
											<span class="stg-cards__meta">
												{isDefault ? <span class="stg-pill stg-pill--primary">Default</span> : null}
												{exp.text
													? (
														<span class={exp.expired ? "stg-cards__expired" : undefined}>
															{exp.text}
														</span>
													)
													: null}
												{card.cardholderName ? <span>{card.cardholderName}</span> : null}
											</span>
										</div>
										{confirming.value === card.id
											? (
												<div
													class="stg-emails__confirm"
													role="group"
													aria-label={`Remove ${cardName(card)}?`}
												>
													<span class="stg-emails__ask">Remove this card?</span>
													<Button
														size="sm"
														severity="danger"
														label="Remove"
														loading={busy.value === card.id}
														onClick={() =>
															act(
																card.id,
																() => CardsService.remove(card.id, ACTING),
																`${cardName(card)} removed.`,
															)}
													/>
													<Button
														size="sm"
														variant="text"
														severity="secondary"
														label="Keep"
														onClick={() => (confirming.value = null)}
													/>
												</div>
											)
											: (
												<div class="stg-emails__actions">
													{!isDefault && !exp.expired
														? (
															<Button
																size="sm"
																variant="text"
																label="Make default"
																loading={busy.value === `d:${card.id}`}
																onClick={() =>
																	act(
																		`d:${card.id}`,
																		() => CardsService.setDefault(card.id, ACTING),
																		`${cardName(card)} is now your default card.`,
																	)}
															/>
														)
														: null}
													<Button
														size="sm"
														variant="text"
														severity="danger"
														label="Remove"
														aria-label={`Remove ${cardName(card)}`}
														onClick={() => (confirming.value = card.id)}
													/>
												</div>
											)}
									</li>
								);
							})}
						</ul>
					)}
				<SaveStatus state={status.value} />
				<OutLink href="/wallet">Payment methods in your wallet</OutLink>
			</SettingsBlock>
		</div>
	);
}
