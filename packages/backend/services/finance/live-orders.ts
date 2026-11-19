import type {
	CheckoutTotals,
	FulfilmentKind,
	MoneyView,
	Order,
	OrderLine,
	OrderLineStatus,
	OrderPage,
	OrderStatus,
	PurchasableItemKind,
} from "@projective/types/finance";
import {
	buildIcsCalendar,
	calendarLinksFor,
	DEFAULT_LOCALE,
	formatMoney,
	fulfilmentKindOf,
} from "@projective/types/finance";
import type { ExploreItem } from "@projective/types/explore";
import type { OrderHistoryLine, OrderHistoryPage, OrderLineHome } from "@projective/types/finance";
import { downloadHref, purchasesHref } from "@projective/types/catalogue";
import { IntakeAnswersSchema } from "@projective/types/services";
import { getUserClient } from "../../core/supabase.ts";
import { entitlementsForLines, type LineEntitlement } from "../catalogue/delivery.ts";
import { type Catalog, loadCatalog } from "../explore/live-catalog.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import type { ResolvedOwner } from "./commerce-owner.ts";
import { type HistoryRequest, type KeysetQuery, readHistoryRows } from "./order-history.ts";

/**
 * live-orders — the confirmation hub's read over `finance.orders` + `finance.order_lines`, as the
 * signed-in caller.
 *
 * **A receipt reprints; it does not recompute.** Every figure is the order row's own, in the currency
 * it was charged in — re-projecting a settled amount into today's display currency would show a buyer
 * a figure they were never charged. The line titles are the order's snapshots for the same reason: a
 * listing renamed after the purchase does not rewrite what was bought. Only DISPLAY facts that no
 * receipt stores (a cover image, the seller's name) are read from the live catalogue.
 *
 * **A line only offers an action it can honour.** A download needs an active entitlement whose frozen
 * files are ready (`catalogue.entitlements`, Decision #488; `order_lines.asset_id` is reserved and never
 * read); an engagement
 * needs a workspace to open; a session needs its time. Where the fact is missing the SSOT's
 * `fulfilmentKindOf` resolves the line to `pending` with a sentence saying why — never a link that
 * 404s. No room has been minted for a booked session here, so there is no join link to offer yet.
 */

// #region Rows
const ORDER_COLS =
	"id, reference, status, placed_at, owner_type, owner_id, basket_id, currency, subtotal_minor, " +
	"creator_discount_minor, promo_discount_minor, platform_fee_minor, platform_fee_bp, " +
	"platform_fee_mode, tax_minor, processing_contribution_minor, total_minor, charged_minor, " +
	"payment_provider, payment_method_label, promo_code";
const LINE_COLS =
	"id, order_id, basket_item_id, item_type, item_id, title, subtitle, quantity, line_total_minor, " +
	"currency, promo_discount_minor, platform_fee_bp, platform_fee_minor, fulfilment, asset_id, " +
	"download_name, download_bytes, download_format, licence, stage_id, scheduled_at, timezone, " +
	"duration_minutes, seats, conferencing_provider, intake_answers, position, ticket_id, project_id, " +
	"status, refunded_minor, refunded_at";

interface OrderRow {
	id: string;
	reference: string;
	status: OrderStatus;
	placed_at: string;
	owner_type: string;
	owner_id: string;
	basket_id: string | null;
	currency: string;
	subtotal_minor: number | string;
	creator_discount_minor: number | string;
	promo_discount_minor: number | string;
	platform_fee_minor: number | string;
	platform_fee_bp: number;
	platform_fee_mode: "seller_deducted" | "buyer_added";
	tax_minor: number | string;
	processing_contribution_minor: number | string;
	total_minor: number | string;
	charged_minor: number | string;
	payment_provider: string;
	payment_method_label: string;
	promo_code: string | null;
}

interface LineRow {
	id: string;
	order_id: string;
	basket_item_id: string | null;
	item_type: PurchasableItemKind;
	item_id: string;
	title: string;
	subtitle: string | null;
	quantity: number;
	line_total_minor: number | string;
	currency: string;
	promo_discount_minor: number | string;
	/** The seller commission's rate on a product line (Decision #337, ruling M1); `null` on an escrow line. */
	platform_fee_bp: number | null;
	platform_fee_minor: number | string;
	fulfilment: FulfilmentKind;
	asset_id: string | null;
	download_name: string | null;
	download_bytes: number | string | null;
	download_format: string | null;
	licence: string | null;
	stage_id: string | null;
	scheduled_at: string | null;
	timezone: string | null;
	duration_minutes: number | null;
	seats: number | null;
	conferencing_provider: string | null;
	/** The buyer's intake answers on a session, block or seat line (Decision #453); `{}` otherwise. */
	intake_answers: unknown;
	position: number;
	/** The one ticket this line funded (Decision #166); `null` for every other line. */
	ticket_id: string | null;
	/** The engagement a One-Off or Task line created at payment (Decision #457); `null` otherwise. */
	project_id: string | null;
	/** Where the line stands as its money goes back (Decision #469; FBP DB19). */
	status: OrderLineStatus;
	/** What has been refunded on this line, in its currency; `0` until a refund lands. */
	refunded_minor: number | string;
	refunded_at: string | null;
}
// #endregion

