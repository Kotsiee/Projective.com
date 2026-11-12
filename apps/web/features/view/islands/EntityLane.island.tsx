import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { requestShare } from "@web/features/share/core/share-request.ts";
import { useEffect } from "preact/hooks";
// `profile-skeleton.css` rides this island because it pulls in `explore.css`, which the page's server-rendered
// parts read; `entity-view.css` is the page's own sheet, and this island delivers it (§C.1 — a sheet
// imported by a server component alone never ships).
import "@features/profile/styles/profile-skeleton.css";
import "../styles/entity-view.css";
import {
	LaneLedger,
	type LaneLedgerRow,
	LaneMenu,
	type LaneMenuItem,
	LaneStages,
	PriceBlock,
	SeatSummary,
} from "../components/lane-parts.tsx";
import { basketIds, hydrateBasket } from "../core/basket-state.ts";
import { signInHref } from "../core/view-model.ts";
import { offerSummaryFor } from "../core/offer-summary.ts";
import { savedFlag, savedTypeOf, toggleFlag } from "@features/saved/core/saved-state.ts";
import { CollectionPicker } from "@features/saved/components/CollectionPicker.tsx";
import "@features/saved/styles/saved.css";
import { BookingCtaRig } from "../components/BookingCtaRig.tsx";
import BookingPanels from "./BookingPanels.island.tsx";
import { announce as announceBooking, openBookingPanel } from "../core/booking-state.ts";
import { type EntityArchetype, offerFor, seatCapacityFor } from "../core/entity-archetype.ts";
import BuyNowModal from "@web/features/checkout/islands/BuyNowModal.island.tsx";
import { purchasableKindOf } from "@web/features/checkout/core/purchasable.ts";
import { commitBasket, commitBuyNow } from "../core/booking-commits.ts";
import { commitOrSimulate, seedSimulation, type SimulationFacts } from "../core/simulation.ts";
import type { EntityView, ProjectStage } from "@projective/types/explore";
import type { ServiceBookingOffer } from "@projective/types/services";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { PriceAmount } from "@features/explore/core/pricing.ts";

/**
 * EntityLane — the listing's bounded purchase card (`DESIGN_SYSTEM.md` §D.7, Decision #424), the
 * `.evp-frame`'s END column at a content width of 1024px and up.
 *
 * One presentation serves both shells: a signed-in buyer and a guest see the same floating card in the
 * same place. Its anatomy is fixed — price (with the secondary actions behind a kebab) · stage or seat
 * summary · key terms · the action stack — and it carries NO identity: the creator is named once, in
 * the page's byline, so the card never repeats the avatar, name, crest and rating the reader has just
 * read.
 *
 * **It is bounded and never scrolls on its own.** A long stage run lists its first rows and folds the
 * rest into one jump into the body's stage ledger, so every key term and the commit are on screen
 * without an inner scrollbar.
 *
 * **Below that width it is not rendered at all** and the duty transfers to `EntityBuyBar`. The two are
 * mutually exclusive by `display`, so only ever one is in the accessibility tree, and both derive their
 * offer from the SAME server-resolved object so they cannot drift.
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
	/**
	 * The owner's buyer simulation (Decision #217 (j)): every commit resolves locally with its
	 * would-be outcome (`core/simulation.ts`), and the owner's own basket is never read.
	 */
	simulation?: SimulationFacts;
}

/** The most stage rows the card lists before folding the rest into one jump into the body. */
const CARD_STAGE_LIMIT = 4;

