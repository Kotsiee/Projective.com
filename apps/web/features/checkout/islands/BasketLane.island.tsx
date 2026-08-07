import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/checkout.css";
import {
	LaneCollapseButton,
	LaneEmpty,
	LaneFooter,
	LaneHead,
	LaneIconButton,
	LaneList,
	LaneSearch,
} from "@projective/ui/navigation";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { CollapseGlyph } from "../components/checkout-glyphs.tsx";
import { basketHref, checkoutHref } from "../core/basket-model.ts";
import { basketCount, baskets as basketsSignal } from "../core/basket-state.ts";
import { useCheckoutSeamPassive } from "../core/checkout-seam.ts";
import type { BasketSummary, CheckoutView } from "../types/checkout-types.ts";

/**
 * BasketLane — the middle-nav LANE for `/basket` and `/checkout`: **which basket, and which of the two
 * steps you are on**. Nothing else.
 *
 * Per the region contract (Decisions #60 / #63) a lane owns navigation and scope only: no totals, no
 * Pay button, no promo field. Those are the footer band's and the body's, and putting a money action
 * here is precisely how `/wallet` came to have five controls nobody could reach on a phone.
 *
 * Both presentations are always in the DOM and CSS reveals exactly one, keyed off the splitter's
 * `data-mode` — the shipped repo pattern. A width observer would paint the wrong presentation for a
 * frame on every load, and a basket switcher that flickers reads as a bug in the basket.
 *
 * **Mobile:** `.ui-middle-nav__lane` is `display: none` below 767px, so everything here is unreachable
 * on a phone. The duty transfers to the header band's scope control rather than vanishing — see
 * `BasketHeaderBand`.
 */

// #region Props
/** Props for {@link BasketLane}. */
export interface BasketLaneProps {
	/** The acting account's baskets, SSR-resolved so the switcher paints in the first byte. */
	baskets: BasketSummary[];
	/** The basket currently open. */
	activeBasketId: string | null;
	/** The acting owner scope (`personal` · `team:northwind` · …). */
	owner: string;
	/** The display currency every server figure was formatted in. */
	display: string;
	/** Which of the two steps the URL addresses. */
	view: CheckoutView;
	/** How many lines are parked on the saved-for-later shelf. */
	savedForLaterCount: number;
	/** How many active lines have gone unavailable — the lane's one ambient status. */
	unavailableCount: number;
}
// #endregion