// #region Formatting
function clip(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** A settled figure, in the currency it was charged in. Never converted. */
function receipt(minor: number | string, currency: string): MoneyView {
	const value = Number(minor) || 0;
	return {
		minor: value,
		currency,
		display: formatMoney(value, currency, DEFAULT_LOCALE),
		origin: null,
	};
}

/** `17 Jul 2026, 16:20 UTC` — stated in UTC so a receipt reads the same wherever it is opened. */
function stampLabel(iso: string): string {
	return clip(
		`${
			new Intl.DateTimeFormat(DEFAULT_LOCALE, {
				day: "numeric",
				month: "short",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
				timeZone: "UTC",
			}).format(new Date(iso))
		} UTC`,
		80,
	);
}

/** `Tue 30 Sep · 10:00–11:00` in the booking's own zone. */
function slotLabel(iso: string, timezone: string | null, minutes: number | null): string {
	const ms = Date.parse(iso);
	const zone = timezone || "UTC";
	const fmt = (options: Intl.DateTimeFormatOptions, t: number) => {
		try {
			return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone }).format(new Date(t));
		} catch {
			return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(t));
		}
	};
	const day = fmt({ weekday: "short", day: "numeric", month: "short" }, ms);
	const at = (t: number) => fmt({ hour: "2-digit", minute: "2-digit", hour12: false }, t);
	const range = minutes && minutes > 0 ? `${at(ms)}–${at(ms + minutes * 60_000)}` : at(ms);
	return clip(`${day} · ${range}`, 80);
}

/** `24.5 MB`. */
function byteLabel(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function slugify(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) ||
		"booking";
}

const CONFERENCING_LABEL: Record<string, string> = {
	zoom: "Zoom",
	google: "Google Meet",
	microsoft_teams: "Microsoft Teams",
};

const STATUS_MESSAGE: Record<OrderStatus, (total: string) => string> = {
	confirmed: (total) => `Paid ${total}.`,
	processing: () => "Your payment is processing — we'll confirm it shortly.",
	awaiting_payment: () => "This order is waiting for payment to complete.",
	invoiced: (total) => `Invoice raised for ${total}. It's due on your usual terms.`,
	refunded: (total) => `Refunded ${total}.`,
	cancelled: () => "This order was cancelled before anything was delivered, and refunded in full.",
};
// #endregion

// #region Resolution
/** The display facts a receipt line borrows from the live catalogue and the buyer's projects. */
interface LineContext {
	catalog: Catalog | null;
	projects: Map<string, ProjectFace>;
	stages: Map<string, { slug: string; projectId: string; name: string; position: number }>;
	/** A funded ticket's payee, by ticket id — who "can start now" on the confirmation. */
	payees: Map<string, string>;
	/** A product line's entitlement, by order line id (Decision #488) — what its download links name. */
	entitlements: Map<string, LineEntitlement>;
	/** A session, block or seat line's seat, by order line id: the cohort it sits on and that cohort's engagement. */
	seats: Map<string, { cohortId: string; projectId: string | null }>;
	/** Every sitting of each of those cohorts, in time order (Decision #453 flag (c)). */
	sittings: Map<string, SittingRow[]>;
}

/** One sitting as the buyer may read it (`projects.session_events`), with its calendar mirror's state. */
interface SittingRow {
	startsAt: string;
	endsAt: string;
	status: string;
	/** The mirror is still `tentative`: a block's pencilled-in time awaiting its handshake (Decision #211). */
	tentative: boolean;
}

/** The item kinds whose line is a seat on a cohort: a 1-1 session, a block, a group seat. */
const SEAT_KINDS = new Set<PurchasableItemKind>([
	"service_session",
	"set_session",
	"course_group_session",
]);

/** A purchased project as its order lines read it. */
interface ProjectFace {
	slug: string;
	title: string;
	/** The listing a service-backed project was instantiated from; `null` for a client project. */
	sourceBlueprintId: string | null;
}

