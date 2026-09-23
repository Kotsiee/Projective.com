import type { SupabaseClient } from "supabaseClient";
import type {
	AddBasketItem,
	AppliedPromo,
	Basket,
	BasketGroup,
	BasketItem,
	BasketListEntry,
	BasketLists,
	BasketSummary,
	MoveBasketItem,
	PurchasableItemGroup,
	PurchasableItemKind,
	RemoveBasketItem,
	UpdateBasketItem,
} from "@projective/types/finance";
import {
	applyDiscounts,
	basketSubtotal,
	isCheckoutEligible,
	itemKindMeta,
} from "@projective/types/finance";
import type { ExploreItem } from "@projective/types/explore";
import { getUserClient } from "../../core/supabase.ts";
import {
	type BlueprintRow,
	type Catalog,
	loadCatalog,
	type ProductRow,
} from "../explore/live-catalog.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { type MoneyProjector, moneyProjector } from "./commerce-money.ts";
import { resolveOwner, type ResolvedOwner } from "./commerce-owner.ts";
import type { BasketQuery } from "./basket-query.ts";

/**
 * live-basket — the `/basket` read projection and every basket write, over `finance.baskets` and
 * `finance.basket_items`, read and written as the signed-in caller.
 *
 * ## What is stored, and what is only ever derived
 *
 * A basket line stores WHAT was added (`item_type`, `item_id`, the stage, the booked instant, the
 * seats) plus a display snapshot (`title`, `unit_price_minor`, `currency`). The snapshot is written
 * when the line is added, and it is **not trusted afterwards**: the buyer's own RLS lets them rewrite
 * every price column on their line, so a figure read back from the row is a figure the buyer chose.
 * Every read therefore re-prices each line from the listing it points at — the catalogue for a
 * service or product, the stage or the project for project work — through the same rules the card
 * that added it was priced by. The snapshot is shown only for a line that can no longer be priced,
 * and such a line is never payable.
 *
 * ## Identifiers
 *
 * `item_id` is the purchasable's uuid; every surface speaks its public address — the discovery slug
 * (`svc-…`, `prd-…`) or the project slug (`prj-…`). This module is where the two meet: a write
 * accepts either and stores the uuid, a read answers with the slug. A stage is likewise answered as
 * its `stg-…` slug, the address its channel route resolves (Decision #93).
 *
 * ## Money
 *
 * One {@link MoneyProjector} per read: every line converts at the same table, and every total is the
 * SSOT's arithmetic over those converted minors (`basketSubtotal`, `applyDiscounts`,
 * `isCheckoutEligible`). Nothing here re-implements a subtotal or a discount.
 *
 * ## Nothing is hard-deleted
 *
 * A removed line is stamped `removed_at`; a purchased one `purchased_at` (by checkout, through a
 * definer — the column refuses a client write). Reads exclude both.
 */

// #region Constants
/** The id a buyer's default basket answers to before it exists as a row. The first write creates it. */
export const DEFAULT_BASKET_ID = "default";

/**
 * The id of the parked shelf — a VIEW over every `saved_for_later` line across the account's baskets,
 * not a row, which is why it has a reserved word rather than an id a buyer could delete.
 */
export const SAVED_LIST_ID = "saved";

/** How many named baskets one owner may keep. Bounded by the SSOT's `BasketLists.lists` cap. */
const MAX_BASKETS = 39;

const BASKET_COLS = "id, owner_type, owner_id, name, is_default, promo_code, created_at, updated_at";
const LINE_COLS =
	"id, basket_id, item_type, item_id, stage_id, revision_id, title, subtitle, unit_price_minor, " +
	"original_price_minor, currency, quantity, discount_code, discount_amount_minor, " +
	"is_selected_for_checkout, saved_for_later, position, scheduled_at, timezone, seats, " +
	"destination_email, metadata, created_at, updated_at";
const PROJECT_COLS =
	"id, slug, title, status, currency, budget_amount_cents, owner_user_id, owner_team_id, " +
	"client_business_id, owner_organisation_id, source_blueprint_id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Honour the SSOT's truncation contract on free-text snapshots. */
