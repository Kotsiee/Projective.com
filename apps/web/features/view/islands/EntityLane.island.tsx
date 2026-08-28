import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Popover } from "@projective/ui/feedback";
import { Avatar, RatingStars } from "@projective/ui/display";
import { PriceOrigin } from "../components/entity-view-parts.tsx";
import { MoneyView } from "@projective/ui/display/money";
import { Icon } from "@projective/ui/icons";
// The lane reuses the profile lane's `pf-lane*` skeleton (header + scroll + footer geometry), so
// `profile.css` must ride this island's client bundle — and it is what pulls in `explore.css`, whose
// `.ex-status` rules the identity band's earned badges render with. `entity-view.css` layers the
// conversion-rail content on top, and it is this island that delivers the whole page's sheet
// (§C.1 — a sheet imported by a server component alone never ships).
import "@features/profile/styles/profile.css";
import "../styles/entity-view.css";
import { StatusChip } from "@features/explore/components/StatusChip.tsx";
import { basketIds, hydrateBasket, toggleBasket } from "../core/basket-state.ts";
import { jumpToStage } from "../core/view-state.ts";
import { scrollToId } from "../core/scroll-to.ts";
import { sellerBadges, signInHref } from "../core/view-model.ts";
import { BookingCtaRig } from "../components/BookingCtaRig.tsx";
import BookingPanels from "./BookingPanels.island.tsx";
import { announce as announceBooking, openBookingPanel } from "../core/booking-state.ts";
import {
	type EntityArchetype,
	offerFor,
	type SeatCapacity,
	seatCapacityFor,
} from "../core/entity-archetype.ts";
import BuyNowModal from "@web/features/checkout/islands/BuyNowModal.island.tsx";
import { requestBuyNow } from "@web/features/checkout/core/buy-now-state.ts";
import { purchasableKindOf } from "@web/features/checkout/core/purchasable.ts";
import {
	type EntityView,
	type ProjectStage,
	revisionAllowanceKind,
	type StageRevisions,
} from "@projective/types/explore";
import type { ServiceBookingOffer } from "@projective/types/services";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { PriceAmount } from "@features/explore/core/pricing.ts";

/**
 * EntityLane — the conversion rail (`DESIGN_SYSTEM.md` §D.7), mounted as the frame's END column.
 *
 * On a public entity-view route the side panel stops being navigation and becomes **the
 * transaction**. It renders IN PAGE now, as the last column of the `.evp-frame` grid, rather than in
 * the shell's middle-nav lane — which is why it is no longer called `MiddleNavActionLane`. One
 * presentation serves both shells: an authenticated buyer and a guest see the same floating panel in
 * the same place, instead of a drag-resizable middle-nav lane on one side of the page for one of
 * them and a floating glass aside for the other.
 *
 * **The collapsed icon rail and the collapse toggle are gone, deliberately.** Both were reveals keyed
 * on hosts this panel no longer has — `.ui-splitter[data-mode="collapsed"]` and
 * `:root[data-guest-nav]` — so the rail could never appear and the toggle's
 * `MIDDLE_LANE_TOGGLE_EVENT` had no listener. A styled, focusable control whose handler reaches
 * nothing is a defect of the same class as a broken link (root CLAUDE.md §3 gate 11), and collapsing
 * a panel whose footer now holds the purchase button would hide the transaction outright.
 *
 * **The footer is pinned and carries the primary CTAs.** It cannot collapse: it is `flex: none` and
 * sticks to the panel's base, so the offer is on screen whatever the ledger above it does. The
 * scroll region between the identity band and that footer carries the facts — price, rating, seat
 * capacity, the summary ledger — and no controls that commit.
 *
 * **Below the frame breakpoint (1100px) this lane is not rendered at all** and the duty transfers to
 * `EntityBuyBar`. The two are mutually exclusive by `display`, so only ever one is in the
 * accessibility tree, and both derive their offer from the SAME server-resolved object so they cannot
 * drift. The transfer point is the FRAME's breakpoint rather than `--bp-md` because the lane is now a
 * page column: it costs 328px of the content region the shell used to supply from outside it, and at
 * 900px the four tracks left the content column narrower than the same page gets on a phone.
 */

