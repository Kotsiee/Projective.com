import type { JSX } from "preact";
import { resolveCardArt } from "@projective/types/finance";
import { PaymentCardOption } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { PROVIDER_LABEL, PROVIDER_NOTE, providerIcon } from "../core/checkout-model.ts";
import { Amount } from "./Amount.tsx";
import type {
	CheckoutWallet,
	PaymentProvider,
	ProviderAvailability,
	SavedCard,
} from "../types/checkout-types.ts";

/**
 * PaymentChoice — how the buyer is paying: the six routes, and the card a card payment charges.
 *
 * **A refused route is rendered, disabled, and carries its reason.** `availableProviders` returns all
 * six in enum order with a sentence on every refusal, and this component shows all six. A payment
 * method that is silently absent is unexplainable — the buyer cannot tell whether they are
 * ineligible, whether the platform is broken, or whether they simply cannot see it — which is the
 * same absence-versus-gate distinction `/wallet` draws: a capability the account does not have is
 * absent, a capability it is not yet allowed to use is present and locked with the reason attached.
 *
 * The reason is wired as `aria-describedby` on the radio itself, so a screen-reader user hears why a
 * route is closed at the moment they land on it rather than having to hunt for the text beside it.
 */

// #region Provider choice
/** Props for {@link ProviderChoice}. */
export interface ProviderChoiceProps {
	/** Every route, available or not, in the SSOT's enum order. */
	providers: readonly ProviderAvailability[];
	/** The chosen route; `null` until one is adopted. */
	chosen: PaymentProvider | null;
	/** The wallet's standing against this checkout — rendered inside the wallet route. */
	wallet: CheckoutWallet;
	/** The id of the heading that labels the group. */
	labelledBy: string;
	onChoose: (provider: PaymentProvider) => void;
}

/** The wallet's balance and, when it falls short, what to do about it. */
function WalletDetail(props: { wallet: CheckoutWallet }): JSX.Element {
	const { wallet } = props;

	return (
		<div class="cko-wallet" data-covers={wallet.covers ? "true" : "false"}>
			<p class="cko-wallet__row">
				<span class="cko-wallet__label">Available balance</span>
				<Amount value={wallet.available} size="body" />
			</p>

			{!wallet.covers && (
				<>
					<p class="cko-wallet__row" data-short="true">
						<span class="cko-wallet__label">Short by</span>
						<Amount value={wallet.shortfall} size="body" />
					</p>
					{
						/*
						 * Two routes out, both real pages. There is no "top up and pay" action here: that
						 * would be a second money movement composed on a surface whose whole job is the
						 * first one, and the wallet already owns topping up — including the disclosure of
						 * what a top-up costs, which this surface does not carry.
						 */
					}
					<p class="cko-wallet__actions">
						<a class="cko-wallet__link" href="/wallet" target="_blank" rel="noopener noreferrer">
							<Icon name="wallet" />
							Top up your wallet
							<span class="ui-visually-hidden">(opens in a new tab)</span>
						</a>
						<a
							class="cko-wallet__link"
							href="/wallet/funding"
							target="_blank"
							rel="noopener noreferrer"
						>
							<Icon name="refresh" />
							Set up automatic top-ups
							<span class="ui-visually-hidden">(opens in a new tab)</span>
						</a>
					</p>
					<p class="cko-wallet__note">
						Topping up in another tab? Come back and reload this page so the balance is re-checked.
					</p>
				</>
			)}
		</div>
	);
}

