import type {
	AddBasketItem,
	AppliedPromo,
	Basket,
	BasketGroup,
	BasketItem,
	BasketSummary,
	KycStatus,
	MoneyView,
	MoveBasketItem,
	PurchasableItemGroup,
	PurchasableItemKind,
	PurchaseOwnerType,
	RemoveBasketItem,
	UpdateBasketItem,
} from "@projective/types/finance";
import {
	applyDiscounts,
	basketSubtotal,
	formatMoney,
	isCheckoutEligible,
	itemKindMeta,
} from "@projective/types/finance";
import type { ExploreItem, ProjectItem } from "@projective/types/explore";
import { PRODUCTS, PROJECTS, SERVICES } from "../explore/fixtures.ts";
import { parsePriceMajor, PIPELINE_LOW, unitPriceMajor } from "../explore/pricing.ts";
import { switcher, toMoney } from "./wallet-fixtures.ts";
import type { BasketQuery, BasketSim } from "./basket-query.ts";

/**
 * basket fixtures — the fat {@link BasketBackendService}'s deterministic purchasing world while
 * `FINANCE_BACKEND_LIVE` is off.
 *
 * Like every sibling read projection this DERIVES its corpus from the SAME discovery fixtures the rest
 * of the platform sells from (`../explore/fixtures.ts`), so **a basket line agrees with the card that
 * added it** — same title, same seller, same media, same deep link, and a unit price resolved through
 * the shared numeric pricing primitives (`../explore/pricing.ts`) rather than a second copy of the
 * pipeline/session rules. No RNG: a stable unsigned hash and a fixed reference clock keep SSR and the
 * island's refetch byte-identical.
 *
 * **ALL money math is server-side and goes through the SSOT's one arithmetic path** — `basketSubtotal`,
 * `applyDiscounts`, `isCheckoutEligible` (and, in the checkout service, `checkoutTotals` /
 * `platformFeeFor` / `availableProviders`). Nothing in this module re-implements a subtotal, a discount
 * or a fee; it converts, formats, and wraps the integers those functions return into `MoneyView`s. The
 * FX snapshot and the formatter are the wallet's (`toMoney`), so two finance surfaces cannot quote one
 * price two ways.
 *
 * Because this is a WRITE surface, the derived baskets seed a mutable module-level {@link STATE} so
 * add / update / move / remove / promo / create-basket are fully exercisable with the gate off
 * (optimistic, per-process, no persistence). Nothing is hard-deleted (root CLAUDE.md §5): a removed
 * line is stamped `removedAt` and a purchased line `purchasedAt`, and reads exclude both.
 *
 * **Simulation knobs** ({@link BasketSim}) let the Dev Context Switcher reach every scope and gate —
 * persona, entity role, entity verification — passed as query params the island refetches with. They
 * mirror axes the switcher already ships; no new axis is introduced.
 */

// #region Reference clock + deterministic helpers (declared before the corpus — it builds at module init)
/** Fixed reference "now" — the same instant the wallet, projects and messaging fixtures use. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A tiny stable hash → non-negative int (unsigned `>>>`, per the documented hash-index gotcha). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/**
 * Honour the SSOT's truncation contract: `BasketItemSchema`'s free-text snapshots are bounded tighter
 * than their unbounded `text` columns, so a longer catalogue title must be cut on the way IN — a row
 * that exceeds them would fail to parse on the way out and take the whole basket read with it.
 */
function clip(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** An ISO timestamp from an epoch offset against the fixed clock. */
function iso(ms: number): string {
	return new Date(ms).toISOString();
}

/** `Tue 12 Aug · 14:00–15:00` for a booked slot, rendered in the slot's own timezone. */
function slotLabel(ms: number, timezone: string, minutes: number): string {
	const day = new Intl.DateTimeFormat("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
		timeZone: timezone,
	}).format(new Date(ms));
	const at = (t: number) =>
		new Intl.DateTimeFormat("en-GB", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			timeZone: timezone,
		}).format(new Date(t));
	return clip(`${day} · ${at(ms)}–${at(ms + minutes * 60_000)}`, 80);
}
// #endregion

// #region Money projection (the wallet's FX snapshot + the SSOT formatter — never a second copy)
const LOCALE = "en-GB";
/**
 * The currency the discovery corpus prices in. Every explore price is a `$` figure, so a basket line's
 * stored price has USD origin and the viewer's display currency is a conversion of it — which is why a
 * cross-currency basket shows the origin disclosure on each PRICE.
 */
const CORPUS_CURRENCY = "USD";

/**
 * A stored PRICE, converted from the corpus currency into the viewer's display currency and formatted
 * server-side. Carries the `(origin, rate)` disclosure when the two differ.
 */
function price(majorUsd: number, display: string): MoneyView {
	return toMoney(Math.round(majorUsd * 100), CORPUS_CURRENCY, display, LOCALE);
}

/**
 * A DERIVED figure — a line total, a subtotal, a fee, a promo saving. Already expressed in the display
 * currency (it is computed from converted minors), so it carries no origin: an origin is a property of
 * a price that was set in another currency, not of a sum of several such prices. Computing it from the
 * already-converted minors is also what keeps `Σ lineTotal === subtotal − creatorDiscounts` exact —
 * converting each figure independently could drift by a minor unit.
 */
function derived(minor: number, display: string): MoneyView {
	return { minor, currency: display, display: formatMoney(minor, display, LOCALE), origin: null };
}
// #endregion

// #region Owner scopes
/** A principal whose money a basket spends, and the finance facts a checkout needs about it. */
interface OwnerSeed {
	/** The canonical scope key (`personal` · `team:{id}` · `business:{id}` · `organisation:{id}`). */
	key: string;
	/** The `PurchaseOwnerType` for an entity; the personal scope resolves it from the persona. */
	ownerType: PurchaseOwnerType | null;
	ownerId: string;
	name: string;
	handle: string | null;
	avatar: string | null;
	/** The account's own currency — the default display currency for its baskets. */
	currency: string;
	/**
	 * The `wallet-fixtures` key this account's Projective balance is read from; `null` when the wallet
	 * cast carries no vault for it (see the organisation note in the module docs).
	 */
	walletKey: string | null;
	/** KYB state of the spending entity; `null` for an individual (KYB does not apply). */
	kybStatus: KycStatus | null;
	/** Verification tier — Level 3 is Business/KYB (`PRODUCT_SPEC` §Identity). */
	verificationTier: number | null;
}

/** An Unsplash face URL (the shared avatar convention across the fixture cast). */
function face(id: string): string {
	return `https://images.unsplash.com/${id}?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80`;
}