export interface EntityLaneProps {
	view: EntityView;
	archetype: EntityArchetype;
	/** The structured headline price. `null` for a listing with no figure ("Contact us"). */
	amount: PriceAmount | null;
	/** The pre-formatted fallback for a listing carrying no structured minor units. */
	fallback: string;
	/** The per-unit noun (`ticket`, `session`, `seat`), without the leading slash. */
	unit?: string;
	/** True when the figure is only the LOW end of a range, so it must be announced as a floor. */
	isFloor?: boolean;
	authed: boolean;
	ctx: HrefContext;
	/** Stage-showcase stages — adds the quick-jump navigation list. */
	stages?: readonly ProjectStage[];
	/**
	 * The SSR-resolved booking offer — what the primary says, what it does, and what the Contact menu
	 * may show.
	 *
	 * It arrives as a prop rather than being fetched so the first byte carries the right verb on the
	 * one control this page exists for. Both transactional regions receive the SAME object, resolved
	 * once by the page, which is what makes §D.7.4's "the offer has one home" true of the data and not
	 * just of the layout.
	 */
	offer: ServiceBookingOffer;
}

export default function EntityLane(
	{ view, archetype, amount, fallback, unit, isFloor, authed, ctx, stages, offer: bookingOffer }:
		EntityLaneProps,
): JSX.Element {
	const { item } = view;
	const offer = offerFor(archetype);
	const capacity = seatCapacityFor(view, archetype);
	const hasStages = !!stages?.length;

	const saved = useSignal(false);
	const status = useSignal("");
	const added = basketIds.value.includes(item.id);

	useEffect(() => {
		hydrateBasket();
	}, []);

	// #region Actions
	function announce(msg: string): void {
		status.value = msg;
	}

	/** Share via the Web Share sheet where the platform offers one, else copy to the clipboard. */
	function share(): void {
		try {
			const url = globalThis.location?.href ?? "";
			const nav = globalThis.navigator as Navigator & {
				share?: (d: { title: string; url: string }) => Promise<void>;
			};
			if (nav?.share) nav.share({ title: item.title, url }).catch(() => {});
			else {
				nav?.clipboard?.writeText(url).catch(() => {});
				announce("Link copied to clipboard");
			}
		} catch { /* non-fatal */ }
	}

	const purchaseKind = purchasableKindOf(item);

	/**
	 * The two purchase handlers, handed to the shared rig rather than implemented inside it.
	 *
	 * Each of the checkout feature's flows already has ONE implementation (`basket-state.ts` mirrors
	 * optimistically and reverts a refusal; `requestBuyNow` bounces a guest and opens the panel). The
	 * rig calls these; it never grows a second copy, which is how two surfaces come to add a line under
	 * two different `itemType`s and stack two rows for one listing.
	 *
	 * TWO functions, one per control — see `EntityBuyBar` for the defect a single shared one caused.
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
		return Promise.resolve(false);
	}

	async function onAddToBasket(): Promise<boolean> {
		if (!authed) {
			globalThis.location.href = signInHref(item, ctx);
			return false;
		}
		const res = await toggleBasket(item);
		announceBooking(res.message);
		announce(res.message);
		return res.ok;
	}
	// #endregion

	// #region Summary ledger (§D.7.2 item 5 — inline meta rows, never chips)
	/**
	 * A meta row: a label, the fact, and an optional muted qualifier UNDER the fact.
	 *
	 * The `note` exists because several of these facts genuinely are two — "3 files" and how big they
	 * are, "stage 2 of 4" and which stage that is. They used to be one middot-joined string, which made
	 * the scannable part and the qualifier compete on one line at one weight.
	 */
	const ledger: Array<{ label: string; value: string; note?: string }> = [];
	if (item.type === "services" && item.delivery) {
		ledger.push({ label: "Delivery", value: item.delivery });
	}
	if (archetype === "pipeline" && view.service?.stages.length) {
		const active = view.service.stages.find((s) => s.status === "active") ??
			view.service.stages[0];
		ledger.push({
			label: "Stage",
			value: `${active.index} of ${view.service.stages.length}`,
			note: active.name,
		});
	}
	if (view.service?.bookingSummary) {
		ledger.push({ label: "Format", value: view.service.bookingSummary });
	}
	if (archetype === "product" && view.product) {
		ledger.push({
			label: "Download",
			value: `${view.product.files.length} files`,
			note: view.product.payloadLabel,
		});
		ledger.push({ label: "Licence", value: view.product.licence.name });
	}
	const revisions = view.trust.find((t) => t.icon === "revisions");
	if (revisions) ledger.push({ label: revisions.label, value: revisions.value });
	const response = view.trust.find((t) => t.icon === "response");
	if (response) ledger.push({ label: response.label, value: response.value });
	// `escrows` is deliberately narrow — PRODUCT_SPEC locks escrow-at-checkout to SESSIONS, so a
	// blanket notice on a One-Off or a Product would be a protection claim the platform has not made.
	if (offer.escrows) {
		ledger.push({
			label: "Protection",
			value: "Held in escrow",
			note: "Released when you accept",
		});
	}
	// #endregion

	/*
	 * The currency the stage prices are quoted in.
	 *
	 * `TicketPrice.min`/`max` are MAJOR units in the listing's own currency, and only a service or a
	 * product carries one — so the fallback matches `StageProgressLedger`'s exactly. Two different
	 * fallbacks would let the lane and the body stage card label the same number differently.
	 */
	const stageCurrency = item.type === "services" || item.type === "products"
		? item.currency
		: "USD";

	const badges = sellerBadges(item, view.responseMinutes);
	const reviews = view.reviews.summary;
	const hasReviews = reviews.count > 0;

	return (
		<div class="pf-lane evp-lane">
			<div class="pf-lane__full evp-lane__full">
				{
					/*
				  1. IDENTITY BAND. The uploader's face and their DISPLAY NAME — not their handle. A
				  buyer decides whether to trust a person, and "@fernanda-ruiz" is an address where
				  "Fernanda Ruiz" is a name; the handle survives as the link target and in the hero.

				  The earned badges beside it are `.ex-status` chips, the same component and the same
				  derivation rule the Explore card that linked here uses (`sellerBadges`), so a seller
				  cannot be "Top rated" on the card and unmarked on the page. They are the sanctioned
				  container case (§B.11.3): a required disclosure of an earned, changeable state.

				  Every SECONDARY action lives behind the kebab.
				*/
				}
				<header class="evp-lane__id">
					<a class="evp-lane__owner" href={`/${item.owner.handle}`}>
						<Avatar
							image={item.owner.avatar}
							label={item.owner.name}
							size="md"
							class="evp-lane__avatar"
						/>
						<span class="evp-lane__identity">
							<span class="evp-lane__name">
								{item.owner.name}
								{item.owner.verified && (
									<Icon
										name="verified"
										size="sm"
										filled
										class="evp-lane__crest"
										aria-label="Verified"
									/>
								)}
							</span>
							{badges.length > 0 && (
								<span class="evp-lane__badges">
									{badges.map((signal) => <StatusChip key={signal.id} signal={signal} />)}
								</span>
							)}
						</span>
					</a>

					{
						/*
					  No `label`: `Popover` promotes a labelled panel to `role="dialog"`, and the trigger
					  advertises `aria-haspopup="menu"`. The two disagreed, so a screen reader announced a
					  menu and landed the user in a dialog. The panel's own `role="menu"` + `menuitem`
					  children already name and describe it.
					*/
					}
					<Popover
						placement="bottom-end"
						class="evp-menu"
						trigger={(api) => (
							<button
								type="button"
								ref={api.ref as RefObject<HTMLButtonElement>}
								class="evp-lane__kebab"
								aria-label="More listing actions"
								aria-expanded={api.expanded ? "true" : "false"}
								aria-controls={api.panelId}
								aria-haspopup="menu"
								onClick={api.toggle}
							>
								<Icon name="kebab" size="sm" />
							</button>
						)}
					>
						<div class="evp-menu__list" role="menu">
							<button type="button" class="evp-menu__item" role="menuitem" onClick={share}>
								<Icon name="share" size="sm" aria-hidden />
								<span>Share listing</span>
							</button>
							<button
								type="button"
								class="evp-menu__item"
								role="menuitem"
								onClick={() => {
									saved.value = !saved.value;
									announce(saved.value ? "Saved to your list" : "Removed from your list");
								}}
							>
								<Icon name="bookmark" size="sm" aria-hidden />
								<span>{saved.value ? "Remove from list" : "Save to custom list"}</span>
							</button>
							{
								/*
							  Request custom scope opens the QUOTE composer rather than the generic message
							  box. It previously opened the latter, which quietly made two different acts —
							  "ask me something" and "price this different scope" — resolve to one untyped
							  message, so the provider received a proposal with no budget, no timeline and no
							  structure to answer against.
							*/
							}
							<button
								type="button"
								class="evp-menu__item"
								role="menuitem"
								onClick={() => openBookingPanel("quote")}
							>
								<Icon name="edit" size="sm" aria-hidden />
								<span>Request custom scope</span>
							</button>
							<button
								type="button"
								class="evp-menu__item"
								role="menuitem"
								data-danger="true"
								onClick={() => announce("Report submitted for review")}
							>
								<Icon name="flag" size="sm" aria-hidden />
								<span>Report listing</span>
							</button>
						</div>
					</Popover>
				</header>

				<div class="pf-lane__scroll evp-lane__scroll">
					{
						/*
					  2. PRICE. Two registers, one figure — never two equally-weighted numbers, which
					  reads as two prices.

					  "From" is its own eyebrow line rather than a word run into the figure. It is a
					  qualifier on the whole price, not part of the number, and inline it competed for the
					  same baseline as the currency symbol.

					  `MoneyView` splits the figure into symbol / major / minor ITSELF (`splitMoney`), so
					  the smaller raised pence in the design come from the component rather than from this
					  surface slicing a formatted string. That matters beyond tidiness: the app's currency
					  sweep rebuilds this exact subtree when it re-projects a server-rendered figure, so a
					  hand-split price would lose its pence styling the first time the reader changed
					  currency.
					*/
					}
					<div class="evp-price">
						{amount
							? (
								<>
									{isFloor && <span class="evp-price__from">From</span>}
									<span class="evp-price__figure">
										<MoneyView
											minor={amount.minor}
											currency={amount.currency}
											size="figure"
											hideOrigin
											class="evp-price__money"
										/>
										{unit && <span class="evp-price__unit">/ {unit}</span>}
									</span>
									<PriceOrigin minor={amount.minor} currency={amount.currency} />
								</>
							)
							: <span class="evp-price__figure evp-price__figure--quote">{fallback}</span>}
					</div>

					{
						/*
					  3. REPUTATION, and it is one control rather than a row with a link in it.

					  The whole thing — stars, score, count — is a single anchor to the reviews section,
					  because a reader who wants the reviews aims at the stars and the target that
					  actually navigated was the four-word count beside them. It stays an `<a href>` so
					  middle-click, open-in-new-tab and no-JS all still work, and the handler only
					  UPGRADES the jump: it cancels the hash navigation and scrolls smoothly to a position
					  that clears the pinned chrome, which a bare `#hash` cannot do.
					*/
					}
					{hasReviews && (
						<a
							class="evp-lane__rating"
							href="#evp-reviews"
							onClick={(e) => {
								if (scrollToId("evp-reviews")) e.preventDefault();
							}}
						>
							<RatingStars
								value={reviews.average}
								size="sm"
								label={`Rated ${reviews.average.toFixed(1)} out of 5 from ${reviews.count} reviews`}
							/>
							<span class="evp-lane__ratingvalue">{reviews.average.toFixed(1)}</span>
							<span class="evp-lane__ratingcount">
								{reviews.count} {reviews.count === 1 ? "review" : "reviews"}
							</span>
						</a>
					)}

					{
						/*
					  4. THE STAGES, and they come BEFORE the meta.

					  A pipeline buyer's first question is what the engagement consists of and what each
					  step costs; the summary facts are what they check afterwards. The order follows that,
					  and the single hairline below the list is the ONLY divider in this region — the meta
					  rows are separated by spacing alone (§B.4.1, spacing is the first separator).

					  Each row carries the stage's own price as muted subtext, rendered through the SAME
					  `MoneyView` the body ledger uses so the lane and the stage card cannot state
					  different amounts, and quote the same currency after a switch.
					*/
					}
					{hasStages && (
						<nav class="evp-stages" aria-label="Pipeline stages">
							{stages!.map((s) => (
								<button
									type="button"
									class="evp-stages__item"
									key={s.id}
									data-status={s.status}
									onClick={() => jumpToStage(s.id)}
								>
									<span class="evp-stages__n" aria-hidden="true">{s.index}</span>
									<span class="evp-stages__body">
										<span class="evp-stages__name">{s.name}</span>
										<span class="evp-stages__price">
											{
												/*
											  ONE figure — the INITIAL per-ticket price, not the 0.5×–2.0× workload
											  range. Same field, same rendering, same rule as the body ledger's
											  summary row, so the two regions cannot state the stage differently.
											*/
											}
											<MoneyView
												minor={Math.round(s.price.min * 100)}
												currency={stageCurrency}
												size="micro"
												hideOrigin
											/>
											{s.revisions && (
												<>
													<span class="evp-stages__pricesep" aria-hidden="true">·</span>
													{
														/*
													  Classified by the SSOT's own rule, not by re-reading the two fields
													  here — the lane, the stage ledger and the trust row are one
													  commitment described in three places, and the shortest of the three
													  is the easiest one to get subtly wrong.
													*/
													}
													<span class="evp-stages__revisions">
														{revisionLabel(s.revisions)}
													</span>
												</>
											)}
										</span>
									</span>
									<Icon
										name="chevron-right"
										size="sm"
										class="evp-stages__chevron"
										aria-hidden
									/>
								</button>
							))}
						</nav>
					)}

					{
						/*
					  5. THE META SECTION. Two columns — label at the inline start, value at the end with
					  an optional muted note beneath it.

					  The note is not decoration: several of these facts are genuinely two facts joined by
					  a middot ("3 files · 12.4 MB", "2 of 4 · Design"), and stacking the qualifier under
					  the value is what lets the value itself stay scannable. Rows with one fact simply
					  have no note.

					  Facts, not controls, so none of them is a chip (§B.11.2), and no row draws a rule.
					*/
					}
					{(capacity || ledger.length > 0) && (
						<div class="evp-lane__meta">
							{/* Seat capacity — the meter is decorative, the sentence is the fact (§D.8.4). */}
							{capacity && <LaneSeats capacity={capacity} />}

							{ledger.length > 0 && (
								<dl class="evp-lane__ledger">
									{ledger.map((row) => (
										<div class="evp-lane__ledgerrow" key={row.label}>
											<dt class="evp-lane__ledgerlabel">{row.label}</dt>
											<dd class="evp-lane__ledgervalue">
												<span class="evp-lane__ledgerfact">{row.value}</span>
												{row.note && <span class="evp-lane__ledgernote">{row.note}</span>}
											</dd>
										</div>
									))}
								</dl>
							)}
						</div>
					)}
				</div>

				{
					/*
				  5. THE PINNED ACTION FOOTER. One brand primary, one outlined secondary, one ghost
				  tertiary — pinned to the panel's base and never collapsing, so the offer is on screen
				  regardless of how long the ledger above it runs.
				*/
				}
				<div class="pf-lane__footer evp-lane__footer">
					<BookingCtaRig
						offer={bookingOffer}
						layout="lane"
						inBasket={added}
						onPrimaryPurchase={purchaseKind ? onPrimaryPurchase : undefined}
						onAddToBasket={purchaseKind ? onAddToBasket : undefined}
					/>
				</div>
			</div>

			{
				/*
			  Instant checkout elects a host across the two transactional regions. The inquiry composer
			  is NOT mounted here: both regions hydrate (they hide each other by `display`, not by
			  unmounting) and a `DraggablePopover` portals its panel to the body, so two instances bound
			  to one shared signal would open two panels. `EntityBuyBar` is rendered unconditionally by
			  `EntityViewPage` while this lane is only mounted when the archetype resolves one, so the
			  buy bar is the guaranteed single host. This lane only ever flips the signal.
			*/
			}
			<BuyNowModal host="lane" />
			<BookingPanels
				offer={bookingOffer}
				host="lane"
				stages={view.service?.stages}
				currency={item.type === "services" || item.type === "products" ? item.currency : undefined}
			/>

			<p class="ui-visually-hidden" role="status" aria-live="polite">{status.value}</p>
		</div>
	);
}

