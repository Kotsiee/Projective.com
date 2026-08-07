import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/checkout.css";
import { Popover } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { basketHref, checkoutHref } from "../core/basket-model.ts";
import { basketSearch, notifyBasketChanged } from "../core/basket-state.ts";
import { useCheckoutSeamPassive } from "../core/checkout-seam.ts";
import type { BasketSummary, CheckoutOwner, CheckoutView } from "../types/checkout-types.ts";

/**
 * BasketHeaderBand — the middle-nav HEADER band on `/basket` and `/checkout`: **whose basket this is,
 * how to narrow it, and what currency it is being read in**.
 *
 * It carries no action that moves money and no primary CTA — those belong to the footer band — and no
 * data, which belongs to the body. What it does carry, uniquely, is the surface's answer to the mobile
 * problem: `.ui-middle-nav__lane` is removed below 767px, and the lane is the only route between the
 * baskets and the two steps. A responsibility cannot simply evaporate at a breakpoint, so at that width
 * the band grows a **Browse** control holding exactly what the lane held. The duty TRANSFERS; it is
 * never duplicated at a width where the lane is present.
 *
 * The Browse control is gated by a viewport media query rather than a container query, deliberately:
 * it mirrors the lane's own `@media (max-width: 767px)` rule, so the two are decided by the same
 * measurement and cannot disagree. Everything sized against the band's own width uses a container
 * query, because the band's width depends on whether the lane is there.
 */

// #region Props
/** Props for {@link BasketHeaderBand}. */
export interface BasketHeaderBandProps {
	/** Who is paying — name, handle and avatar, resolved server-side. */
	owner: CheckoutOwner;
	/** The `owner=` scope param, echoed into every link so navigation keeps the acting account. */
	ownerParam: string;
	/** The open basket's display name. */
	basketName: string;
	/** The open basket's id. */
	basketId: string | null;
	/** The acting account's baskets — the mobile Browse control's contents. */
	baskets: BasketSummary[];
	/** Which of the two steps the URL addresses. */
	view: CheckoutView;
	/** The display currency every figure is formatted in. */
	display: string;
}
// #endregion

/** The display currencies the surface offers. Matches the wallet's, so one reader sees one set. */
const CURRENCIES: readonly string[] = ["GBP", "USD", "EUR"];

