import type { JSX } from "preact";
import { resolveCardArt } from "@projective/types/finance";
import { Badge, PaymentCardOption } from "@projective/ui/display";
import type { PaymentCardArt, PaymentCardData } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import type { PaymentMethodId } from "../core/checkout-model.ts";
import { PROVIDER_LABEL, providerIcon } from "../core/checkout-model.ts";
import { Amount } from "./Amount.tsx";
import type {
	CheckoutWallet,
	PaymentProvider,
	ProviderAvailability,
	SavedCard,
} from "../types/checkout-types.ts";

/**
 * PaymentChoice — how the buyer is paying: the instruments they SELECT between, the express routes
 * they TRIGGER, and the face a summary names an instrument by.
 *
 * ## Selecting is not the same act as triggering, so they are not the same control
 *
 * The surface used to draw all six routes as one radio list, which asked the buyer to answer two
 * different questions with one control. Choosing "PayPal" from a list and then pressing Buy Now is
 * not how PayPal works — pressing the PayPal button IS the payment, in PayPal's own sheet, and a
 * radio that merely arms it leaves the buyer with a selection that does nothing until they find a
 * second button elsewhere on the page.
 *
 * So the step now has two regions with two grammars:
 *
 * - **{@link PaymentMethodChooser}** — one `role="radiogroup"` over the instruments a Buy Now can be
 *   charged against: the Projective wallet, and every card on file. One selection, shared, which is
 *   what makes "either the wallet or a card, never both" structural rather than two components
 *   remembering to clear each other (`selectedMethodId` in `basket-state.ts`).
 * - **{@link ExpressCheckout}** — the three vendor sheets, drawn in the rail above Buy Now. Each is a
 *   button that starts a payment, never an option that waits for one.
 *
 * `invoice` appears in neither: consolidated monthly billing is arranged once, on the Details step,
 * and offering it as a per-purchase instrument would imply it can be picked per basket. The
 * `InvoicingAction` on the payment step is the honest route to it.
 *
 * **A refused route is still rendered, disabled, and still carries its reason** in both regions.
 * `availableProviders` returns every route with a sentence on each refusal, and a payment method that
 * is silently absent is unexplainable — the buyer cannot tell whether they are ineligible, whether
 * the platform is broken, or whether they simply cannot see it. That is the absence-versus-gate
 * distinction `/wallet` draws, and the reason is wired as `aria-describedby` on the control itself so
 * it is heard on arrival rather than hunted for.
 *
 * ## The wallet and a card are one list drawn at two scales
 *
 * The wallet leads as a hero plate with its balance and a top-up pill; the cards follow as compact
 * rows. Both are options of the SAME radiogroup, both carry the SAME three selection channels — the
 * row's tonal tint, {@link PaymentCardOption}'s `--primary` ring, and its drawn tick — and neither
 * draws a radio dot, because the plate itself is the thing being chosen. The tick is what survives a
 * colour-vision overlay and a greyscale render; `aria-checked` is what carries the fact.
 *
 * Every plate is the SAME 302:192 proportion, narrowed by a call-site `--pc-max`. It is never the
 * package's own geometry: an instrument that changes proportion between the picker and the summary is
 * an instrument the buyer has to re-identify.
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

// #region The instrument list (wallet + saved cards, ONE selection)
/** Props for {@link PaymentMethodChooser}. */
export interface PaymentMethodChooserProps {
	/** Every route the server offered, available or not — the wallet's own offer is read from here. */
	providers: readonly ProviderAvailability[];
	/** The wallet's standing against this checkout — balance, and the shortfall when it falls short. */
	wallet: CheckoutWallet;
	/** The account the money is spent from — printed on the wallet's face. */
	ownerName: string;
	/** Every card on file, expired ones included. */
	cards: readonly SavedCard[];
	/** The instrument currently selected; `null` before one is adopted. */
	selected: PaymentMethodId | null;
	/** The id of the heading that labels the group. */
	labelledBy: string;
	onSelect: (id: PaymentMethodId) => void;
	/** Opens the add-a-method modal — the inline "Add new card" row and the empty state both use it. */
	onAddCard: () => void;
}