/**
 * The lane's compact seat meter. Split out purely so the geometry-is-never-animated rule lives beside
 * the element it governs: the widths are `flex-grow` integers set directly, so a background tab with a
 * frozen animation clock cannot draw an empty cohort as full (§8 Decision #60).
 */
function LaneSeats({ capacity }: { capacity: SeatCapacity }): JSX.Element {
	const segments = capacity.total <= 20 ? capacity.total : 20;
	const taken = capacity.total <= 20
		? capacity.taken
		: Math.round((capacity.taken / capacity.total) * 20);
	return (
		<div class="evp-lane__seats">
			<div class="evp-lane__seatstrack" aria-hidden="true">
				{Array.from(
					{ length: segments },
					(_, i) => (
						<span class="evp-lane__seatseg" key={i} data-state={i < taken ? "taken" : "open"} />
					),
				)}
			</div>
			<p class="evp-lane__seatsfact">{capacity.sentence}</p>
		</div>
	);
}

/**
 * The lane's one-phrase revision label.
 *
 * Deliberately carries no figure: the row already holds the stage's ticket price, and a second amount
 * beside it turns a scannable line into two numbers a reader has to tell apart. The amount belongs to
 * the stage ledger in the body, where there is room for the sentence that explains it.
 */
function revisionLabel(revisions: StageRevisions): string {
	switch (revisionAllowanceKind(revisions)) {
		case "unlimited":
			return "unlimited revisions";
		case "metered":
			return "revisions billed";
		default:
			return `${revisions.free} free rev${revisions.free === 1 ? "" : "s"}`;
	}
}