/** A discovery item's public cover (listing showcase slot 1), or `null` when it has none. */
function coverOf(item: ExploreItem): string | null {
	return "media" in item && typeof item.media === "string" && item.media ? item.media : null;
}

/** The public face of a purchased listing, when the catalogue still carries it. */
function listingFace(ctx: LineContext, line: LineRow): {
	thumbnail: string | null;
	sellerHandle: string | null;
	sellerName: string | null;
} {
	const none = { thumbnail: null, sellerHandle: null, sellerName: null };
	const catalog = ctx.catalog;
	if (!catalog) return none;
	const project = ctx.projects.get(line.item_id);
	if (project) {
		const slug = project.sourceBlueprintId
			? [...catalog.blueprintBySlug].find(([, row]) => row.id === project.sourceBlueprintId)?.[0]
			: undefined;
		const source = slug ? catalog.byId.get(slug) : undefined;
		return { ...none, thumbnail: source ? coverOf(source) : null };
	}
	const bySlug = line.item_type === "digital_product"
		? [...catalog.productBySlug].find(([, row]) => row.id === line.item_id)?.[0]
		: [...catalog.blueprintBySlug].find(([, row]) => row.id === line.item_id)?.[0];
	const item = bySlug ? catalog.byId.get(bySlug) : undefined;
	if (!item) return none;
	const handle = item.owner.handle.replace(/^@/, "");
	return {
		thumbnail: coverOf(item),
		sellerHandle: handle ? clip(handle, 40) : null,
		sellerName: clip(item.owner.name, 120),
	};
}

async function lineContext(actor: ReadActor & { accessToken: string }, lines: readonly LineRow[]): Promise<LineContext> {
	const db = getUserClient(actor.accessToken).schema("projects");
	const stageIds = [...new Set(lines.map((l) => l.stage_id).filter((id): id is string => !!id))];
	const projectKinds = new Set<PurchasableItemKind>(["project_ticket", "one_off_project", "one_off_task"]);
	const projectIds = new Set(lines.filter((l) => projectKinds.has(l.item_type)).map((l) => l.item_id));
	for (const line of lines) if (line.project_id) projectIds.add(line.project_id);

	const stages = new Map<string, { slug: string; projectId: string; name: string; position: number }>();
	if (stageIds.length > 0) {
		const { data } = await db.from("project_stages").select("id, slug, project_id, name").in("id", stageIds);
		const rows = (data ?? []) as { id: string; slug: string; project_id: string; name: string }[];
		for (const row of rows) projectIds.add(row.project_id);
		const siblings = rows.length > 0
			? await db.from("project_stages").select("id, project_id, sort_order")
				.in("project_id", [...new Set(rows.map((r) => r.project_id))])
			: { data: [] };
		const order = new Map<string, number>();
		const byProject = new Map<string, { id: string; sort_order: number }[]>();
		for (const s of (siblings.data ?? []) as { id: string; project_id: string; sort_order: number }[]) {
			byProject.set(s.project_id, [...(byProject.get(s.project_id) ?? []), s]);
		}
		for (const list of byProject.values()) {
			list.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
			list.forEach((s, i) => order.set(s.id, i + 1));
		}
		for (const row of rows) {
			stages.set(row.id, {
				slug: row.slug,
				projectId: row.project_id,
				name: row.name,
				position: order.get(row.id) ?? 1,
			});
		}
	}

	const { seats, sittings } = await seatsOf(actor, lines);
	for (const seat of seats.values()) if (seat.projectId) projectIds.add(seat.projectId);

	const projects = new Map<string, ProjectFace>();
	if (projectIds.size > 0) {
		const { data } = await db.from("projects").select("id, slug, title, source_blueprint_id")
			.in("id", [...projectIds]);
		for (
			const row of (data ?? []) as {
				id: string;
				slug: string;
				title: string;
				source_blueprint_id: string | null;
			}[]
		) {
			projects.set(row.id, {
				slug: row.slug,
				title: row.title,
				sourceBlueprintId: row.source_blueprint_id,
			});
		}
	}

	const productLines = lines.filter((l) => l.item_type === "digital_product").map((l) => l.id);
	return {
		catalog: await loadCatalog().catch(() => null),
		projects,
		stages,
		payees: await payeesOf(actor, lines),
		entitlements: await entitlementsForLines(getUserClient(actor.accessToken), productLines)
			.catch(() => new Map<string, LineEntitlement>()),
		seats,
		sittings,
	};
}