/** The DOM id of one instrument option, so roving focus moves without a ref per cell. */
function optionId(method: PaymentMethodId): string {
	return `cko-method-${method.replace(":", "-")}`;
}

/**
 * The wallet and every usable card, in the order they are drawn.
 *
 * Expired cards are excluded from the KEYBOARD order only — they still render, still say why, and
 * still cannot be chosen. Arrowing onto a control that refuses selection is a dead stop.
 */
function focusOrder(
	walletUsable: boolean,
	cards: readonly SavedCard[],
): PaymentMethodId[] {
	const order: PaymentMethodId[] = walletUsable ? ["wallet"] : [];
	for (const card of cards) if (!card.isExpired) order.push(`card:${card.id}`);
	return order;
}

/**
 * The Projective wallet as one option of the instrument list.
 *
 * **The row is a plain `<div>` and the radio is the plate inside it** — the same structure the card
 * rows use, and for the same reason: `PaymentCardOption` is the `role="radio"` button, so the balance
 * figure and the Top Up anchor beside it must be its SIBLINGS. A nested anchor inside a radio is
 * invalid HTML and breaks both controls. Clicking anywhere on the row forwards to the option, which
 * is a pointer convenience layered over a control that is already fully keyboard-operable, and it is
 * idempotent — re-selecting the selected wallet changes nothing.
 *
 * The plate itself carries no radio dot. Selection is the ring, the drawn tick and the row's tint,
 * exactly as on a card.
 */
function WalletOption(props: {
	offer: ProviderAvailability | undefined;
	wallet: CheckoutWallet;
	ownerName: string;
	checked: boolean;
	tabIndex: number;
	onSelect: () => void;
}): JSX.Element {
	const { offer, wallet, ownerName, checked } = props;
	const available = offer?.available ?? false;
	const reasonId = "cko-method-wallet-reason";

	return (
		<div
			class="cko-wallet-opt"
			data-checked={checked ? "true" : "false"}
			data-available={available ? "true" : "false"}
			onClick={available ? props.onSelect : undefined}
		>
			<div class="cko-wallet-opt__instrument">
				<PaymentCardOption
					id={optionId("wallet")}
					class="cko-card cko-wallet-opt__face"
					card={walletCardData(ownerName)}
					art={walletCardArt()}
					size="md"
					checked={checked}
					disabled={!available}
					tabIndex={props.tabIndex}
					// The plate is drawn from a balance, not from stored fragments, so its composed name
					// would read as a card it is not. This states what choosing it actually does.
					label={`Projective wallet, ${wallet.available.display} available`}
					aria-describedby={available ? undefined : reasonId}
					onSelect={props.onSelect}
				/>

				<div class="cko-wallet-opt__standing">
					<p class="cko-wallet-opt__name">Projective Wallet</p>
					<p class="cko-wallet-opt__figure">
						<span class="cko-wallet-opt__figure-label">Available balance</span>
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
						 * middle-click and an open-in-new-tab like every other route on the platform.
						 */
					}
					<a
						class="ui-button ui-button--outlined ui-button--size-sm ui-button--rounded cko-wallet-opt__topup"
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

			{/* The server's own words for the refusal, rendered verbatim and bound to the control. */}
			{!available && offer?.reason && (
				<p class="cko-wallet-opt__reason" id={reasonId}>
					<Icon name="lock" />
					<span>{offer.reason}</span>
				</p>
			)}

			{available && !wallet.covers && (
				<div class="cko-wallet-opt__short">
					<p class="cko-wallet-opt__row">
						<span class="cko-wallet-opt__label">Short by</span>
						<Amount value={wallet.shortfall} size="body" />
					</p>
					{
						/*
						 * A route out, to a real page. There is no "top up and pay" action here: that would be
						 * a second money movement composed on a surface whose whole job is the first one, and
						 * the wallet already owns topping up — including the disclosure of what a top-up
						 * costs, which this surface does not carry.
						 */
					}
					<p class="cko-wallet-opt__actions">
						<a
							class="cko-wallet-opt__link"
							href="/wallet/funding"
							target="_blank"
							rel="noopener noreferrer"
						>
							<Icon name="refresh" />
							Set up automatic top-ups
							<span class="ui-visually-hidden">(opens in a new tab)</span>
						</a>
					</p>
					<p class="cko-wallet-opt__note">
						Topping up in another tab? Come back and reload this page so the balance is re-checked.
					</p>
				</div>
			)}
		</div>
	);
}

