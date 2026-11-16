import type { ComponentChildren, JSX } from "preact";
import { resolveCardArt } from "@projective/types/finance";
import { Badge, MetaLine, PaymentCard, PaymentCardOption } from "@projective/ui/display";
import { useCurrencyView } from "@projective/ui/display/money";
import type { PaymentCardArt, PaymentCardData } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import { walletScopeNoun } from "@features/wallet/core/wallet-model.ts";
import type { PaymentMethodId } from "../core/checkout-model.ts";
import { Amount } from "./Amount.tsx";
import { FxBreakdown, type FxBreakdownProps } from "./FxBreakdown.tsx";
import type {
	CheckoutWallet,
	PaymentProvider,
	ProviderAvailability,
	PurchaseOwnerType,
	SavedCard,
} from "../types/checkout-types.ts";

/**
 * PaymentChoice — how the buyer is paying: the routes they SELECT between, and the face a summary
 * names an instrument by. The express wallets they TRIGGER are `ExpressCheckoutElement`, drawn above
 * this list at the top of the payment column (Decision #153).
 *
 * {@link PaymentMethodChooser} is ONE `role="radiogroup"` over the routes a Buy Now can be charged
 * against: the Projective wallet, a card on file, and — once consolidated monthly billing is arranged
 * — paying on account (`invoice`, Decision #172). Each route is a compact row, and only the chosen one
 * expands its details inline: the wallet's face and Top Up, or the saved cards and Add a payment
 * method. `(provider, cardId)` in `basket-state.ts` stays the one selection, so a route and a card can
 * never hold two answers.
 *
 * **Every route is choosable, refused or not.** Choosing a refused route opens it, and the step's pay
 * notice says why once, beside the disabled commit, so a refusal is never repeated on the row, in a
 * banner and beside Buy Now. The chosen route's radio is described by that notice (`refusalId`).
 *
 * Every plate is the package's ISO-7810 1.586:1 face (Decision #432), narrowed only by a call-site
 * `--pc-max`, so the wallet and a card are one shape at two scales.
 */

// #region The wallet's own instrument face
/**
 * The card face the Projective wallet is drawn as: the SSOT's `vault` art, foil-marked when the
 * balance is an entity's.
 *
 * `networkLabel` is overridden to the platform's own name rather than left at the SSOT's
 * `"Projective Vault Card"`. That label names a **real, separate product** — a card issued against a
 * balance — and printing it on the wallet route would tell a buyer they are paying with an instrument
 * they may not hold.
 *
 * @param entity Whether the wallet spends a team's, business's or enterprise's money.
 */
export function walletCardArt(entity: boolean): PaymentCardArt {
	return {
		...resolveCardArt({ brand: "vault", binNumber: null, isBusinessCard: entity }),
		networkLabel: "Projective",
		issuerHint: null,
	};
}

/** Whether a paying account's money is an entity's rather than one person's. */
export function isEntityWallet(ownerType: PurchaseOwnerType): boolean {
	return ownerType === "team" || ownerType === "business" || ownerType === "enterprise";
}