/**
 * Each session, block or seat line's seat and its cohort's sittings, read as the buyer through the
 * line's own link (`projects.cohort_memberships.order_line_id`) — the sittings are never copied onto the
 * order line, so a rescheduled or cancelled sitting reads as it stands. A seat the caller cannot read
 * (another member's, on an entity order) is absent, and its line keeps its first-sitting snapshot.
 */
async function seatsOf(
	actor: ReadActor & { accessToken: string },
	lines: readonly LineRow[],
): Promise<Pick<LineContext, "seats" | "sittings">> {
	const seats = new Map<string, { cohortId: string; projectId: string | null }>();
	const sittings = new Map<string, SittingRow[]>();
	const lineIds = lines.filter((l) => SEAT_KINDS.has(l.item_type)).map((l) => l.id);
	if (lineIds.length === 0) return { seats, sittings };
	const db = getUserClient(actor.accessToken);
	const { data: memberships } = await db.schema("projects").from("cohort_memberships")
		.select("order_line_id, cohort_id").in("order_line_id", lineIds);
	const held = (memberships ?? []) as { order_line_id: string; cohort_id: string }[];
	const cohortIds = [...new Set(held.map((m) => m.cohort_id))];
	if (cohortIds.length === 0) return { seats, sittings };

	const [{ data: cohorts }, { data: events }] = await Promise.all([
		db.schema("projects").from("cohorts").select("id, project_id").in("id", cohortIds),
		db.schema("projects").from("session_events")
			.select("id, cohort_id, start_time, end_time, status")
			.in("cohort_id", cohortIds)
			.order("start_time", { ascending: true })
			.limit(52 * cohortIds.length),
	]);
	type CohortRow = { id: string; project_id: string | null };
	const projectOf = new Map(((cohorts ?? []) as CohortRow[]).map((c) => [c.id, c.project_id]));
	for (const m of held) {
		seats.set(m.order_line_id, {
			cohortId: m.cohort_id,
			projectId: projectOf.get(m.cohort_id) ?? null,
		});
	}

	type EventRow = {
		id: string;
		cohort_id: string;
		start_time: string;
		end_time: string;
		status: string;
	};
	const rows = (events ?? []) as EventRow[];
	const tentative = new Set<string>();
	if (rows.length > 0) {
		const { data: mirrors } = await db.schema("scheduling").from("events")
			.select("source_session_event_id, status")
			.in("source_session_event_id", rows.map((r) => r.id));
		for (const mirror of (mirrors ?? []) as { source_session_event_id: string; status: string }[]) {
			if (mirror.status === "tentative") tentative.add(mirror.source_session_event_id);
		}
	}
	for (const row of rows) {
		sittings.set(row.cohort_id, [...(sittings.get(row.cohort_id) ?? []), {
			startsAt: row.start_time,
			endsAt: row.end_time,
			status: row.status,
			tentative: tentative.has(row.id),
		}]);
	}
	return { seats, sittings };
}

/** The display name of each funded ticket's payee, read as the buyer — an unreadable one is absent. */
async function payeesOf(
	actor: ReadActor & { accessToken: string },
	lines: readonly LineRow[],
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const ticketIds = [...new Set(lines.map((l) => l.ticket_id).filter((id): id is string => !!id))];
	if (ticketIds.length === 0) return out;
	const db = getUserClient(actor.accessToken);
	const { data: tickets } = await db.schema("projects").from("tickets")
		.select("id, current_assignee_id").in("id", ticketIds);
	const rows = (tickets ?? []) as { id: string; current_assignee_id: string | null }[];
	const userIds = [...new Set(rows.map((t) => t.current_assignee_id).filter((id): id is string => !!id))];
	if (userIds.length === 0) return out;
	const { data: users } = await db.schema("org").from("users_public")
		.select("user_id, username, first_name, last_name").in("user_id", userIds);
	const names = new Map<string, string>();
	type UserRow = {
		user_id: string;
		username: string | null;
		first_name: string | null;
		last_name: string | null;
	};
	for (const u of (users ?? []) as UserRow[]) {
		const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
		if (full || u.username) names.set(u.user_id, clip(full || `@${u.username}`, 120));
	}
	for (const t of rows) {
		const name = t.current_assignee_id ? names.get(t.current_assignee_id) : undefined;
		if (name) out.set(t.id, name);
	}
	return out;
}
// #endregion

// #region Projection
function icsPathFor(orderId: string, lineId: string): string {
	return clip(
		`/api/checkout/calendar?order=${encodeURIComponent(orderId)}&line=${encodeURIComponent(lineId)}`,
		600,
	);
}

