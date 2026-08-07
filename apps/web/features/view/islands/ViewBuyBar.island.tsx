import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import "../styles/view.css";
import { ProfileIcon } from "@features/profile/components/profile-glyphs.tsx";
import { type ViewGlyph, ViewIcon } from "../components/view-glyphs.tsx";
import { commerceFor, messageHrefFor, scheduleHrefFor, signInHref } from "../core/view-model.ts";
import { setAvailabilityMode } from "../core/view-state.ts";
import { basketIds, hydrateBasket, toggleBasket } from "../core/basket-state.ts";
import BuyNowModal from "@web/features/checkout/islands/BuyNowModal.island.tsx";
import { requestBuyNow } from "@web/features/checkout/core/buy-now-state.ts";
import { purchasableKindOf } from "@web/features/checkout/core/purchasable.ts";
import type { EntityPricing, ExploreItem, TrustFact } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * ViewBuyBar — the ≤767px transactional block, rendered in the page body directly under the hero.
 *
 * Below 767px the middle-nav lane is `display:none` (middle-nav.css / guest-shell.css both drop it at
 * that exact width), and the entire transaction lived only in the lane: price, primary CTA, secondary
 * CTA, message and trust facts. Measured at 390×844, a product page rendered `$79`, "Buy now", "Add to
 * basket" and "Message team" all at 0×0 — a commerce surface with no price and no purchase path on a
 * phone. `ViewDetails` is informational by contract, so nothing took the lane's place.
 *
 * This is the same fix `.pf-header__actions` is on the profile page: one body-side copy, revealed by
 * media query exactly where the lane is not. The two are mutually exclusive by `display`, so only one
 * is ever in the accessibility tree, and both derive their offer from the shared {@link commerceFor},
 * so they cannot drift. Basket state is the module-level signal the lane also reads.
 */
export interface ViewBuyBarProps {
	item: ExploreItem;
	pricing: EntityPricing;
	trust: TrustFact[];
	authed: boolean;
	ctx: HrefContext;
}

export default function ViewBuyBar(
	{ item, pricing, trust, authed, ctx }: ViewBuyBarProps,
): JSX.Element {
	const status = useSignal("");
	const favorited = useSignal(false);
	const added = basketIds.value.includes(item.id);

	useEffect(() => {
		hydrateBasket();
	}, []);

	const { bookable, purchasable, bookLabel, msgLabel } = commerceFor(item);
	const scheduleHref = bookable ? scheduleHrefFor(item, ctx) : null;
	const msgHref = authed ? messageHrefFor(item) : signInHref(item, ctx);

	/** The purchasable kind this listing is bought as; `null` for anything not bought on its own. */
	const purchaseKind = purchasableKindOf(item);

	/** Buy now — the same instant-checkout panel the lane opens, over the same shared target signal. */
	function onBuy(): void {
		if (!purchaseKind) return;
		requestBuyNow({
			itemId: item.id,
			itemType: purchaseKind,
			title: item.title,
			sellerName: item.owner.name,
			signInHref: signInHref(item, ctx),
		}, authed);
	}

	/** Add ⇄ remove, written through to the real basket; the server's answer settles the CTA. */
	function onToggleBasket(): void {
		if (!authed) {
			globalThis.location.href = signInHref(item, ctx);
			return;
		}
		status.value = added ? "Removing…" : "Adding…";
		void toggleBasket(item).then((res) => (status.value = res.message));
	}

	return (
		<section class="vw-buy" aria-label={`Pricing and actions for ${item.title}`}>
			<div class="vw-price" data-mode={pricing.mode}>
				<span class="vw-price__value">{pricing.display}</span>
				{pricing.caption ? <span class="vw-price__caption">{pricing.caption}</span> : null}
			</div>

			<div class="vw-ctas">
				{bookable
					? (
						<>
							<Button
								fluid
								rounded
								icon={<ViewIcon name="calendar" size={18} />}
								label={bookLabel}
								onClick={() => setAvailabilityMode(true)}
							/>
							<Button
								variant="text"
								fluid
								rounded
								icon={<ViewIcon name="message" size={18} />}
								label={msgLabel}
								onClick={() => (globalThis.location.href = msgHref)}
							/>
							{scheduleHref
								? <a class="vw-lane__fulllink" href={scheduleHref}>Open full calendar</a>
								: null}
						</>
					)
					: purchasable
					? (
						<>
							<Button
								fluid
								rounded
								icon={<ViewIcon name="buy" size={18} />}
								label="Buy now"
								onClick={onBuy}
							/>
							<Button
								variant="outlined"
								fluid
								rounded
								aria-pressed={added}
								icon={<ViewIcon name={added ? "check" : "basket"} size={18} />}
								label={added ? "In basket" : "Add to basket"}
								onClick={onToggleBasket}
							/>
							<Button
								variant="text"
								fluid
								rounded
								icon={<ViewIcon name="message" size={18} />}
								label={msgLabel}
								onClick={() => (globalThis.location.href = msgHref)}
							/>
						</>
					)
					: (
						<>
							<Button
								fluid
								rounded
								icon={<ViewIcon name="message" size={18} />}
								label={msgLabel}
								onClick={() => (globalThis.location.href = msgHref)}
							/>
							<Button
								variant="outlined"
								fluid
								rounded
								aria-pressed={favorited.value}
								icon={<ProfileIcon name="star" />}
								label={favorited.value ? "Saved" : "Save"}
								onClick={() => (favorited.value = !favorited.value)}
							/>
						</>
					)}
			</div>

			<p class="vw-ctas__status" role="status" aria-live="polite">{status.value}</p>

			{trust.length > 0
				? (
					<ul class="vw-trust" aria-label="Trust & delivery">
						{trust.map((t) => (
							<li key={t.label} class="vw-trust__item">
								<span class="vw-trust__icon" data-icon={t.icon} aria-hidden="true">
									<ViewIcon name={t.icon as ViewGlyph} size={16} />
								</span>
								<span class="vw-trust__text">
									<span class="vw-trust__label">{t.label}</span>
									<span class="vw-trust__value">{t.value}</span>
								</span>
							</li>
						))}
					</ul>
				)
				: null}

			{/* The lane outranks this host; see the election note in `buy-now-state.ts`. */}
			<BuyNowModal host="body" />
		</section>
	);
}