/**
 * The owner cast — the SAME identities the wallet, nav and workspace fixtures use, so switching context
 * moves the wallet and the basket together.
 *
 * There is deliberately no organisation vault in the wallet cast, so `@meridian`'s basket resolves a
 * `null` wallet: its Projective balance reads as zero and the `wallet` provider is refused with the
 * SSOT's own shortfall wording, rather than a personal balance being presented as the organisation's.
 */
const OWNERS: OwnerSeed[] = [
	{
		key: "personal",
		ownerType: null,
		ownerId: "u-ahmed",
		name: "Ahmed K.",
		handle: "ahmed",
		avatar: face("photo-1506794778202-cad84cf45f1d"),
		currency: "GBP",
		walletKey: "personal:u-ahmed",
		kybStatus: null,
		verificationTier: 2,
	},
	{
		key: "team:northwind",
		ownerType: "team",
		ownerId: "northwind",
		name: "Northwind Studio",
		handle: "northwind",
		avatar: face("photo-1500648767791-00dcc994a43e"),
		currency: "GBP",
		walletKey: "team:northwind",
		kybStatus: null,
		verificationTier: 2,
	},
	{
		key: "business:monarch-labs",
		ownerType: "business",
		ownerId: "monarch-labs",
		name: "Monarch Labs",
		handle: "monarchlabs",
		avatar: face("photo-1438761681033-6461ffad8d80"),
		currency: "GBP",
		walletKey: "business:monarch-labs",
		kybStatus: "verified",
		verificationTier: 3,
	},
	{
		key: "organisation:meridian",
		ownerType: "organisation",
		ownerId: "meridian",
		name: "Meridian Group",
		handle: "meridian",
		avatar: face("photo-1487412720507-e7ab37603c6f"),
		currency: "GBP",
		walletKey: null,
		kybStatus: "verified",
		verificationTier: 3,
	},
];

const OWNER_BY_KEY = new Map(OWNERS.map((o) => [o.key, o]));

/**
 * Whether a simulated persona can offer/deliver services. The app-side twin is `dev-seam`'s
 * `personaCapabilities`, which the backend cannot import (the workspace boundary forbids `@features/*`
 * — CLAUDE.md Decision #12); the mapping is restated here rather than diverged from: a **business is
 * buyer-only**, a freelancer and a team can also deliver.
 */
function personaIsFreelancer(persona: BasketSim["persona"]): boolean {
	return persona === "freelancer" || persona === "team";
}

/** The finance identity a basket/checkout read is scoped to, after the simulation is applied. */
export interface ResolvedOwner {
	key: string;
	ownerType: PurchaseOwnerType;
	ownerId: string;
	name: string;
	handle: string | null;
	avatar: string | null;
	/** Whether the acting user may spend this account's money (always true for their own). */
	actingIsMember: boolean;
	kybStatus: KycStatus | null;
	verificationTier: number | null;
	/** The resolved display currency for every figure in this read. */
	display: string;
	/** Whether this owner's money belongs to an entity rather than to the acting individual. */
	isEntity: boolean;
}

/** Normalise an `owner` query param onto a seeded scope key; anything unknown falls back to personal. */
function ownerKeyOf(raw: string | null | undefined): string {
	if (!raw) return "personal";
	const [scope, id] = raw.split(":");
	if (scope === "personal" || scope === "user" || scope === "freelancer") return "personal";
	const key = `${scope}:${id ?? ""}`;
	return OWNER_BY_KEY.has(key) ? key : "personal";
}

/**
 * The seeded scope key a simulated basket-owner axis selects — the FIRST owner of that kind in the
 * cast, so the client never has to know a fixture id to reach a scope.
 */
function ownerKeyForScope(scope: NonNullable<BasketSim["ownerScope"]>): string {
	if (scope === "personal") return "personal";
	return OWNERS.find((o) => o.ownerType === scope)?.key ?? "personal";
}

/** Map the simulated entity-verification axis onto the KYC/KYB vocabulary the SSOT gates on. */
function kybFromSim(sim: BasketSim["kyb"]): KycStatus | null {
	switch (sim) {
		case "verified":
			return "verified";
		case "kyb_pending":
			return "pending";
		case "unverified":
			return "unverified";
		default:
			return null;
	}
}

/**
 * Resolve which account a read spends from, in which currency, and whether the acting user may spend
 * from it — the input every provider decision, blocker and money figure downstream is built on.
 */
export function resolveOwner(query: BasketQuery): ResolvedOwner {
	const sim = query.sim ?? {};
	const acting = sim.actingContext;
	// The simulated scope wins over both the `?owner=` param and the acting flag: it is the developer
	// naming the principal outright, which is a stronger statement than either of the other two.
	const requested = sim.ownerScope
		? ownerKeyForScope(sim.ownerScope)
		: acting === false
		? "personal"
		: query.owner;
	const seed = OWNER_BY_KEY.get(ownerKeyOf(requested)) ?? OWNERS[0];
	const isEntity = seed.ownerType === "business" || seed.ownerType === "team" ||
		seed.ownerType === "organisation";

	const isFreelancer = sim.persona !== undefined
		? personaIsFreelancer(sim.persona)
		: query.isFreelancer === true;
	const ownerType: PurchaseOwnerType = seed.ownerType ?? (isFreelancer ? "freelancer" : "user");

	const simKyb = kybFromSim(sim.kyb);
	const kybStatus = isEntity ? (simKyb ?? seed.kybStatus) : null;
	const verificationTier = isEntity
		? (kybStatus === "verified" ? 3 : kybStatus === "pending" ? 2 : null)
		: seed.verificationTier;

	return {
		key: seed.key,
		ownerType,
		ownerId: seed.ownerId,
		name: seed.name,
		handle: seed.handle,
		avatar: seed.avatar,
		actingIsMember: isEntity ? sim.workspaceRole !== "non_member" : true,
		kybStatus,
		verificationTier,
		display: (query.display || seed.currency).toUpperCase(),
		isEntity,
	};
}

/**
 * The account's Projective wallet balance in the read's display currency, in integer minor units.
 *
 * Read from the wallet fixtures rather than derived here — the wallet is the authority on a balance,
 * and a checkout that computed its own would be a second answer to the same question. An account with
 * no vault in the wallet cast reads zero (see {@link OWNERS}).
 */