/**
 * Why a line has nothing to open yet, in the buyer's own terms — and only what is true. A download is
 * pending when its purchase has nothing to fetch now: it was refunded or withdrawn, the product
 * delivers no file, or its files are still being copied in after publishing (Decision #488). Nothing
 * emails the buyer when that changes, so the note promises nothing it cannot keep.
 */
function pendingNoteFor(natural: FulfilmentKind, entitlement: LineEntitlement | undefined): string {
	if (natural === "session") return "We'll confirm the time with the seller shortly.";
	if (natural === "download") {
		if (entitlement && entitlement.status !== "active") {
			return "This purchase was refunded, so its files are no longer available.";
		}
		if (entitlement?.delivery === "preparing") {
			return "Your files are being prepared — they'll be ready in a moment.";
		}
		return "This product came with no files to download. Message the seller if you expected some.";
	}
	return "Starts once the seller opens the workspace.";
}

/**
 * A product line's download facts, from its entitlement: one file is fetched directly; a bundle opens
 * the purchases view on this purchase, and lists each file with its own address. Nothing while the
 * purchase is not active or its files are not ready.
 */
function downloadOf(entitlement: LineEntitlement | undefined): {
	href: string;
	name: string | null;
	bytes: number;
	files: OrderLine["downloadFiles"];
} | null {
	if (!entitlement || entitlement.status !== "active" || entitlement.delivery !== "ready") return null;
	const files = entitlement.files.slice(0, 24).map((f) => ({
		name: clip(f.name, 200),
		href: downloadHref(entitlement.slug, f.fileId),
		bytes: f.bytes,
		sizeLabel: clip(byteLabel(f.bytes), 24),
	}));
	if (files.length === 0) return null;
	return {
		href: files.length === 1 ? files[0].href : clip(purchasesHref(entitlement.slug), 600),
		name: files.length === 1 ? files[0].name : null,
		bytes: files.reduce((sum, f) => sum + f.bytes, 0),
		files,
	};
}

