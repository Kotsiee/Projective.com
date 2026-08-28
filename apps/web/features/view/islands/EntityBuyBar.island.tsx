import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import { PriceOrigin } from "../components/entity-view-parts.tsx";
import "../styles/entity-view.css";
import { basketIds, hydrateBasket, toggleBasket } from "../core/basket-state.ts";
import { signInHref } from "../core/view-model.ts";
import { type EntityArchetype, offerFor } from "../core/entity-archetype.ts";
import type { HeadlinePrice } from "../core/view-pricing.ts";
import BuyNowModal from "@web/features/checkout/islands/BuyNowModal.island.tsx";
import { requestBuyNow } from "@web/features/checkout/core/buy-now-state.ts";
import { purchasableKindOf } from "@web/features/checkout/core/purchasable.ts";
import { BookingCtaRig } from "../components/BookingCtaRig.tsx";
import BookingPanels from "./BookingPanels.island.tsx";
import { announce } from "../core/booking-state.ts";
import type { EntityView } from "@projective/types/explore";
import type { ServiceBookingOffer } from "@projective/types/services";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * EntityBuyBar — the ≤767px transactional block (`DESIGN_SYSTEM.md` §D.7.4).
 *
 * Below the frame breakpoint (1100px) the conversion lane is not rendered — it is a page column now,
 * and four tracks inside a content region the shell has already narrowed leave ~350px for the content
 * itself. So the entire transaction lives here instead. Measured at 390x844 before this existed, a
 * product page rendered its price, "Buy now", "Add to basket" and "Message" all at `0x0` — a commerce
 * surface with no price and no purchase path on a phone.
 *
 * **The duty TRANSFERS; it does not duplicate.** This block is revealed by media query exactly where
 * the lane is not, so the two are mutually exclusive by `display` and only ever one is in the
 * accessibility tree. Both derive their offer from {@link offerFor}, their price from
 * `headlinePriceFor`, and their button treatment from the SAME `.evp-cta__btn` classes — so the phone
 * and the desktop cannot drift into quoting different things or ranking them differently.
 *
 * Same pattern as `.pf-header__actions` on the profile page and the `/wallet` header switcher
 * (§8 Decision #63).
 */

export interface EntityBuyBarProps {
	view: EntityView;
	archetype: EntityArchetype;
	price: HeadlinePrice;
	authed: boolean;
	ctx: HrefContext;
	/**
	 * The SSR-resolved booking offer.
	 *
	 * It arrives as a prop rather than being fetched, so the first byte carries the right verb on the
	 * one control this page exists for. Resolving it in an effect would paint an absent or wrong
	 * primary and then change it under the reader's cursor.
	 */
	offer: ServiceBookingOffer;
}

export default function EntityBuyBar(
	{ view, archetype, price, authed, ctx, offer }: EntityBuyBarProps,
): JSX.Element {
	const { item } = view;
	const archetypeOffer = offerFor(archetype);
	const added = basketIds.value.includes(item.id);

	useEffect(() => {
		hydrateBasket();
	}, []);

	const purchaseKind = purchasableKindOf(item);

	/**
	 * The two purchase handlers, passed INTO the rig rather than implemented in it.
	 *
	 * The basket and instant checkout are the checkout feature's flows and each already has one
	 * implementation (`basket-state.ts`, which mirrors optimistically and reverts a refusal;
	 * `requestBuyNow`, which bounces a guest and opens the panel). The rig calls these; it never grows a
	 * second copy — which is how two surfaces come to add a line under two different `itemType`s and
	 * stack two rows for one listing.
	 *
	 * They are TWO functions, one per control. A single shared one had to ask the offer which button had
	 * called it, and got it wrong: on a product the secondary "Add to basket" saw `primary.kind ===
	 * "buy_now"` and opened instant checkout instead of adding anything.
	 */
	function onPrimaryPurchase(): Promise<boolean> {
		if (!authed) {
			globalThis.location.href = signInHref(item, ctx);
			return Promise.resolve(false);
		}
		if (!purchaseKind) return Promise.resolve(false);
		requestBuyNow({
			itemId: item.id,
			itemType: purchaseKind,
			title: item.title,
			sellerName: item.owner.name,
			signInHref: signInHref(item, ctx),
		}, authed);
		// The panel now owns the transaction, so the CTA does not settle: a check mark beside a modal the
		// buyer has not finished with would confirm something that has not happened.
		return Promise.resolve(false);
	}

	async function onAddToBasket(): Promise<boolean> {
		if (!authed) {
			globalThis.location.href = signInHref(item, ctx);
			return false;
		}
		const res = await toggleBasket(item);
		announce(res.message);
		return res.ok;
	}

	return (
		<div class="evp-buybar">
			<div class="evp-price">
				{price.amount
					? (
						<>
							<span class="evp-price__figure">
								{price.isFloor && <span class="evp-price__from">From&#32;</span>}
								<MoneyView
									minor={price.amount.minor}
									currency={price.amount.currency}
									size="figure"
									hideOrigin
									class="evp-price__money"
								/>
							</span>
							{price.unit && <span class="evp-price__unit">/ {price.unit}</span>}
							<PriceOrigin minor={price.amount.minor} currency={price.amount.currency} />
						</>
					)
					: <span class="evp-price__figure evp-price__figure--quote">{price.fallback}</span>}
			</div>

			<BookingCtaRig
				offer={offer}
				layout="bar"
				inBasket={added}
				onPrimaryPurchase={purchaseKind ? onPrimaryPurchase : undefined}
				onAddToBasket={purchaseKind ? onAddToBasket : undefined}
			/>

			{archetypeOffer.escrows && (
				<p class="evp-buybar__note">
					<Icon name="shield" size="sm" aria-hidden /> Funds held in escrow until you accept.
				</p>
			)}

			{
				/*
			  `host="body"`. Both transactional regions are always mounted — they hide each other by
			  `display`, and a portalled panel escapes a hidden ancestor entirely — so the modal layers
			  elect a single host rather than rendering twice. The buy bar is rendered unconditionally by
			  `EntityViewPage` while the lane only mounts when `viewLaneFor` resolves one, which makes
			  this the guaranteed host of last resort.
			*/
			}
			<BuyNowModal host="body" />
			<BookingPanels
				offer={offer}
				host="body"
				stages={view.service?.stages}
				currency={item.type === "services" || item.type === "products" ? item.currency : undefined}
			/>
		</div>
	);
}