export function walletAvailableMinor(owner: ResolvedOwner, query: BasketQuery): number {
	const seed = OWNER_BY_KEY.get(owner.key);
	if (!seed?.walletKey) return 0;
	const active = switcher({
		wallet: seed.walletKey,
		display: owner.display,
		viewerHandle: query.viewerHandle,
		viewerId: query.viewerId,
		isFreelancer: query.isFreelancer,
	}).active;
	// The wallet resolver falls back to the personal wallet for an unknown key; refuse to present
	// someone else's balance as this account's.
	const [scope, id] = seed.walletKey.split(":");
	if (active.scope !== scope || (id && active.id !== id)) return 0;
	return active.available.minor;
}

/**
 * The acting wallet's balance after the simulated coverage axis, in minor units.
 *
 * It takes the TOTAL as an input rather than a flat figure because "covers" and "falls short" are
 * relative statements — a fixed balance would cover one basket and not another, so an axis that set a
 * number instead of a relationship would be inert on half the baskets it was pointed at. `covers`
 * raises the balance to exactly meet the total; `shortfall` holds it below, so the wallet provider is
 * refused with the SSOT's own shortfall wording rather than a fabricated one.
 *
 * The two provider presets that remove the wallet from the offer zero it here, so the shortfall reason
 * the buyer reads is the true one ("no funds"), not a second sentence invented for the preset.
 */
export function simWalletMinor(base: number, totalMinor: number, sim?: BasketSim): number {
	if (sim?.providers === "no_wallet" || sim?.providers === "card_only") return 0;
	if (sim?.walletCover === "covers") return Math.max(base, totalMinor);
	if (sim?.walletCover === "shortfall") return Math.min(base, Math.floor(totalMinor * 0.4));
	return base;
}
// #endregion

// #region Corpus lookup + unit pricing
const CORPUS = new Map<string, ExploreItem>();
for (const item of [...SERVICES, ...PRODUCTS, ...PROJECTS]) CORPUS.set(item.id, item);

/** The discovery record a basket line points at, or `undefined` when the id is unknown. */
export function corpusItem(id: string): ExploreItem | undefined {
	return CORPUS.get(id);
}

/**
 * The per-ticket price of a project stage, in major units.
 *
 * The discovery corpus stores a project's whole `budget` and its phase list but no per-ticket rate, so
 * one is derived: the budget spread across roughly eight tickets per phase, rounded to a tidy ten. It
 * is deterministic and stated here rather than guessed at each call site; the live path reads the real
 * `projects.project_stages.unit_price_cents` instead.
 */
function projectTicketMajor(project: ProjectItem): number {
	const budget = parsePriceMajor(project.budget);
	const phases = Math.max(project.phases.length, 1);
	return Math.round(budget / (phases * 8) / 10) * 10;
}

/**
 * The price of ONE unit of a purchasable, in major units, resolved by the KIND being bought rather than
 * by the listing alone: the same service is a per-ticket price as a pipeline ticket, a per-session price
 * as a booking, and a per-seat price as a group seat. Delegates to the shared
 * {@link unitPriceMajor} wherever the corpus already answers the question.
 */
function unitMajorFor(kind: PurchasableItemKind, item: ExploreItem): number {
	switch (kind) {
		case "one_off_project":
			return item.type === "projects" ? parsePriceMajor(item.budget) : unitPriceMajor(item);
		case "project_ticket":
			return item.type === "projects" ? projectTicketMajor(item) : unitPriceMajor(item);
		case "one_off_task":
			return item.type === "projects"
				? Math.round(projectTicketMajor(item) * PIPELINE_LOW)
				: unitPriceMajor(item);
		case "set_session":
			// A package of four bookings at the listing's per-session rate.
			return unitPriceMajor(item) * SET_SESSION_COUNT;
		default:
			return unitPriceMajor(item);
	}
}

/** How many bookings a `set_session` package holds. */
const SET_SESSION_COUNT = 4;
// #endregion

// #region Line + basket seeds
/** One seeded basket line. Prices are corpus (USD) major units; everything else mirrors the row. */
interface LineSeed {
	id: string;
	itemType: PurchasableItemKind;
	/** The discovery id this line points at. */
	itemId: string;
	/** Override the derived unit price (major units). */
	unitMajor?: number;
	quantity?: number;
	/** A creator discount applied on top of the list price, across the whole quantity (major units). */
	discountMajor?: number;
	/** A struck-through RRP above the charged {@link unitMajor}; carries no arithmetic. */
	originalMajor?: number;
	discountCode?: string;
	subtitle?: string;
	stageId?: string;
	stageLabel?: string;
	destinationEmail?: string;
	licence?: string;
	format?: string;
	/** Days ahead of the reference clock the booked slot sits. */
	slotInDays?: number;
	slotHour?: number;
	slotMinutes?: number;
	timezone?: string;
	seats?: number;
	/** Defaults to `true`. */
	selected?: boolean;
	savedForLater?: boolean;
	unavailableReason?: string;
	/** Days behind the reference clock the line was added. */
	addedDaysAgo?: number;
}

/** One seeded basket belonging to an owner scope. */
interface BasketSeed {
	id: string;
	ownerKey: string;
	name: string;
	isDefault: boolean;
	lines: LineSeed[];
}

/**
 * The seeded baskets. Between them every one of the ten {@link PurchasableItemKind} members appears at
 * least once, so every adaptive checkout row layout is reachable, along with a saved-for-later section,
 * a wishlist basket, a creator discount, an RRP strike-through, a line missing its delivery address, and
 * a line that went stale after it was added.
 */
