import type {
	CheckoutTotals,
	FulfilmentKind,
	MoneyView,
	Order,
	OrderLine,
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
import { getUserClient } from "../../core/supabase.ts";
import { type Catalog, loadCatalog } from "../explore/live-catalog.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import type { ResolvedOwner } from "./commerce-owner.ts";

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
 * **A line only offers an action it can honour.** A download needs a stored asset; an engagement
 * needs a workspace to open; a session needs its time. Where the fact is missing the SSOT's
 * `fulfilmentKindOf` resolves the line to `pending` with a sentence saying why — never a link that
 * 404s. No room has been minted for a booked session here, so there is no join link to offer yet.
 */

// #region Rows
const ORDER_COLS =
	"id, reference, status, placed_at, owner_type, owner_id, basket_id, currency, subtotal_minor, " +
	"creator_discount_minor, promo_discount_minor, platform_fee_minor, platform_fee_bp, " +
	"platform_fee_mode, tax_minor, processing_contribution_minor, total_minor, charged_minor, " +
	"payment_provider, payment_method_label";
const LINE_COLS =
	"id, order_id, basket_item_id, item_type, item_id, title, subtitle, quantity, line_total_minor, " +
	"currency, fulfilment, asset_id, download_name, download_bytes, download_format, licence, " +
	"stage_id, scheduled_at, timezone, duration_minutes, seats, conferencing_provider, position";

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
	position: number;
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
	cancelled: () => "This order was cancelled.",
};
// #endregion

// #region Resolution
/** The display facts a receipt line borrows from the live catalogue and the buyer's projects. */
interface LineContext {
	catalog: Catalog | null;
	projects: Map<string, { slug: string; title: string }>;
	stages: Map<string, { slug: string; projectId: string; name: string; position: number }>;
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
	const bySlug = line.item_type === "digital_product"
		? [...catalog.productBySlug].find(([, row]) => row.id === line.item_id)?.[0]
		: [...catalog.blueprintBySlug].find(([, row]) => row.id === line.item_id)?.[0];
	const item = bySlug ? catalog.byId.get(bySlug) : undefined;
	if (!item) return none;
	const handle = item.owner.handle.replace(/^@/, "");
	return {
		thumbnail: "media" in item && typeof item.media === "string" && item.media ? item.media : null,
		sellerHandle: handle ? clip(handle, 40) : null,
		sellerName: clip(item.owner.name, 120),
	};
}

async function lineContext(actor: ReadActor & { accessToken: string }, lines: readonly LineRow[]): Promise<LineContext> {
	const db = getUserClient(actor.accessToken).schema("projects");
	const stageIds = [...new Set(lines.map((l) => l.stage_id).filter((id): id is string => !!id))];
	const projectKinds = new Set<PurchasableItemKind>(["project_ticket", "one_off_project", "one_off_task"]);
	const projectIds = new Set(lines.filter((l) => projectKinds.has(l.item_type)).map((l) => l.item_id));

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

	const projects = new Map<string, { slug: string; title: string }>();
	if (projectIds.size > 0) {
		const { data } = await db.from("projects").select("id, slug, title").in("id", [...projectIds]);
		for (const row of (data ?? []) as { id: string; slug: string; title: string }[]) {
			projects.set(row.id, { slug: row.slug, title: row.title });
		}
	}

	return { catalog: await loadCatalog().catch(() => null), projects, stages };
}
// #endregion

// #region Projection
function icsPathFor(orderId: string, lineId: string): string {
	return clip(
		`/api/checkout/calendar?order=${encodeURIComponent(orderId)}&line=${encodeURIComponent(lineId)}`,
		600,
	);
}

/** Why a line has nothing to open yet, in the buyer's own terms. */
function pendingNoteFor(line: LineRow, natural: FulfilmentKind): string {
	if (natural === "session") return "We'll confirm the time with the seller shortly.";
	if (natural === "download") return "Your files are being prepared — we'll email you when they're ready.";
	return "Starts once the seller opens the workspace.";
}

function toLine(line: LineRow, order: OrderRow, ctx: LineContext): OrderLine {
	const face = listingFace(ctx, line);
	const natural = line.fulfilment;
	const stage = line.stage_id ? ctx.stages.get(line.stage_id) : undefined;
	const stageProject = stage ? ctx.projects.get(stage.projectId) : undefined;
	const ownProject = ctx.projects.get(line.item_id);

	const engagement = natural !== "engagement"
		? null
		: stage && stageProject
		? {
			href: clip(`/projects/${stageProject.slug}/${stage.slug}`, 200),
			label: clip(`Stage ${stage.position} · ${stage.name}`, 120),
		}
		: ownProject
		? { href: clip(`/projects/${ownProject.slug}`, 200), label: clip(ownProject.title, 120) }
		: null;

	const bytes = line.download_bytes === null ? null : Number(line.download_bytes);
	const download = natural === "download" && line.asset_id
		? {
			href: clip(`/files?asset=${encodeURIComponent(line.asset_id)}`, 600),
			name: line.download_name ? clip(line.download_name, 200) : null,
			bytes,
			label: bytes !== null && Number.isFinite(bytes) ? clip(byteLabel(bytes), 24) : null,
		}
		: null;

	const booked = natural === "session" && line.scheduled_at !== null;
	const duration = line.duration_minutes ?? null;
	const provider = booked && line.conferencing_provider ? line.conferencing_provider : null;
	const calendar = booked && duration
		? calendarLinksFor({
			title: clip(line.title, 160),
			startIso: new Date(line.scheduled_at!).toISOString(),
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
		quantity: line.quantity,
		lineTotal: receipt(line.line_total_minor, line.currency),
		fulfilment: natural,
		pendingNote: null,
		assetId: download ? line.asset_id : null,
		downloadHref: download?.href ?? null,
		downloadName: download?.name ?? null,
		downloadBytes: download?.bytes ?? null,
		downloadSizeLabel: download?.label ?? null,
		downloadFormat: line.download_format ? clip(line.download_format, 80) : null,
		licence: line.licence ? clip(line.licence, 80) : null,
		engagementHref: engagement?.href ?? null,
		engagementLabel: engagement?.label ?? null,
		scheduledAt: booked ? new Date(line.scheduled_at!).toISOString() : null,
		scheduledLabel: booked ? slotLabel(line.scheduled_at!, line.timezone, duration) : null,
		timezone: booked ? line.timezone : null,
		durationMinutes: booked ? duration : null,
		conferencingProvider: provider ? clip(provider, 40) : null,
		conferencingLabel: provider ? clip(CONFERENCING_LABEL[provider] ?? provider, 60) : null,
		// No meeting room has been minted for this booking, so there is nothing to join yet.
		joinUrl: null,
		calendar,
		seats: line.seats,
	};
	// The claimed route and the facts behind it are reconciled ONCE, by the SSOT's own rule.
	const resolved = fulfilmentKindOf(draft);
	return {
		...draft,
		fulfilment: resolved,
		pendingNote: resolved === "pending" ? pendingNoteFor(line, natural) : null,
	};
}

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