/**
 * The wallet and the cards on file as ONE radio group.
 *
 * The group owns the keyboard model — the roving `tabIndex` (only the selected option is `0`, so a
 * wallet plus eight cards costs one Tab stop rather than nine) and the arrow-key behaviour a radio
 * group is expected to have, including selecting on arrow as native radios do. `PaymentCardOption`
 * deliberately owns neither, which is what keeps one model for a collection rather than a copy per
 * cell.
 *
 * **"Add new card" is a `<button>`, not an option.** It is drawn as the list's last row because that
 * is where a buyer looks for it, but it commits nothing and selects nothing, so it carries no
 * `role="radio"` and stays out of the roving order — arrow keys move between instruments and skip it,
 * and Tab reaches it as the action it is.
 */
export function PaymentMethodChooser(props: PaymentMethodChooserProps): JSX.Element {
	const { providers, wallet, cards, selected, labelledBy } = props;

	const walletOffer = providers.find((entry) => entry.provider === "wallet");
	const cardOffer = providers.find((entry) => entry.provider === "card");
	const walletUsable = walletOffer?.available ?? false;
	const cardsUsable = cardOffer?.available ?? false;

	if (providers.length === 0) {
		return (
			<p class="cko-methods__empty" role="status">
				No payment routes have been worked out for this checkout yet — there is nothing to pay for.
			</p>
		);
	}

	const order = focusOrder(walletUsable, cardsUsable ? cards : []);
	// With nothing selected the FIRST usable instrument holds the group's single tab stop, so the
	// group is always reachable — an all-`-1` group is a radiogroup the keyboard cannot enter.
	const focusTarget = (selected && order.includes(selected) ? selected : order[0]) ?? null;

	const move = (from: PaymentMethodId, delta: number) => {
		if (order.length === 0) return;
		const at = order.indexOf(from);
		const next = order[((at < 0 ? 0 : at + delta) + order.length) % order.length];
		if (!next) return;
		props.onSelect(next);
		document.getElementById(optionId(next))?.focus();
	};

	const jump = (to: PaymentMethodId | undefined) => {
		if (!to) return;
		props.onSelect(to);
		document.getElementById(optionId(to))?.focus();
	};

	const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const active = (event.target as HTMLElement | null)?.id ?? "";
		const current = order.find((id) => optionId(id) === active);
		if (!current) return;

		switch (event.key) {
			case "ArrowRight":
			case "ArrowDown":
				event.preventDefault();
				move(current, 1);
				break;
			case "ArrowLeft":
			case "ArrowUp":
				event.preventDefault();
				move(current, -1);
				break;
			case "Home":
				event.preventDefault();
				jump(order[0]);
				break;
			case "End":
				event.preventDefault();
				jump(order[order.length - 1]);
				break;
		}
	};

	return (
		<div class="cko-methods" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
			<WalletOption
				offer={walletOffer}
				wallet={wallet}
				ownerName={props.ownerName}
				checked={selected === "wallet"}
				tabIndex={focusTarget === "wallet" ? 0 : -1}
				onSelect={() => props.onSelect("wallet")}
			/>

			<div class="cko-methods__cards">
				<h3 class="cko__subhead" id="cko-cards-head">Card to charge</h3>
				{
					/*
					 * The list is withheld only when the server has actually REFUSED the card route — in
					 * which case a list of chargeable cards would contradict the refusal directly above it.
					 * It is never gated on the buyer having first chosen "card": the design puts the wallet
					 * and the cards in one list of instruments, and gating meant the cards were absent from
					 * the first byte (nothing is chosen server-side), which reads as an account with none
					 * saved.
					 */
				}
				{cardsUsable
					? (
						<CardChooser
							cards={cards}
							chosen={selected?.startsWith("card:") ? selected.slice("card:".length) : null}
							focusId={focusTarget?.startsWith("card:")
								? focusTarget.slice("card:".length)
								: null}
							onChoose={(id) => props.onSelect(`card:${id}`)}
							onAddCard={props.onAddCard}
						/>
					)
					: (
						<p class="cko-methods__reason" id="cko-method-card-reason">
							<Icon name="lock" />
							<span>
								{cardOffer?.reason ??
									"Paying by card isn't available for this account right now."}
							</span>
						</p>
					)}
			</div>
		</div>
	);
}
// #endregion

