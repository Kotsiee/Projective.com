import type { JSX } from "preact";
import { cx } from "@ui/core/cx.ts";
import { resolveCardArt } from "@projective/types/finance";
import { Badge, PaymentCard, PaymentCardOption } from "@projective/ui/display";
import type { PaymentCardArt, PaymentCardData } from "@projective/ui/display";
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
 * PaymentChoice — how the buyer is paying: the six routes, the card a card payment charges, and the
 * face the summary rail names that instrument by.
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
 *
 * ## Two presentations, one radio group
 *
 * The design gives the wallet route a **container of its own** — a heading, the instrument's face, the
 * balance at display scale and a top-up pill — while the other five stay compact rows. That is a
 * presentation split, not a structural one: all six are still options of the same
 * `role="radiogroup"`, in the SSOT's enum order, and the wallet's container is the same
 * `.cko-pay__opt` element with a modifier. Lifting the wallet out into its own control would have
 * given the page two selection models for one decision.
 *
 * ## The card picker is a LIST, not a wall of cards
 *
 * Saved cards render as rows inside one bordered group: a thumbnail face, the programme and holder on
 * the left, the masked tail and expiry on the right. The radio semantics are unchanged —
 * {@link PaymentCardOption} is still the `role="radio"` button and still owns the roving tab stop —
 * so the list is a smaller drawing of the same control, not a different one.
 *
 * The thumbnail is the SAME 302:192 plate as the wallet's, narrowed by a call-site `--pc-max`. It is
 * never the package's own geometry: an instrument that changes proportion between the picker and the
 * summary is an instrument the buyer has to re-identify.
 */

// #region The wallet's own instrument face
/**
 * The card face the Projective wallet is drawn as.
 *
 * `networkLabel` is overridden to the platform's own name rather than left at the SSOT's
 * `"Projective Vault Card"`. That label names a **real, separate product** — a physical/virtual card
 * issued against a balance — and printing it on the wallet route would tell a buyer they are paying
 * with an instrument they may not hold. Everything else is the SSOT's resolved `vault` art, so the
 * face re-tones with the theme like every other card on the platform.
 */
export function walletCardArt(): PaymentCardArt {
	return {
		...resolveCardArt({ brand: "vault", binNumber: null, isBusinessCard: false }),
		networkLabel: "Projective",
		issuerHint: null,
	};
}

/**
 * The wallet's card DATA — deliberately almost empty.
 *
 * There is no number, no expiry and no security code on a wallet balance, and {@link PaymentCard}
 * degrades every absent field to absence rather than to a placeholder. So the face prints a chip, the
 * account name and the Projective mark, and claims nothing it does not hold.
 *
 * @param holder The account the money is being spent from; `null` prints no name.
 */
export function walletCardData(holder: string | null): PaymentCardData {
	return {
		brand: "vault",
		last4: null,
		expMonth: null,
		expYear: null,
		cardholderName: holder,
		binNumber: null,
		isBusinessCard: false,
		isDefault: false,
		isExpired: false,
	};
}
// #endregion

// #region Card display fragments
/**
 * What a saved card is CALLED — the programme we can honestly derive, never the issuing bank.
 *
 * Exported so the payment step's summary rail names the instrument with the same words the picker
 * does; two derivations of one label is how a buyer comes to think they chose a different card.
 */
export function cardBrandLabel(card: SavedCard): string {
	const art = resolveCardArt({
		brand: card.brand,
		binNumber: card.binNumber,
		isBusinessCard: card.isBusinessCard,
	});
	return art.issuerHint ?? art.networkLabel;
}

/**
 * `MM/YYYY`, or `null` when either half is missing.
 *
 * Mirrors the package's own rule: a partial expiry renders NOTHING rather than a placeholder, because
 * `--/--` in the slot where a date belongs reads as a date that failed to load.
 */
export function cardExpiryLabel(card: SavedCard): string | null {
	const { expMonth: month, expYear: year } = card;
	if (month == null || year == null) return null;
	if (!Number.isFinite(month) || !Number.isFinite(year)) return null;
	return `${String(month).padStart(2, "0")}/${year}`;
}
// #endregion

// #region The chosen instrument, as the summary rail names it
/**
 * What the summary rail calls the instrument this payment will charge.
 *
 * Delegates to the SAME vocabulary the picker uses — {@link cardBrandLabel} for a card,
 * `PROVIDER_LABEL` for every other route — so the rail and the picker cannot name one choice two
 * ways. A route with nothing chosen yet says so; it never guesses.
 *
 * @param provider The chosen route; `null` before the buyer picks one.
 * @param card The card a card payment will charge; `null` for every other route.
 */
export function instrumentLabel(
	provider: PaymentProvider | null,
	card: SavedCard | null,
): string {
	if (provider === null) return "Not chosen yet";
	if (provider === "wallet") return "Projective Wallet";
	if (provider === "card") return card ? cardBrandLabel(card) : PROVIDER_LABEL.card;
	return PROVIDER_LABEL[provider];
}