export default function BasketHeaderBand(props: BasketHeaderBandProps): JSX.Element {
	const browseOpen = useSignal(false);
	const currencyOpen = useSignal(false);
	const findOpen = useSignal(false);

	useCheckoutSeamPassive({
		basketId: props.basketId,
		owner: props.ownerParam,
		display: props.display,
	});

	/**
	 * Narrowing is a BODY concern the band merely opens, so the query goes into the shared store and the
	 * body reacts. The pulse is not optional: the two are separate hydration roots, so without it the
	 * field would accept typing and the list under it would not move — which reads as a broken filter
	 * rather than an unfetched one.
	 */
	const onSearch = (value: string) => {
		basketSearch.value = value;
		notifyBasketChanged();
	};

	/** A currency choice is a server re-read (every figure is formatted there), so it is a link. */
	const currencyHref = (code: string) => {
		const base = props.view === "checkout"
			? checkoutHref(props.basketId, props.ownerParam)
			: basketHref(props.basketId, props.ownerParam);
		return `${base}${base.includes("?") ? "&" : "?"}display=${code}`;
	};

	/** Narrowing exists on `/basket` only — the checkout body renders the server's own line set. */
	const searchable = props.view === "basket";

	/** The one find-in-basket field, rendered inline at width and inside the Find popover below it. */
	const SearchField = (): JSX.Element => (
		<input
			type="search"
			class="bsk-head__search-input"
			placeholder="Find in basket"
			aria-label="Find in basket"
			value={basketSearch.value}
			onInput={(e) => onSearch((e.target as HTMLInputElement).value)}
		/>
	);

	return (
		<div class="bsk-head" data-view={props.view}>
			<div class="bsk-head__identity">
				<Avatar image={props.owner.avatar ?? undefined} label={props.owner.name} size="sm" />
				<span class="bsk-head__names">
					<span class="bsk-head__title">{props.basketName}</span>
					<span class="bsk-head__owner">{props.owner.name}</span>
				</span>
			</div>

			{
				/*
				 * Narrowing is offered ONLY where something reads it. `basketSearch` is consumed by the
				 * `/basket` body alone, so on `/checkout` this field accepted typing and filtered nothing —
				 * a control that answers no question is worse than an absent one, because the reader
				 * concludes their basket has one line rather than that they mis-typed.
				 */
			}
			{searchable && (
				<label class="bsk-head__search">
					<span class="bsk-head__search-icon" aria-hidden="true">
						<Icon name="search" />
					</span>
					<SearchField />
				</label>
			)}

			<div class="bsk-head__controls">
				{/* Mobile-only: the duty the lane owns above 767px, transferred rather than dropped. */}
				<Popover
					open={browseOpen}
					placement="bottom-end"
					label="Browse baskets"
					class="bsk-menu"
					trigger={(api) => (
						<button
							type="button"
							class="bsk-head__btn bsk-head__btn--browse"
							aria-label="Browse baskets"
							aria-haspopup="dialog"
							aria-expanded={api.expanded ? "true" : "false"}
							aria-controls={api.panelId}
							onClick={api.toggle}
							ref={api.ref as RefObject<HTMLButtonElement>}
						>
							<Icon name="menu" />
							<span class="bsk-head__btn-label">Browse</span>
						</button>
					)}
				>
					<a class="bsk-menu__item" href={basketHref(props.basketId, props.ownerParam)}>
						<Icon name="basket" />
						<span>Basket</span>
					</a>
					<a class="bsk-menu__item" href={checkoutHref(props.basketId, props.ownerParam)}>
						<Icon name="wallet" />
						<span>Checkout</span>
					</a>
					<hr class="bsk-menu__rule" />
					{props.baskets.map((entry) => (
						<a
							key={entry.id}
							class="bsk-menu__item"
							href={basketHref(entry.id, props.ownerParam)}
							aria-current={entry.id === props.basketId ? "page" : undefined}
						>
							<Icon name={entry.isDefault ? "basket" : "bookmark"} />
							<span>{entry.name}</span>
							<span class="bsk-menu__count">{entry.itemCount}</span>
						</a>
					))}
				</Popover>

				{
					/*
					 * Below the band's own narrow tier the inline field has no room, so it collapses into this
					 * control rather than disappearing. Hiding it outright was the `/wallet` failure applied to a
					 * header: a capability removed by a breakpoint with nothing holding it.
					 */
				}
				{searchable && (
					<Popover
						open={findOpen}
						placement="bottom-end"
						label="Find in basket"
						class="bsk-menu"
						trigger={(api) => (
							<button
								type="button"
								class="bsk-head__btn bsk-head__btn--find"
								aria-label="Find in basket"
								aria-haspopup="dialog"
								aria-expanded={api.expanded ? "true" : "false"}
								aria-controls={api.panelId}
								onClick={api.toggle}
								ref={api.ref as RefObject<HTMLButtonElement>}
							>
								<Icon name="search" />
								{basketSearch.value !== "" && <span class="bsk-head__btn-dot" aria-hidden="true" />}
							</button>
						)}
					>
						<label class="bsk-head__findfield">
							<span class="bsk-head__search-icon" aria-hidden="true">
								<Icon name="search" />
							</span>
							<SearchField />
						</label>
					</Popover>
				)}

				<Popover
					open={currencyOpen}
					placement="bottom-end"
					label="Display currency"
					class="bsk-menu"
					trigger={(api) => (
						<button
							type="button"
							class="bsk-head__btn"
							aria-label={`Display currency: ${props.display}`}
							aria-haspopup="dialog"
							aria-expanded={api.expanded ? "true" : "false"}
							aria-controls={api.panelId}
							onClick={api.toggle}
							ref={api.ref as RefObject<HTMLButtonElement>}
						>
							<Icon name="globe" />
							<span class="bsk-head__btn-label">{props.display}</span>
						</button>
					)}
				>
					{CURRENCIES.map((code) => (
						<a
							key={code}
							class="bsk-menu__item"
							href={currencyHref(code)}
							aria-current={code === props.display ? "true" : undefined}
						>
							<span>{code}</span>
							{code === props.display && <Icon name="check" />}
						</a>
					))}
				</Popover>
			</div>
		</div>
	);
}