/** The scope noun the wallet face prints for a paying account ("Team vault"). */
export function walletScopeLabel(ownerType: PurchaseOwnerType): string {
	switch (ownerType) {
		case "team":
		case "business":
		case "enterprise":
			return walletScopeNoun(ownerType);
		default:
			return walletScopeNoun("personal");
	}
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

/** A card's spoken and printed name — its programme or network, and its tail ("Visa ending 4242"). */
export function cardLabel(card: SavedCard): string {
	const art = resolveCardArt({
		brand: card.brand,
		binNumber: card.binNumber,
		isBusinessCard: card.isBusinessCard,
	});
	const name = art.issuerHint ?? art.networkLabel;
	return card.last4 ? `${name} ending ${card.last4}` : name;
}
// #endregion

// #region The route list (wallet · card · invoice, ONE selection)
/** Props for {@link PaymentMethodChooser}. */
export interface PaymentMethodChooserProps {
	/** Every route the server offered, available or not — each route's own offer is read from here. */
	providers: readonly ProviderAvailability[];
	/** The wallet's standing against this checkout — balance, and the shortfall when it falls short. */
	wallet: CheckoutWallet;
	/** The account the money is spent from — printed on the wallet's face. */
	ownerName: string;
	/** Whose money it is — sets the face's scope noun and its entity foil. */
	ownerType: PurchaseOwnerType;
	/** Every card on file, expired ones included. */
	cards: readonly SavedCard[];
	/** The chosen route (`chosenProvider`) — `card` can be chosen before a card is. */
	provider: PaymentProvider | null;
	/** The card a card payment charges (`chosenCardId`), kept while another route is chosen. */
	cardId: string | null;
	/** The id of the heading that labels the group. */
	labelledBy: string;
	onSelect: (id: PaymentMethodId) => void;
	/** Choose the card route when no usable card is on file to choose with it. */
	onSelectCardRoute: () => void;
	/** Opens the add-a-method modal. */
	onAddCard: () => void;
	/**
	 * Whether a card can be added from here at all (the processor is connected). When the card route
	 * is refused for a reason a new card answers — a business account with no business card on file —
	 * Add a payment method stays in the card route rather than vanishing with the list.
	 */
	canAddCard: boolean;
	/**
	 * When the paying business settles on a monthly invoice, the line the Invoice route carries ("Billed
	 * on your Nov 15 invoice"); `null` or absent hides the route — paying on account is arranged first.
	 */
	onAccountNote?: string | null;
	/** The element that says why the chosen route cannot pay, when it cannot. */
	refusalId?: string;
	/** The Buy-Now modal's density: the wallet route carries no face. */
	compact?: boolean;
	/**
	 * The checkout's FX quote, so a wallet balance held in another currency can state the locked rate —
	 * printed only when the quote converts into the currency the buyer is reading.
	 */
	settlement?: FxBreakdownProps["settlement"] & { currency: string };
}

type PaymentRoute = "wallet" | "card" | "invoice";

const NO_QUOTE: FxBreakdownProps["settlement"] = {
	rateLabel: null,
	asOfLabel: null,
	originCurrency: null,
};

const ROUTE_ICON: Readonly<Record<PaymentRoute, IconName>> = {
	wallet: "wallet",
	card: "catalogue",
	invoice: "document",
};

function routeHeadId(route: PaymentRoute): string {
	return `cko-route-${route}`;
}

function routeOf(provider: PaymentProvider | null): PaymentRoute | null {
	return provider === "wallet" || provider === "card" || provider === "invoice" ? provider : null;
}

function RouteRow(props: {
	route: PaymentRoute;
	checked: boolean;
	tabStop: boolean;
	name: string;
	sub: ComponentChildren;
	meta?: ComponentChildren;
	aside?: ComponentChildren;
	describedBy?: string;
	onChoose: () => void;
	children?: ComponentChildren;
}): JSX.Element {
	const { route, checked } = props;
	const head = (
		<button
			type="button"
			role="radio"
			id={routeHeadId(route)}
			class="cko-route__head"
			aria-checked={checked ? "true" : "false"}
			aria-describedby={props.describedBy}
			tabIndex={props.tabStop ? 0 : -1}
			onClick={props.onChoose}
		>
			<span class="cko-route__dot" aria-hidden="true" />
			<span class="cko-route__glyph" aria-hidden="true">
				<Icon name={ROUTE_ICON[route]} />
			</span>
			<span class="cko-route__text">
				<span class="cko-route__name">{props.name}</span>
				{props.sub ? <span class="cko-route__sub">{props.sub}</span> : null}
			</span>
			{props.meta ? <span class="cko-route__meta">{props.meta}</span> : null}
		</button>
	);
	return (
		<div class="cko-route" data-route={route} data-checked={checked ? "true" : "false"}>
			{props.aside
				? (
					<div class="cko-route__bar">
						{head}
						<span class="cko-route__aside">{props.aside}</span>
					</div>
				)
				: head}
			{checked && props.children ? <div class="cko-route__panel">{props.children}</div> : null}
		</div>
	);
}

/**
 * The payment routes as ONE radio group, the chosen route expanded.
 *
 * The group owns the keyboard model: a roving `tabIndex` (only the chosen route is `0`, else the
 * first) and arrow keys that move AND select, as native radios do. The saved cards inside the card
 * route are their own group ({@link CardChooser}), so arrows there move between cards and Tab leaves
 * the list for Add a payment method.
 */
export function PaymentMethodChooser(props: PaymentMethodChooserProps): JSX.Element {
	const { providers, wallet, cards, provider, cardId } = props;
	const viewer = useCurrencyView({}, wallet.available.currency).displayCurrency;

	if (providers.length === 0) {
		return (
			<p class="cko-methods__empty" role="status">
				No payment routes have been worked out for this checkout yet — there is nothing to pay for.
			</p>
		);
	}

	const offerOf = (route: PaymentRoute) => providers.find((entry) => entry.provider === route);
	const routes: PaymentRoute[] = props.onAccountNote
		? ["wallet", "card", "invoice"]
		: ["wallet", "card"];
	const chosen = routeOf(provider);
	const tabStop = chosen && routes.includes(chosen) ? chosen : routes[0];
	const usable = cards.filter((card) => !card.isExpired);
	const chosenCard = chosen === "card" ? cards.find((card) => card.id === cardId) ?? null : null;
	const cardsUsable = offerOf("card")?.available ?? false;
	const describedBy = (route: PaymentRoute) =>
		chosen === route && offerOf(route)?.available !== true ? props.refusalId : undefined;

	const choose = (route: PaymentRoute) => {
		if (route !== "card") {
			props.onSelect(route);
			return;
		}
		const keep = usable.find((card) => card.id === cardId) ??
			usable.find((card) => card.isDefault) ?? usable[0];
		if (keep) props.onSelect(`card:${keep.id}`);
		else props.onSelectCardRoute();
	};

	const go = (route: PaymentRoute | undefined) => {
		if (!route) return;
		choose(route);
		document.getElementById(routeHeadId(route))?.focus();
	};

	const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const id = (event.target as HTMLElement | null)?.id ?? "";
		const at = routes.findIndex((route) => routeHeadId(route) === id);
		if (at < 0) return;
		const step = (delta: number) => routes[(at + delta + routes.length) % routes.length];
		switch (event.key) {
			case "ArrowRight":
			case "ArrowDown":
				event.preventDefault();
				go(step(1));
				break;
			case "ArrowLeft":
			case "ArrowUp":
				event.preventDefault();
				go(step(-1));
				break;
			case "Home":
				event.preventDefault();
				go(routes[0]);
				break;
			case "End":
				event.preventDefault();
				go(routes[routes.length - 1]);
				break;
		}
	};

	const scope = walletScopeLabel(props.ownerType);
	const short = wallet.shortfall.minor > 0;
	const own = wallet.available.origin ?? wallet.available;
	const held = own.currency !== viewer ? { currency: own.currency, display: own.display } : null;
	const quote = props.settlement?.currency === viewer ? props.settlement : NO_QUOTE;
	const cardSub = chosenCard
		? cardLabel(chosenCard)
		: usable.length === 0
		? "No card on file"
		: usable.length === 1
		? "1 card on file"
		: `${usable.length} cards on file`;
	const showsCardPanel = cardsUsable || props.canAddCard;

	return (
		<div
			class={props.compact ? "cko-routes cko-routes--compact" : "cko-routes"}
			role="radiogroup"
			aria-labelledby={props.labelledBy}
			onKeyDown={onKeyDown}
		>
			<RouteRow
				route="wallet"
				checked={chosen === "wallet"}
				tabStop={tabStop === "wallet"}
				name="Projective Wallet"
				sub={scope}
				meta={
					<>
						<Amount value={wallet.available} size="body" hideOrigin />
						<span class="ui-visually-hidden">available</span>
					</>
				}
				aside={held && (
					<FxBreakdown
						kind="held"
						exact={held}
						settlement={quote}
						id={props.compact ? "bnow-wallet-fx" : "cko-wallet-fx"}
					/>
				)}
				describedBy={describedBy("wallet")}
				onChoose={() => choose("wallet")}
			>
				{props.compact ? null : (
					<PaymentCard
						class="cko-route__face"
						variant="wallet"
						decorative
						card={walletCardData(props.ownerName)}
						art={walletCardArt(isEntityWallet(props.ownerType))}
						scopeLabel={scope}
						size="sm"
					/>
				)}
				<div class="cko-route__acts">
					<a
						class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm ui-button--rounded cko-route__btn"
						href="/wallet"
						target="_blank"
						rel="noopener noreferrer"
					>
						<span class="ui-button__icon">
							<Icon name="plus" />
						</span>
						<span class="ui-button__label">Top Up</span>
						<span class="ui-visually-hidden">(opens in a new tab)</span>
					</a>
					{short && (
						<a
							class="cko-route__link"
							href="/wallet/funding"
							target="_blank"
							rel="noopener noreferrer"
						>
							Set up automatic top-ups
							<span class="ui-visually-hidden">(opens in a new tab)</span>
						</a>
					)}
					{short && (
						<p class="cko-route__note">
							Topping up in another tab? Reload this page so the balance is re-checked.
						</p>
					)}
				</div>
			</RouteRow>

			<RouteRow
				route="card"
				checked={chosen === "card"}
				tabStop={tabStop === "card"}
				name="Credit / Debit Card"
				sub={cardSub}
				describedBy={describedBy("card")}
				onChoose={() => choose("card")}
			>
				{showsCardPanel
					? (
						<>
							{cardsUsable && cards.length > 0 && (
								<CardChooser
									cards={cards}
									chosen={chosenCard?.id ?? null}
									onChoose={(id) => props.onSelect(`card:${id}`)}
								/>
							)}
							{cardsUsable && cards.length === 0 && (
								<p class="cko-route__note">No cards are saved on this account yet.</p>
							)}
							{props.canAddCard && (
								<Button
									class="cko-route__add"
									severity="neutral"
									variant="outlined"
									size="sm"
									rounded
									icon={<Icon name="plus" />}
									label="Add a payment method"
									onClick={props.onAddCard}
								/>
							)}
						</>
					)
					: null}
			</RouteRow>

			{props.onAccountNote && (
				<RouteRow
					route="invoice"
					checked={chosen === "invoice"}
					tabStop={tabStop === "invoice"}
					name="Invoice"
					sub={props.onAccountNote}
					describedBy={describedBy("invoice")}
					onChoose={() => choose("invoice")}
				/>
			)}
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

/** The DOM id of one card option, so roving focus moves without a ref per cell. */
function cardOptionId(cardId: string): string {
	return `cko-method-card-${cardId}`;
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
export function CardChooser(props: CardChooserProps): JSX.Element | null {
	const { cards, chosen } = props;
	if (cards.length === 0) return null;

	const usable = cards.filter((card) => !card.isExpired);
	const focusTarget = chosen ?? usable[0]?.id ?? null;

	const go = (card: SavedCard | undefined) => {
		if (!card) return;
		props.onChoose(card.id);
		document.getElementById(cardOptionId(card.id))?.focus();
	};

	const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const active = (event.target as HTMLElement | null)?.id ?? "";
		const prefix = cardOptionId("");
		const cardId = active.startsWith(prefix) ? active.slice(prefix.length) : null;
		if (!cardId || usable.length === 0) return;
		const at = usable.findIndex((card) => card.id === cardId);
		const step = (delta: number) =>
			usable[((at < 0 ? 0 : at + delta) + usable.length) % usable.length];

		switch (event.key) {
			case "ArrowRight":
			case "ArrowDown":
				event.preventDefault();
				go(step(1));
				break;
			case "ArrowLeft":
			case "ArrowUp":
				event.preventDefault();
				go(step(-1));
				break;
			case "Home":
				event.preventDefault();
				go(usable[0]);
				break;
			case "End":
				event.preventDefault();
				go(usable[usable.length - 1]);
				break;
		}
	};

	return (
		<div class="cko-cardlist" role="radiogroup" aria-label="Card to charge" onKeyDown={onKeyDown}>
			{cards.map((card) => {
				const art = resolveCardArt({
					brand: card.brand,
					binNumber: card.binNumber,
					isBusinessCard: card.isBusinessCard,
				});
				const expiry = cardExpiryLabel(card);
				const facts = [
					card.cardholderName,
					card.isBusinessCard && "Business card",
					card.isDefault && "Default",
				];

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
							// The thumbnail hook: a CLASS, because `PaymentCard` overwrites `style` with its
							// art variables. It narrows `--pc-max` only; the face keeps its ISO proportion.
							class="cko-cardlist__face"
							card={card}
							art={art}
							size="sm"
							checked={chosen === card.id}
							disabled={card.isExpired}
							tabIndex={card.id === focusTarget ? 0 : -1}
							onSelect={() =>
								props.onChoose(card.id)}
						/>

						<span class="cko-cardlist__body">
							<span class="cko-cardlist__brand">{art.issuerHint ?? art.networkLabel}</span>
							<MetaLine as="span" size="xs" class="cko-cardlist__holder" items={facts} />
							{(chosen === card.id || card.isExpired) && (
								<span class="cko-cardlist__tags">
									{chosen === card.id && (
										<Badge
											class="cko-cardlist__badge"
											value="Selected"
											severity="primary"
											size="sm"
										/>
									)}
									{card.isExpired && (
										<span class="cko-tag" data-tone="warning">
											<Icon name="warning" />
											Expired
										</span>
									)}
								</span>
							)}
						</span>

						<span class="cko-cardlist__ident">
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
