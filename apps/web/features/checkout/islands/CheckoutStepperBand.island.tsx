import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/checkout.css";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import CheckoutCurrencySelect from "./CheckoutCurrencySelect.island.tsx";
import { CheckoutStepper } from "../components/CheckoutStepper.tsx";
import { type CheckoutStep, checkoutStepHref, isFocusStep } from "../core/basket-model.ts";
import { basketSearch, notifyBasketChanged } from "../core/basket-state.ts";
import { reachedStep, seedStep } from "../core/checkout-state.ts";
import { useCheckoutSeamPassive } from "../core/checkout-seam.ts";
import type { BasketSummary, CheckoutOwner } from "../types/checkout-types.ts";

/**
 * CheckoutStepperBand — the middle-nav HEADER band on **all four** checkout steps: *how far through
 * the flow you are*, and nothing else.
 *
 * The band is the {@link CheckoutStepper} alone, left-aligned at the content column's own inline
 * padding, vertically centred in the fixed `--shell-midnav-header-h` strip. On the two focus steps
 * (`details`, `payment`) that is the whole band. On the basket step a small control cluster sits at
 * the far inline end — find-in-basket, the mobile Browse transfer, and the display-currency selector
 * — placed there precisely so it cannot crowd the trail.
 *
 * It carries **no action that moves money and no primary CTA** — those are the footer rig's — and no
 * data, which is the body's.
 *
 * ## What was removed, and where each fact went instead
 *
 * The band used to open with an account identity block (avatar · name · basket name). The design puts
 * the trail at the inline edge, so the block is gone — but "whose money is this" is not, and it is
 * worth recording where each step now answers it, because a payment surface that answers it nowhere
 * is a real defect rather than a tidier header:
 *
 * - **Basket · Confirmation** run in `full` chrome, so the shell's own account control is present.
 * - **Details** carries `BillingContextSwitcher` in the body — the legal identity being invoiced,
 *   which is a stronger answer than an avatar was.
 * - **Payment** prints "Paying from …" above the card selection, beside the figure it applies to.
 *
 * The display-currency selector narrowed to the basket step for the same reason: the design shows the
 * focus steps carrying the trail alone. See the note on {@link CheckoutStepperBandProps.display} for
 * the consequence that has, which is stated rather than assumed away.
 *
 * ## The three mechanisms that are not obvious
 *
 * 1. **`container-type: inline-size` + `container-name: cko-band` on the root are load-bearing, not
 *    decoration.** `checkout-stepper.css` steps the trail's type and chevron spacing down inside
 *    `@container cko-band (max-width: 34rem)`; a container query with no matching ancestor container
 *    never matches at all, so without the declaration in `basket-bands.css` the trail would simply
 *    clip. The containment is also what stops a `nowrap` band contributing its min-content width to
 *    the frame's `minmax(0, 1fr)` content track — `/wallet` shipped without it and one rig raised the
 *    whole surface's floor to 739px, crushing the lane to 2px.
 *
 * 2. **The ≤767px Browse duty-transfer.** `.ui-middle-nav__lane` is `display: none` below 767px, and
 *    on the basket step the lane is the only route between the account's baskets. A responsibility
 *    cannot evaporate at a breakpoint, so at that width the band grows a Browse control holding
 *    exactly the lane's scope duty. It is **icon-only** at every width it appears, so the transfer
 *    costs the trail no room. It is gated by a **viewport** media query rather than a container
 *    query, deliberately: it mirrors the lane's own `@media (max-width: 767px)` rule, so the two are
 *    decided by the same measurement and cannot disagree. Everything sized against the band's own
 *    width uses a container query, because that width depends on whether the lane is there.
 *    On the two focus steps there is no lane to inherit from, so there is no Browse control either.
 *
 * 3. **`reached` comes from the store, not from the URL.** A buyer whose details were already saved is
 *    redirected past Details; walking back to the basket must still show Details as a step they have
 *    reached rather than one they skipped. {@link reachedStep} is monotonic and is read only after
 *    mount — reading a module signal during SSR would read a value shared by every concurrent request
 *    (the data-race class flagged in Decision #69), and the prop is the honest first-byte answer.
 */

// #region Props
/** Props for {@link CheckoutStepperBand}. */
export interface CheckoutStepperBandProps {
	/** Which of the four steps the URL addresses. */
	step: CheckoutStep;
	/**
	 * Who is paying. **No longer rendered by the band** — see the class doc for where each step answers
	 * identity now. Retained as an optional prop so the header slot's existing call still type-checks;
	 * it can be dropped from both sides in one change.
	 */
	owner?: CheckoutOwner;
	/** The `owner=` scope param, echoed into every link so navigation keeps the acting account. */
	ownerParam: string;
	/**
	 * The open basket's display name. **No longer rendered by the band** — retained for the same
	 * reason as {@link CheckoutStepperBandProps.owner}.
	 */
	basketName?: string;
	/** The open basket's id, carried through every step link so the flow stays on one basket. */
	basketId: string | null;
	/** The acting account's baskets — the mobile Browse control's contents. */
	baskets: BasketSummary[];
	/**
	 * The display currency SSR formatted every figure in; seeds the selector.
	 *
	 * The selector itself renders on the **basket step only**. The two focus steps run in `focus`
	 * chrome, which withholds the shell's utility bar, so they carry no currency control at all — a
	 * deliberate consequence of the design and not an oversight: the currency is chosen before the
	 * commit and travels with the viewer through the shared store, and re-denominating a figure a
	 * buyer is one click from paying is not a refinement that belongs on that step.
	 */
	display: string;
	/** The completed order, on the confirmation step; `null` elsewhere. */
	orderId?: string | null;
}
// #endregion