/** Render the six payment routes as one radio group. */
export function ProviderChoice(props: ProviderChoiceProps): JSX.Element {
	const { providers, chosen, wallet, labelledBy } = props;

	if (providers.length === 0) {
		return (
			<p class="cko-pay__empty" role="status">
				No payment routes have been worked out for this checkout yet — there is nothing to pay for.
			</p>
		);
	}

	return (
		<div class="cko-pay" role="radiogroup" aria-labelledby={labelledBy}>
			{providers.map((offer) => {
				const id = `cko-provider-${offer.provider}`;
				const reasonId = `${id}-reason`;
				const noteId = `${id}-note`;
				const checked = chosen === offer.provider;

				return (
					<div
						key={offer.provider}
						class="cko-pay__opt"
						data-available={offer.available ? "true" : "false"}
						data-checked={checked ? "true" : "false"}
					>
						<input
							type="radio"
							class="cko-pay__radio"
							id={id}
							name="cko-provider"
							value={offer.provider}
							checked={checked}
							disabled={!offer.available}
							aria-describedby={offer.available ? noteId : `${noteId} ${reasonId}`}
							onChange={() => props.onChoose(offer.provider)}
						/>
						<label class="cko-pay__main" for={id}>
							<span class="cko-pay__glyph" aria-hidden="true">
								<Icon name={providerIcon(offer.provider)} />
							</span>
							<span class="cko-pay__label">{PROVIDER_LABEL[offer.provider]}</span>
						</label>

						<p class="cko-pay__note" id={noteId}>{PROVIDER_NOTE[offer.provider]}</p>

						{
							/*
							 * The server's own words for the refusal, rendered verbatim. Two wordings of one
							 * refusal is how a buyer comes to believe they have two different problems.
							 */
						}
						{!offer.available && offer.reason && (
							<p class="cko-pay__reason" id={reasonId}>
								<Icon name="lock" />
								<span>{offer.reason}</span>
							</p>
						)}

						{offer.provider === "wallet" && (
							<div class="cko-pay__detail">
								<WalletDetail wallet={wallet} />
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
// #endregion

// #region Card choice
/** Props for {@link CardChooser}. */
export interface CardChooserProps {
	cards: readonly SavedCard[];
	/** The card a card payment will charge; `null` when none is usable. */
	chosen: string | null;
	onChoose: (cardId: string) => void;
}

/** The DOM id of one card option, so the roving focus can move without a ref per cell. */
function optionId(cardId: string): string {
	return `cko-card-${cardId}`;
}

/**
 * The saved-card picker.
 *
 * `PaymentCardOption` is a `role="radio"` button and deliberately owns neither the group nor the
 * keyboard model — that stays with whoever owns the collection, which is here. So this component
 * supplies the `role="radiogroup"` wrapper, the group label, the roving `tabIndex` (only the checked
 * option is `0`, so a wallet of eight cards costs one Tab stop rather than eight) and the arrow-key
 * behaviour a radio group is expected to have, including selecting on arrow as native radios do.
 *
 * An expired card is rendered and disabled rather than hidden: "my card isn't listed" and "my card is
 * out of date" are different problems with different fixes, and only one of them is solved by adding
 * a new card.
 */
export function CardChooser(props: CardChooserProps): JSX.Element {
	const { cards, chosen } = props;

	if (cards.length === 0) {
		return (
			<p class="cko-cards__empty" role="status">
				<Icon name="info" />
				<span>
					No cards are saved on this account yet. Add one in{" "}
					<a href="/wallet/methods" target="_blank" rel="noopener noreferrer">
						payment methods
					</a>, then reload this page.
				</span>
			</p>
		);
	}

	const usable = cards.filter((card) => !card.isExpired);
	// When nothing is chosen the FIRST usable card holds the group's single tab stop, so the group is
	// always reachable — an all-`-1` group is a radiogroup the keyboard cannot enter.
	const focusTarget = chosen ?? usable[0]?.id ?? null;

	const move = (from: string, delta: number) => {
		if (usable.length === 0) return;
		const at = usable.findIndex((card) => card.id === from);
		const next = usable[((at < 0 ? 0 : at + delta) + usable.length) % usable.length];
		if (!next) return;
		props.onChoose(next.id);
		document.getElementById(optionId(next.id))?.focus();
	};

	const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const active = (event.target as HTMLElement | null)?.id ?? "";
		const cardId = active.startsWith("cko-card-") ? active.slice("cko-card-".length) : null;
		if (!cardId) return;

		switch (event.key) {
			case "ArrowRight":
			case "ArrowDown":
				event.preventDefault();
				move(cardId, 1);
				break;
			case "ArrowLeft":
			case "ArrowUp":
				event.preventDefault();
				move(cardId, -1);
				break;
			case "Home":
				event.preventDefault();
				if (usable[0]) {
					props.onChoose(usable[0].id);
					document.getElementById(optionId(usable[0].id))?.focus();
				}
				break;
			case "End": {
				event.preventDefault();
				const last = usable[usable.length - 1];
				if (last) {
					props.onChoose(last.id);
					document.getElementById(optionId(last.id))?.focus();
				}
				break;
			}
		}
	};

	return (
		<div
			class="cko-cards__grid"
			role="radiogroup"
			aria-label="Card to charge"
			onKeyDown={onKeyDown}
		>
			{cards.map((card) => (
				<div key={card.id} class="cko-cards__cell">
					<PaymentCardOption
						id={optionId(card.id)}
						card={card}
						// The SSOT's resolved art, not the component's local fallback: the face then matches
						// the projection the server sent rather than a parallel derivation of it.
						art={resolveCardArt({
							brand: card.brand,
							binNumber: card.binNumber,
							isBusinessCard: card.isBusinessCard,
						})}
						size="sm"
						checked={chosen === card.id}
						disabled={card.isExpired}
						tabIndex={card.id === focusTarget ? 0 : -1}
						onSelect={() => props.onChoose(card.id)}
					/>
					<p class="cko-cards__tags">
						{card.isBusinessCard && <span class="cko-tag">Business card</span>}
						{card.isDefault && <span class="cko-tag">Default</span>}
						{card.isExpired && (
							<span class="cko-tag" data-tone="warning">
								<Icon name="warning" />
								Expired
							</span>
						)}
					</p>
				</div>
			))}
		</div>
	);
}
// #endregion
