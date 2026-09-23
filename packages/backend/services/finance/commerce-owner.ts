import type { KycStatus, PurchaseOwnerType } from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { FxService } from "./FxService.ts";
import type { MoneyProjector } from "./commerce-money.ts";
import type { BasketQuery } from "./basket-query.ts";

/**
 * commerce-owner — WHOSE money a basket, a saved card or a checkout spends, and what the platform
 * knows about that principal.
 *
 * Every commerce read and write starts here. A basket belongs to a person, a team, a business or an
 * organisation; the request names which through its `owner` param (`personal` · `team:{id}` ·
 * `business:{id}` · `organisation:{id}`, defaulted from the acting context), and this module turns
 * that into a {@link ResolvedOwner} by asking the DATABASE — `finance.get_purchase_owner`, a
 * member-gated definer read (00001210 §8). The application never decides membership itself:
 * `actingIsMember` is `finance.fn_can_manage_basket`, the same predicate the basket's RLS policies
 * are made of, so the surface and the database cannot disagree about who may spend.
 *
 * **A personal basket is `owner_type = 'user'`** whichever side of the market the person is on. The
 * two personal owner types exist for WALLETS (a seller's earnings land in a `freelancer` wallet), not
 * for purchases; one person has one basket. Reads accept either type so a row written the other way
 * is still found.
 *
 * **Nothing here authorises.** The owner param is a request field and the context behind it is an
 * unverified JWT decode; both only decide which question is asked. Every row the answer is built from
 * is read with the caller's own token, so a forged param can at most address an account whose
 * figures the signed token still cannot read.
 */

// #region Types
/** The billable identity of an entity, as its members may see it. */
export interface PurchaseBilling {
	legalName: string | null;
	registrationNumber: string | null;
	taxId: string | null;
	email: string | null;
	phone: string | null;
	addressLine1: string | null;
	addressCity: string | null;
	addressPostcode: string | null;
	addressCountry: string | null;
}

/** The person behind a personal basket, as they may see themselves. */
export interface PurchasePerson {
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	city: string | null;
	country: string | null;
}

/** The finance identity a basket or checkout read is scoped to. */
export interface ResolvedOwner {
	/** The canonical scope key (`personal` · `team:{id}` · `business:{id}` · `organisation:{id}`). */
	key: string;
	ownerType: PurchaseOwnerType;
	ownerId: string;
	name: string;
	handle: string | null;
	avatar: string | null;
	/** Whether the caller may SPEND this account's money (`finance.fn_can_manage_basket`). */
	actingIsMember: boolean;
	/** Whether the caller may SEE this account's finances (`finance.fn_owner_visible`). */
	isMember: boolean;
	/** KYB state of a spending business or organisation; `null` for a person or a team. */
	kybStatus: KycStatus | null;
	/** Verification tier — Level 3 is Business/KYB (`PRODUCT_SPEC` §Identity). */
	verificationTier: number | null;
	/** The resolved display currency for every figure in this read. */
	display: string;
	/** Whether this owner's money belongs to an entity rather than to the acting individual. */
	isEntity: boolean;
	/** The account's own invoicing terms (`org.business_profiles.invoicing_mode` / `billing_day`). */
	invoicingMode: "per_transaction" | "intervaled_monthly" | null;
	billingDay: number | null;
	/** The entity's billable identity — members only. */
	billing: PurchaseBilling | null;
	/** The person behind a personal basket. */
	person: PurchasePerson | null;
	/** The spend departments an organisation declares. */
	departments: string[];
}

/** The raw object `finance.get_purchase_owner` / `list_purchase_owners` return. */
interface OwnerJson {
	owner_type: string;
	owner_id: string;
	name: string | null;
	handle: string | null;
	avatar_bucket: string | null;
	avatar_path: string | null;
	is_member: boolean;
	can_spend: boolean;
	kyb_status: string | null;
	currency: string | null;
	invoicing_mode: string | null;
	billing_day: number | null;
	billing: Record<string, string | null> | null;
	person: Record<string, string | null> | null;
	departments: string[] | null;
}
// #endregion