const BASKET_SEEDS: BasketSeed[] = [
	{
		id: "bk-personal",
		ownerKey: "personal",
		name: "Basket",
		isDefault: true,
		lines: [
			{
				id: "bi-p1",
				itemType: "digital_product",
				itemId: "pr-3d-product-scenes",
				destinationEmail: "ahmed@projective.test",
				licence: "Extended licence",
				format: "Blender + 4K textures",
				addedDaysAgo: 2,
			},
			{
				id: "bi-p2",
				itemType: "digital_product",
				itemId: "pr-motion-primitives",
				quantity: 2,
				discountMajor: 18,
				discountCode: "CREATOR15",
				destinationEmail: "ahmed@projective.test",
				licence: "Standard licence",
				format: "After Effects + Lottie",
				addedDaysAgo: 2,
			},
			{
				id: "bi-p3",
				itemType: "service_ticket",
				itemId: "sv-brand-identity-sprint",
				quantity: 2,
				stageId: "stage-concept-routes",
				stageLabel: "Stage 2 · Concept routes",
				addedDaysAgo: 4,
			},
			{
				id: "bi-p4",
				itemType: "service_session",
				itemId: "sv-portfolio-review-session",
				slotInDays: 6,
				slotHour: 14,
				slotMinutes: 60,
				timezone: "Europe/London",
				addedDaysAgo: 1,
			},
			{
				id: "bi-p5",
				itemType: "set_session",
				itemId: "sv-portfolio-review-session",
				subtitle: "4-session package · fortnightly",
				slotInDays: 13,
				slotHour: 10,
				slotMinutes: 60,
				timezone: "Europe/London",
				addedDaysAgo: 1,
			},
			{
				id: "bi-p6",
				itemType: "course_group_session",
				itemId: "sv-design-systems-workshop",
				quantity: 2,
				seats: 2,
				subtitle: "2 seats · September cohort",
				slotInDays: 21,
				slotHour: 16,
				slotMinutes: 120,
				timezone: "Europe/London",
				addedDaysAgo: 3,
			},
			{
				id: "bi-p7",
				itemType: "single_service_task",
				itemId: "sv-packaging-art-direction",
				// Went stale after it was added. It stays in the basket carrying its reason (and counts
				// toward `unavailableCount`) but is deselected, so it does not block a checkout the buyer
				// never asked it to be part of. Selecting it again raises the `unavailable_item` blocker,
				// which is the channel that actually explains the refusal.
				selected: false,
				unavailableReason: "Ren Koda paused this listing while they're at capacity.",
				addedDaysAgo: 9,
			},
			{
				id: "bi-p8",
				itemType: "digital_product",
				itemId: "pr-editorial-type-system",
				savedForLater: true,
				selected: false,
				originalMajor: 160,
				licence: "Standard licence",
				format: "OTF + variable",
				addedDaysAgo: 14,
			},
			{
				id: "bi-p9",
				itemType: "one_off_service",
				itemId: "sv-landing-page-in-a-week",
				savedForLater: true,
				selected: false,
				addedDaysAgo: 20,
			},
		],
	},
	{
		id: "bk-wishlist",
		ownerKey: "personal",
		name: "3D Asset Wishlist",
		isDefault: false,
		lines: [
			{
				id: "bi-w1",
				itemType: "digital_product",
				itemId: "pr-grain-lightroom-pack",
				selected: false,
				addedDaysAgo: 30,
			},
			{
				id: "bi-w2",
				itemType: "digital_product",
				itemId: "pr-iconography-set",
				selected: false,
				addedDaysAgo: 27,
			},
			{
				id: "bi-w3",
				itemType: "digital_product",
				itemId: "pr-dashboard-blocks",
				selected: false,
				savedForLater: true,
				addedDaysAgo: 22,
			},
		],
	},
	{
		id: "bk-northwind",
		ownerKey: "team:northwind",
		name: "Northwind Studio",
		isDefault: true,
		lines: [
			{
				id: "bi-n1",
				itemType: "project_ticket",
				itemId: "pj-helia-wallet-redesign",
				quantity: 3,
				stageId: "stage-hi-fi-design",
				stageLabel: "Stage 3 · Hi-fi design",
				addedDaysAgo: 5,
			},
			{
				id: "bi-n2",
				itemType: "one_off_task",
				itemId: "pj-atlas-analytics-platform",
				subtitle: "Realtime spike · one task",
				addedDaysAgo: 3,
			},
			{
				id: "bi-n3",
				itemType: "one_off_service",
				itemId: "sv-landing-page-in-a-week",
				addedDaysAgo: 2,
			},
		],
	},
	{
		id: "bk-monarch",
		ownerKey: "business:monarch-labs",
		name: "Monarch Labs",
		isDefault: true,
		lines: [
			{
				id: "bi-m1",
				itemType: "one_off_project",
				itemId: "pj-verdant-brand-refresh",
				addedDaysAgo: 6,
			},
			{
				id: "bi-m2",
				itemType: "service_ticket",
				itemId: "sv-realtime-mvp-build",
				quantity: 3,
				stageId: "stage-api-layer",
				stageLabel: "Stage 2 · API layer",
				addedDaysAgo: 4,
			},
			{
				id: "bi-m3",
				itemType: "single_service_task",
				itemId: "sv-packaging-art-direction",
				selected: false,
				addedDaysAgo: 8,
			},
			{
				id: "bi-m4",
				itemType: "digital_product",
				itemId: "pr-notion-ops-suite",
				// No destination address — selecting this line reaches the `missing_email` blocker.
				selected: false,
				licence: "Team licence",
				format: "Notion workspace",
				addedDaysAgo: 8,
			},
		],
	},
	{
		id: "bk-meridian",
		ownerKey: "organisation:meridian",
		name: "Meridian Group",
		isDefault: true,
		lines: [
			{
				id: "bi-o1",
				itemType: "one_off_project",
				itemId: "pj-meridian-design-system",
				addedDaysAgo: 7,
			},
			{
				id: "bi-o2",
				itemType: "project_ticket",
				itemId: "pj-loop-mobile-app",
				quantity: 4,
				stageId: "stage-ios-build",
				stageLabel: "Stage 3 · iOS build",
				addedDaysAgo: 7,
			},
			{
				id: "bi-o3",
				itemType: "course_group_session",
				itemId: "sv-design-systems-workshop",
				quantity: 12,
				seats: 12,
				subtitle: "12 seats · platform guild",
				slotInDays: 28,
				slotHour: 15,
				slotMinutes: 120,
				timezone: "Europe/London",
				addedDaysAgo: 5,
			},
		],
	},
];
// #endregion

// #region Mutable session store
/** A basket line as the store holds it — prices in corpus (USD) major units, states mutable. */
interface StoredLine {
	id: string;
	basketId: string;
	itemType: PurchasableItemKind;
	itemId: string;
	stageId: string | null;
	stageLabel: string | null;
	revisionId: string | null;
	unitMajor: number;
	quantity: number;
	discountMajor: number;
	originalMajor: number | null;
	discountCode: string | null;
	subtitle: string | null;
	destinationEmail: string | null;
	licence: string | null;
	format: string | null;
	scheduledAtMs: number | null;
	scheduledMinutes: number;
	timezone: string | null;
	seats: number | null;
	selected: boolean;
	savedForLater: boolean;
	available: boolean;
	unavailableReason: string | null;
	metadata: Record<string, unknown>;
	createdAtMs: number;
	updatedAtMs: number;
	/** Soft removal — nothing is hard-deleted (root CLAUDE.md §5). */
	removedAt: string | null;
	/** Set when a checkout consumed the line; it leaves the basket without being destroyed. */
	purchasedAt: string | null;
}

