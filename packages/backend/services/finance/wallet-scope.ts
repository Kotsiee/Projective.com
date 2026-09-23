import type {
	KycStatus,
	MoneyView,
	VaultCapability,
	VaultRole,
	WalletQuery,
	WalletRef,
	WalletScope,
} from "@projective/types/finance";
import { capabilitiesForRole } from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { type MoneyProjector, moneyProjector } from "./commerce-money.ts";
import { listOwners, type ResolvedOwner } from "./commerce-owner.ts";
import { FxService } from "./FxService.ts";

/**
 * wallet-scope — WHICH wallet a `/wallet` read or movement is about, and what the viewer may do there.
 *
 * A viewer's wallets are their personal wallet plus the vault of every team, business and
 * organisation they belong to. Membership, names and faces come from `finance.list_purchase_owners`
 * (the same member-gated door the checkout uses); the wallet ROWS are read with the viewer's own token
 * (`View visible wallets`), and so are their vault permissions — so the set of wallets this module can
 * name is exactly the set the database will let the viewer see, and nothing here decides membership.
 *
 * **Capabilities are the database's.** A vault capability comes from the viewer's
 * `finance.vault_permissions` row (`manage_members` implies every capability, as
 * `fn_has_vault_capability` reads it); the coarse role the surface shows is derived FROM those
 * capabilities, never the other way round. A personal wallet is the viewer's own money and carries
 * every capability.
 */

// #region Types
/** A `finance.wallets` row, as the wallet surface reads it. */
export interface WalletRow {
	id: string;
	owner_type: string;
	owner_id: string;
	currency: string;
	balance_cents: number;
	approval_threshold_cents: number | null;
}

/** One wallet the viewer can see: its owner, its rows (one per currency) and the viewer's rights. */
export interface WalletAccount {
	scope: Exclude<WalletScope, "aggregate">;
	/** `""` for the personal wallet, else the entity id. */
	id: string;
	/** The `wallet` param that addresses it (`personal` · `team:{id}` · …). */
	key: string;
	owner: ResolvedOwner;
	rows: WalletRow[];
	/** The viewer's coarse role; `null` on their personal wallet. */
	role: VaultRole | null;
	capabilities: VaultCapability[];
}

/** The viewer as the finance surface needs them. */
export interface WalletViewer {
	userId: string;
	/** Whether they sell (have a freelancer profile) — decides the personal face's subject. */
	isFreelancer: boolean;
	kycStatus: KycStatus | null;
	kycTier: number | null;
	payoutReady: boolean;
}

/** Everything a wallet read resolves once and hands down. */
export interface WalletContext {
	actor: ReadActor & { accessToken: string };
	viewer: WalletViewer;
	money: MoneyProjector;
	/** Every wallet the viewer can see, personal first. */
	accounts: WalletAccount[];
	/** The wallet this read is about, or the read-only rollup of all of them. */
	target: WalletAccount | "aggregate";
}
// #endregion

// #region Capabilities
const ALL_CAPABILITIES: readonly VaultCapability[] = capabilitiesForRole("owner");

/** A permission row's capabilities, expanded as `fn_has_vault_capability` reads them. */
function expand(raw: readonly string[]): VaultCapability[] {
	if (raw.includes("manage_members")) return [...ALL_CAPABILITIES];
	return ALL_CAPABILITIES.filter((cap) => raw.includes(cap));
}

/** The coarse role a capability set reads as (Owner ⊇ Admin ⊇ PM ⊇ Member — `capabilitiesForRole`). */
function roleOf(caps: readonly VaultCapability[]): VaultRole {
	if (caps.includes("manage_billing")) return "owner";
	if (caps.includes("manage_members")) return "admin";
	if (caps.includes("spend")) return "pm";
	return "member";
}
// #endregion

// #region Resolution
/** Parse a `wallet` param; anything unrecognised is the personal wallet. */
function parseWallet(raw: string | null | undefined): { scope: WalletScope; id: string } {
	if (raw === "aggregate") return { scope: "aggregate", id: "" };
	if (!raw || raw === "personal") return { scope: "personal", id: "" };
	const at = raw.indexOf(":");
	const scope = at === -1 ? raw : raw.slice(0, at);
	const id = at === -1 ? "" : raw.slice(at + 1).toLowerCase();
	if ((scope === "team" || scope === "business" || scope === "organisation") && id) return { scope, id };
	return { scope: "personal", id: "" };
}

/** The wallet the active context points at, when the request names none. */
function activeKey(actor: ReadActor): string {
	switch (actor.contextType) {
		case "team":
		case "business":
		case "organisation":
			return actor.contextId ? `${actor.contextType}:${actor.contextId}` : "personal";
		default:
			return "personal";
	}
}

/**
 * Resolve a wallet read: the viewer, every wallet they can see, the target, and a money projector in
 * the display currency. `null` when the caller cannot be identified — every wallet surface is a
 * signed-in surface.
 *
 * The display currency is an explicit `?display=` first, then the viewer's preference, then the
 * target wallet's own currency — each narrowed to one the FX engine can price.
 */