function clip(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
// #endregion

// #region Rows
interface BasketRow {
	id: string;
	owner_type: string;
	owner_id: string;
	name: string;
	is_default: boolean;
	promo_code: string | null;
	created_at: string;
	updated_at: string;
}

interface LineRow {
	id: string;
	basket_id: string;
	item_type: PurchasableItemKind;
	item_id: string;
	stage_id: string | null;
	revision_id: string | null;
	title: string;
	subtitle: string | null;
	unit_price_minor: number | string;
	original_price_minor: number | string | null;
	currency: string;
	quantity: number;
	discount_code: string | null;
	discount_amount_minor: number | string;
	is_selected_for_checkout: boolean;
	saved_for_later: boolean;
	position: number;
	scheduled_at: string | null;
	timezone: string | null;
	seats: number | null;
	destination_email: string | null;
	metadata: Record<string, unknown> | null;
	created_at: string;
	updated_at: string;
}

interface ProjectFact {
	id: string;
	slug: string;
	title: string;
	status: string;
	currency: string;
	budget_amount_cents: number | string | null;
	owner_user_id: string;
	owner_team_id: string | null;
	client_business_id: string | null;
	owner_organisation_id: string | null;
	source_blueprint_id: string | null;
}

interface StageFact {
	id: string;
	slug: string;
	projectId: string;
	name: string;
	/** 1-based position within its project, by `sort_order`. */
	position: number;
	status: string;
	unitPriceCents: number | null;
}
// #endregion

// #region Purchasables
type Family = "product" | "service" | "project";

/** Which family of purchasable each kind buys. */
const FAMILY: Record<PurchasableItemKind, Family> = {
	digital_product: "product",
	project_ticket: "project",
	one_off_project: "project",
	one_off_task: "project",
	service_ticket: "service",
	one_off_service: "service",
	single_service_task: "service",
	service_session: "service",
	set_session: "service",
	course_group_session: "service",
};

/**
 * The delivery model each service kind buys. A kind that does not match its listing's model is not a
 * purchase the seller offers — a session price is not the price of a one-off engagement.
 */
const SERVICE_MODEL: Partial<Record<PurchasableItemKind, BlueprintRow["delivery_model"]>> = {
	service_ticket: "pipeline",
	one_off_service: "one_off",
	single_service_task: "direct_deliverable",
	service_session: "session",
	set_session: "session",
	course_group_session: "group_session",
};

/** A resolved purchasable: the listing or project a line points at. */
interface Purchasable {
	family: Family;
	uuid: string;
	/** The public address — a discovery slug, or a project slug. */
	slug: string;
	type: "products" | "services" | "projects";
	title: string;
	thumbnail: string | null;
	sellerHandle: string | null;
	sellerName: string | null;
	href: string | null;
	/** `null` while it can be bought; otherwise the buyer-facing reason it cannot. */
	closed: string | null;
	product?: ProductRow;
	blueprint?: BlueprintRow;
	project?: ProjectFact;
}

/** uuid → slug indexes over one loaded catalogue, built once per catalogue object. */
interface CatalogIndex {
	productById: Map<string, string>;
	blueprintById: Map<string, string>;
	projectById: Map<string, string>;
}

const INDEXES = new WeakMap<Catalog, CatalogIndex>();

function indexOf(catalog: Catalog): CatalogIndex {
	const cached = INDEXES.get(catalog);
	if (cached) return cached;
	const index: CatalogIndex = {
		productById: new Map([...catalog.productBySlug].map(([slug, row]) => [row.id, slug])),
		blueprintById: new Map([...catalog.blueprintBySlug].map(([slug, row]) => [row.id, slug])),
		projectById: new Map([...catalog.projectBySlug].map(([slug, entry]) => [entry.row.id, slug])),
	};
	INDEXES.set(catalog, index);
	return index;
}

/** The `@`-less handle of a discovery owner. */
function handleOf(item: ExploreItem): string | null {
	const handle = item.owner.handle.replace(/^@/, "");
	return handle ? clip(handle, 40) : null;
}

/** A listing (service or product) from the public catalogue, by uuid. */
function listingPurchasable(
	catalog: Catalog,
	family: "product" | "service",
	uuid: string,
): Purchasable | null {
	const index = indexOf(catalog);
	const slug = family === "product"
		? index.productById.get(uuid)
		: index.blueprintById.get(uuid);
	if (!slug) return null;
	const item = catalog.byId.get(slug);
	if (!item) return null;
	return {
		family,
		uuid,
		slug,
		type: family === "product" ? "products" : "services",
		title: item.title,
		thumbnail: "media" in item && typeof item.media === "string" && item.media ? item.media : null,
		sellerHandle: handleOf(item),
		sellerName: clip(item.owner.name, 120),
		href: `/view/${slug}`,
		closed: null,
		product: family === "product" ? catalog.productBySlug.get(slug) : undefined,
		blueprint: family === "service" ? catalog.blueprintBySlug.get(slug) : undefined,
	};
}

/** Whether a project is funded from this owner's money. */
function projectBelongsTo(project: ProjectFact, owner: ResolvedOwner): boolean {
	switch (owner.ownerType) {
		case "team":
			return project.owner_team_id === owner.ownerId;
		case "business":
			return project.client_business_id === owner.ownerId;
		case "organisation":
			return project.owner_organisation_id === owner.ownerId;
		default:
			// A personal project is one no workspace owns: the three workspace columns are exclusive, and
			// a project filed under one of them is that workspace's to fund.
			return project.owner_user_id === owner.ownerId && !project.owner_team_id &&
				!project.client_business_id && !project.owner_organisation_id;
	}
}

const CLOSED_PROJECT = new Set(["completed", "cancelled", "archived"]);
const CLOSED_STAGE = new Set(["approved", "paid", "cancelled"]);

function projectPurchasable(project: ProjectFact, owner: ResolvedOwner): Purchasable {
	const closed = CLOSED_PROJECT.has(project.status)
		? "This project is closed."
		: projectBelongsTo(project, owner)
		? null
		: "This project belongs to another account.";
	return {
		family: "project",
		uuid: project.id,
		slug: project.slug,
		type: "projects",
		title: project.title,
		thumbnail: null,
		// A project line funds the buyer's OWN project; there is no seller to credit on the line.
		sellerHandle: null,
		sellerName: null,
		href: `/projects/${project.slug}`,
		closed,
		project,
	};
}
// #endregion

// #region Session
/** Everything one request's reads and writes share. */
interface Session {
	db: SupabaseClient;
	actor: ReadActor & { accessToken: string };
	owner: ResolvedOwner;
	money: MoneyProjector;
	catalog: Catalog | null;
}

/**
 * Open a session: the owner, the money projector for its display currency, and the catalogue.
 *
 * `null` for a caller who cannot be identified — see {@link resolveOwner}. The catalogue load is
 * allowed to fail: a line then reads as "we couldn't check this listing", which is the safe direction
 * (not payable) rather than a whole basket that refuses to render.
 */
async function openSession(query: BasketQuery, actor: ReadActor): Promise<Session | null> {
	if (!canReadLive(actor)) return null;
	const owner = await resolveOwner(query, actor);
	if (!owner) return null;
	const [money, catalog] = await Promise.all([
		moneyProjector(owner.display),
		loadCatalog().catch(() => null),
	]);
	return {
		db: getUserClient(actor.accessToken),
		actor,
		owner,
		money,
		catalog,
	};
}

/** The owner filter every basket read applies — a personal basket may carry either personal type. */
function ownedBaskets(session: Session) {
	const q = session.db.schema("finance").from("baskets").select(BASKET_COLS);
	return session.owner.isEntity
		? q.eq("owner_type", session.owner.ownerType).eq("owner_id", session.owner.ownerId)
		: q.in("owner_type", ["user", "freelancer"]).eq("owner_id", session.owner.ownerId);
}

async function readBaskets(session: Session): Promise<BasketRow[]> {
	const { data, error } = await ownedBaskets(session)
		.order("is_default", { ascending: false })
		.order("created_at", { ascending: true });
	if (error) throw new Error(`finance.baskets read failed: ${error.message}`);
	return (data ?? []) as unknown as BasketRow[];
}

async function readLines(session: Session, basketIds: readonly string[]): Promise<LineRow[]> {
	if (basketIds.length === 0) return [];
	const { data, error } = await session.db.schema("finance").from("basket_items")
		.select(LINE_COLS)
		.in("basket_id", [...basketIds])
		.is("removed_at", null)
		.is("purchased_at", null)
		.order("position", { ascending: true })
		.order("created_at", { ascending: true });
	if (error) throw new Error(`finance.basket_items read failed: ${error.message}`);
	return (data ?? []) as unknown as LineRow[];
}

async function readProjects(
	session: Session,
	column: "id" | "slug",
	values: readonly string[],
): Promise<ProjectFact[]> {
	if (values.length === 0) return [];
	const { data, error } = await session.db.schema("projects").from("projects")
		.select(PROJECT_COLS)
		.in(column, [...values]);
	if (error) throw new Error(`projects.projects read failed: ${error.message}`);
	return (data ?? []) as unknown as ProjectFact[];
}

/**
 * Stages by id or by slug, each with its 1-based position in its project.
 *
 * The position needs every sibling, so this reads the named stages, then every stage of their
 * projects — two reads regardless of how many stages a basket names.
 */
async function readStages(
	session: Session,
	column: "id" | "slug",
	values: readonly string[],
): Promise<StageFact[]> {
	if (values.length === 0) return [];
	const stages = session.db.schema("projects").from("project_stages");
	const { data, error } = await stages
		.select("id, slug, project_id, name, sort_order, status, unit_price_cents")
		.in(column, [...values]);
	if (error) throw new Error(`projects.project_stages read failed: ${error.message}`);
	const rows = (data ?? []) as {
		id: string;
		slug: string;
		project_id: string;
		name: string;
		sort_order: number;
		status: string;
		unit_price_cents: number | string | null;
	}[];
	if (rows.length === 0) return [];

	const projectIds = [...new Set(rows.map((row) => row.project_id))];
	const siblings = await session.db.schema("projects").from("project_stages")
		.select("id, project_id, sort_order")
		.in("project_id", projectIds);
	if (siblings.error) {
		throw new Error(`projects.project_stages read failed: ${siblings.error.message}`);
	}
	const order = new Map<string, number>();
	const byProject = new Map<string, { id: string; sort_order: number }[]>();
	for (const s of (siblings.data ?? []) as { id: string; project_id: string; sort_order: number }[]) {
		const list = byProject.get(s.project_id) ?? [];
		list.push(s);
		byProject.set(s.project_id, list);
	}
	for (const list of byProject.values()) {
		list.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
		list.forEach((s, i) => order.set(s.id, i + 1));
	}

	return rows.map((row) => ({
		id: row.id,
		slug: row.slug,
		projectId: row.project_id,
		name: row.name,
		position: order.get(row.id) ?? 1,
		status: row.status,
		unitPriceCents: row.unit_price_cents === null ? null : Number(row.unit_price_cents),
	}));
}
// #endregion

// #region Pricing
/** A price in its OWN currency, as the listing states it today. */
interface Price {
	minor: number;
	currency: string;
}

/**
 * The price of ONE unit of a line, from the listing as it stands now.
 *
 * The same rules the discovery card and the view page price by (`explore/pricing.ts`): a Pipeline
 * ticket at the Standard ticket rate, a session at the per-session rate, a group seat at the per-seat
 * rate, everything else at its fixed engagement price. The session kinds scale by what the unit IS:
 * a set-session package is `session_count` sittings, and a group-session line is ONE booking of
 * `seats` seats — `seats` is a priced quantity in its own right and is not folded into `quantity`
 * (the column says so), so it scales the unit rather than the line.
 *
 * `null` when the thing cannot be priced today — the line is then shown, never charged.
 */
function unitPriceOf(
	kind: PurchasableItemKind,
	p: Purchasable,
	stage: StageFact | null,
	seats: number | null,
): Price | null {
	if (p.family === "product") {
		return p.product ? { minor: p.product.price_cents, currency: p.product.currency } : null;
	}
	if (p.family === "project") {
		const project = p.project;
		if (!project) return null;
		if (kind === "project_ticket") {
			return stage?.unitPriceCents != null
				? { minor: stage.unitPriceCents, currency: project.currency }
				: null;
		}
		return project.budget_amount_cents != null
			? { minor: Number(project.budget_amount_cents), currency: project.currency }
			: null;
	}
	const b = p.blueprint;
	if (!b) return null;
	const session = b.session_price_cents ?? b.price_cents;
	switch (kind) {
		case "service_ticket":
			return { minor: b.ticket_price_cents ?? b.price_cents, currency: b.currency };
		case "service_session":
			return { minor: session, currency: b.currency };
		case "set_session":
			return { minor: session * Math.max(1, b.session_count ?? 1), currency: b.currency };
		case "course_group_session":
			return { minor: session * Math.max(1, seats ?? 1), currency: b.currency };
		default:
			return { minor: b.price_cents, currency: b.currency };
	}
}
// #endregion

// #region Resolution
/** Everything one line's projection needs, resolved once. */
interface LineFacts {
	purchasable: Purchasable | null;
	stage: StageFact | null;
	/** The owning project's slug for a service ticket's stage (its board). */
	boardProjectSlug: string | null;
	/** Why the line cannot be bought today; `null` while it can. */
	closed: string | null;
}

/** The resolution maps for a set of lines. */
interface Resolved {
	facts: Map<string, LineFacts>;
	/** Parent (engagement) id → the face a group or derived list shows. */
	parents: Map<string, Parent>;
}

/** An engagement a group of lines rolls up to. */
interface Parent {
	id: string;
	title: string;
	sellerName: string | null;
	href: string | null;
	thumbnail: string | null;
	type: Purchasable["type"];
}

/** Resolve every line's purchasable, stage and availability in a handful of set reads. */
async function resolveLines(session: Session, lines: readonly LineRow[]): Promise<Resolved> {
	const { catalog, owner } = session;
	const projectIds = new Set<string>();
	const stageIds = new Set<string>();
	for (const line of lines) {
		if (FAMILY[line.item_type] === "project") projectIds.add(line.item_id);
		if (line.stage_id) stageIds.add(line.stage_id);
	}

	const stages = await readStages(session, "id", [...stageIds]);
	const stageById = new Map(stages.map((s) => [s.id, s]));
	// A service ticket's stage lives on the buyer's own project — read it too, for its board slug.
	for (const stage of stages) projectIds.add(stage.projectId);
	const projects = await readProjects(session, "id", [...projectIds]);
	const projectById = new Map(projects.map((p) => [p.id, p]));

	const facts = new Map<string, LineFacts>();
	const parents = new Map<string, Parent>();

	for (const line of lines) {
		const family = FAMILY[line.item_type];
		let purchasable: Purchasable | null = null;
		if (family === "project") {
			const project = projectById.get(line.item_id);
			purchasable = project ? projectPurchasable(project, owner) : null;
		} else if (catalog) {
			purchasable = listingPurchasable(catalog, family, line.item_id);
		}

		const stage = line.stage_id ? stageById.get(line.stage_id) ?? null : null;
		const stageProject = stage ? projectById.get(stage.projectId) ?? null : null;

		let closed: string | null = null;
		if (!purchasable) {
			closed = family !== "project" && !catalog
				? "We couldn't check this listing right now."
				: family === "project"
				? "That project is no longer available to you."
				: "This listing is no longer available.";
		} else if (purchasable.closed) {
			closed = purchasable.closed;
		} else if (
			family === "service" && purchasable.blueprint &&
			SERVICE_MODEL[line.item_type] !== purchasable.blueprint.delivery_model
		) {
			closed = "This listing is no longer sold this way.";
		}

		if (!closed && itemKindMeta(line.item_type).needsStage && line.stage_id) {
			if (!stage) closed = "That stage no longer exists.";
			else if (CLOSED_STAGE.has(stage.status)) closed = "That stage has finished.";
		}
		if (!closed && line.scheduled_at && Date.parse(line.scheduled_at) <= Date.now()) {
			closed = "That time has passed — pick a new one.";
		}

		facts.set(line.id, {
			purchasable,
			stage,
			boardProjectSlug: line.item_type === "service_ticket" ? stageProject?.slug ?? null : null,
			closed,
		});

		if (purchasable && !parents.has(purchasable.slug)) {
			parents.set(purchasable.slug, {
				id: purchasable.slug,
				title: purchasable.title,
				sellerName: purchasable.sellerName,
				href: purchasable.href,
				thumbnail: purchasable.thumbnail,
				type: purchasable.type,
			});
		}
	}
	return { facts, parents };
}
// #endregion

// #region Projection
/** `Tue 12 Aug · 14:00–15:00` in the slot's own zone; the start alone when no length is stated. */
function slotLabel(iso: string, timezone: string | null, minutes: number | null): string {
	const ms = Date.parse(iso);
	const zone = timezone || "UTC";
	const safe = (fn: () => string): string => {
		try {
			return fn();
		} catch {
			return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
		}
	};
	const day = safe(() =>
		new Intl.DateTimeFormat("en-GB", {
			weekday: "short",
			day: "numeric",
			month: "short",
			timeZone: zone,
		}).format(new Date(ms))
	);
	const at = (t: number) =>
		safe(() =>
			new Intl.DateTimeFormat("en-GB", {
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
				timeZone: zone,
			}).format(new Date(t))
		);
	const range = minutes && minutes > 0 ? `${at(ms)}–${at(ms + minutes * 60_000)}` : at(ms);
	return clip(`${day} · ${range}`, 80);
}

/** `Stage 2 · Concept routes`. */
function stageLabelOf(stage: StageFact): string {
	return clip(`Stage ${stage.position} · ${stage.name}`, 120);
}

/** Project one stored line into the SSOT's {@link BasketItem}, in the session's display currency. */
function toItem(line: LineRow, facts: LineFacts, money: MoneyProjector): BasketItem {
	const { purchasable: p, stage } = facts;
	const meta = itemKindMeta(line.item_type);

	// The price comes from the listing as it stands now; the row's own figure only stands in for a
	// listing that can no longer be priced, and such a line is never payable.
	const current = p ? unitPriceOf(line.item_type, p, stage, line.seats) : null;
	let closed = facts.closed ?? (current ? null : "This isn't priced yet.");
	const unitSource: Price = current ??
		{ minor: Number(line.unit_price_minor) || 0, currency: line.currency };
	if (!closed && !money.canConvert(unitSource.currency)) {
		closed = `We can't show this price in ${money.display} right now.`;
	}
	const unit = money.price(unitSource.minor, unitSource.currency);

	const storedDiscount = Number(line.discount_amount_minor) || 0;
	const discountMinor = storedDiscount > 0 && money.canConvert(line.currency)
		? Math.min(money.convertMinor(storedDiscount, line.currency), unit.minor * line.quantity)
		: 0;
	// Already converted and clamped to the line, so it is a DERIVED figure in the display currency.
	const discount = money.derived(discountMinor);
	const original = line.original_price_minor !== null && money.canConvert(line.currency)
		? money.price(Number(line.original_price_minor), line.currency)
		: null;

	const stageLabel = stage ? stageLabelOf(stage) : null;
	const sessionMinutes = p?.blueprint?.session_minutes ?? null;
	const metadata: Record<string, unknown> = {
		...(line.metadata ?? {}),
		sourceType: p?.type ?? "unknown",
	};
	// The engagement keys are DERIVED here and win over anything stored: they are what the checkout
	// narrows and groups on, and a stored value is one the buyer could have written.
	delete metadata.projectId;
	delete metadata.serviceId;
	delete metadata.boardProjectId;
	if (p?.family === "project") metadata.projectId = p.slug;
	if (p?.family === "service") metadata.serviceId = p.slug;
	if (facts.boardProjectSlug) metadata.boardProjectId = facts.boardProjectSlug;
	if (line.item_type === "set_session" && p?.blueprint) {
		metadata.sessions = Math.max(1, p.blueprint.session_count ?? 1);
	}

	return {
		id: line.id,
		basketId: line.basket_id,
		itemType: line.item_type,
		itemId: p?.slug ?? line.item_id,
		stageId: stage?.slug ?? line.stage_id,
		revisionId: line.revision_id,
		title: clip(p?.title ?? line.title ?? "Unavailable item", 200) || "Unavailable item",
		subtitle: line.subtitle ? clip(line.subtitle, 200) : (stageLabel ?? meta.label),
		unitPrice: unit,
		quantity: line.quantity,
		discountCode: line.discount_code ? clip(line.discount_code, 40) : null,
		discountAmount: discount,
		lineTotal: money.derived(unit.minor * line.quantity - discount.minor),
		isSelectedForCheckout: line.is_selected_for_checkout,
		savedForLater: line.saved_for_later,
		destinationEmail: line.destination_email,
		metadata,
		createdAt: new Date(line.created_at).toISOString(),
		updatedAt: new Date(line.updated_at).toISOString(),
		thumbnail: p?.thumbnail ?? null,
		sellerHandle: p?.sellerHandle ?? null,
		sellerName: p?.sellerName ?? null,
		href: p?.href ?? null,
		originalPrice: original,
		licence: p?.product ? clip(p.product.licence, 80) : null,
		format: p?.product ? clip(p.product.format, 80) : null,
		scheduledAt: line.scheduled_at ? new Date(line.scheduled_at).toISOString() : null,
		scheduledLabel: line.scheduled_at
			? slotLabel(line.scheduled_at, line.timezone, sessionMinutes)
			: null,
		timezone: line.timezone,
		stageLabel,
		seats: line.seats,
		available: closed === null,
		unavailableReason: closed ? clip(closed, 200) : null,
	};
}

/** The plural noun a group's caption counts in. */
function groupNoun(group: PurchasableItemGroup, count: number): string {
	const one = group === "product" ? "download" : group === "session" ? "booking" : "line";
	return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** Which engagement a line groups under, and which narrowing param addresses it. */
function engagementOf(item: BasketItem): { id: string; param: "project_id" | "service_id" } {
	const projectId = typeof item.metadata.projectId === "string" ? item.metadata.projectId : null;
	if (projectId) return { id: projectId, param: "project_id" };
	const serviceId = typeof item.metadata.serviceId === "string" ? item.metadata.serviceId : null;
	return serviceId
		? { id: serviceId, param: "service_id" }
		: { id: item.itemId, param: "service_id" };
}

/**
 * Categorise a basket's lines. A group is an INDEX over `items` (ids, never nested rows), and its
 * subtotal is the SSOT's {@link basketSubtotal} — the same figure the basket header shows.
 */
function buildGroups(
	items: readonly BasketItem[],
	parents: ReadonlyMap<string, Parent>,
	money: MoneyProjector,
): BasketGroup[] {
	const order: string[] = [];
	const buckets = new Map<string, BasketItem[]>();
	for (const item of items) {
		if (item.savedForLater) continue;
		const meta = itemKindMeta(item.itemType);
		const key = meta.group === "product" ? "product" : `${meta.group}:${engagementOf(item).id}`;
		if (!buckets.has(key)) {
			buckets.set(key, []);
			order.push(key);
		}
		buckets.get(key)!.push(item);
	}

	return order.slice(0, 40).map((key) => {
		const rows = buckets.get(key)!;
		const group = itemKindMeta(rows[0].itemType).group;
		const parentId = key === "product" ? null : key.slice(key.indexOf(":") + 1);
		const parent = parentId ? parents.get(parentId) : undefined;
		const label = key === "product" ? "Digital downloads" : (parent?.title ?? rows[0].title);
		const seller = parent?.sellerName ?? rows[0].sellerName;
		return {
			id: `bg-${key.replace(/[^a-z0-9]+/gi, "-")}`.slice(0, 120),
			group,
			label: clip(label, 120),
			caption: clip(
				seller ? `${groupNoun(group, rows.length)} · ${seller}` : groupNoun(group, rows.length),
				160,
			),
			itemIds: rows.map((r) => r.id),
			itemCount: rows.length,
			selectedCount: rows.filter((r) => r.isSelectedForCheckout).length,
			subtotal: money.derived(basketSubtotal(rows)),
			href: parent?.href ?? null,
		};
	});
}

/** Project a basket row (or the virtual default) into the SSOT's {@link Basket}. */
function toBasket(
	row: BasketRow | null,
	items: readonly BasketItem[],
	parents: ReadonlyMap<string, Parent>,
	session: Session,
): Basket {
	const { owner, money } = session;
	const discounts = applyDiscounts(items, 0);
	const active = items.filter((i) => !i.savedForLater);
	const now = new Date().toISOString();
	return {
		id: row?.id ?? DEFAULT_BASKET_ID,
		ownerType: owner.ownerType,
		ownerId: owner.ownerId,
		name: clip(row?.name ?? "Main Basket", 120),
		isDefault: row?.is_default ?? true,
		currency: money.display,
		items: [...items],
		groups: buildGroups(items, parents, money),
		subtotal: money.derived(basketSubtotal(items)),
		creatorDiscounts: money.derived(discounts.creatorDiscountMinor),
		net: money.derived(discounts.netMinor),
		itemCount: active.length,
		selectedCount: items.filter(isCheckoutEligible).length,
		savedForLaterCount: items.filter((i) => i.savedForLater).length,
		unavailableCount: active.filter((i) => !i.available).length,
		createdAt: row ? new Date(row.created_at).toISOString() : now,
		updatedAt: row ? new Date(row.updated_at).toISOString() : now,
	};
}
// #endregion

// #region The whole-account read
/** One owner's baskets, every live line projected, and the facts behind them. */
export interface AccountBaskets {
	owner: ResolvedOwner;
	money: MoneyProjector;
	rows: BasketRow[];
	/** Projected lines by basket id. */
	itemsByBasket: Map<string, BasketItem[]>;
	parents: Map<string, Parent>;
}

/**
 * Read every basket the owner keeps and project every live line in them — one pass that the basket,
 * the lane's lists and the derived views all read, so no two of them can disagree about a line.
 *
 * The display currency falls back to the lines' own currency when the requested one cannot be reached
 * from all of them (an FX table that failed to load), rather than totalling mixed currencies.
 */
async function readAccount(session: Session): Promise<AccountBaskets> {
	const rows = await readBaskets(session);
	const lines = await readLines(session, rows.map((r) => r.id));

	const currencies = new Set(lines.map((l) => l.currency.toUpperCase()));
	if (
		lines.length > 0 && [...currencies].some((c) => !session.money.canConvert(c)) &&
		currencies.size === 1
	) {
		const only = [...currencies][0];
		session.money = await moneyProjector(only);
		session.owner = { ...session.owner, display: session.money.display };
	}

	const { facts, parents } = await resolveLines(session, lines);
	const itemsByBasket = new Map<string, BasketItem[]>();
	for (const row of rows) itemsByBasket.set(row.id, []);
	for (const line of lines) {
		const f = facts.get(line.id);
		if (!f) continue;
		itemsByBasket.get(line.basket_id)?.push(toItem(line, f, session.money));
	}
	return {
		owner: session.owner,
		money: session.money,
		rows,
		itemsByBasket,
		parents,
	};
}

/** The basket a query targets: the named one when it belongs to the owner, else the default. */
function targetRow(rows: readonly BasketRow[], basketId: string | null | undefined): BasketRow | null {
	if (basketId) {
		const found = rows.find((r) => r.id === basketId);
		if (found) return found;
	}
	return rows.find((r) => r.is_default) ?? rows[0] ?? null;
}

/** Whether an id addresses a SERVER-DERIVED list rather than a stored basket. */
export function isDerivedListId(id: string | null | undefined): boolean {
	return typeof id === "string" && (id.startsWith("ticket:") || id.startsWith("session:"));
}

/** Every line across the account, projected. */
function everyItem(account: AccountBaskets): BasketItem[] {
	return account.rows.flatMap((row) => account.itemsByBasket.get(row.id) ?? []);
}

/**
 * A derived list AS a basket: every line for one engagement, across every basket and shelf. A VIEW —
 * it spans all baskets, includes parked lines (surfaced unparked, because a view has no shelf of its
 * own to file them under), and is never checkout-eligible as a basket.
 */
function derivedBasketOf(account: AccountBaskets, listId: string, session: Session): Basket {
	const kind = listId.slice(0, listId.indexOf(":"));
	const parentId = listId.slice(listId.indexOf(":") + 1);
	const items = everyItem(account)
		.filter((item) => {
			const meta = itemKindMeta(item.itemType);
			const belongs = kind === "ticket" ? meta.needsStage : meta.needsSchedule;
			return belongs && engagementOf(item).id === parentId;
		})
		.map((item) => (item.savedForLater ? { ...item, savedForLater: false } : item));
	const parent = account.parents.get(parentId);
	const basket = toBasket(null, items, account.parents, session);
	return {
		...basket,
		id: listId,
		name: clip(parent?.title ?? items[0]?.title ?? "Everything for this engagement", 120),
		isDefault: false,
		savedForLaterCount: 0,
		itemCount: items.length,
	};
}

/** The resolved basket for a read: a stored one, the virtual default, or a derived view. */
function basketOf(account: AccountBaskets, basketId: string | null | undefined, session: Session): Basket {
	if (isDerivedListId(basketId)) return derivedBasketOf(account, basketId as string, session);
	const row = targetRow(account.rows, basketId);
	return toBasket(row, row ? account.itemsByBasket.get(row.id) ?? [] : [], account.parents, session);
}

/** Every basket the owner keeps, the default pinned first. */
function summariesOf(account: AccountBaskets): BasketSummary[] {
	const { owner, money } = account;
	if (account.rows.length === 0) {
		return [{
			id: DEFAULT_BASKET_ID,
			name: "Main Basket",
			isDefault: true,
			ownerType: owner.ownerType,
			ownerId: owner.ownerId,
			itemCount: 0,
			subtotal: money.derived(0),
			updatedAt: new Date().toISOString(),
		}];
	}
	return account.rows.map((row) => {
		const items = account.itemsByBasket.get(row.id) ?? [];
		return {
			id: row.id,
			name: clip(row.name, 120),
			isDefault: row.is_default,
			ownerType: owner.ownerType,
			ownerId: owner.ownerId,
			itemCount: items.filter((i) => !i.savedForLater).length,
			subtotal: money.derived(basketSubtotal(items)),
			updatedAt: new Date(row.updated_at).toISOString(),
		};
	}).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}
// #endregion

// #region Promo
/** The database's answer for one code (`finance.resolve_promo_code`). */
interface PromoJson {
	found: boolean;
	code: string;
	label?: string;
	kind?: "percent" | "flat";
	value_bp?: number | null;
	value_minor?: number | string | null;
	currency?: string | null;
	valid: boolean;
	reason: string | null;
}

/**
 * Resolve what a code is worth against a set of lines, in the display currency.
 *
 * The raw saving is computed here; the CLAMP is the SSOT's — {@link applyDiscounts} caps a promo at
 * what is left after creator discounts, so a code worth more than the basket reduces it to zero rather
 * than minting a credit. The returned figure is the clamped one: the buyer is shown the saving they
 * actually get.
 */
async function resolvePromo(
	session: Session,
	code: string | null,
	items: readonly BasketItem[],
): Promise<AppliedPromo | null> {
	if (!code || !code.trim()) return null;
	const { data, error } = await session.db.schema("finance").rpc("resolve_promo_code", {
		p_code: code,
	});
	if (error) throw new Error(`finance.resolve_promo_code failed: ${error.message}`);
	const promo = data as PromoJson | null;
	const money = session.money;
	const refused = (label: string, message: string): AppliedPromo => ({
		code: clip((promo?.code ?? code).trim().toUpperCase(), 40),
		label: clip(label, 120),
		valid: false,
		amount: money.derived(0),
		message: clip(message, 200),
	});
	if (!promo || !promo.found) return refused("Unrecognised code", "We don't recognise that code.");
	if (!promo.valid) {
		return refused(promo.label ?? promo.code, promo.reason ?? "This code can't be used.");
	}

	const base = applyDiscounts(items, 0).netMinor;
	let raw = 0;
	if (promo.kind === "percent") {
		raw = Math.round((base * (promo.value_bp ?? 0)) / 10_000);
	} else if (promo.kind === "flat" && promo.currency) {
		// A flat saving is money in ONE currency, and checkout settles each line in the currency its
		// listing is priced in — so the code applies only where every line is priced in its currency.
		// Converting it onto a line priced in another would quote a saving the charge never honours.
		const flatCurrency = promo.currency.toUpperCase();
		const foreign = items.find((item) =>
			isCheckoutEligible(item) &&
			(item.unitPrice.origin?.currency ?? item.unitPrice.currency).toUpperCase() !== flatCurrency
		);
		if (foreign || !money.canConvert(promo.currency)) {
			return refused(
				promo.label ?? promo.code,
				`This code only applies to items priced in ${flatCurrency}.`,
			);
		}
		raw = money.convertMinor(Number(promo.value_minor) || 0, promo.currency);
	}
	const clamped = applyDiscounts(items, raw).promoDiscountMinor;
	return {
		code: clip(promo.code, 40),
		label: clip(promo.label ?? promo.code, 120),
		valid: true,
		amount: money.derived(clamped),
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

// #region Lists
/** `4 tickets` / `1 booking`. */
function countNoun(count: number, one: string): string {
	return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** A `/checkout*` destination carrying the scope a list is read under. */
function listHref(path: string, owner: ResolvedOwner, params: Record<string, string | null>): string {
	const qs = new URLSearchParams();
	if (owner.key !== "personal") qs.set("owner", owner.key);
	for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
	const q = qs.toString();
	return clip(q ? `${path}?${q}` : path, 200);
}

/** The engagement-derived entries for one kind of line. */
function derivedLists(
	items: readonly BasketItem[],
	account: AccountBaskets,
	kind: "ticket" | "session",
): BasketListEntry[] {
	const order: string[] = [];
	const buckets = new Map<string, BasketItem[]>();
	for (const item of items) {
		if (item.savedForLater) continue;
		const meta = itemKindMeta(item.itemType);
		if (!(kind === "ticket" ? meta.needsStage : meta.needsSchedule)) continue;
		const engagement = engagementOf(item);
		if (!buckets.has(engagement.id)) {
			buckets.set(engagement.id, []);
			order.push(engagement.id);
		}
		buckets.get(engagement.id)!.push(item);
	}
	return order.slice(0, 40).map((parentId) => {
		const rows = buckets.get(parentId)!;
		const parent = account.parents.get(parentId);
		const seller = parent?.sellerName ?? rows[0].sellerName;
		const noun = countNoun(rows.length, kind === "ticket" ? "ticket" : "booking");
		const id = `${kind}:${parentId}`;
		return {
			id: clip(id, 120),
			kind,
			label: clip(parent?.title ?? rows[0].title, 120),
			caption: clip(seller ? `${noun} · ${seller}` : noun, 160),
			itemCount: rows.length,
			subtotal: account.money.derived(basketSubtotal(rows)),
			href: listHref("/checkout", account.owner, { basket: id }),
			isDefault: false,
			checkoutable: true,
			thumbnail: parent?.thumbnail ?? null,
		};
	});
}

/** Where the lane footer's CTA goes for the active list — the next step, carrying the narrowing. */
function checkoutHrefFor(
	account: AccountBaskets,
	basketId: string,
	active: BasketListEntry | undefined,
): string {
	if (!active || active.kind === "basket" || active.kind === "saved") {
		return listHref("/checkout/details", account.owner, { basket: basketId });
	}
	const parentId = active.id.slice(active.id.indexOf(":") + 1);
	const param = account.parents.get(parentId)?.type === "projects" ? "project_id" : "service_id";
	return listHref("/checkout/details", account.owner, { basket: basketId, [param]: parentId });
}

/** The basket lane's whole navigation model, in ONE pass over one read. */
function buildLists(account: AccountBaskets, basket: Basket, activeId: string | null): BasketLists {
	const { money, owner } = account;
	const lists: BasketListEntry[] = summariesOf(account).map((summary) => ({
		id: summary.id,
		kind: "basket" as const,
		label: summary.name,
		caption: clip(countNoun(summary.itemCount, "item"), 160),
		itemCount: summary.itemCount,
		subtotal: summary.subtotal,
		href: listHref("/checkout", owner, { basket: summary.id }),
		isDefault: summary.isDefault,
		checkoutable: true,
		thumbnail: null,
	}));

	const parked = everyItem(account).filter((item) => item.savedForLater);
	lists.push({
		id: SAVED_LIST_ID,
		kind: "saved",
		label: "Saved for later",
		caption: clip(countNoun(parked.length, "item"), 160),
		itemCount: parked.length,
		// Nothing parked is checkout-eligible, so this is zero by construction rather than by rule.
		subtotal: money.derived(basketSubtotal(parked)),
		href: listHref("/checkout", owner, { basket: basket.id, list: SAVED_LIST_ID }),
		isDefault: false,
		checkoutable: false,
		thumbnail: null,
	});

	const tickets = derivedLists(basket.items, account, "ticket");
	const sessions = derivedLists(basket.items, account, "session");
	const every = [...lists, ...tickets, ...sessions];
	const active = every.find((entry) => entry.id === activeId) ??
		lists.find((entry) => entry.id === basket.id) ?? lists[0];

	return {
		lists: lists.slice(0, 40),
		tickets,
		sessions,
		activeId: active?.id ?? null,
		activeSubtotal: active?.subtotal ?? money.derived(0),
		activeCheckoutHref: checkoutHrefFor(account, basket.id, active),
	};
}
// #endregion

// #region Public reads
/** What every basket read and write answers with. */
export interface BasketView {
	owner: ResolvedOwner;
	money: MoneyProjector;
	baskets: BasketSummary[];
	basket: Basket;
	promo: AppliedPromo | null;
	/** The attached promo code of the resolved basket (before resolution). */
	promoCode: string | null;
	account: AccountBaskets;
	/** Resolve a code against a SUBSET of lines — the checkout prices only what the buyer submits. */
	resolvePromo(code: string | null, items: readonly BasketItem[]): Promise<AppliedPromo | null>;
	/** Group a subset of lines the way the basket groups them. */
	groupsFor(items: readonly BasketItem[]): BasketGroup[];
}

/** The outcome of a live basket operation. */
export type BasketOutcome<T> =
	| { ok: true; message: string | null; value: T }
	| { ok: false; status: number; message: string; errors?: Record<string, string> };

function refuse<T>(
	status: number,
	message: string,
	errors?: Record<string, string>,
): BasketOutcome<T> {
	return { ok: false, status, message, errors };
}

const SIGNED_OUT: BasketOutcome<never> = {
	ok: false,
	status: 401,
	message: "Sign in to see your basket.",
};

/** Build the whole read for an open session. */
async function viewOf(
	session: Session,
	basketId: string | null | undefined,
): Promise<BasketView> {
	const account = await readAccount(session);
	const basket = basketOf(account, basketId, session);
	const row = isDerivedListId(basketId) ? null : targetRow(account.rows, basketId);
	const promoCode = row?.promo_code ?? null;
	return {
		owner: account.owner,
		money: account.money,
		baskets: summariesOf(account),
		basket,
		promo: await resolvePromo(session, promoCode, basket.items),
		promoCode,
		account,
		resolvePromo: (code, items) => resolvePromo(session, code, items),
		groupsFor: (items) => buildGroups(items, account.parents, account.money),
	};
}

/**
 * The resolved basket for a query, its siblings and its promo — the read every basket surface and the
 * checkout start from.
 */
export async function readBasket(
	query: BasketQuery,
	actor: ReadActor,
): Promise<BasketOutcome<BasketView>> {
	const session = await openSession(query, actor);
	if (!session) return SIGNED_OUT;
	return { ok: true, message: null, value: await viewOf(session, query.basketId) };
}

/** The basket lane's navigation model. */
export async function readLists(
	query: BasketQuery,
	actor: ReadActor,
	activeId: string | null,
): Promise<BasketOutcome<BasketLists>> {
	const session = await openSession(query, actor);
	if (!session) return SIGNED_OUT;
	const view = await viewOf(session, query.basketId);
	return {
		ok: true,
		message: null,
		value: buildLists(view.account, view.basket, activeId ?? query.basketId ?? null),
	};
}

// #endregion

// #region Writes
/** Refuse an entity write by somebody who may not spend its money. */
function spendGate(session: Session): BasketOutcome<never> | null {
	if (session.owner.actingIsMember) return null;
	return refuse(
		403,
		session.owner.isEntity
			? "Only a member who can spend from this account can change its basket. Switch to your personal account to buy this yourself."
			: "You can't change this basket.",
	);
}

/** Map a write error onto a refusal a buyer can act on; anything unrecognised is a server failure. */
function writeFailure<T>(error: { code?: string; message: string }): BasketOutcome<T> {
	if (error.code === "42501") return refuse(403, "You can't change this basket.");
	if (error.code === "23514") {
		return refuse(422, "That change isn't valid for this line.", { basketItemId: "invalid" });
	}
	throw new Error(`basket write failed: ${error.message}`);
}

/** Stamp a basket as touched — `updated_at` is maintained by the service (schema convention). */
async function touch(session: Session, basketId: string): Promise<void> {
	await session.db.schema("finance").from("baskets")
		.update({ updated_at: new Date().toISOString() })
		.eq("id", basketId);
}

/**
 * The owner's default basket, created on first use. A concurrent first write that loses the race on
 * the one-default-per-owner index simply reads the winner's row.
 */
async function ensureDefault(session: Session): Promise<BasketRow> {
	const existing = targetRow(await readBaskets(session), null);
	if (existing) return existing;
	const { data, error } = await session.db.schema("finance").from("baskets")
		.insert({
			owner_type: session.owner.isEntity ? session.owner.ownerType : "user",
			owner_id: session.owner.ownerId,
			name: "Main Basket",
			is_default: true,
		})
		.select(BASKET_COLS)
		.single();
	if (!error && data) return data as BasketRow;
	if (error?.code === "23505") {
		const winner = targetRow(await readBaskets(session), null);
		if (winner) return winner;
	}
	throw new Error(`finance.baskets insert failed: ${error?.message ?? "no row"}`);
}

/** The stored basket a write addresses — one the owner keeps, or the default (created on demand). */
async function writeTarget(session: Session, basketId: string | null | undefined): Promise<BasketRow> {
	if (basketId && basketId !== DEFAULT_BASKET_ID && !isDerivedListId(basketId)) {
		const found = (await readBaskets(session)).find((r) => r.id === basketId);
		if (found) return found;
	}
	return ensureDefault(session);
}

/** A live line of one of the owner's baskets, or `null`. */
async function ownedLine(session: Session, lineId: string): Promise<LineRow | null> {
	if (!UUID_RE.test(lineId)) return null;
	const rows = await readBaskets(session);
	if (rows.length === 0) return null;
	const { data, error } = await session.db.schema("finance").from("basket_items")
		.select(LINE_COLS)
		.eq("id", lineId)
		.in("basket_id", rows.map((r) => r.id))
		.is("removed_at", null)
		.is("purchased_at", null)
		.maybeSingle();
	if (error) throw new Error(`finance.basket_items read failed: ${error.message}`);
	return (data as LineRow | null) ?? null;
}

/** Resolve a purchasable for an ADD, by its public slug or its uuid. */
async function purchasableForAdd(
	session: Session,
	kind: PurchasableItemKind,
	reference: string,
): Promise<Purchasable | null> {
	const family = FAMILY[kind];
	if (family === "project") {
		const column = UUID_RE.test(reference) ? "id" : "slug";
		const [project] = await readProjects(session, column, [reference]);
		return project ? projectPurchasable(project, session.owner) : null;
	}
	const catalog = session.catalog;
	if (!catalog) return null;
	if (UUID_RE.test(reference)) return listingPurchasable(catalog, family, reference.toLowerCase());
	const row = family === "product"
		? catalog.productBySlug.get(reference)
		: catalog.blueprintBySlug.get(reference);
	return row ? listingPurchasable(catalog, family, row.id) : null;
}

/** Resolve a stage reference (slug or uuid) that a ticket line may route through. */
async function stageForTicket(
	session: Session,
	kind: PurchasableItemKind,
	p: Purchasable,
	reference: string,
): Promise<StageFact | null> {
	const [stage] = await readStages(session, UUID_RE.test(reference) ? "id" : "slug", [reference]);
	if (!stage) return null;
	if (kind === "project_ticket") return stage.projectId === p.uuid ? stage : null;
	// A service ticket routes through a stage of the buyer's OWN engagement, instantiated from this
	// listing — never through somebody else's project that happens to have a stage of that name.
	const [project] = await readProjects(session, "id", [stage.projectId]);
	return project && project.source_blueprint_id === p.uuid &&
			projectBelongsTo(project, session.owner)
		? stage
		: null;
}

/** The buyer's own delivery address — their primary email, when the database knows it. */
function accountEmail(session: Session): string | null {
	return session.owner.person?.email ?? null;
}

/**
 * Add a purchasable to a basket.
 *
 * A `null` `basketId` lands in the owner's default basket. An untimed purchase already in the basket
 * at the same stage increments its quantity; a TIMED one is identified by its booked instant as well,
 * because two sittings on two dates are two commitments (merging them kept whichever time was stored
 * first and silently raised the quantity).
 */
export async function addItem(
	input: AddBasketItem,
	query: BasketQuery,
	actor: ReadActor,
): Promise<BasketOutcome<BasketView>> {
	const session = await openSession({ ...query, basketId: input.basketId }, actor);
	if (!session) return SIGNED_OUT;
	const gate = spendGate(session);
	if (gate) return gate;

	const p = await purchasableForAdd(session, input.itemType, input.itemId);
	if (!p) {
		return refuse(404, "We couldn't find that item — it may have been removed.", {
			itemId: "not_found",
		});
	}
	if (p.closed) return refuse(409, p.closed, { itemId: "unavailable" });
	if (
		p.family === "service" && p.blueprint &&
		SERVICE_MODEL[input.itemType] !== p.blueprint.delivery_model
	) {
		return refuse(422, "That listing can't be bought that way.", { itemType: "mismatch" });
	}

	const meta = itemKindMeta(input.itemType);
	let stage: StageFact | null = null;
	if (meta.needsStage && input.stageId) {
		stage = await stageForTicket(session, input.itemType, p, input.stageId);
		if (!stage) return refuse(422, "That stage isn't part of this engagement.", { stageId: "invalid" });
		if (CLOSED_STAGE.has(stage.status)) {
			return refuse(409, "That stage has finished.", { stageId: "closed" });
		}
	}
	const seats = input.seats ?? null;
	const price = unitPriceOf(input.itemType, p, stage, seats);
	if (!price) return refuse(409, "This isn't priced yet, so it can't be bought.", { itemId: "unpriced" });

	const scheduledAt = meta.needsSchedule && input.scheduledAt
		? new Date(input.scheduledAt).toISOString()
		: null;
	if (scheduledAt && Date.parse(scheduledAt) <= Date.now()) {
		return refuse(409, "That time has passed — pick a new one.", { scheduledAt: "past" });
	}

	const basket = await writeTarget(session, input.basketId);
	const quantity = input.quantity ?? 1;
	// A fresh builder per statement: supabase-js shares one URL across statements built from the same
	// `from()`, so a reused builder would carry the lookup's filters into the write that follows it.
	const items = () => session.db.schema("finance").from("basket_items");

	let existingQuery = items().select("id, quantity, scheduled_at")
		.eq("basket_id", basket.id)
		.eq("item_type", input.itemType)
		.eq("item_id", p.uuid)
		.eq("saved_for_later", false)
		.is("removed_at", null)
		.is("purchased_at", null);
	existingQuery = stage ? existingQuery.eq("stage_id", stage.id) : existingQuery.is("stage_id", null);
	const existing = await existingQuery;
	if (existing.error) throw new Error(`finance.basket_items read failed: ${existing.error.message}`);
	const match = ((existing.data ?? []) as { id: string; quantity: number; scheduled_at: string | null }[])
		.find((row) =>
			!meta.needsSchedule ||
			(row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null) === scheduledAt
		);

	if (match) {
		const { error } = await items()
			.update({ quantity: Math.min(match.quantity + quantity, 999), updated_at: new Date().toISOString() })
			.eq("id", match.id);
		if (error) return writeFailure(error);
		await touch(session, basket.id);
		return {
			ok: true,
			message: `Updated ${clip(p.title, 80)} in your basket.`,
			value: await viewOf(session, basket.id),
		};
	}

	const positions = await items().select("position").eq("basket_id", basket.id)
		.order("position", { ascending: false }).limit(1);
	const nextPosition = Math.min(
		(((positions.data ?? []) as { position: number }[])[0]?.position ?? -1) + 1,
		32_767,
	);

	const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
	// Derived at read time from the row itself; never stored where the buyer could re-point them.
	delete metadata.projectId;
	delete metadata.serviceId;
	delete metadata.boardProjectId;

	const { error } = await items().insert({
		basket_id: basket.id,
		item_type: input.itemType,
		item_id: p.uuid,
		stage_id: stage?.id ?? null,
		revision_id: input.revisionId && UUID_RE.test(input.revisionId) ? input.revisionId : null,
		title: clip(p.title, 200),
		subtitle: stage ? stageLabelOf(stage) : null,
		unit_price_minor: price.minor,
		currency: price.currency,
		quantity,
		position: nextPosition,
		scheduled_at: scheduledAt,
		timezone: meta.needsSchedule ? (input.timezone ?? null) : null,
		seats: input.itemType === "course_group_session" ? (seats ?? 1) : null,
		// A deliverable defaults to the buyer's own address — they take delivery unless they say
		// otherwise — so adding a download does not block the checkout on a field nobody asked for.
		destination_email: input.destinationEmail ?? (meta.needsEmail ? accountEmail(session) : null),
		metadata,
	});
	if (error) return writeFailure(error);
	await touch(session, basket.id);
	return {
		ok: true,
		message: `Added ${clip(p.title, 80)} to ${clip(basket.name, 60)}.`,
		value: await viewOf(session, basket.id),
	};
}

/** Patch one line. Every field but the id is optional; an omitted field is left untouched. */
export async function updateItem(
	input: UpdateBasketItem,
	query: BasketQuery,
	actor: ReadActor,
): Promise<BasketOutcome<BasketView>> {
	const session = await openSession(query, actor);
	if (!session) return SIGNED_OUT;
	const gate = spendGate(session);
	if (gate) return gate;
	const line = await ownedLine(session, input.basketItemId);
	if (!line) return refuse(404, "That basket line no longer exists.");

	const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (input.quantity !== undefined) patch.quantity = input.quantity;
	if (input.isSelectedForCheckout !== undefined) {
		patch.is_selected_for_checkout = input.isSelectedForCheckout;
	}
	if (input.savedForLater !== undefined) {
		patch.saved_for_later = input.savedForLater;
		// A parked line is never also queued for payment — the two states are exclusive by definition.
		if (input.savedForLater) patch.is_selected_for_checkout = false;
	}
	if (input.destinationEmail !== undefined) patch.destination_email = input.destinationEmail;
	const meta = itemKindMeta(line.item_type);
	if (input.scheduledAt !== undefined) {
		if (!meta.needsSchedule) {
			return refuse(422, "This line isn't booked for a time.", { scheduledAt: "not_scheduled" });
		}
		const at = input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null;
		if (at && Date.parse(at) <= Date.now()) {
			return refuse(409, "That time has passed — pick a new one.", { scheduledAt: "past" });
		}
		patch.scheduled_at = at;
	}
	if (input.timezone !== undefined) patch.timezone = input.timezone;
	if (input.seats !== undefined) {
		if (line.item_type !== "course_group_session") {
			return refuse(422, "Only a group session holds seats.", { seats: "not_seated" });
		}
		patch.seats = input.seats;
	}
	if (input.stageId !== undefined) {
		if (!meta.needsStage) return refuse(422, "This line doesn't route through a stage.");
		if (input.stageId === null) {
			patch.stage_id = null;
		} else {
			const resolved = await resolveLines(session, [line]);
			const p = resolved.facts.get(line.id)?.purchasable ?? null;
			if (!p) return refuse(409, "This item is no longer available.");
			const stage = await stageForTicket(session, line.item_type, p, input.stageId);
			if (!stage) return refuse(422, "That stage isn't part of this engagement.", { stageId: "invalid" });
			if (CLOSED_STAGE.has(stage.status)) {
				return refuse(409, "That stage has finished.", { stageId: "closed" });
			}
			patch.stage_id = stage.id;
			patch.subtitle = stageLabelOf(stage);
		}
	}
	if (input.metadata !== undefined) {
		const merged: Record<string, unknown> = { ...(line.metadata ?? {}), ...input.metadata };
		delete merged.projectId;
		delete merged.serviceId;
		delete merged.boardProjectId;
		patch.metadata = merged;
	}

	const { error } = await session.db.schema("finance").from("basket_items")
		.update(patch)
		.eq("id", line.id);
	if (error) return writeFailure(error);
	await touch(session, line.basket_id);
	return { ok: true, message: "Basket updated.", value: await viewOf(session, line.basket_id) };
}

/**
 * Remove a line — the explicit user action, distinct from parking it. Soft: stamped `removed_at` and
 * dropped from every read, never destroyed.
 */
export async function removeItem(
	input: RemoveBasketItem,
	query: BasketQuery,
	actor: ReadActor,
): Promise<BasketOutcome<BasketView>> {
	const session = await openSession(query, actor);
	if (!session) return SIGNED_OUT;
	const gate = spendGate(session);
	if (gate) return gate;
	const line = await ownedLine(session, input.basketItemId);
	if (!line) return refuse(404, "That basket line no longer exists.");
	const now = new Date().toISOString();
	const { error } = await session.db.schema("finance").from("basket_items")
		.update({ removed_at: now, updated_at: now })
		.eq("id", line.id);
	if (error) return writeFailure(error);
	await touch(session, line.basket_id);
	return { ok: true, message: "Removed from your basket.", value: await viewOf(session, line.basket_id) };
}

/** Move a line between baskets and/or park it. Nothing is removed by a move. */
export async function moveItem(
	input: MoveBasketItem,
	query: BasketQuery,
	actor: ReadActor,
): Promise<BasketOutcome<BasketView>> {
	const session = await openSession(query, actor);
	if (!session) return SIGNED_OUT;
	const gate = spendGate(session);
	if (gate) return gate;
	const line = await ownedLine(session, input.basketItemId);
	if (!line) return refuse(404, "That basket line no longer exists.");

	const to = await writeTarget(session, input.toBasketId);
	const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (to.id !== line.basket_id) patch.basket_id = to.id;
	if (input.position !== undefined) patch.position = Math.min(input.position, 32_767);
	if (input.savedForLater !== undefined) {
		patch.saved_for_later = input.savedForLater;
		if (input.savedForLater) patch.is_selected_for_checkout = false;
	}
	const { error } = await session.db.schema("finance").from("basket_items")
		.update(patch)
		.eq("id", line.id);
	if (error) return writeFailure(error);
	await touch(session, to.id);
	if (to.id !== line.basket_id) await touch(session, line.basket_id);
	return {
		ok: true,
		message: to.id === line.basket_id ? "Basket updated." : `Moved to ${clip(to.name, 60)}.`,
		value: await viewOf(session, to.id),
	};
}

/**
 * Attach (or clear, with `null`) a promotional code on a whole basket. A refused code is not attached,
 * but the refusal is returned so the surface can explain it against the field the buyer typed into.
 */
export async function applyPromo(
	basketId: string,
	code: string | null,
	query: BasketQuery,
	actor: ReadActor,
): Promise<BasketOutcome<BasketView & { applied: AppliedPromo | null }>> {
	const session = await openSession(query, actor);
	if (!session) return SIGNED_OUT;
	const gate = spendGate(session);
	if (gate) return gate;
	const basket = await writeTarget(session, basketId);

	if (code === null) {
		const { error } = await session.db.schema("finance").from("baskets")
			.update({ promo_code: null, updated_at: new Date().toISOString() })
			.eq("id", basket.id);
		if (error) return writeFailure(error);
		return {
			ok: true,
			message: "Promo code removed.",
			value: { ...(await viewOf(session, basket.id)), applied: null },
		};
	}

	const before = await viewOf(session, basket.id);
	const promo = await resolvePromo(session, code, before.basket.items);
	const { error } = await session.db.schema("finance").from("baskets")
		.update({
			promo_code: promo?.valid ? promo.code : null,
			updated_at: new Date().toISOString(),
		})
		.eq("id", basket.id);
	if (error) return writeFailure(error);
	const after = await viewOf(session, basket.id);
	return {
		ok: true,
		message: promo?.valid
			? `${promo.label} applied — you save ${promo.amount.display}.`
			: (promo?.message ?? "We don't recognise that code."),
		value: { ...after, applied: promo },
	};
}

/** Create a further named basket for the owner (a wishlist, a project shopping list). */
export async function createBasket(
	name: string,
	query: BasketQuery,
	actor: ReadActor,
): Promise<BasketOutcome<BasketView>> {
	const session = await openSession(query, actor);
	if (!session) return SIGNED_OUT;
	const gate = spendGate(session);
	if (gate) return gate;
	const rows = await readBaskets(session);
	if (rows.length >= MAX_BASKETS) {
		return refuse(409, "You've reached the number of lists one account can keep.", { name: "limit" });
	}
	const { data, error } = await session.db.schema("finance").from("baskets")
		.insert({
			owner_type: session.owner.isEntity ? session.owner.ownerType : "user",
			owner_id: session.owner.ownerId,
			name: clip(name.trim(), 120),
			// The first basket an owner creates becomes their default — there is nothing else for an
			// add-to-basket to land in.
			is_default: rows.length === 0,
		})
		.select(BASKET_COLS)
		.single();
	if (error || !data) return writeFailure(error ?? { message: "no row" });
	const created = data as BasketRow;
	return {
		ok: true,
		message: `Created ${clip(created.name, 60)}.`,
		value: await viewOf(session, created.id),
	};
}

/** The lane model for a view, with `activeId` selected — what a list creation answers with. */
export function listsOf(view: BasketView, activeId: string | null): BasketLists {
	return buildLists(view.account, view.basket, activeId);
}
// #endregion