// #region Owner param
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owner a request names, before anything has been checked. */
export type OwnerRequest =
	| { scope: "personal" }
	| { scope: "team" | "business" | "organisation"; id: string };

/**
 * Parse an `owner` param. Anything that is not a well-formed entity key — `personal`, `user`,
 * `freelancer`, a missing id, a non-uuid id — is the personal scope, the one every signed-in caller
 * has.
 */
export function parseOwnerParam(raw: string | null | undefined): OwnerRequest {
	if (!raw) return { scope: "personal" };
	const at = raw.indexOf(":");
	const scope = at === -1 ? raw : raw.slice(0, at);
	const id = at === -1 ? "" : raw.slice(at + 1);
	if (
		(scope === "team" || scope === "business" || scope === "organisation") && UUID_RE.test(id)
	) {
		return { scope, id: id.toLowerCase() };
	}
	return { scope: "personal" };
}

/** The canonical key of a resolved scope. */
function keyOf(ownerType: PurchaseOwnerType, ownerId: string): string {
	return ownerType === "user" || ownerType === "freelancer" ? "personal" : `${ownerType}:${ownerId}`;
}
// #endregion

// #region Mapping
function asOwnerType(value: string): PurchaseOwnerType | null {
	switch (value) {
		case "user":
		case "freelancer":
			return "user";
		case "team":
		case "business":
		case "organisation":
			return value;
		default:
			return null;
	}
}

function asKyc(value: string | null): KycStatus | null {
	switch (value) {
		case "unverified":
		case "pending":
		case "verified":
		case "rejected":
		case "expired":
			return value;
		default:
			return null;
	}
}

function billingOf(raw: Record<string, string | null> | null): PurchaseBilling | null {
	if (!raw) return null;
	return {
		legalName: raw.legal_name ?? null,
		registrationNumber: raw.registration_number ?? null,
		taxId: raw.tax_id ?? null,
		email: raw.email ?? null,
		phone: raw.phone ?? null,
		addressLine1: raw.address_line_1 ?? null,
		addressCity: raw.address_city ?? null,
		addressPostcode: raw.address_postcode ?? null,
		addressCountry: raw.address_country ?? null,
	};
}

function personOf(raw: Record<string, string | null> | null): PurchasePerson | null {
	if (!raw) return null;
	return {
		firstName: raw.first_name ?? null,
		lastName: raw.last_name ?? null,
		email: raw.email ?? null,
		city: raw.city ?? null,
		country: raw.country ?? null,
	};
}

/**
 * Project the database's owner object. `display` is resolved by the caller, because it depends on
 * the request (an explicit `?display=`) as well as on the owner.
 */
function toOwner(json: OwnerJson, display: string): ResolvedOwner | null {
	const ownerType = asOwnerType(json.owner_type);
	if (!ownerType) return null;
	const isEntity = ownerType !== "user" && ownerType !== "freelancer";
	const kybStatus = isEntity && ownerType !== "team" ? asKyc(json.kyb_status) : null;
	const mode = json.invoicing_mode === "intervaled_monthly"
		? "intervaled_monthly"
		: json.invoicing_mode === "per_transaction"
		? "per_transaction"
		: null;
	return {
		key: keyOf(ownerType, json.owner_id),
		ownerType,
		ownerId: json.owner_id,
		name: (json.name ?? "").trim() || (json.handle ?? "Your account"),
		handle: json.handle,
		avatar: publicObjectUrl(json.avatar_bucket, json.avatar_path),
		actingIsMember: json.can_spend === true,
		isMember: json.is_member === true,
		kybStatus,
		// Level 3 is what the SSOT's invoicing gate asks for; a pending review is Level 2.
		verificationTier: kybStatus === "verified" ? 3 : kybStatus === "pending" ? 2 : null,
		display,
		isEntity,
		invoicingMode: mode,
		billingDay: typeof json.billing_day === "number" ? json.billing_day : null,
		billing: billingOf(json.billing),
		person: personOf(json.person),
		departments: Array.isArray(json.departments)
			? json.departments.filter((d): d is string => typeof d === "string")
			: [],
	};
}

/**
 * The display currency for a read: an explicit `?display=` first, then the account's own currency,
 * then the viewer's preference — each narrowed to a currency the FX engine can actually price.
 */