export async function resolveWalletContext(
	query: WalletQuery,
	actor: ReadActor,
): Promise<WalletContext | null> {
	if (!canReadLive(actor)) return null;
	const db = getUserClient(actor.accessToken);

	const [owners, walletsRes, permsRes, profileRes] = await Promise.all([
		listOwners({ display: query.display, viewerCurrency: query.viewerCurrency }, actor),
		db.schema("finance").from("wallets")
			.select("id, owner_type, owner_id, currency, balance_cents, approval_threshold_cents"),
		db.schema("finance").from("vault_permissions")
			.select("wallet_id, capabilities")
			.eq("member_user_id", actor.userId),
		db.schema("org").from("freelancer_profiles")
			.select("kyc_status, kyc_tier, payout_ready")
			.eq("user_id", actor.userId)
			.maybeSingle(),
	]);
	if (walletsRes.error) throw new Error(`finance.wallets read failed: ${walletsRes.error.message}`);
	if (permsRes.error) throw new Error(`finance.vault_permissions read failed: ${permsRes.error.message}`);
	if (profileRes.error) throw new Error(`org.freelancer_profiles read failed: ${profileRes.error.message}`);

	const rows = ((walletsRes.data ?? []) as WalletRow[]).map((row) => ({
		...row,
		balance_cents: Number(row.balance_cents) || 0,
		approval_threshold_cents: row.approval_threshold_cents === null
			? null
			: Number(row.approval_threshold_cents),
	}));
	const perms = new Map<string, VaultCapability[]>();
	for (const p of (permsRes.data ?? []) as { wallet_id: string; capabilities: string[] | null }[]) {
		perms.set(p.wallet_id, expand(p.capabilities ?? []));
	}

	const accounts: WalletAccount[] = [];
	for (const owner of owners) {
		if (!owner.isMember) continue;
		const personal = !owner.isEntity;
		const own = rows.filter((row) =>
			personal
				? row.owner_id === actor.userId && (row.owner_type === "user" || row.owner_type === "freelancer")
				: row.owner_id === owner.ownerId && row.owner_type === owner.ownerType
		);
		let capabilities: VaultCapability[];
		if (personal) {
			capabilities = [...ALL_CAPABILITIES];
		} else {
			// The union across the entity's wallets (one per currency); membership alone is `view`.
			const union = new Set<VaultCapability>(["view"]);
			for (const row of own) for (const cap of perms.get(row.id) ?? []) union.add(cap);
			capabilities = ALL_CAPABILITIES.filter((cap) => union.has(cap));
		}
		accounts.push({
			scope: personal ? "personal" : owner.ownerType as WalletAccount["scope"],
			id: personal ? "" : owner.ownerId,
			key: owner.key,
			owner,
			rows: own,
			role: personal ? null : roleOf(capabilities),
			capabilities,
		});
	}
	accounts.sort((a, b) => (a.scope === "personal" ? -1 : b.scope === "personal" ? 1 : 0));

	const requested = parseWallet(query.wallet ?? activeKey(actor));
	const target = requested.scope === "aggregate"
		? "aggregate" as const
		: accounts.find((a) => a.scope === requested.scope && a.id === requested.id) ??
			accounts.find((a) => a.scope === "personal") ?? null;
	if (target === null) return null;

	const ownCurrency = target === "aggregate" ? null : primaryCurrency(target);
	const display = FxService.supportedCurrency(query.display || query.viewerCurrency || ownCurrency || null);
	const profile = profileRes.data as
		| { kyc_status: string | null; kyc_tier: number | null; payout_ready: boolean | null }
		| null;

	return {
		actor,
		viewer: {
			userId: actor.userId,
			isFreelancer: profile !== null,
			kycStatus: (profile?.kyc_status ?? null) as KycStatus | null,
			kycTier: typeof profile?.kyc_tier === "number" ? profile.kyc_tier : null,
			payoutReady: profile?.payout_ready === true,
		},
		money: await moneyProjector(display),
		accounts,
		target,
	};
}
// #endregion

// #region Money over an account
/** The currency an account holds most of — its "own" currency when it holds several. */
export function primaryCurrency(account: WalletAccount): string | null {
	const sorted = [...account.rows].sort((a, b) => b.balance_cents - a.balance_cents);
	return sorted[0]?.currency ?? account.owner.display ?? null;
}

/**
 * A set of stored amounts as ONE figure in the display currency. Several amounts in one currency are
 * a PRICE in that currency (it keeps its origin, so the surface can disclose the conversion); amounts
 * in several currencies are converted first and summed, and a sum of conversions has no origin.
 */
export function sumOf(money: MoneyProjector, amounts: readonly { minor: number; currency: string }[]): MoneyView {
	const currencies = new Set(amounts.map((a) => a.currency.toUpperCase()));
	if (currencies.size === 1) {
		const [currency] = [...currencies];
		return money.price(amounts.reduce((sum, a) => sum + a.minor, 0), currency);
	}
	let total = 0;
	for (const a of amounts) if (money.canConvert(a.currency)) total += money.convertMinor(a.minor, a.currency);
	return money.derived(total);
}

/** An account's Available balance (the sum of its wallet rows). */
export function availableOf(money: MoneyProjector, account: WalletAccount): MoneyView {
	if (account.rows.length === 0) return money.derived(0);
	return sumOf(money, account.rows.map((row) => ({ minor: row.balance_cents, currency: row.currency })));
}

/** The switcher row for an account. */
export function refOf(money: MoneyProjector, account: WalletAccount): WalletRef {
	return {
		scope: account.scope,
		id: account.id,
		handle: account.scope === "personal" ? null : account.owner.handle,
		name: account.scope === "personal" ? account.owner.name : account.owner.name,
		avatar: account.owner.avatar,
		role: account.role,
		available: availableOf(money, account),
	};
}

/** The read-only "All accounts" row: every visible wallet's Available, converted and summed. */
export function aggregateRef(money: MoneyProjector, accounts: readonly WalletAccount[]): WalletRef {
	let total = 0;
	for (const account of accounts) {
		for (const row of account.rows) {
			if (money.canConvert(row.currency)) total += money.convertMinor(row.balance_cents, row.currency);
		}
	}
	return {
		scope: "aggregate",
		id: "",
		handle: null,
		name: "All accounts",
		avatar: null,
		role: null,
		available: money.derived(total),
	};
}
// #endregion