function toLine(line: LineRow, order: OrderRow, ctx: LineContext): OrderLine {
	const face = listingFace(ctx, line);
	const natural = line.fulfilment;
	const stage = line.stage_id ? ctx.stages.get(line.stage_id) : undefined;
	const stageProject = stage ? ctx.projects.get(stage.projectId) : undefined;
	const ownProject = ctx.projects.get(line.item_id);
	// A One-Off or Task opens the engagement its payment created, not its first stage (Decision #457).
	const bought = line.project_id ? ctx.projects.get(line.project_id) : undefined;

	const engagement = natural !== "engagement"
		? null
		: bought
		? { href: clip(`/projects/${bought.slug}`, 200), label: clip(bought.title, 120) }
		: stage && stageProject
		? {
			href: clip(`/projects/${stageProject.slug}/${stage.slug}`, 200),
			label: clip(`Stage ${stage.position} · ${stage.name}`, 120),
		}
		: ownProject
		? { href: clip(`/projects/${ownProject.slug}`, 200), label: clip(ownProject.title, 120) }
		: null;

	const entitlement = ctx.entitlements.get(line.id);
	const delivered = natural === "download" ? downloadOf(entitlement) : null;
	const bytes = delivered?.bytes ?? null;
	const download = delivered
		? {
			href: delivered.href,
			name: delivered.name,
			bytes,
			label: bytes !== null && Number.isFinite(bytes) ? clip(byteLabel(bytes), 24) : null,
			files: delivered.files,
		}
		: null;

	// A seat's sittings are read through its membership, never off the line (Decision #453 flag (c)); a
	// group seat's line stores no time of its own, so its first standing sitting is what it was booked for.
	const seat = SEAT_KINDS.has(line.item_type) ? ctx.seats.get(line.id) : undefined;
	const seatSittings = seat ? ctx.sittings.get(seat.cohortId) ?? [] : [];
	const zone = line.timezone || (seatSittings.length > 0 ? "UTC" : null);
	const sittings = seatSittings.slice(0, 52).map((s) => {
		const span = Date.parse(s.endsAt) - Date.parse(s.startsAt);
		const minutes = Math.max(1, Math.round(span / 60_000));
		return {
			at: new Date(s.startsAt).toISOString(),
			label: slotLabel(s.startsAt, zone, minutes),
			state: s.status.startsWith("cancelled")
				? "cancelled" as const
				: s.status === "completed"
				? "completed" as const
				: s.tentative
				? "to_agree" as const
				: "scheduled" as const,
		};
	});
	const firstStanding = seatSittings.find((s) => !s.status.startsWith("cancelled"));
	const startAt = line.scheduled_at ?? firstStanding?.startsAt ?? null;
	const seatProject = seat?.projectId ? ctx.projects.get(seat.projectId) : undefined;
	const sessionProject = seatProject ?? (natural === "session" ? stageProject : undefined);

	const booked = natural === "session" && startAt !== null;
	const standingMinutes = firstStanding
		? Math.round((Date.parse(firstStanding.endsAt) - Date.parse(firstStanding.startsAt)) / 60_000)
		: 0;
	const duration = line.duration_minutes ?? (standingMinutes > 0 ? standingMinutes : null);
	const provider = booked && line.conferencing_provider ? line.conferencing_provider : null;
	const calendar = booked && duration
		? calendarLinksFor({
			title: clip(line.title, 160),
			startIso: new Date(startAt!).toISOString(),
			durationMinutes: duration,
			description: `Booked through Projective${face.sellerName ? ` with ${face.sellerName}` : ""}.`,
			location: provider ? CONFERENCING_LABEL[provider] ?? provider : "Projective",
			uid: `${line.id}@projective`,
		}, icsPathFor(order.id, line.id))
		: null;

	const draft: OrderLine = {
		id: line.id,
		basketItemId: line.basket_item_id,
		itemType: line.item_type,
		itemId: line.item_id,
		title: clip(line.title, 200) || "Purchase",
		subtitle: line.subtitle ? clip(line.subtitle, 200) : null,
		thumbnail: face.thumbnail,
		sellerHandle: face.sellerHandle,
		sellerName: face.sellerName,
		payeeName: line.ticket_id ? ctx.payees.get(line.ticket_id) ?? null : null,
		quantity: line.quantity,
		lineTotal: receipt(line.line_total_minor, line.currency),
		promoDiscount: receipt(line.promo_discount_minor, line.currency),
		platformFee: receipt(line.platform_fee_minor, line.currency),
		platformFeeBp: line.platform_fee_bp,
		status: line.status,
		refunded: receipt(line.refunded_minor, line.currency),
		refundedAt: line.refunded_at ? new Date(line.refunded_at).toISOString() : null,
		fulfilment: natural,
		pendingNote: null,
		assetId: null,
		downloadHref: download?.href ?? null,
		downloadName: download?.name ?? null,
		downloadBytes: download?.bytes ?? null,
		downloadSizeLabel: download?.label ?? null,
		downloadFiles: download?.files ?? [],
		downloadFormat: line.download_format ? clip(line.download_format, 80) : null,
		licence: line.licence ? clip(line.licence, 80) : null,
		engagementHref: engagement?.href ?? null,
		engagementLabel: engagement?.label ?? null,
		scheduledAt: booked ? new Date(startAt!).toISOString() : null,
		scheduledLabel: booked ? slotLabel(startAt!, zone, duration) : null,
		timezone: booked ? zone : null,
		durationMinutes: booked ? duration : null,
		conferencingProvider: provider ? clip(provider, 40) : null,
		conferencingLabel: provider ? clip(CONFERENCING_LABEL[provider] ?? provider, 60) : null,
		// No meeting room has been minted for this booking, so there is nothing to join yet.
		joinUrl: null,
		calendar,
		seats: line.seats,
		intakeAnswers: IntakeAnswersSchema.safeParse(line.intake_answers ?? {}).data ?? {},
		sittings,
		sessionHref: sessionProject ? clip(`/projects/${sessionProject.slug}`, 200) : null,
	};
	// The claimed route and the facts behind it are reconciled ONCE, by the SSOT's own rule.
	const resolved = fulfilmentKindOf(draft);
	return {
		...draft,
		fulfilment: resolved,
		pendingNote: resolved === "pending" ? pendingNoteFor(natural, entitlement) : null,
	};
}

/**
 * The order row's own totals. `platformFee` is the sum of the lines' recorded fees (each product line's
 * seller commission); `platformFeeBp` is the payer's rate stamped on the order, which its escrow lines
 * are charged at release. A product line's own rate is on the line (`OrderLine.platformFeeBp`).
 */
function totalsOf(order: OrderRow): CheckoutTotals {
	const money = (minor: number | string) => receipt(minor, order.currency);
	const subtotal = Number(order.subtotal_minor) || 0;
	const creator = Number(order.creator_discount_minor) || 0;
	const promo = Number(order.promo_discount_minor) || 0;
	return {
		subtotal: money(subtotal),
		creatorDiscounts: money(creator),
		promoDiscount: money(promo),
		net: money(Math.max(subtotal - creator - promo, 0)),
		platformFee: money(order.platform_fee_minor),
		platformFeeBp: order.platform_fee_bp,
		platformFeeMode: order.platform_fee_mode,
		taxes: money(order.tax_minor),
		taxNote: null,
		processingContribution: money(order.processing_contribution_minor),
		total: money(order.total_minor),
	};
}

