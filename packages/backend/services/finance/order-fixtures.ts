import type {
	BasketItem,
	BillingContext,
	BuyerDetails,
	CalendarLinks,
	CheckoutTotals,
	FulfilmentKind,
	InvoiceFx,
	MoneyView,
	Order,
	OrderInvoice,
	OrderLine,
	OrderPage,
	OrderStatus,
	PurchasableItemKind,
	TaxBreakdown,
} from "@projective/types/finance";
import {
	buildIcsCalendar,
	calendarLinksFor,
	checkoutTotals,
	fulfilmentKindOf,
	itemKindMeta,
} from "@projective/types/finance";
import type { BasketQuery, BasketSim } from "./basket-query.ts";
import * as fx from "./basket-fixtures.ts";
import { FX_FIXTURE_AS_OF, FX_FIXTURE_BASE } from "./fx-fixtures.ts";
import { defaultCardId, listCards } from "./cards-fixtures.ts";

/**
 * order fixtures — the deterministic order corpus behind `/checkout/confirmation`, and the mutable
 * per-process store that lets a completed charge be READ BACK by id.
 *
 * **This is what closes `CheckoutResult.orderId`.** That field has shipped permanently `null` because
 * nothing could produce an order (CLAUDE.md Decision #68, flagged item (g)); {@link recordOrder} is
 * called by `CheckoutBackendService.create()` on every attempt that actually produced one, and
 * {@link orderFor} resolves it afterwards. No `finance.orders` table exists yet, so this stays a
 * read+write projection over fixtures exactly like `detail` / `messages` / `files`, and the field
 * names are the SSOT's so a live table adopts them verbatim.
 *
 * **Nothing here re-denominates a charged amount.** An order is a document about money that has
 * already moved: it reprints the `MoneyView`s the charge produced, in the currency it was charged in,
 * and the conversion that produced them is reprinted from the snapshot captured at the time
 * ({@link invoiceFxFor}) rather than re-resolved against today's table. A read-time FX projection is
 * correct for a price; on a receipt it is how a buyer comes to be shown a figure they were never
 * charged.
 *
 * **The simulation axes reshape the READ, never the record.** A stored order keeps line SEEDS (the
 * basket snapshot); {@link orderFor} derives the `OrderLine[]` from them on each read, so moving the
 * `simFulfilment` / `simConferencing` controls changes what the hub renders without rewriting
 * anything that was purchased.
 *
 * Deterministic: no RNG and no `Date.now()`. Every stamp derives from `basket-fixtures`' shared
 * reference clock and every derived index uses an unsigned `>>>` hash — a signed `>>` goes negative
 * and yields an `undefined` slot, which is how a label ships reading "undefined" (Decision #48) and a
 * filename ships ending "….undefined" (Decision #32).
 */

// #region Reference clock + deterministic helpers (declared ABOVE every consumer)
/** The corpus reference instant, kept in step with `basket-fixtures`' own `NOW`. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const DAY = 86_400_000;

/** The zone every human-readable stamp in this corpus is rendered in. */
const ZONE = "Europe/London";
const LOCALE = "en-GB";

/**
 * The `DTSTAMP` every generated `.ics` carries.
 *
 * Fixed rather than read from a clock so {@link buildIcsCalendar} — which is pure precisely so this is
 * possible — produces the same bytes for the same event on every request. A moving `DTSTAMP` would
 * make the file uncacheable and two downloads of one booking non-identical.
 */
const ICS_DTSTAMP = new Date(NOW).toISOString();