// #region Express checkout
/** The three vendor sheets, in the order the design draws them. */
const EXPRESS_ROUTES: readonly PaymentProvider[] = ["apple_pay", "google_pay", "paypal"];

/** Props for {@link ExpressCheckout}. */
export interface ExpressCheckoutProps {
	/** Every route the server offered, available or not. */
	providers: readonly ProviderAvailability[];
	/** Whether a charge is already in flight, so a second sheet cannot be opened over the first. */
	busy: boolean;
	/** Whether something unrelated to the route blocks payment — an express sheet cannot fix it. */
	blocked: boolean;
	/** Starts the payment in the vendor's own sheet. */
	onPay: (provider: PaymentProvider) => void;
}

/**
 * Apple Pay · Google Pay · PayPal, as three buttons that START a payment.
 *
 * **These are actions, not options.** Pressing one opens the vendor's sheet and pays there; nothing
 * here arms a later Buy Now, which is why they live above the divider rather than in the instrument
 * list. A route the server refused renders disabled with its own reason bound by `aria-describedby`,
 * the same gate-versus-absence rule the instrument list follows.
 *
 * **Vendor livery is deliberate and is the one place on this surface a literal colour is permitted.**
 * Each network publishes mandatory presentation rules for its button — Apple Pay black-on-white-mark,
 * PayPal's yellow, Google's light button — and a brand-tinted control is the buyer's evidence that
 * the sheet about to open is the one they recognise. Those constants are quarantined in a single
 * documented block in `checkout-payment.css` (`--xpay-*`), exactly as brand marks are quarantined in
 * `footer-icons.tsx` (Decision #62), and they are the only values on the surface that are not
 * `var(--*)`. Everything else — geometry, spacing, radius, focus ring, motion — is token-driven.
 *
 * On Safari the Apple Pay button additionally adopts the platform's OWN rendering through
 * `-webkit-appearance: -apple-pay-button`, which is the only way to draw a compliant Apple Pay mark:
 * the glyph is drawn by the OS, not by us, so nothing here reproduces a trademark. Elsewhere it falls
 * back to the styled form.
 */