export default function BasketLane(props: BasketLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	const query = useSignal("");
	const railSwitchOpen = useSignal(false);

	// The lane renders shared state but owns no fetch: the body is the single reader, so a passive
	// mirror keeps the two from racing for the same basket.
	useCheckoutSeamPassive({
		basketId: props.activeBasketId,
		owner: props.owner,
		display: props.display,
	});

	useEffect(() => {
		if (basketsSignal.value.length === 0) basketsSignal.value = props.baskets;
		const el = document.querySelector(".ui-splitter") as HTMLElement | null;
		if (el) collapsed.value = el.dataset.mode === "collapsed";
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	};

	// Live count when the body has read one, else the SSR figure — so the rail badge never lags a
	// removal the reader just performed.
	const liveCount = basketCount.value || activeCountOf(props.baskets, props.activeBasketId);
	const list = basketsSignal.value.length > 0 ? basketsSignal.value : props.baskets;
	const q = query.value.trim().toLowerCase();
	const visible = q ? list.filter((b) => b.name.toLowerCase().includes(q)) : list;

	return (
		<div class="bsk-lane" data-view={props.view}>
			{/* Expanded presentation */}
			<div class="bsk-lane__full">
				<LaneHead>
					<LaneSearch
						value={query.value}
						placeholder="Find a basket"
						label="Find a basket"
						icon={<Icon name="search" />}
						onInput={(value) => (query.value = value)}
					/>
				</LaneHead>

				<LaneList label="Baskets and checkout">
					<nav class="bsk-lane__steps" aria-label="Checkout steps">
						<a
							class="bsk-lane__step"
							href={basketHref(props.activeBasketId, props.owner)}
							aria-current={props.view === "basket" ? "page" : undefined}
						>
							<Icon name="basket" />
							<span class="bsk-lane__step-label">Basket</span>
							<span class="bsk-lane__count">{liveCount}</span>
						</a>
						<a
							class="bsk-lane__step"
							href={checkoutHref(props.activeBasketId, props.owner)}
							aria-current={props.view === "checkout" ? "page" : undefined}
						>
							<Icon name="wallet" />
							<span class="bsk-lane__step-label">Checkout</span>
						</a>
					</nav>

					<p class="bsk-lane__grouphead" id="bsk-lane-baskets">Your baskets</p>
					{visible.length === 0
						? (
							<LaneEmpty
								title="No baskets match"
								note="Clear the search to see them all."
								icon={<Icon name="basket" />}
							/>
						)
						: (
							<ul class="bsk-lane__list" aria-labelledby="bsk-lane-baskets">
								{visible.map((entry) => (
									<li key={entry.id}>
										<a
											class="bsk-lane__row"
											href={basketHref(entry.id, props.owner)}
											data-active={entry.id === props.activeBasketId ? "true" : undefined}
											aria-current={entry.id === props.activeBasketId ? "page" : undefined}
										>
											<Icon name={entry.isDefault ? "basket" : "bookmark"} />
											<span class="bsk-lane__row-label">{entry.name}</span>
											<span class="bsk-lane__count">{entry.itemCount}</span>
										</a>
									</li>
								))}
							</ul>
						)}

					{props.savedForLaterCount > 0 && (
						<a
							class="bsk-lane__row"
							href={`${basketHref(props.activeBasketId, props.owner)}#saved`}
						>
							<Icon name="bookmark" />
							<span class="bsk-lane__row-label">Saved for later</span>
							<span class="bsk-lane__count">{props.savedForLaterCount}</span>
						</a>
					)}
				</LaneList>

				{
					/*
				  The lane's one ambient status. It is a STATE, not an action — pressing it does nothing,
				  because acting on an unavailable line happens on the line itself. It carries its own
				  words as well as its tone, so the meaning survives a colour-blind palette (§B.6).
				*/
				}
				{props.unavailableCount > 0 && (
					<p class="bsk-lane__status" role="status" data-tone="warn">
						<Icon name="warning" />
						<span>
							{props.unavailableCount === 1
								? "1 item needs attention"
								: `${props.unavailableCount} items need attention`}
						</span>
					</p>
				)}

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						onToggle={() => setCollapsed(!collapsed.value)}
						icon={CollapseGlyph}
					/>
				</LaneFooter>
			</div>

			{/* Collapsed rail — every destination above, icon-only, each with a portal Tooltip (§B.6) */}
			<div class="bsk-lane__rail">
				<Tooltip content="Basket" placement="right">
					<a
						class="bsk-lane__railbtn"
						href={basketHref(props.activeBasketId, props.owner)}
						aria-label="Basket"
						data-active={props.view === "basket" ? "true" : undefined}
					>
						<Icon name="basket" size="md" />
						{liveCount > 0 && <span class="bsk-lane__raildot" aria-hidden="true" />}
					</a>
				</Tooltip>
				<Tooltip content="Checkout" placement="right">
					<a
						class="bsk-lane__railbtn"
						href={checkoutHref(props.activeBasketId, props.owner)}
						aria-label="Checkout"
						data-active={props.view === "checkout" ? "true" : undefined}
					>
						<Icon name="wallet" size="md" />
					</a>
				</Tooltip>
				{
					/*
					 * WHICH basket is the lane's own scope duty, and the rail is the lane's other presentation —
					 * so it has to survive the collapse. It previously did not: a collapsed lane offered Basket
					 * and Checkout and no way to switch between the account's baskets at all.
					 *
					 * One control opening the list, rather than a row per basket: every basket resolves to the
					 * same two glyphs, so N identical squares would be a list nobody could read without hovering
					 * each one in turn.
					 */
				}
				{list.length > 1 && (
					<Popover
						open={railSwitchOpen}
						placement="right-start"
						label="Switch basket"
						class="bsk-menu"
						trigger={(api) => (
							<Tooltip content="Switch basket" placement="right">
								<button
									type="button"
									class="bsk-lane__railbtn"
									aria-label="Switch basket"
									aria-haspopup="dialog"
									aria-expanded={api.expanded ? "true" : "false"}
									aria-controls={api.panelId}
									onClick={api.toggle}
									ref={api.ref as RefObject<HTMLButtonElement>}
								>
									<Icon name="switch" size="md" />
								</button>
							</Tooltip>
						)}
					>
						{list.map((entry) => (
							<a
								key={entry.id}
								class="bsk-menu__item"
								href={basketHref(entry.id, props.owner)}
								aria-current={entry.id === props.activeBasketId ? "page" : undefined}
							>
								<Icon name={entry.isDefault ? "basket" : "bookmark"} />
								<span>{entry.name}</span>
								<span class="bsk-menu__count">{entry.itemCount}</span>
							</a>
						))}
					</Popover>
				)}
				{props.savedForLaterCount > 0 && (
					<Tooltip content="Saved for later" placement="right">
						<a
							class="bsk-lane__railbtn"
							href={`${basketHref(props.activeBasketId, props.owner)}#saved`}
							aria-label={`Saved for later, ${props.savedForLaterCount} items`}
						>
							<Icon name="bookmark" size="md" />
						</a>
					</Tooltip>
				)}
				{props.unavailableCount > 0 && (() => {
					// One sentence, used twice on purpose: the Tooltip carries it for a sighted viewer and
					// the visually-hidden span carries it for assistive tech. The glyph is `aria-hidden`, so
					// without the span this `role="status"` region would announce nothing at all — a warning
					// no reader can resolve is worse than no warning (§B.6: the explaining words live in the
					// tooltip, but an icon-only indicator still needs a real accessible name).
					const one = props.unavailableCount === 1;
					const attention = `${props.unavailableCount} item${one ? "" : "s"} ${
						one ? "needs" : "need"
					} attention`;
					return (
						<Tooltip content={attention} placement="right">
							<span class="bsk-lane__railbtn" data-tone="warn" role="status">
								<Icon name="warning" size="md" />
								<span class="ui-visually-hidden">{attention}</span>
							</span>
						</Tooltip>
					);
				})()}
				<div class="bsk-lane__railfoot">
					<LaneIconButton
						icon={CollapseGlyph}
						label="Expand lane"
						tooltipPlacement="right"
						onClick={() => setCollapsed(false)}
					/>
				</div>
			</div>
		</div>
	);
}

// #region Helpers
/** The SSR line count of the open basket, used until the body publishes a live one. */
function activeCountOf(list: readonly BasketSummary[], activeId: string | null): number {
	const found = activeId ? list.find((b) => b.id === activeId) : list.find((b) => b.isDefault);
	return found?.itemCount ?? 0;
}
// #endregion