function toOrder(order: OrderRow, lines: readonly LineRow[], owner: ResolvedOwner, ctx: LineContext): Order {
	const projected = lines.map((line) => toLine(line, order, ctx));
	const total = receipt(order.total_minor, order.currency);
	return {
		id: order.id,
		reference: clip(order.reference, 40),
		status: order.status,
		placedAt: new Date(order.placed_at).toISOString(),
		placedAtLabel: stampLabel(order.placed_at),
		ownerType: owner.ownerType,
		ownerId: order.owner_id,
		ownerName: clip(owner.name, 120),
		basketId: order.basket_id,
		currency: order.currency,
		lines: projected,
		totals: totalsOf(order),
		// No per-order invoice is stored; a consumer receipt IS the order. Statement invoices are the
		// monthly `finance.invoices` rows, read on the wallet's invoices page.
		invoice: null,
		paymentMethodLabel: clip(order.payment_method_label || order.payment_provider, 120),
		charged: receipt(order.charged_minor, order.currency),
		promoCode: order.promo_code,
		processingContribution: receipt(order.processing_contribution_minor, order.currency),
		pendingCount: projected.filter((l) => l.fulfilment === "pending").length,
		message: clip(STATUS_MESSAGE[order.status](total.display), 200),
	};
}
// #endregion

// #region Reads
/** The owner filter every order read applies. */
function ownedOrders(actor: ReadActor & { accessToken: string }, owner: ResolvedOwner) {
	const q = getUserClient(actor.accessToken).schema("finance").from("orders").select(ORDER_COLS)
		.eq("owner_id", owner.ownerId);
	return owner.isEntity ? q.eq("owner_type", owner.ownerType) : q.in("owner_type", ["user", "freelancer"]);
}

/**
 * The confirmation hub's whole read: the named order (or the account's most recent) and the account's
 * other recent ones. An order of a different account is never returned even when its id is named —
 * the owner filter and RLS both refuse it — and `null` means the account has no order at all.
 */
export async function readOrderPage(
	owner: ResolvedOwner,
	orderId: string | null | undefined,
	actor: ReadActor,
): Promise<OrderPage | null> {
	if (!canReadLive(actor)) return null;
	const recentRes = await ownedOrders(actor, owner).order("placed_at", { ascending: false }).limit(20);
	if (recentRes.error) throw new Error(`finance.orders read failed: ${recentRes.error.message}`);
	const recent = (recentRes.data ?? []) as unknown as OrderRow[];
	const order = orderId ? recent.find((o) => o.id === orderId) ?? await findOrder(actor, owner, orderId) : recent[0];
	if (!order) return null;

	const { data, error } = await getUserClient(actor.accessToken).schema("finance").from("order_lines")
		.select(LINE_COLS)
		.eq("order_id", order.id)
		.order("position", { ascending: true });
	if (error) throw new Error(`finance.order_lines read failed: ${error.message}`);
	const lines = (data ?? []) as unknown as LineRow[];
	const ctx = await lineContext(actor, lines);

	return {
		order: toOrder(order, lines, owner, ctx),
		recent: recent.filter((o) => o.id !== order.id).slice(0, 20).map((o) => ({
			id: o.id,
			reference: clip(o.reference, 40),
			placedAtLabel: stampLabel(o.placed_at),
			total: receipt(o.total_minor, o.currency),
			status: o.status,
		})),
	};
}

/** One named order of this owner beyond the recent window. */
async function findOrder(
	actor: ReadActor & { accessToken: string },
	owner: ResolvedOwner,
	orderId: string,
): Promise<OrderRow | undefined> {
	if (!/^[0-9a-f-]{36}$/i.test(orderId)) return undefined;
	const { data, error } = await ownedOrders(actor, owner).eq("id", orderId).maybeSingle();
	if (error) throw new Error(`finance.orders read failed: ${error.message}`);
	return (data as unknown as OrderRow | null) ?? undefined;
}

// #region History
/**
 * Where a past line lives now (MARKETPLACE CK3): a download opens the purchases view on its purchase,
 * which shows a refunded one as refunded; a session, block or seat opens the session's workspace; an
 * engagement its project or stage. `null` when there is nowhere the buyer can go.
 */