/** A basket as the store holds it. */
interface StoredBasket {
	id: string;
	ownerKey: string;
	name: string;
	isDefault: boolean;
	promoCode: string | null;
	createdAtMs: number;
	updatedAtMs: number;
	lines: StoredLine[];
}

const STATE = new Map<string, StoredBasket>();
/** Insertion order per owner scope, so the basket list is stable across mutations. */
const BASKETS_BY_OWNER = new Map<string, string[]>();
let seq = 0;

/** Which group a line's kind rolls up to, and the parent it groups under. */
function parentOf(itemId: string): { group: PurchasableItemGroup; parentId: string } | null {
	const item = CORPUS.get(itemId);
	if (!item) return null;
	if (item.type === "products") return { group: "product", parentId: item.id };
	if (item.type === "projects") return { group: "project", parentId: item.id };
	return { group: "service", parentId: item.id };
}

/** Build the stored line for a seed, resolving its price + display facts from the discovery corpus. */
function storedFromSeed(seed: LineSeed, basketId: string): StoredLine {
	const item = CORPUS.get(seed.itemId);
	const unitMajor = seed.unitMajor ?? (item ? unitMajorFor(seed.itemType, item) : 0);
	const meta = itemKindMeta(seed.itemType);
	const parent = parentOf(seed.itemId);
	const createdAtMs = NOW - (seed.addedDaysAgo ?? 1) * DAY;
	const slotMs = seed.slotInDays !== undefined
		? NOW + seed.slotInDays * DAY - (NOW % DAY) + (seed.slotHour ?? 12) * HOUR
		: null;
	return {
		id: seed.id,
		basketId,
		itemType: seed.itemType,
		itemId: seed.itemId,
		stageId: seed.stageId ?? null,
		stageLabel: seed.stageLabel ?? null,
		revisionId: null,
		unitMajor,
		quantity: seed.quantity ?? 1,
		discountMajor: seed.discountMajor ?? 0,
		originalMajor: seed.originalMajor ?? null,
		discountCode: seed.discountCode ?? null,
		subtitle: seed.subtitle ?? null,
		destinationEmail: seed.destinationEmail ?? null,
		licence: seed.licence ?? null,
		format: seed.format ?? null,
		scheduledAtMs: meta.needsSchedule ? slotMs : null,
		scheduledMinutes: seed.slotMinutes ?? 60,
		timezone: seed.timezone ?? null,
		seats: seed.seats ?? null,
		selected: seed.selected ?? true,
		savedForLater: seed.savedForLater ?? false,
		available: seed.unavailableReason === undefined,
		unavailableReason: seed.unavailableReason ?? null,
		metadata: {
			sourceType: item?.type ?? "unknown",
			...(parent?.group === "project" ? { projectId: parent.parentId } : {}),
			...(parent && parent.group !== "project" && parent.group !== "product"
				? { serviceId: parent.parentId }
				: {}),
			...(seed.itemType === "set_session" ? { sessions: SET_SESSION_COUNT } : {}),
		},
		createdAtMs,
		updatedAtMs: createdAtMs,
		removedAt: null,
		purchasedAt: null,
	};
}

/** Lazily seed (and return) every basket for an owner scope, in stable order. */
function basketsFor(ownerKey: string): StoredBasket[] {
	const existing = BASKETS_BY_OWNER.get(ownerKey);
	if (existing) return existing.map((id) => STATE.get(id)!).filter(Boolean);
	const ids: string[] = [];
	for (const seed of BASKET_SEEDS) {
		if (seed.ownerKey !== ownerKey) continue;
		const basket: StoredBasket = {
			id: seed.id,
			ownerKey,
			name: seed.name,
			isDefault: seed.isDefault,
			promoCode: null,
			createdAtMs: NOW - 30 * DAY,
			updatedAtMs: NOW - DAY,
			lines: seed.lines.map((line) => storedFromSeed(line, seed.id)),
		};
		STATE.set(basket.id, basket);
		ids.push(basket.id);
	}
	if (ids.length === 0) {
		// An owner scope with no seeded basket still gets an empty default one, so an add-to-basket
		// from anywhere on the platform always has somewhere to land.
		const id = `bk-${ownerKey.replace(/[^a-z0-9]+/g, "-")}`;
		const basket: StoredBasket = {
			id,
			ownerKey,
			name: "Basket",
			isDefault: true,
			promoCode: null,
			createdAtMs: NOW,
			updatedAtMs: NOW,
			lines: [],
		};
		STATE.set(id, basket);
		ids.push(id);
	}
	BASKETS_BY_OWNER.set(ownerKey, ids);
	return ids.map((id) => STATE.get(id)!);
}

/** The lines a read sees: neither removed nor already purchased. */
function liveLines(basket: StoredBasket): StoredLine[] {
	return basket.lines.filter((l) => l.removedAt === null && l.purchasedAt === null);
}

/** Resolve the basket a query targets — the named one when it belongs to the owner, else the default. */
function resolveBasket(owner: ResolvedOwner, basketId?: string | null): StoredBasket {
	const all = basketsFor(owner.key);
	if (basketId) {
		const found = all.find((b) => b.id === basketId);
		if (found) return found;
	}
	return all.find((b) => b.isDefault) ?? all[0];
}

/** Find a line by id anywhere in an owner's baskets (a move crosses baskets). */
function findLine(owner: ResolvedOwner, lineId: string): StoredLine | undefined {
	for (const basket of basketsFor(owner.key)) {
		const line = basket.lines.find((l) => l.id === lineId && l.removedAt === null);
		if (line) return line;
	}
	return undefined;
}
// #endregion