export default function CheckoutStepperBand(props: CheckoutStepperBandProps): JSX.Element {
	const browseOpen = useSignal(false);
	const findOpen = useSignal(false);
	/**
	 * Whether the client store may be read yet.
	 *
	 * The band renders on the server too, where every module signal is shared by every concurrent
	 * request — so before mount the SSR prop is the only trustworthy answer, and after mount the store
	 * is. Gating on a signal rather than on `typeof document` also keeps the first client render
	 * identical to the server's, so hydration has nothing to reconcile.
	 */
	const mounted = useSignal(false);

	useCheckoutSeamPassive({
		basketId: props.basketId,
		owner: props.ownerParam,
		display: props.display,
	});

	useEffect(() => {
		seedStep(props.step);
		mounted.value = true;
	}, [props.step]);

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

	/** Narrowing exists on step 1 only — every later step renders the server's own resolved line set. */
	const searchable = props.step === "basket";
	/** The lane exists on the non-focus steps, so those are the only ones with a duty to inherit. */
	const hasLane = !isFocusStep(props.step);
	const reached = mounted.value ? reachedStep.value : props.step;

	return (
		<div class="cko-band" data-step={props.step}>
			<div class="cko-band__steps">
				<CheckoutStepper
					active={props.step}
					basketId={props.basketId}
					owner={props.ownerParam}
					orderId={props.orderId ?? null}
					reached={reached}
				/>
			</div>

			<div class="cko-band__controls">
				{
					/*
					 * The band's own narrow tiers have no room for an inline field, so find-in-basket is
					 * ALWAYS this control rather than an inline field that disappears below a width. A
					 * capability removed by a breakpoint with nothing holding it is the `/wallet` footer
					 * defect wearing a header's clothes; a capability that is always in one place is simply
					 * where it is.
					 */
				}
				{searchable && (
					<Popover
						open={findOpen}
						placement="bottom-end"
						label="Find in basket"
						class="bsk-menu"
						trigger={(api) => (
							<Tooltip content="Find in basket" placement="bottom">
								<button
									type="button"
									class="cko-band__btn cko-band__btn--find"
									aria-label="Find in basket"
									aria-haspopup="dialog"
									aria-expanded={api.expanded ? "true" : "false"}
									aria-controls={api.panelId}
									onClick={api.toggle}
									ref={api.ref as RefObject<HTMLButtonElement>}
								>
									<Icon name="search" />
									{basketSearch.value !== "" && <span class="cko-band__dot" aria-hidden="true" />}
								</button>
							</Tooltip>
						)}
					>
						<label class="cko-band__findfield">
							<span class="cko-band__findicon" aria-hidden="true">
								<Icon name="search" />
							</span>
							<input
								type="search"
								class="cko-band__findinput"
								placeholder="Find in basket"
								aria-label="Find in basket"
								value={basketSearch.value}
								onInput={(e) => onSearch((e.target as HTMLInputElement).value)}
							/>
						</label>
					</Popover>
				)}

				{/* Mobile-only: the scope duty the lane owns above 767px, transferred rather than dropped. */}
				{hasLane && (
					<Popover
						open={browseOpen}
						placement="bottom-end"
						label="Browse baskets"
						class="bsk-menu"
						trigger={(api) => (
							<Tooltip content="Browse baskets" placement="bottom">
								<button
									type="button"
									class="cko-band__btn cko-band__btn--browse"
									aria-label="Browse baskets"
									aria-haspopup="dialog"
									aria-expanded={api.expanded ? "true" : "false"}
									aria-controls={api.panelId}
									onClick={api.toggle}
									ref={api.ref as RefObject<HTMLButtonElement>}
								>
									<Icon name="menu" />
								</button>
							</Tooltip>
						)}
					>
						{props.baskets.map((entry) => (
							<a
								key={entry.id}
								class="bsk-menu__item"
								href={checkoutStepHref("basket", entry.id, props.ownerParam)}
								aria-current={entry.id === props.basketId ? "page" : undefined}
							>
								<Icon name={entry.isDefault ? "basket" : "bookmark"} />
								<span>{entry.name}</span>
								<span class="bsk-menu__count">{entry.itemCount}</span>
							</a>
						))}
					</Popover>
				)}

				{searchable && <CheckoutCurrencySelect initial={props.display} />}
			</div>
		</div>
	);
}