function homeOf(row: LineRow, line: OrderLine, ctx: LineContext): OrderLineHome | null {
	if (row.fulfilment === "download") {
		const entitlement = ctx.entitlements.get(row.id);
		return entitlement
			? { href: clip(purchasesHref(entitlement.slug), 600), label: "Open in your purchases" }
			: null;
	}
	if (line.sessionHref) return { href: line.sessionHref, label: "Open the session" };
	if (line.engagementHref) {
		return {
			href: line.engagementHref,
			label: clip(line.engagementLabel ?? "Open the workspace", 120),
		};
	}
	return null;
}

/** One past line as the history lists it: the receipt's projection, reduced, and its home. */
function historyLineOf(row: LineRow, order: OrderRow, ctx: LineContext): OrderHistoryLine {
	const line = toLine(row, order, ctx);
	return {
		id: line.id,
		itemType: line.itemType,
		title: line.title,
		lineTotal: line.lineTotal,
		home: homeOf(row, line, ctx),
	};
}

/**
 * One page of the acting account's order history, newest first (`/checkout/orders`, MARKETPLACE CK3):
 * keyset-paged on `(placed_at, id)` through {@link readHistoryRows}, scoped by the same owner filter as
 * the confirmation hub and read under the caller's JWT, so a team's or a business's history lists only
 * that account's orders and only to someone RLS lets see them. Each order's lines come in one read for
 * the whole page, each linked to its home. `null` when the caller cannot read live.
 */
export async function readOrderHistory(
	owner: ResolvedOwner,
	request: HistoryRequest,
	actor: ReadActor,
): Promise<OrderHistoryPage | null> {
	if (!canReadLive(actor)) return null;
	const scoped = () => ownedOrders(actor, owner) as unknown as KeysetQuery<OrderRow>;
	const window = await readHistoryRows(scoped(), request, scoped);

	const ids = window.rows.map((o) => o.id);
	let lines: LineRow[] = [];
	if (ids.length > 0) {
		const { data, error } = await getUserClient(actor.accessToken).schema("finance")
			.from("order_lines")
			.select(LINE_COLS)
			.in("order_id", ids)
			.order("position", { ascending: true });
		if (error) throw new Error(`finance.order_lines read failed: ${error.message}`);
		lines = (data ?? []) as unknown as LineRow[];
	}
	const ctx = await lineContext(actor, lines);
	const byOrder = new Map<string, OrderHistoryLine[]>();
	for (const row of lines) {
		const order = window.rows.find((o) => o.id === row.order_id);
		const own = byOrder.get(row.order_id) ?? [];
		if (!order || own.length >= 200) continue;
		byOrder.set(row.order_id, [...own, historyLineOf(row, order, ctx)]);
	}

	return {
		ownerKey: owner.key,
		ownerName: clip(owner.name, 120),
		owners: [],
		entries: window.rows.map((order) => ({
			id: order.id,
			reference: clip(order.reference, 40),
			status: order.status,
			placedAt: new Date(order.placed_at).toISOString(),
			placedAtLabel: stampLabel(order.placed_at),
			total: receipt(order.total_minor, order.currency),
			lines: byOrder.get(order.id) ?? [],
		})),
		older: window.older,
		newer: window.newer,
	};
}
// #endregion

/**
 * The `.ics` document for one booked line, and the filename it downloads as. Built by the SSOT's
 * `buildIcsCalendar` from the same event the Google and Outlook links describe; the `DTSTAMP` is the
 * order's placement instant, so two downloads of one booking are byte-identical.
 */
export async function icsFor(
	owner: ResolvedOwner,
	orderId: string,
	lineId: string,
	actor: ReadActor,
): Promise<{ filename: string; body: string } | null> {
	if (!canReadLive(actor)) return null;
	const order = await findOrder(actor, owner, orderId);
	if (!order) return null;
	const { data, error } = await getUserClient(actor.accessToken).schema("finance").from("order_lines")
		.select(LINE_COLS)
		.eq("order_id", order.id)
		.eq("id", lineId)
		.maybeSingle();
	if (error) throw new Error(`finance.order_lines read failed: ${error.message}`);
	const line = data as unknown as LineRow | null;
	if (!line || line.fulfilment !== "session" || !line.scheduled_at || !line.duration_minutes) return null;
	const provider = line.conferencing_provider;
	const body = buildIcsCalendar({
		title: clip(line.title, 160),
		startIso: new Date(line.scheduled_at).toISOString(),
		durationMinutes: line.duration_minutes,
		description: "Booked through Projective.",
		location: provider ? CONFERENCING_LABEL[provider] ?? provider : "Projective",
		uid: `${line.id}@projective`,
	}, new Date(order.placed_at).toISOString());
	return { filename: `${slugify(line.title)}.ics`, body };
}
// #endregion