export function ExpressCheckout(props: ExpressCheckoutProps): JSX.Element | null {
	const offers = EXPRESS_ROUTES
		.map((provider) => props.providers.find((entry) => entry.provider === provider))
		.filter((offer): offer is ProviderAvailability => offer !== undefined);

	// No express route was even offered for this checkout — so there is no express region, rather than
	// an empty one captioned with three refusals nobody asked about.
	if (offers.length === 0) return null;

	return (
		<section class="cko-xpay" aria-labelledby="cko-xpay-head">
			<h3 class="cko-xpay__head" id="cko-xpay-head">Express checkout</h3>
			<div class="cko-xpay__row">
				{offers.map((offer) => {
					const reasonId = `cko-xpay-${offer.provider}-reason`;
					const refused = !offer.available || props.blocked;
					return (
						<div key={offer.provider} class="cko-xpay__cell">
							<button
								type="button"
								class="cko-xpay__btn"
								data-provider={offer.provider}
								disabled={refused || props.busy}
								aria-describedby={refused ? reasonId : undefined}
								onClick={() => props.onPay(offer.provider)}
							>
								<Icon name={providerIcon(offer.provider)} />
								<span class="cko-xpay__label">{PROVIDER_LABEL[offer.provider]}</span>
							</button>
							{refused && (
								<p class="cko-xpay__reason" id={reasonId}>
									{props.blocked && offer.available
										? "Sort out the item above first — an express payment can't clear it."
										: offer.reason ?? "This isn't available on this device."}
								</p>
							)}
						</div>
					);
				})}
			</div>
		</section>
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
	 * Which card holds the group's single tab stop, when an OUTER group owns the roving order.
	 *
	 * The payment step's radiogroup spans the wallet AND the cards, so the tab stop may belong to the
	 * wallet and no card may carry a `0` at all. Left unset (the Buy-Now modal, where the cards are the
	 * whole group) this component keeps owning that decision itself.
	 */
	focusId?: string | null;
	/**
	 * Opens the add-a-method modal.
	 *
	 * Supplied → the list ends with an "Add new card" row and the empty state offers the same modal.
	 * Omitted (the Buy-Now modal, which mounts no such modal) → no row is drawn and the empty state
	 * falls back to the wallet's own payment-methods page rather than offering a dead control.
	 */
	onAddCard?: () => void;
}

/** The DOM id of one card option — the SAME resolver the instrument list uses, so an outer group's
 * roving focus and this list's own address the identical element. */
function cardOptionId(cardId: string): string {
	return optionId(`card:${cardId}`);
}

/**
 * The list's trailing "Add new card" row.
 *
 * Drawn as a list row because that is where a buyer looks for it, and dashed rather than solid so it
 * reads as a slot to fill rather than an instrument already on file. It is a plain `<button>`: it
 * selects nothing and commits nothing, so it carries no `role="radio"` and takes no place in the
 * group's arrow-key order.
 */
function AddCardRow(props: { onAddCard: () => void }): JSX.Element {
	return (
		<button type="button" class="cko-cardlist__add" onClick={props.onAddCard}>
			<span class="cko-cardlist__addplate" aria-hidden="true">
				<Icon name="plus" />
			</span>
			<span class="cko-cardlist__addlabel">Add new card</span>
		</button>
	);
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
	/*
	 * Which card holds the group's single tab stop.
	 *
	 * `focusId` is the OUTER group's answer where one owns the roving order (the payment step's
	 * radiogroup spans the wallet as well, so the stop may belong to the wallet and NO card may carry
	 * a `0`). `undefined` means this component is the whole group, and it falls back to the chosen
	 * card, then the first usable one — an all-`-1` group is a radiogroup the keyboard cannot enter.
	 * `null` is a real answer and must not collapse into the fallback, hence the `undefined` test.
	 */
	const focusTarget = props.focusId !== undefined
		? props.focusId
		: chosen ?? usable[0]?.id ?? null;

	const move = (from: string, delta: number) => {
		if (usable.length === 0) return;
		const at = usable.findIndex((card) => card.id === from);
		const next = usable[((at < 0 ? 0 : at + delta) + usable.length) % usable.length];
		if (!next) return;
		props.onChoose(next.id);
		document.getElementById(cardOptionId(next.id))?.focus();
	};

	const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const active = (event.target as HTMLElement | null)?.id ?? "";
		const prefix = cardOptionId("");
		const cardId = active.startsWith(prefix) ? active.slice(prefix.length) : null;
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
					document.getElementById(cardOptionId(usable[0].id))?.focus();
				}
				break;
			case "End": {
				event.preventDefault();
				const last = usable[usable.length - 1];
				if (last) {
					props.onChoose(last.id);
					document.getElementById(cardOptionId(last.id))?.focus();
				}
				break;
			}
		}
	};

	/*
	 * When an OUTER group owns the roving model this component must not also be a radiogroup, and must
	 * not answer arrow keys: the event bubbles, so two handlers would both move focus and the wallet
	 * would be unreachable by keyboard from inside the card list. `owned` therefore drops the role, the
	 * group label and the key handler together — one prop, one meaning.
	 */
	const owned = props.focusId !== undefined;

	return (
		<div
			class="cko-cardlist"
			role={owned ? undefined : "radiogroup"}
			aria-label={owned ? undefined : "Card to charge"}
			onKeyDown={owned ? undefined : onKeyDown}
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
							id={cardOptionId(card.id)}
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

			{props.onAddCard && <AddCardRow onAddCard={props.onAddCard} />}
		</div>
	);
}
// #endregion