// #region Projection
/** Project one stored line into the SSOT's {@link BasketItem}, in the read's display currency. */
function toItem(line: StoredLine, display: string): BasketItem {
	const item = CORPUS.get(line.itemId);
	const unit = price(line.unitMajor, display);
	const discount = line.discountMajor > 0
		? price(line.discountMajor, display)
		: derived(0, display);
	const lineMinor = unit.minor * line.quantity - discount.minor;
	const meta = itemKindMeta(line.itemType);
	return {
		id: line.id,
		basketId: line.basketId,
		itemType: line.itemType,
		itemId: line.itemId,
		stageId: line.stageId,
		revisionId: line.revisionId,
		title: clip(item?.title ?? "Unavailable item", 200),
		subtitle: line.subtitle ? clip(line.subtitle, 200) : (line.stageLabel ?? meta.label),
		unitPrice: unit,
		quantity: line.quantity,
		discountCode: line.discountCode,
		discountAmount: discount,
		lineTotal: derived(lineMinor, display),
		isSelectedForCheckout: line.selected,
		savedForLater: line.savedForLater,
		destinationEmail: line.destinationEmail,
		metadata: line.metadata,
		createdAt: iso(line.createdAtMs),
		updatedAt: iso(line.updatedAtMs),
		thumbnail: item && "media" in item ? (item.media ?? null) : null,
		sellerHandle: item ? clip(item.owner.handle.replace(/^@/, ""), 40) : null,
		sellerName: item ? clip(item.owner.name, 120) : null,
		href: item ? `/view/${item.id}` : null,
		originalPrice: line.originalMajor !== null ? price(line.originalMajor, display) : null,
		licence: line.licence,
		format: line.format,
		scheduledAt: line.scheduledAtMs !== null ? iso(line.scheduledAtMs) : null,
		scheduledLabel: line.scheduledAtMs !== null
			? slotLabel(line.scheduledAtMs, line.timezone ?? "UTC", line.scheduledMinutes)
			: null,
		timezone: line.timezone,
		stageLabel: line.stageLabel,
		seats: line.seats,
		available: line.available,
		unavailableReason: line.unavailableReason,
	};
}