export default function EntityLane(
	{
		view,
		archetype,
		amount,
		fallback,
		unit,
		isFloor,
		authed,
		ctx,
		stages,
		offer: bookingOffer,
		simulation,
	}: EntityLaneProps,
): JSX.Element {
	seedSimulation(simulation);
	const { item } = view;
	const offer = offerFor(archetype);
	const capacity = seatCapacityFor(view, archetype);
	const hasStages = !!stages?.length;

	const kind = savedTypeOf(item.type);
	const saved = authed ? savedFlag(kind, item.id) : null;
	const picking = useSignal(false);
	const status = useSignal("");
	const added = basketIds.value.includes(item.id);

	// A simulation never reads the owner's own basket: what a buyer sees is an empty one.
	useEffect(() => {
		hydrateBasket(authed && !simulation);
	}, [authed]);

	// #region Actions
	function announce(msg: string): void {
		status.value = msg;
	}

	/** Open the unified share modal (people on Projective · external apps · copy · the device sheet). */
	async function share(): Promise<void> {
		const out = await commitOrSimulate({ kind: "share" }, () => {
			requestShare({ href: globalThis.location?.href ?? "", title: item.title, noun: "listing" });
			return Promise.resolve();
		});
		if (out.simulated) announce(out.outcome);
	}

	/** A guest's save is a sign-in first — the save is a claim on their own account. */
	function signedIn(): boolean {
		if (saved) return true;
		globalThis.location.assign(signInHref(item, ctx));
		return false;
	}

	/** Save or un-save the listing (a bookmark, Decision #180). */
	async function save(): Promise<void> {
		if (!simulation && !signedIn()) return;
		const out = await commitOrSimulate({ kind: "save" }, () => toggleFlag(kind, item.id));
		const message = out.simulated ? out.outcome : out.value.message;
		if (message) announce(message);
	}

	/** Open the collection picker — in a simulation, state what it would do instead. */
	async function collect(): Promise<void> {
		if (!simulation && !signedIn()) return;
		const out = await commitOrSimulate({ kind: "collection" }, () => {
			picking.value = true;
			return Promise.resolve();
		});
		if (out.simulated) announce(out.outcome);
	}

	const menu: LaneMenuItem[] = [
		{ key: "share", label: "Share listing", icon: "share", onSelect: () => void share() },
		{
			key: "save",
			label: saved?.value ? "Remove from saved" : "Save",
			icon: "star",
			onSelect: () => void save(),
		},
		{
			key: "collection",
			label: "Add to collection…",
			icon: "bookmark",
			onSelect: () => void collect(),
		},
		{
			key: "scope",
			label: "Request custom scope",
			icon: "edit",
			onSelect: () => openBookingPanel("quote"),
		},
	];

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
	async function onPrimaryPurchase(): Promise<boolean> {
		if (!authed) {
			globalThis.location.href = signInHref(item, ctx);
			return false;
		}
		if (!purchaseKind) return false;
		const out = await commitBuyNow({
			itemId: item.id,
			itemType: purchaseKind,
			title: item.title,
			sellerName: item.owner.name,
			signInHref: signInHref(item, ctx),
		}, authed);
		// A simulated purchase settles in place; a real one hands the transaction to the panel.
		return out.simulated;
	}

	async function onAddToBasket(): Promise<boolean> {
		if (!authed) {
			globalThis.location.href = signInHref(item, ctx);
			return false;
		}
		const out = await commitBasket(item);
		if (out.simulated) return true;
		announceBooking(out.value.message);
		announce(out.value.message);
		return out.value.ok;
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
	const ledger: LaneLedgerRow[] = [];
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
	// A session's delivery line and its booking summary are frequently the same sentence ("60-minute
	// session"); one fact is printed once, under the label that reaches the row first.
	if (view.service?.bookingSummary && !ledger.some((r) => r.value === view.service?.bookingSummary)) {
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
	const stageCurrency = (item.type === "services" || item.type === "products"
		? item.currency
		: undefined) ?? "USD";

	return (
		<div class="evp-card">
			{
				/*
			  1. PRICE, with every SECONDARY action behind the kebab beside it. No identity band: the
			  creator is named once, in the page's byline (Decision #424), and the card opens on the figure.

			  Request custom scope opens the QUOTE composer rather than the generic message box, so "price
			  this different scope" reaches the provider as a structured proposal, not an untyped message.
			*/
			}
			<div class="evp-card__head">
				<PriceBlock amount={amount} fallback={fallback} unit={unit} isFloor={isFloor} />
				<LaneMenu menu={menu} menuLabel="More listing actions" />
			</div>

			{
				/*
			  2. STAGE / SEAT SUMMARY — compact rows, capped so the card is bounded and never scrolls on
			  its own (the rest of a long run is one jump into the body's stage ledger), and the cohort's
			  single seat meter.
			*/
			}
			{hasStages && (
				<LaneStages stages={stages!} currency={stageCurrency} label="Pipeline stages" limit={CARD_STAGE_LIMIT} />
			)}
			{capacity && <SeatSummary capacity={capacity} />}

			{/* 3. KEY TERMS — inline meta rows, never chips (§B.11.2). */}
			<LaneLedger rows={ledger} />

			{/* 4. THE ACTION STACK — tier 1 · tier 4 · the one ghost (§B.8.1). */}
			<BookingCtaRig
				offer={bookingOffer}
				layout="lane"
				inBasket={added}
				onPrimaryPurchase={purchaseKind ? onPrimaryPurchase : undefined}
				onAddToBasket={purchaseKind ? onAddToBasket : undefined}
			/>

			{
				/*
			  Instant checkout elects a host across the two transactional regions. The inquiry composer is
			  NOT mounted here: both regions hydrate (they hide each other by `display`, not by unmounting)
			  and a `DraggablePopover` portals its panel to the body, so two instances bound to one shared
			  signal would open two panels. `EntityBuyBar` is the guaranteed single host.
			*/
			}
			<BuyNowModal host="lane" />
			<BookingPanels
				offer={bookingOffer}
				host="lane"
				stages={view.service?.stages}
				intake={view.service?.intake}
				sessionPlan={view.service?.sessionPlan}
				currency={item.type === "services" || item.type === "products" ? item.currency : undefined}
				summary={offerSummaryFor(view)}
			/>

			{saved && (
				<CollectionPicker
					open={picking}
					target={{ type: kind, ref: item.id, title: item.title }}
					onDone={(_collection, message) => {
						saved.value = true;
						announce(message);
					}}
				/>
			)}

			<p class="ui-visually-hidden" role="status" aria-live="polite">{status.value}</p>
		</div>
	);
}