function displayFor(query: BasketQuery, ownerCurrency: string | null): string {
	return FxService.supportedCurrency(
		query.display || ownerCurrency || query.viewerCurrency || null,
	);
}
// #endregion

// #region Resolution
/**
 * Resolve the owner a request spends from.
 *
 * `null` when the caller cannot be identified at all (a guest, or an expired token) — every commerce
 * surface is a signed-in surface, and answering a guest with somebody's basket is not a degraded
 * answer, it is a wrong one. An entity id the database knows nothing about (or an organisation the
 * caller does not belong to) resolves to the caller's PERSONAL scope, the one account every caller
 * has; a known entity the caller cannot spend from resolves normally with `actingIsMember: false`, so
 * the surface can say why the account is closed to them rather than silently switching accounts.
 */
export async function resolveOwner(
	query: BasketQuery,
	actor: ReadActor,
): Promise<ResolvedOwner | null> {
	if (!canReadLive(actor)) return null;
	const db = getUserClient(actor.accessToken).schema("finance");
	const requested = parseOwnerParam(query.owner);

	const ask = async (ownerType: string, ownerId: string): Promise<OwnerJson | null> => {
		const { data, error } = await db.rpc("get_purchase_owner", {
			p_owner_type: ownerType,
			p_owner_id: ownerId,
		});
		if (error) throw new Error(`finance.get_purchase_owner failed: ${error.message}`);
		return (data as OwnerJson | null) ?? null;
	};

	const json = requested.scope === "personal"
		? await ask("user", actor.userId)
		: (await ask(requested.scope, requested.id)) ?? (await ask("user", actor.userId));
	if (!json) return null;
	return toOwner(json, displayFor(query, json.currency));
}

/**
 * Every identity the caller may buy or bill as — themselves first, then each team, business and
 * organisation they own or actively belong to. The Details step's billing-identity switcher.
 */
export async function listOwners(query: BasketQuery, actor: ReadActor): Promise<ResolvedOwner[]> {
	if (!canReadLive(actor)) return [];
	const { data, error } = await getUserClient(actor.accessToken).schema("finance").rpc(
		"list_purchase_owners",
	);
	if (error) throw new Error(`finance.list_purchase_owners failed: ${error.message}`);
	const rows = Array.isArray(data) ? (data as OwnerJson[]) : [];
	return rows
		.map((row) => toOwner(row, displayFor(query, row.currency)))
		.filter((owner): owner is ResolvedOwner => owner !== null);
}
// #endregion

// #region Wallet
/**
 * The account's spendable Projective balance in the read's display currency, in minor units.
 *
 * `finance.wallets.balance_cents` is the AVAILABLE balance (the ledger is materialised single-entry:
 * escrow holds debit it, and releases credit it — see `documentation/database/finance/Tables.md`). An
 * account may hold one wallet per currency, and each is converted at the SAME table the rest of the
 * checkout is priced against before they are counted together. A wallet whose currency cannot be
 * converted is left out rather than added at an assumed rate, and an account with no wallet reads
 * zero — the SSOT's provider rules then refuse the wallet route with their own shortfall wording.
 *
 * Read with the caller's token (`View visible wallets`), so a non-member reads zero.
 */
export async function walletAvailableMinor(
	owner: ResolvedOwner,
	money: MoneyProjector,
	actor: ReadActor,
): Promise<number> {
	if (!canReadLive(actor)) return 0;
	const types = owner.isEntity ? [owner.ownerType] : ["user", "freelancer"];
	const { data, error } = await getUserClient(actor.accessToken).schema("finance")
		.from("wallets")
		.select("currency, balance_cents")
		.eq("owner_id", owner.ownerId)
		.in("owner_type", types);
	if (error) throw new Error(`finance.wallets read failed: ${error.message}`);
	let total = 0;
	for (const row of (data ?? []) as { currency: string; balance_cents: number | string }[]) {
		if (!money.canConvert(row.currency)) continue;
		total += money.convertMinor(Number(row.balance_cents) || 0, row.currency);
	}
	return total;
}
// #endregion