/** Props for {@link InstrumentFace}. */
export interface InstrumentFaceProps {
	/** The chosen route; `null` before the buyer picks one. */
	provider: PaymentProvider | null;
	/** The card a card payment will charge; `null` for every other route. */
	card: SavedCard | null;
	/** The account the money is spent from — printed on the wallet's face. */
	ownerName: string;
	class?: string;
}

/**
 * A thumbnail of the instrument this payment will charge.
 *
 * A wallet and a card both have a real plate, so both draw one — the same face the picker showed, at
 * the summary's scale. Every other route has no plate at all, and inventing one would put a card in
 * front of a buyer paying by PayPal; those render the route's own registry glyph on a plain tile.
 *
 * Always `decorative`: the name sits in text beside it, so a second announcement of the same fact is
 * noise, and a flip control inside a summary row is a keyboard trap with nothing behind it.
 */
export function InstrumentFace(props: InstrumentFaceProps): JSX.Element {
	const { provider, card } = props;

	if (provider === "wallet") {
		return (
			<PaymentCard
				class={props.class}
				card={walletCardData(props.ownerName)}
				art={walletCardArt()}
				size="sm"
				decorative
			/>
		);
	}

	if (provider === "card" && card) {
		return (
			<PaymentCard
				class={props.class}
				card={card}
				art={resolveCardArt({
					brand: card.brand,
					binNumber: card.binNumber,
					isBusinessCard: card.isBusinessCard,
				})}
				size="sm"
				decorative
			/>
		);
	}

	return (
		<span class={cx("cko-instrument__tile", props.class)} aria-hidden="true">
			<Icon name={provider ? providerIcon(provider) : "wallet"} />
		</span>
	);
}
// #endregion

// #region Provider choice
/** Props for {@link ProviderChoice}. */
export interface ProviderChoiceProps {
	/** Every route, available or not, in the SSOT's enum order. */
	providers: readonly ProviderAvailability[];
	/** The chosen route; `null` until one is adopted. */
	chosen: PaymentProvider | null;
	/** The wallet's standing against this checkout — rendered inside the wallet route. */
	wallet: CheckoutWallet;
	/** The account the money is spent from — printed on the wallet's face. */
	ownerName: string;
	/** The id of the heading that labels the group. */
	labelledBy: string;
	onChoose: (provider: PaymentProvider) => void;
}