/** The plural noun a group's caption counts in. */
function groupNoun(group: PurchasableItemGroup, count: number): string {
	const one = group === "product"
		? "download"
		: group === "session"
		? "booking"
		: group === "project"
		? "line"
		: "line";
	return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/**
 * Categorise a basket's lines server-side. A group is an INDEX over `items` (it carries ids, never
 * nested rows), so a line can never disagree with itself, and its subtotal comes from the SSOT's
 * {@link basketSubtotal} — the same gross-of-discount figure the basket header shows.
 */
export function buildGroups(items: readonly BasketItem[], display: string): BasketGroup[] {
	const order: string[] = [];
	const buckets = new Map<string, BasketItem[]>();
	for (const item of items) {
		if (item.savedForLater) continue;
		const meta = itemKindMeta(item.itemType);
		const parentId = typeof item.metadata.projectId === "string"
			? item.metadata.projectId
			: typeof item.metadata.serviceId === "string"
			? item.metadata.serviceId
			: item.itemId;
		const key = meta.group === "product" ? "product" : `${meta.group}:${parentId}`;
		if (!buckets.has(key)) {
			buckets.set(key, []);
			order.push(key);
		}
		buckets.get(key)!.push(item);
	}

	return order.map((key) => {
		const rows = buckets.get(key)!;
		const group = itemKindMeta(rows[0].itemType).group;
		const parentId = key === "product" ? null : key.slice(key.indexOf(":") + 1);
		const parent = parentId ? CORPUS.get(parentId) : undefined;
		const label = key === "product" ? "Digital downloads" : (parent?.title ?? rows[0].title);
		const seller = parent?.owner.name ?? rows[0].sellerName;
		return {
			id: `bg-${key.replace(/[^a-z0-9]+/gi, "-")}`,
			group,
			label: clip(label, 120),
			caption: clip(
				seller ? `${groupNoun(group, rows.length)} · ${seller}` : groupNoun(group, rows.length),
				160,
			),
			itemIds: rows.map((r) => r.id),
			itemCount: rows.length,
			selectedCount: rows.filter((r) => r.isSelectedForCheckout).length,
			subtotal: derived(basketSubtotal(rows), display),
			href: parent ? `/view/${parent.id}` : null,
		};
	});
}

/** Project a stored basket into the SSOT's {@link Basket}, with every total computed server-side. */
function toBasket(stored: StoredBasket, owner: ResolvedOwner): Basket {
	const display = owner.display;
	const lines = liveLines(stored);
	const items = lines.map((l) => toItem(l, display));
	const discounts = applyDiscounts(items, 0);
	const active = items.filter((i) => !i.savedForLater);
	return {
		id: stored.id,
		ownerType: owner.ownerType,
		ownerId: owner.ownerId,
		name: clip(stored.name, 120),
		isDefault: stored.isDefault,
		currency: display,
		items,
		groups: buildGroups(items, display),
		subtotal: derived(basketSubtotal(items), display),
		creatorDiscounts: derived(discounts.creatorDiscountMinor, display),
		net: derived(discounts.netMinor, display),
		itemCount: active.length,
		selectedCount: items.filter(isCheckoutEligible).length,
		savedForLaterCount: items.filter((i) => i.savedForLater).length,
		unavailableCount: active.filter((i) => !i.available).length,
		createdAt: iso(stored.createdAtMs),
		updatedAt: iso(stored.updatedAtMs),
	};
}
// #endregion

// #region Public reads
/** Every basket the resolved owner keeps, newest activity first with the default pinned. */
export function listBaskets(query: BasketQuery): BasketSummary[] {
	const owner = resolveOwner(query);
	return basketsFor(owner.key).map((stored) => {
		const items = liveLines(stored).map((l) => toItem(l, owner.display));
		return {
			id: stored.id,
			name: clip(stored.name, 120),
			isDefault: stored.isDefault,
			ownerType: owner.ownerType,
			ownerId: owner.ownerId,
			itemCount: items.filter((i) => !i.savedForLater).length,
			subtotal: derived(basketSubtotal(items), owner.display),
			updatedAt: iso(stored.updatedAtMs),
		};
	}).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** The resolved basket for a query (the named one, else the owner's default). */
export function getBasket(query: BasketQuery): Basket {
	const owner = resolveOwner(query);
	return toBasket(resolveBasket(owner, query.basketId), owner);
}

/** The resolved basket for an already-resolved owner — the checkout service's entry point. */
export function basketFor(owner: ResolvedOwner, basketId?: string | null): Basket {
	return toBasket(resolveBasket(owner, basketId), owner);
}

/** The promo code currently attached to a basket, if any. */
export function activePromoCode(owner: ResolvedOwner, basketId?: string | null): string | null {
	return resolveBasket(owner, basketId).promoCode;
}
// #endregion

// #region Promotional codes
/** A seeded promotional code. */
interface PromoSeed {
	code: string;
	label: string;
	/** `percent` of the discounted net, or a `flat` saving in corpus (USD) major units. */
	kind: "percent" | "flat";
	value: number;
	/** Why the code is refused; `null` when it is live. */
	message: string | null;
}

const PROMOS: Record<string, PromoSeed> = {
	SUMMER20: {
		code: "SUMMER20",
		label: "SUMMER20 · 20% off",
		kind: "percent",
		value: 20,
		message: null,
	},
	WELCOME10: {
		code: "WELCOME10",
		label: "WELCOME10 · $10 off your first order",
		kind: "flat",
		value: 10,
		message: null,
	},
	BIGSAVE: {
		code: "BIGSAVE",
		label: "BIGSAVE · $5,000 off",
		kind: "flat",
		value: 5_000,
		message: null,
	},
	EXPIRED24: {
		code: "EXPIRED24",
		label: "EXPIRED24 · Spring sale",
		kind: "percent",
		value: 15,
		message: "This code expired on 30 June 2026.",
	},
};

/**
 * Resolve what a code is worth against a set of lines, in integer minor units of the display currency.
 *
 * The raw saving is computed here; the CLAMP is the SSOT's — {@link applyDiscounts} caps a promo at
 * what is left after creator discounts, so a code worth more than the basket reduces it to zero rather
 * than minting a credit. The returned figure is the clamped one, because the buyer must be shown the
 * saving they actually get.
 */
export function resolvePromo(
	code: string | null,
	items: readonly BasketItem[],
	display: string,
): AppliedPromo | null {
	if (!code) return null;
	const seed = PROMOS[code.trim().toUpperCase()];
	if (!seed) {
		return {
			code: clip(code.trim().toUpperCase(), 40),
			label: "Unrecognised code",
			valid: false,
			amount: derived(0, display),
			message: "We don't recognise that code.",
		};
	}
	if (seed.message) {
		return {
			code: seed.code,
			label: clip(seed.label, 120),
			valid: false,
			amount: derived(0, display),
			message: seed.message,
		};
	}
	const base = applyDiscounts(items, 0).netMinor;
	const raw = seed.kind === "percent"
		? Math.round((base * seed.value) / 100)
		: price(seed.value, display).minor;
	const clamped = applyDiscounts(items, raw).promoDiscountMinor;
	return {
		code: seed.code,
		label: clip(seed.label, 120),
		valid: true,
		amount: derived(clamped, display),
		message: clamped < raw
			? "This code is worth more than your basket — it's been capped at the basket total."
			: null,
	};
}

/** The promo saving attached to a basket, in minor units — `0` when none applies or it is refused. */
export function promoMinorFor(promo: AppliedPromo | null): number {
	return promo?.valid ? promo.amount.minor : 0;
}
// #endregion

// #region Mutations
/** The outcome of a basket write: the refreshed basket, or a refusal with a status + message. */
export interface MutationOutcome {
	ok: boolean;
	status?: number;
	message: string;
	basket?: Basket;
	promo?: AppliedPromo | null;
}

/** Refuse an entity write by someone who is not a member of it. */
function memberGate(owner: ResolvedOwner): MutationOutcome | null {
	if (!owner.isEntity || owner.actingIsMember) return null;
	return {
		ok: false,
		status: 403,
		message:
			"Only a member of this account can change its basket. Switch to your personal account to buy this yourself.",
	};
}

/**
 * The delivery address a deliverable defaults to — the OWNING account's, not the unverified viewer
 * handle from the JWT.
 *
 * The fixture corpus re-owns every basket to a fixed cast (the catalogue precedent), so the account
 * paying is `@ahmed` / `@monarchlabs` / … regardless of which token asked; deriving the address from
 * the resolved owner keeps the line consistent with the basket it lands in. `.test` is an RFC 6761
 * reserved TLD, so a fixture address can never be mistaken for a real inbox. Returns `undefined` for an
 * owner with no handle, leaving the `missing_email` blocker to ask — an unidentified buyer is not
 * guessed at.
 */
function accountEmail(owner: ResolvedOwner): string | undefined {
	return owner.handle ? `${owner.handle}@projective.test` : undefined;
}

/** Stamp a basket + line as touched, so `updatedAt` reflects the write. */
function touch(basket: StoredBasket, line?: StoredLine): void {
	basket.updatedAtMs = NOW;
	if (line) line.updatedAtMs = NOW;
}

/**
 * Add a purchasable to a basket. A `null` `basketId` lands in the owner's default basket, so an
 * add-to-basket from anywhere on the platform needs no prior lookup. Adding a purchasable that is
 * already in the basket at the same stage increments its quantity rather than stacking a second line.
 */
export function addItem(input: AddBasketItem, query: BasketQuery): MutationOutcome {
	const owner = resolveOwner(query);
	const refusal = memberGate(owner);
	if (refusal) return refusal;

	const item = CORPUS.get(input.itemId);
	if (!item) {
		return {
			ok: false,
			status: 404,
			message: "We couldn't find that item — it may have been removed.",
		};
	}
	const basket = resolveBasket(owner, input.basketId);
	const meta = itemKindMeta(input.itemType);
	const stageId = input.stageId ?? null;
	const quantity = input.quantity ?? 1;

	const existing = liveLines(basket).find((l) =>
		l.itemType === input.itemType && l.itemId === input.itemId && l.stageId === stageId &&
		!l.savedForLater
	);
	if (existing) {
		existing.quantity = Math.min(existing.quantity + quantity, 999);
		touch(basket, existing);
		return {
			ok: true,
			message: `Updated ${clip(item.title, 80)} in your basket.`,
			basket: toBasket(basket, owner),
		};
	}

	const line = storedFromSeed({
		id: `bi-${++seq}-${hash(`${input.itemId}:${basket.id}:${seq}`) % 9973}`,
		itemType: input.itemType,
		itemId: input.itemId,
		quantity,
		stageId: stageId ?? undefined,
		// A deliverable defaults to the buyer's own address — they are who takes delivery unless they
		// say otherwise — so adding a download does not immediately block the checkout on a field
		// nobody has been asked for yet. The live path reads the account's verified address from
		// `org.user_emails`; the fixture derives the cast's reserved-TLD placeholder.
		destinationEmail: input.destinationEmail ?? (meta.needsEmail ? accountEmail(owner) : undefined),
		seats: input.seats ?? undefined,
		timezone: input.timezone ?? undefined,
		addedDaysAgo: 0,
	}, basket.id);
	line.revisionId = input.revisionId ?? null;
	line.scheduledAtMs = meta.needsSchedule && input.scheduledAt
		? Date.parse(input.scheduledAt)
		: line.scheduledAtMs;
	if (input.metadata) line.metadata = { ...line.metadata, ...input.metadata };
	basket.lines.push(line);
	touch(basket, line);
	return {
		ok: true,
		message: `Added ${clip(item.title, 80)} to ${clip(basket.name, 60)}.`,
		basket: toBasket(basket, owner),
	};
}

/** Patch one line. Every field but the id is optional; an omitted field is left untouched. */
export function updateItem(input: UpdateBasketItem, query: BasketQuery): MutationOutcome {
	const owner = resolveOwner(query);
	const refusal = memberGate(owner);
	if (refusal) return refusal;
	const line = findLine(owner, input.basketItemId);
	if (!line) return { ok: false, status: 404, message: "That basket line no longer exists." };
	const basket = STATE.get(line.basketId)!;

	if (input.quantity !== undefined) line.quantity = input.quantity;
	if (input.isSelectedForCheckout !== undefined) line.selected = input.isSelectedForCheckout;
	if (input.savedForLater !== undefined) {
		line.savedForLater = input.savedForLater;
		// A parked line is never also queued for payment — the two states are exclusive by definition.
		if (input.savedForLater) line.selected = false;
	}
	if (input.destinationEmail !== undefined) line.destinationEmail = input.destinationEmail;
	if (input.scheduledAt !== undefined) {
		line.scheduledAtMs = input.scheduledAt ? Date.parse(input.scheduledAt) : null;
	}
	if (input.timezone !== undefined) line.timezone = input.timezone;
	if (input.stageId !== undefined) line.stageId = input.stageId;
	if (input.seats !== undefined) line.seats = input.seats;
	if (input.metadata !== undefined) line.metadata = { ...line.metadata, ...input.metadata };
	touch(basket, line);
	return { ok: true, message: "Basket updated.", basket: toBasket(basket, owner) };
}

/**
 * Remove a line outright — the explicit user action, distinct from parking it. Soft: the row is stamped
 * `removedAt` and dropped from every read, never destroyed (root CLAUDE.md §5).
 */
export function removeItem(input: RemoveBasketItem, query: BasketQuery): MutationOutcome {
	const owner = resolveOwner(query);
	const refusal = memberGate(owner);
	if (refusal) return refusal;
	const line = findLine(owner, input.basketItemId);
	if (!line) return { ok: false, status: 404, message: "That basket line no longer exists." };
	const basket = STATE.get(line.basketId)!;
	line.removedAt = iso(NOW);
	touch(basket);
	return { ok: true, message: "Removed from your basket.", basket: toBasket(basket, owner) };
}

/**
 * Move a line between baskets, and/or park it into saved-for-later. Nothing is removed by a move: a
 * parked line stays in its basket, it just stops queueing for payment.
 */
export function moveItem(input: MoveBasketItem, query: BasketQuery): MutationOutcome {
	const owner = resolveOwner(query);
	const refusal = memberGate(owner);
	if (refusal) return refusal;
	const line = findLine(owner, input.basketItemId);
	if (!line) return { ok: false, status: 404, message: "That basket line no longer exists." };

	const from = STATE.get(line.basketId)!;
	const to = resolveBasket(owner, input.toBasketId);
	if (to.id !== from.id) {
		from.lines = from.lines.filter((l) => l.id !== line.id);
		line.basketId = to.id;
		const at = input.position ?? to.lines.length;
		to.lines.splice(Math.min(at, to.lines.length), 0, line);
		touch(from);
	} else if (input.position !== undefined) {
		from.lines = from.lines.filter((l) => l.id !== line.id);
		from.lines.splice(Math.min(input.position, from.lines.length), 0, line);
	}
	if (input.savedForLater !== undefined) {
		line.savedForLater = input.savedForLater;
		if (input.savedForLater) line.selected = false;
	}
	touch(to, line);
	return {
		ok: true,
		message: to.id === from.id ? "Basket updated." : `Moved to ${clip(to.name, 60)}.`,
		basket: toBasket(to, owner),
	};
}

/** Attach (or clear, with a `null` code) a promotional code on a whole basket. */
export function applyPromo(
	basketId: string,
	code: string | null,
	query: BasketQuery,
): MutationOutcome {
	const owner = resolveOwner(query);
	const refusal = memberGate(owner);
	if (refusal) return refusal;
	const basket = resolveBasket(owner, basketId);
	if (code === null) {
		basket.promoCode = null;
		touch(basket);
		return {
			ok: true,
			message: "Promo code removed.",
			basket: toBasket(basket, owner),
			promo: null,
		};
	}
	const items = liveLines(basket).map((l) => toItem(l, owner.display));
	const promo = resolvePromo(code, items, owner.display);
	basket.promoCode = promo?.valid ? promo.code : null;
	touch(basket);
	return {
		ok: true,
		message: promo?.valid
			? `${promo.label} applied — you save ${promo.amount.display}.`
			: (promo?.message ?? "We don't recognise that code."),
		basket: toBasket(basket, owner),
		promo,
	};
}

/** Create a further named basket for the owner (a wishlist, a project shopping list). */
export function createBasket(name: string, query: BasketQuery): MutationOutcome {
	const owner = resolveOwner(query);
	const refusal = memberGate(owner);
	if (refusal) return refusal;
	const ids = BASKETS_BY_OWNER.get(owner.key) ?? basketsFor(owner.key).map((b) => b.id);
	const id = `bk-${owner.key.replace(/[^a-z0-9]+/g, "-")}-${++seq}`;
	const basket: StoredBasket = {
		id,
		ownerKey: owner.key,
		name: clip(name.trim(), 120),
		isDefault: false,
		promoCode: null,
		createdAtMs: NOW,
		updatedAtMs: NOW,
		lines: [],
	};
	STATE.set(id, basket);
	BASKETS_BY_OWNER.set(owner.key, [...ids, id]);
	return {
		ok: true,
		message: `Created ${basket.name}.`,
		basket: toBasket(basket, owner),
	};
}

/**
 * Consume the lines a completed checkout paid for: each is stamped `purchasedAt` and leaves the basket
 * without being destroyed. Called only by {@link CheckoutBackendService} after a charge succeeds.
 */
export function markPurchased(
	owner: ResolvedOwner,
	basketId: string,
	itemIds: readonly string[],
): void {
	const basket = resolveBasket(owner, basketId);
	const wanted = new Set(itemIds);
	for (const line of basket.lines) {
		if (wanted.has(line.id) && line.purchasedAt === null && line.removedAt === null) {
			line.purchasedAt = iso(NOW);
		}
	}
	touch(basket);
}

/** The fixed reference clock, shared with the checkout service so both stamp the same instant. */
export function referenceNow(): number {
	return NOW;
}

/** Build a display-currency {@link MoneyView} — the checkout service's wrapper for SSOT integers. */
export function money(minor: number, display: string): MoneyView {
	return derived(minor, display);
}
// #endregion