/** A tiny stable hash → non-negative int (unsigned `>>>`, per the documented hash-index gotcha). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/** Honour the SSOT's bounded free-text fields — a longer snapshot must be cut on the way IN. */
function clip(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** An ISO timestamp from an epoch offset against the fixed clock. */
function iso(ms: number): string {
	return new Date(ms).toISOString();
}

/** `17 Jul 2026, 17:20 BST` — a placement stamp in the buyer's zone. */
function stampLabel(ms: number): string {
	return clip(
		new Intl.DateTimeFormat(LOCALE, {
			day: "numeric",
			month: "short",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			timeZone: ZONE,
			timeZoneName: "short",
		}).format(new Date(ms)).replace(",", ""),
		80,
	);
}

/** `1 Aug 2026, 00:00 UTC` — the instant an FX observation was quoted at. */
function utcLabel(isoInstant: string): string {
	const ms = Date.parse(isoInstant);
	if (!Number.isFinite(ms)) return isoInstant.slice(0, 80);
	return clip(
		`${
			new Intl.DateTimeFormat(LOCALE, {
				day: "numeric",
				month: "short",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
				timeZone: "UTC",
			}).format(new Date(ms)).replace(",", "")
		} UTC`,
		80,
	);
}

/** A URL/filename-safe slug from a title. */
function slugify(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
		"file";
}

/**
 * A byte count as a label.
 *
 * Formatted SERVER-side beside the exact `downloadBytes` it describes, so the two can never disagree
 * — the same reason every money figure on this surface arrives pre-formatted.
 */
function byteLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** The buyer-facing reference alphabet — no `0`/`O`/`1`/`I`, so a reference can be read aloud. */
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** `PJ-8QK4-2M7X` — short, unambiguous, and derived from the order id so it is reproducible. */
function referenceFor(orderId: string): string {
	let seed = hash(orderId);
	let out = "";
	for (let i = 0; i < 8; i++) {
		out += REF_ALPHABET[seed % REF_ALPHABET.length];
		seed = (seed / REF_ALPHABET.length) >>> 0;
		if (seed === 0) seed = hash(`${orderId}:${i}`);
	}
	return `PJ-${out.slice(0, 4)}-${out.slice(4)}`;
}
// #endregion

// #region Seller of record
/** The platform entity that raises the document, and the jurisdiction it raises it from. */
const SELLER_NAME = "Projective Technologies Ltd";
const SELLER_REGISTRATION = "GB 428 9016 33";
const SELLER_COUNTRY = "GB";
// #endregion

// #region Conferencing (a SNAPSHOT of what was booked, never a live provider reference)
/** One conferencing provider's display facts and the room shape it mints. */
interface ConferencingSeed {
	slug: string;
	label: string;
	room: (code: string) => string;
}

/**
 * The providers a booked session can resolve to.
 *
 * Conferencing and calendar sync are **two capability axes, not one chip set** (Decision #56): this
 * list is the room a session is joined in; the Google/Outlook/`.ics` exports below are how the
 * booking reaches a calendar. Google appears in both only because it genuinely does both.
 */
const CONFERENCING: Record<string, ConferencingSeed> = {
	zoom: { slug: "zoom", label: "Zoom", room: (code) => `https://zoom.us/j/${code}` },
	google: {
		slug: "google",
		label: "Google Meet",
		room: (code) =>
			`https://meet.google.com/${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7, 10)}`,
	},
	microsoft_teams: {
		slug: "microsoft_teams",
		label: "Microsoft Teams",
		room: (code) => `https://teams.microsoft.com/l/meetup-join/${code}`,
	},
};

/** A deterministic 10-digit room code for a line. */
function roomCode(seedKey: string): string {
	return String(hash(seedKey) % 1_000_000_0000).padStart(10, "0");
}
// #endregion

// #region Line seeds (the immutable snapshot a read derives from)
/**
 * What an order line records about the basket line it was bought from.
 *
 * Deliberately a SNAPSHOT and not a reference: a listing gets delisted, a stage gets renamed and a
 * price moves, and none of that may retroactively change what a receipt says was bought.
 */
interface OrderLineSeed {
	id: string;
	basketItemId: string;
	itemType: PurchasableItemKind;
	itemId: string;
	title: string;
	subtitle: string | null;
	thumbnail: string | null;
	sellerHandle: string | null;
	sellerName: string | null;
	quantity: number;
	lineTotalMinor: number;
	stageId: string | null;
	stageLabel: string | null;
	projectId: string | null;
	serviceId: string | null;
	destinationEmail: string | null;
	licence: string | null;
	format: string | null;
	scheduledAt: string | null;
	scheduledLabel: string | null;
	timezone: string | null;
	seats: number | null;
}

/** Snapshot one purchased basket line. */
function seedFromItem(item: BasketItem): OrderLineSeed {
	const metadata = item.metadata as Record<string, unknown>;
	return {
		id: `ol-${item.id}`,
		basketItemId: item.id,
		itemType: item.itemType,
		itemId: item.itemId,
		title: item.title,
		subtitle: item.subtitle,
		thumbnail: item.thumbnail,
		sellerHandle: item.sellerHandle,
		sellerName: item.sellerName,
		quantity: item.quantity,
		lineTotalMinor: item.lineTotal.minor,
		stageId: item.stageId,
		stageLabel: item.stageLabel,
		projectId: typeof metadata.projectId === "string" ? metadata.projectId : null,
		serviceId: typeof metadata.serviceId === "string" ? metadata.serviceId : null,
		destinationEmail: item.destinationEmail,
		licence: item.licence,
		format: item.format,
		scheduledAt: item.scheduledAt,
		scheduledLabel: item.scheduledLabel,
		timezone: item.timezone,
		seats: item.seats,
	};
}
// #endregion

// #region Fulfilment routing
/**
 * The route a line's KIND naturally fulfils through.
 *
 * Derived from the SSOT's {@link itemKindMeta} `group` rather than from an eleventh `switch` over the
 * ten purchasable kinds — the branching vocabulary lives in the contract exactly once, so a kind
 * added there is routed here without an edit.
 */
function naturalFulfilment(kind: PurchasableItemKind): FulfilmentKind {
	switch (itemKindMeta(kind).group) {
		case "product":
			return "download";
		case "session":
			return "session";
		default:
			return "engagement";
	}
}

/**
 * Narrow an order's lines to the fulfilment routes the simulated mix asks for.
 *
 * A mix that would empty the order falls back to the full set: an order with no lines is not a state
 * a purchase can be in, and rendering one would look like a broken page rather than like an axis
 * doing its job. `pending` is not a filter — it keeps every line and forces the route, which is a
 * genuine state (a ticket bought into a stage that has not opened yet).
 */
function narrowByMix(
	seeds: readonly OrderLineSeed[],
	mix: BasketSim["fulfilment"],
): OrderLineSeed[] {
	const wanted: FulfilmentKind | null = mix === "products"
		? "download"
		: mix === "tickets"
		? "engagement"
		: mix === "sessions"
		? "session"
		: null;
	if (wanted === null) return [...seeds];
	const kept = seeds.filter((seed) => naturalFulfilment(seed.itemType) === wanted);
	return kept.length > 0 ? kept : [...seeds];
}

/**
 * A digital deliverable's file facts.
 *
 * ⚠️ **FLAGGED — there is no byte-serving endpoint yet.** No route on this origin streams a purchased
 * asset (the `/files` hub addresses a folder, and a share link is a capability token the OWNER mints),
 * so the download resolves to the buyer's own library with the asset named — which is where a
 * purchased asset actually lands. It is same-origin by construction: the CSP forbids an external one,
 * and a receipt that linked off-platform for a paid file would be indistinguishable from a phish. The
 * live path replaces this ONE builder with a signed object URL and nothing else changes.
 */
function downloadFacts(
	seed: OrderLineSeed,
): { assetId: string; href: string; name: string; bytes: number; label: string } {
	const assetId = `fa-${seed.itemId}`;
	const wantsPdf = (seed.format ?? "").toLowerCase().includes("pdf");
	const name = clip(`${slugify(seed.title)}${wantsPdf ? ".pdf" : ".zip"}`, 200);
	// 24 MB – 2.4 GB, deterministic per asset, so the label and the byte count are one fact.
	const bytes = 24 * 1024 * 1024 + (hash(assetId) % (2_400 * 1024 * 1024 - 24 * 1024 * 1024));
	return {
		assetId,
		href: `/files?asset=${encodeURIComponent(assetId)}`,
		name,
		bytes,
		label: clip(byteLabel(bytes), 24),
	};
}

/**
 * Where the work now lives — the canonical channel namespace `/projects/[projectId]/[channelId]`
 * (Decision #22).
 *
 * Deliberately NOT the brief's `/projects/[id]/[stageId]`: the second segment is a CHANNEL id in this
 * codebase and that shape 404s. A stage-routed line addresses its stage channel; a line with no stage
 * lands in the engagement's General channel. A purchased SERVICE has no project id in this corpus, so
 * its own id stands in for the engagement — the live path maps the provisioned project instead.
 */
function engagementFacts(seed: OrderLineSeed): { href: string; label: string } | null {
	const project = seed.projectId ?? seed.serviceId;
	if (!project) return null;
	const channel = seed.stageId ?? "general";
	return {
		href: `/projects/${encodeURIComponent(project)}/${encodeURIComponent(channel)}`,
		label: clip(seed.stageLabel ?? "Project workspace", 120),
	};
}

/**
 * How long a booked slot runs, read back off the label the basket already rendered.
 *
 * Parsed rather than re-derived from the kind so the duration cannot disagree with the slot the buyer
 * confirmed — the label is `… · 14:00–15:00`, and the two clock times in it ARE the booking. A label
 * that does not carry a range falls back to an hour, and a range that appears to end before it starts
 * is read as crossing midnight.
 */
function durationOf(label: string | null): number {
	const match = /(\d{2}):(\d{2})\s*[–-]\s*(\d{2}):(\d{2})/.exec(label ?? "");
	if (!match) return 60;
	const start = Number(match[1]) * 60 + Number(match[2]);
	const end = Number(match[3]) * 60 + Number(match[4]);
	const minutes = end > start ? end - start : end + 24 * 60 - start;
	return minutes > 0 && minutes <= 1440 ? minutes : 60;
}

/** The conferencing snapshot for a booked line, honouring the simulated provider axis. */
function conferencingFor(
	seed: OrderLineSeed,
	sim: BasketSim | undefined,
): { provider: string | null; label: string | null; joinUrl: string | null } {
	const choice = sim?.conferencing ?? "zoom";
	if (choice === "none") {
		// A real state, not an omission: a room is minted by the provider, and until one exists the
		// honest answer is that there is nothing to join yet.
		return { provider: null, label: null, joinUrl: null };
	}
	const provider = CONFERENCING[choice] ?? CONFERENCING.zoom;
	return {
		provider: provider.slug,
		label: provider.label,
		joinUrl: clip(provider.room(roomCode(`${seed.id}:${provider.slug}`)), 600),
	};
}

/** The same-origin `.ics` path for one line of one order. */
function icsPathFor(orderId: string, lineId: string): string {
	return clip(
		`/api/checkout/calendar?order=${encodeURIComponent(orderId)}&line=${
			encodeURIComponent(lineId)
		}`,
		600,
	);
}

/** The calendar entry a booked line describes — the input both the links and the `.ics` are built from. */
function calendarEventFor(
	seed: OrderLineSeed,
	joinUrl: string | null,
): {
	title: string;
	startIso: string;
	durationMinutes: number;
	description: string;
	location: string;
	uid: string;
} | null {
	if (!seed.scheduledAt) return null;
	const seller = seed.sellerName ? ` with ${seed.sellerName}` : "";
	return {
		title: clip(seed.title, 160),
		startIso: seed.scheduledAt,
		durationMinutes: durationOf(seed.scheduledLabel),
		description: `Booked through Projective${seller}.`,
		location: joinUrl ?? "Projective",
		uid: `${seed.id}@projective`,
	};
}

/** The three calendar exports for a booked line; `null` for a line with no slot. */
function calendarFor(
	seed: OrderLineSeed,
	orderId: string,
	joinUrl: string | null,
): CalendarLinks | null {
	const event = calendarEventFor(seed, joinUrl);
	return event ? calendarLinksFor(event, icsPathFor(orderId, seed.id)) : null;
}
// #endregion

// #region Line projection
/** Project one seed into the SSOT's {@link OrderLine} under the read's simulation. */
function toLine(
	seed: OrderLineSeed,
	order: StoredOrder,
	sim: BasketSim | undefined,
	forcePending: boolean,
): OrderLine {
	const money = (minor: number) => fx.money(minor, order.currency);
	const natural = naturalFulfilment(seed.itemType);
	const download = natural === "download" ? downloadFacts(seed) : null;
	const engagement = natural === "engagement" ? engagementFacts(seed) : null;
	const booked = natural === "session" && seed.scheduledAt !== null;
	const conferencing = booked ? conferencingFor(seed, sim) : null;

	const draft: OrderLine = {
		id: seed.id,
		basketItemId: seed.basketItemId,
		itemType: seed.itemType,
		itemId: seed.itemId,
		title: clip(seed.title, 200),
		subtitle: seed.subtitle ? clip(seed.subtitle, 200) : null,
		thumbnail: seed.thumbnail,
		sellerHandle: seed.sellerHandle,
		sellerName: seed.sellerName,
		quantity: seed.quantity,
		lineTotal: money(seed.lineTotalMinor),
		fulfilment: forcePending ? "pending" : natural,
		pendingNote: null,

		assetId: !forcePending && download ? download.assetId : null,
		downloadHref: !forcePending && download ? download.href : null,
		downloadName: !forcePending && download ? download.name : null,
		downloadBytes: !forcePending && download ? download.bytes : null,
		downloadSizeLabel: !forcePending && download ? download.label : null,
		downloadFormat: seed.format,
		licence: seed.licence,

		engagementHref: !forcePending && engagement ? engagement.href : null,
		engagementLabel: !forcePending && engagement ? engagement.label : null,

		scheduledAt: !forcePending && booked ? seed.scheduledAt : null,
		scheduledLabel: !forcePending && booked ? seed.scheduledLabel : null,
		timezone: !forcePending && booked ? seed.timezone : null,
		durationMinutes: !forcePending && booked ? durationOf(seed.scheduledLabel) : null,
		conferencingProvider: conferencing && !forcePending ? conferencing.provider : null,
		conferencingLabel: conferencing && !forcePending ? conferencing.label : null,
		joinUrl: conferencing && !forcePending ? conferencing.joinUrl : null,
		calendar: !forcePending && booked
			? calendarFor(seed, order.id, conferencing?.joinUrl ?? null)
			: null,
		seats: seed.seats,
	};

	// The claimed route and the facts that back it are reconciled ONCE, by the SSOT's own
	// `fulfilmentKindOf` reading the projection above — a line claiming `download` with no href, or
	// `session` with no slot, resolves to `pending`, so the hub can never render an action that 404s.
	const resolved: FulfilmentKind = fulfilmentKindOf(draft);
	return {
		...draft,
		fulfilment: resolved,
		pendingNote: resolved === "pending" ? pendingNoteFor(seed) : null,
	};
}

/** Why a line has nothing to open yet, in the buyer's own terms. */
function pendingNoteFor(seed: OrderLineSeed): string {
	const natural = naturalFulfilment(seed.itemType);
	if (natural === "session") return clip("We'll confirm the time with the seller shortly.", 200);
	if (natural === "download") return clip("Your files are being prepared — we'll email you.", 200);
	return clip(
		seed.stageLabel
			? `Starts when ${seed.stageLabel} opens.`
			: "Starts once the seller opens the workspace.",
		200,
	);
}
// #endregion

// #region Tax + FX (carried, never derived)
/**
 * How tax was treated on an order.
 *
 * ⚠️ **No tax is ADDED anywhere on this platform today** — `checkoutTotals` takes `taxMinor` as an
 * INPUT precisely because this package has no jurisdiction, no nexus rules and no rate table, and the
 * checkout passes none. So this breakdown describes the treatment of the price that was actually
 * charged; it never restates the total, and `totals.taxes` stays the zero the buyer was shown.
 *
 * Two treatments are expressible, and both are statements a real invoice has to make:
 *
 *  - **Reverse charge** — a VAT-registered business billing from outside the seller's country
 *    accounts for the VAT itself. The seller charges none, and the note is a legal requirement rather
 *    than a courtesy, which is why it is carried rather than composed at the surface.
 *  - **UK VAT 20%, included** — a domestic buyer's price is inclusive, so the document shows the VAT
 *    contained WITHIN the charge rather than a figure added on top of it. Adding it on top would make
 *    the invoice disagree with the amount taken.
 *
 * Everything else resolves to a zero-rated "no VAT charged" line rather than a guessed rate. A
 * fabricated rate on a legal document is worse than an absent one.
 */
function taxFor(
	buyer: BuyerDetails,
	kind: BillingContext["kind"],
	totalMinor: number,
	display: string,
): TaxBreakdown {
	const money = (minor: number) => fx.money(minor, display);
	const business = kind === "business";
	const country = (business ? buyer.business.address.country : buyer.personal.address.country)
		.trim().toUpperCase();
	const taxId = business ? buyer.business.taxId.trim() : "";

	if (business && taxId && country && country !== SELLER_COUNTRY) {
		return {
			label: clip("Reverse charge · VAT accounted for by the recipient", 160),
			rateBp: 0,
			taxable: money(totalMinor),
			tax: money(0),
			reverseCharge: true,
			reverseChargeNote: clip(
				"VAT to be accounted for by the recipient under the reverse-charge procedure (Article 196, Council Directive 2006/112/EC).",
				240,
			),
			buyerTaxId: clip(taxId, 60),
		};
	}

	if (country === SELLER_COUNTRY) {
		// Inclusive: the VAT contained within what was charged, at 20%. `Math.round` once, at the end.
		const taxable = Math.round(totalMinor / 1.2);
		return {
			label: clip("VAT 20% · United Kingdom (included in the total)", 160),
			rateBp: 2000,
			taxable: money(taxable),
			tax: money(totalMinor - taxable),
			reverseCharge: false,
			reverseChargeNote: null,
			buyerTaxId: taxId ? clip(taxId, 60) : null,
		};
	}

	return {
		label: clip("No VAT charged", 160),
		rateBp: 0,
		taxable: money(totalMinor),
		tax: money(0),
		reverseCharge: false,
		reverseChargeNote: null,
		buyerTaxId: taxId ? clip(taxId, 60) : null,
	};
}

/**
 * The conversion the invoice documents, or `null` for a same-currency charge.
 *
 * **The rate is read off the money that was actually converted**, not resolved again. Every basket
 * price is projected through `basket-fixtures`' `toMoney`, which attaches the origin amount AND the
 * exact multiplier it applied to the resulting `MoneyView`; reprinting that is the only way the
 * printed rate and the charged figure cannot disagree. Re-resolving through {@link FxService} would
 * be a second table (and an async one, which a synchronous SSR resolver cannot await) — and a rate
 * that differs from the one applied is the single FX failure a reader has no way to detect.
 *
 * The snapshot's base and instant come from the seeded observation table `FxService` itself answers
 * from, so the document names the same reference data the platform priced against.
 */
function invoiceFxFor(order: StoredOrder): InvoiceFx | null {
	if (order.fxOriginCurrency === null || order.fxRate === null) return null;
	const rate = Math.round(order.fxRate * 10_000) / 10_000;
	return {
		fxRate: rate,
		fxBase: FX_FIXTURE_BASE,
		fxAsOf: FX_FIXTURE_AS_OF,
		originCurrency: order.fxOriginCurrency,
		chargedCurrency: order.currency,
		rateLabel: clip(`1 ${order.fxOriginCurrency} = ${rate} ${order.currency}`, 80),
		asOfLabel: utcLabel(FX_FIXTURE_AS_OF),
	};
}
// #endregion

// #region Invoice
/** `INV-2026-0814` — reproducible from the order id, so a reload never renumbers a document. */
function invoiceNumber(order: StoredOrder): string {
	const year = new Date(order.placedAtMs).getUTCFullYear();
	return `INV-${year}-${String(hash(order.id) % 10_000).padStart(4, "0")}`;
}

/** The invoice document's projection — everything the PDF prints, resolved server-side. */
function invoiceFor(order: StoredOrder): OrderInvoice {
	const buyer = order.buyer;
	const kind = order.billedToKind;
	const business = kind === "business";
	const name = business ? (buyer.business.companyName || order.ownerName) : (buyer.personal.name ||
		`${buyer.delivery.firstName} ${buyer.delivery.lastName}`.trim() || order.ownerName);
	return {
		number: invoiceNumber(order),
		issuedAt: iso(order.placedAtMs),
		// No renderer is wired, so no document is claimed to exist. A link to a PDF that 404s is worse
		// than an honest "not ready yet".
		pdfHref: null,
		billedToName: clip(name, 160),
		billedToKind: kind,
		billedToAddress: business ? buyer.business.address : buyer.personal.address,
		billedToRegistration: business && buyer.business.registrationNumber
			? clip(buyer.business.registrationNumber, 60)
			: null,
		issuedByName: SELLER_NAME,
		issuedByRegistration: SELLER_REGISTRATION,
		totals: order.totals,
		tax: taxFor(buyer, kind, order.totals.total.minor, order.currency),
		fx: invoiceFxFor(order),
		paymentSummary: clip(order.paymentMethodLabel, 120),
	};
}
// #endregion

// #region Store
/** An order as the store holds it: the charge, and the snapshot the lines are derived from. */
interface StoredOrder {
	id: string;
	ownerKey: string;
	ownerType: Order["ownerType"];
	ownerId: string;
	ownerName: string;
	basketId: string | null;
	placedAtMs: number;
	/** The status the CHARGE produced; the read narrows it when lines are still pending. */
	status: OrderStatus;
	currency: string;
	totals: CheckoutTotals;
	charged: MoneyView;
	processingContribution: MoneyView;
	paymentMethodLabel: string;
	message: string;
	seeds: OrderLineSeed[];
	buyer: BuyerDetails;
	billedToKind: BillingContext["kind"];
	/** The currency the goods were PRICED in, when it differs from the charge; else `null`. */
	fxOriginCurrency: string | null;
	/** The multiplier actually applied to reach {@link currency}; else `null`. */
	fxRate: number | null;
}

const ORDERS = new Map<string, StoredOrder>();
/** Order ids per owner scope, newest first. */
const ORDERS_BY_OWNER = new Map<string, string[]>();
/** Owner scopes whose seeded historical order has already been built. */
const SEEDED = new Set<string>();

/** Push an order to the front of its owner's list. */
function index(order: StoredOrder): void {
	ORDERS.set(order.id, order);
	ORDERS_BY_OWNER.set(order.ownerKey, [order.id, ...(ORDERS_BY_OWNER.get(order.ownerKey) ?? [])]);
}

/**
 * The FX snapshot a set of purchased lines was priced through.
 *
 * Read off the first line that carries an origin — every price in one basket is converted through one
 * table in one pass, so any one of them names the conversion the whole order was charged under.
 */
function fxSnapshotOf(
	items: readonly BasketItem[],
): { currency: string | null; rate: number | null } {
	for (const item of items) {
		const origin = item.unitPrice.origin;
		if (origin) return { currency: origin.currency.toUpperCase(), rate: origin.fxRate };
	}
	return { currency: null, rate: null };
}

/** The instrument label an order records — what the buyer will recognise on their statement. */
function paymentLabelFor(owner: fx.ResolvedOwner, provider: string, cardId: string | null): string {
	if (provider === "wallet") return "Projective wallet";
	if (provider === "invoice") return "Monthly invoice";
	if (provider === "paypal") return "PayPal";
	if (provider === "google_pay") return "Google Pay";
	if (provider === "apple_pay") return "Apple Pay";
	const card = cardId
		? listCards(owner).find((c) => c.id === cardId)
		: listCards(owner).find((c) => c.id === defaultCardId(owner));
	if (!card) return "Card";
	const brand = card.brand.replace(/_/g, " ");
	const label = brand.charAt(0).toUpperCase() + brand.slice(1);
	return clip(card.last4 ? `${label} •••• ${card.last4}` : label, 120);
}

/**
 * Seed the owner's ONE historical order, so `/checkout/confirmation` is reachable — and every
 * fulfilment route on it exercisable — without first completing a payment.
 *
 * It is snapshotted from the account's default basket at first read, which is what keeps it coherent
 * with the rest of the corpus: the same lines, the same titles, the same sellers and the same prices
 * the basket shows, so a developer comparing the two never sees two answers. It is built LAZILY (not
 * at module init) because it reads the basket store, which seeds itself lazily too.
 */
function seedHistoricalOrder(owner: fx.ResolvedOwner, buyer: BuyerDetails): void {
	if (SEEDED.has(owner.key)) return;
	SEEDED.add(owner.key);

	const basket = fx.basketFor(owner);
	const items = basket.items.filter((item) => !item.savedForLater && item.available);
	if (items.length === 0) return;

	const id = `or-${owner.key.replace(/[^a-z0-9]+/gi, "-")}-seed`;
	const totals = totalsFor(items, owner.display);
	const snapshot = fxSnapshotOf(items);
	index({
		id,
		ownerKey: owner.key,
		ownerType: owner.ownerType,
		ownerId: owner.ownerId,
		ownerName: owner.name,
		basketId: basket.id,
		placedAtMs: NOW - 3 * DAY,
		status: "confirmed",
		currency: owner.display,
		totals,
		charged: totals.total,
		processingContribution: fx.money(0, owner.display),
		paymentMethodLabel: paymentLabelFor(owner, "card", null),
		message: `Paid ${totals.total.display}.`,
		seeds: items.map(seedFromItem),
		buyer,
		billedToKind: buyer.contextKind,
		fxOriginCurrency: snapshot.currency,
		fxRate: snapshot.rate,
	});
}

/**
 * The totals for the SEEDED historical order only.
 *
 * A RECORDED order is handed the charge's own totals verbatim ({@link RecordOrderInput.totals}) and
 * never passes through here — a receipt reprints what was charged, it does not recompute it. This
 * exists solely so the seeded demo order has a coherent set, and it runs the SSOT's single arithmetic
 * path (`checkoutTotals` → `basketSubtotal` → `applyDiscounts` → `platformFeeFor`) rather than adding
 * a second one. Tax is deliberately absent — see {@link taxFor}.
 */
function totalsFor(items: readonly BasketItem[], display: string): CheckoutTotals {
	const money = (minor: number) => fx.money(minor, display);
	const t = checkoutTotals({ items });
	return {
		subtotal: money(t.subtotalMinor),
		creatorDiscounts: money(t.creatorDiscountMinor),
		promoDiscount: money(t.promoDiscountMinor),
		net: money(t.netMinor),
		platformFee: money(t.platformFeeMinor),
		platformFeeBp: t.platformFeeBp,
		platformFeeMode: t.feeMode,
		taxes: money(t.taxMinor),
		taxNote: null,
		processingContribution: money(t.processingContributionMinor),
		total: money(t.totalMinor),
	};
}
// #endregion

// #region Public reads + writes
/** What a recorded order needs from the charge that produced it. */
export interface RecordOrderInput {
	owner: fx.ResolvedOwner;
	/** The basket the charge was raised from. */
	basketId: string;
	/** The lines actually paid for. */
	items: readonly BasketItem[];
	/** The charge's own totals — never recomputed here, so the receipt reprints what was charged. */
	totals: CheckoutTotals;
	/** The outcome status the provider produced. */
	status: "succeeded" | "requires_action" | "pending";
	/** The outcome sentence, reprinted on the hub. */
	message: string;
	provider: string;
	cardId: string | null;
	/** The client-minted attempt key — the order id derives from it, so a replay names one order. */
	idempotencyKey: string;
	buyer: BuyerDetails;
	/** Which billing identity the buyer chose to invoice. */
	billedToKind: BillingContext["kind"];
}

/**
 * Record the order a charge produced, and return its id.
 *
 * **Every non-failed outcome produces an order**, not only a settled one: `requires_action` and
 * `invoiced` are real order states in the SSOT, and a buyer bounced to PayPal or billed on a monthly
 * statement still needs something to come back to. A refusal records nothing — there is no order.
 *
 * The id derives from the attempt's `idempotencyKey`, so a replayed submit resolves the SAME order
 * rather than minting a second one for one payment.
 */
export function recordOrder(input: RecordOrderInput): string {
	const id = `or-${hash(input.idempotencyKey) >>> 0}`;
	const existing = ORDERS.get(id);
	if (existing) return existing.id;

	const display = input.owner.display;
	const snapshot = fxSnapshotOf(input.items);
	const status: OrderStatus = input.status === "requires_action"
		? "awaiting_payment"
		: input.status === "pending"
		? "invoiced"
		: "confirmed";

	index({
		id,
		ownerKey: input.owner.key,
		ownerType: input.owner.ownerType,
		ownerId: input.owner.ownerId,
		ownerName: input.owner.name,
		basketId: input.basketId,
		placedAtMs: fx.referenceNow(),
		status,
		currency: display,
		totals: input.totals,
		// An order that has not settled has taken nothing: `charged` is what MOVED, and reporting the
		// total there would tell a buyer awaiting a PayPal approval that they had already paid.
		charged: status === "confirmed" ? input.totals.total : fx.money(0, display),
		processingContribution: input.totals.processingContribution,
		paymentMethodLabel: paymentLabelFor(input.owner, input.provider, input.cardId),
		message: clip(input.message, 200),
		seeds: input.items.map(seedFromItem),
		buyer: input.buyer,
		billedToKind: input.billedToKind,
		fxOriginCurrency: snapshot.currency,
		fxRate: snapshot.rate,
	});
	return id;
}

/** A resolved order read: which order, for whom, under which simulation. */
export interface OrderFixtureQuery extends BasketQuery {
	/** The order to read; `null`/absent resolves the account's most recent. */
	orderId?: string | null;
}

/**
 * The confirmation hub's whole read: the resolved order and the buyer's other recent ones.
 *
 * Resolution order is the named order, then the account's most recent — and an order belonging to a
 * DIFFERENT owner scope is not returned even when its id is named, because an order id in a URL is a
 * guess anyone can make and a receipt names an address, a company and a card fragment.
 */
export function orderFor(
	owner: fx.ResolvedOwner,
	buyer: BuyerDetails,
	query: OrderFixtureQuery,
): OrderPage | null {
	seedHistoricalOrder(owner, buyer);
	const ids = ORDERS_BY_OWNER.get(owner.key) ?? [];
	const wanted = query.orderId ? ORDERS.get(query.orderId) ?? null : null;
	const stored = wanted && wanted.ownerKey === owner.key
		? wanted
		: ids.length > 0
		? ORDERS.get(ids[0]) ?? null
		: null;
	if (!stored) return null;

	const sim = query.sim;
	const forcePending = sim?.fulfilment === "pending";
	const seeds = narrowByMix(stored.seeds, sim?.fulfilment);
	const lines = seeds.map((seed) => toLine(seed, stored, sim, forcePending));
	const pendingCount = lines.filter((line) => line.fulfilment === "pending").length;

	const order: Order = {
		id: stored.id,
		reference: referenceFor(stored.id),
		// Money has moved and some of it is not yet fulfilled — that is `processing`, not `confirmed`.
		// The distinction is the whole reason the two statuses exist: "paid" must never come to mean
		// "delivered".
		status: stored.status === "confirmed" && pendingCount > 0 ? "processing" : stored.status,
		placedAt: iso(stored.placedAtMs),
		placedAtLabel: stampLabel(stored.placedAtMs),
		ownerType: stored.ownerType,
		ownerId: stored.ownerId,
		ownerName: clip(stored.ownerName, 120),
		basketId: stored.basketId,
		currency: stored.currency,
		lines,
		totals: stored.totals,
		invoice: invoiceFor(stored),
		paymentMethodLabel: clip(stored.paymentMethodLabel, 120),
		charged: stored.charged,
		processingContribution: stored.processingContribution,
		pendingCount,
		message: clip(stored.message, 200),
	};

	return {
		order,
		recent: ids
			.filter((id) => id !== stored.id)
			.map((id) => ORDERS.get(id))
			.filter((row): row is StoredOrder => row !== undefined)
			.slice(0, 20)
			.map((row) => ({
				id: row.id,
				reference: referenceFor(row.id),
				placedAtLabel: stampLabel(row.placedAtMs),
				total: row.totals.total,
				status: row.status,
			})),
	};
}

/**
 * The `.ics` document for one booked line, and the filename it downloads as.
 *
 * Built by the SSOT's {@link buildIcsCalendar} — there is no second iCalendar writer, and the RFC 5545
 * escape order and line folding are already handled there. `null` when the order, the line, or the
 * booking does not exist: a calendar entry for a session that was never scheduled would be an
 * invitation to a time nobody agreed.
 */
export function icsFor(
	owner: fx.ResolvedOwner,
	buyer: BuyerDetails,
	orderId: string,
	lineId: string,
	query: OrderFixtureQuery,
): { filename: string; body: string } | null {
	const page = orderFor(owner, buyer, { ...query, orderId });
	if (!page) return null;
	const line = page.order.lines.find((row) => row.id === lineId);
	if (!line || !line.scheduledAt) return null;

	const stored = ORDERS.get(page.order.id);
	const seed = stored?.seeds.find((row) => row.id === lineId);
	if (!seed) return null;

	const event = calendarEventFor(seed, line.joinUrl);
	if (!event) return null;

	return {
		filename: `projective-${slugify(page.order.reference)}-${slugify(line.title)}.ics`,
		body: buildIcsCalendar(event, ICS_DTSTAMP),
	};
}

/** Test seam: forget every recorded and seeded order, so a fixture reset is reproducible. */
export function resetOrders(): void {
	ORDERS.clear();
	ORDERS_BY_OWNER.clear();
	SEEDED.clear();
}
// #endregion