/** The wallet's balance and, when it falls short, what to do about it. */
function WalletDetail(props: { wallet: CheckoutWallet; ownerName: string }): JSX.Element {
	const { wallet, ownerName } = props;

	return (
		<div class="cko-wallet" data-covers={wallet.covers ? "true" : "false"}>
			<div class="cko-wallet__instrument">
				{
					/*
					 * `decorative`, so the whole face is `aria-hidden` and carries no interactive
					 * descendant: it sits inside a `role="radio"` option, where a nested control would be
					 * invalid HTML and break both. Every fact it draws is stated in text beside it.
					 */
				}
				<PaymentCard
					class="cko-card cko-wallet__face"
					card={walletCardData(ownerName)}
					art={walletCardArt()}
					size="md"
					decorative
				/>

				<div class="cko-wallet__standing">
					<p class="cko-wallet__figure">
						<span class="cko-wallet__figure-label">Available balance</span>
						<Amount value={wallet.available} size="hero" />
					</p>

					{
						/*
						 * Topping up is offered whether or not the balance covers this purchase. A buyer who
						 * is covered today may still be putting money aside for the rest of a pipeline, and
						 * hiding the action until they are short makes the wallet look like a thing that only
						 * appears when something is wrong.
						 *
						 * It is an ANCHOR, not a button: it navigates to a real page, so it must survive a
						 * middle-click and an open-in-new-tab like every other route on the platform. The
						 * pill shape is the checkout's owner-approved action shape, applied through the
						 * shared button class so it matches the real controls beside it.
						 */
					}
					<a
						class="ui-button ui-button--outlined ui-button--size-sm ui-button--rounded cko-wallet__topup"
						href="/wallet"
						target="_blank"
						rel="noopener noreferrer"
					>
						<Icon name="plus" size="sm" />
						Top Up
						<span class="ui-visually-hidden">(opens in a new tab)</span>
					</a>
				</div>
			</div>

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
				const isWallet = offer.provider === "wallet";

				return (
					<div
						key={offer.provider}
						class={isWallet ? "cko-pay__opt cko-pay__opt--wallet" : "cko-pay__opt"}
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

						{isWallet && (
							<div class="cko-pay__detail">
								<WalletDetail wallet={wallet} ownerName={props.ownerName} />
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
	/**
	 * Opens the add-a-method modal. Used by the EMPTY state only — the populated list's "Add Card"
	 * lives in the step's action row beneath it, where the design puts it. Omitted where no such modal
	 * is mounted, in which case the empty state falls back to the wallet's own payment-methods page
	 * rather than offering a dead control.
	 */
	onAddCard?: () => void;
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
 *
 * **The row forwards a click to the option.** The option button wraps only the thumbnail face — it
 * accepts no children — so the programme, holder, masked tail and expiry are siblings of it. A
 * pointer landing on that text would otherwise select nothing, which on a row that reads as one
 * target is a dead click. The forward is a mouse convenience layered over a control that is already
 * fully keyboard-operable, never a substitute for one, and it is idempotent: selecting the card that
 * is already selected changes nothing.
 */
export function CardChooser(props: CardChooserProps): JSX.Element {
	const { cards, chosen } = props;

	if (cards.length === 0) {
		return (
			<div class="cko-cards__empty" role="status">
				<Icon name="info" />
				{props.onAddCard
					? (
						<span>
							No cards are saved on this account yet.{" "}
							<button type="button" class="cko-cards__addlink" onClick={props.onAddCard}>
								Add a payment method
							</button>{" "}
							to pay by card.
						</span>
					)
					: (
						<span>
							No cards are saved on this account yet. Add one in{" "}
							<a href="/wallet/methods" target="_blank" rel="noopener noreferrer">
								payment methods
							</a>, then reload this page.
						</span>
					)}
			</div>
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
			class="cko-cardlist"
			role="radiogroup"
			aria-label="Card to charge"
			onKeyDown={onKeyDown}
		>
			{cards.map((card) => {
				const art = resolveCardArt({
					brand: card.brand,
					binNumber: card.binNumber,
					isBusinessCard: card.isBusinessCard,
				});
				const expiry = cardExpiryLabel(card);

				return (
					<div
						key={card.id}
						class="cko-cardlist__row"
						data-checked={chosen === card.id ? "true" : "false"}
						data-expired={card.isExpired ? "true" : undefined}
						onClick={card.isExpired ? undefined : () => props.onChoose(card.id)}
					>
						<PaymentCardOption
							id={optionId(card.id)}
							// The thumbnail hook. It is a CLASS rather than an inline style because
							// `PaymentCard` overwrites `style` with its own art variables — an inline
							// `--pc-ratio` would be dropped silently and would review as correct. It carries
							// the 302:192 proportion at a narrowed `--pc-max`, so the plate here and the plate
							// in the summary rail are one shape at two scales.
							class="cko-cardlist__face"
							card={card}
							// The SSOT's resolved art, not the component's local fallback: the face then matches
							// the projection the server sent rather than a parallel derivation of it.
							art={art}
							size="sm"
							checked={chosen === card.id}
							disabled={card.isExpired}
							tabIndex={card.id === focusTarget ? 0 : -1}
							onSelect={() => props.onChoose(card.id)}
						/>

						<span class="cko-cardlist__body">
							<span class="cko-cardlist__brand">{art.issuerHint ?? art.networkLabel}</span>
							{card.cardholderName && (
								<span class="cko-cardlist__holder">{card.cardholderName}</span>
							)}

							{
								/*
								 * The "Selected" mark is a SIBLING of the option, never a child of it: the
								 * option is a `role="radio"` button, and nesting anything interactive-looking
								 * inside a radio is invalid and breaks both controls. `Badge` renders
								 * `aria-hidden` unless given a label, which is right here — `aria-checked` on
								 * the option already carries the fact, and a second announcement is noise.
								 */
							}
							<span class="cko-cardlist__tags">
								{chosen === card.id && (
									<Badge
										class="cko-cardlist__badge"
										value="Selected"
										severity="primary"
										size="sm"
									/>
								)}
								{card.isBusinessCard && <span class="cko-tag">Business card</span>}
								{card.isDefault && <span class="cko-tag">Default</span>}
								{card.isExpired && (
									<span class="cko-tag" data-tone="warning">
										<Icon name="warning" />
										Expired
									</span>
								)}
							</span>
						</span>

						<span class="cko-cardlist__ident">
							{
								/*
								 * The mask is the SHAPE of a card number and is hidden from assistive tech, so
								 * it can never be mistaken for digits we hold; the tail is the only real
								 * fragment and is spoken as "ending 5623". A card with no `last4` prints no
								 * number at all rather than a mask of nothing.
								 */
							}
							{card.last4 && (
								<span class="cko-cardlist__pan">
									<span class="cko-cardlist__mask" aria-hidden="true">••••</span>
									<span class="ui-visually-hidden">ending</span>
									<span class="cko-cardlist__tail">{card.last4}</span>
								</span>
							)}
							{expiry && <span class="cko-cardlist__exp">{expiry}</span>}
						</span>
					</div>
				);
			})}
		</div>
	);
}
// #endregion
