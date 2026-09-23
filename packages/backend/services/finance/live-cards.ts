import type { SavedCard } from "@projective/types/finance";
import { CardBrand } from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import type { ResolvedOwner } from "./commerce-owner.ts";

/**
 * live-cards — the acting account's saved cards, read and managed as the signed-in caller over
 * `finance.saved_cards`.
 *
 * A saved card is the DISPLAY projection of an instrument the payment processor holds: brand, last
 * four, expiry, cardholder. This application never holds a number, and the card row is not the
 * application's to create — only the processor's tokenisation handshake may add one, which is why the
 * table carries no client INSERT policy and every display column is immutable once written
 * (`trg_saved_cards_immutable`). What a member with `manage_billing` may do is choose the default and
 * remove a card; both are ordinary RLS-scoped writes.
 *
 * `isExpired` is derived here against the SERVER clock — a client clock must not decide a card is dead.
 */

// #region Rows
const CARD_COLS =
	"id, owner_type, owner_id, payment_method_id, stripe_payment_method_id, brand, last4, exp_month, " +
	"exp_year, cardholder_name, bin_number, is_business_card, is_default, created_by_user_id, created_at";

interface CardRow {
	id: string;
	owner_type: string;
	owner_id: string;
	payment_method_id: string | null;
	stripe_payment_method_id: string;
	brand: string;
	last4: string | null;
	exp_month: number | null;
	exp_year: number | null;
	cardholder_name: string | null;
	bin_number: string | null;
	is_business_card: boolean;
	is_default: boolean;
	created_by_user_id: string | null;
	created_at: string;
}
// #endregion

// #region Projection
/**
 * Whether a card has expired. A card is valid THROUGH the last day of its expiry month, so it expires
 * at the start of the month after — measured in UTC, the only clock both sides of a payment agree on.
 */
function expired(row: CardRow, now: number): boolean {
	if (!row.exp_year || !row.exp_month) return false;
	return Date.UTC(row.exp_year, row.exp_month, 1) <= now;
}

function toCard(row: CardRow, owner: ResolvedOwner, now: number): SavedCard {
	const brand = CardBrand.safeParse(row.brand);
	return {
		id: row.id,
		ownerType: owner.ownerType,
		ownerId: row.owner_id,
		paymentMethodId: row.payment_method_id,
		stripePaymentMethodId: row.stripe_payment_method_id.slice(0, 200),
		brand: brand.success ? brand.data : "unknown",
		last4: row.last4 ? row.last4.slice(-4) : null,
		expMonth: row.exp_month,
		expYear: row.exp_year,
		cardholderName: row.cardholder_name ? row.cardholder_name.slice(0, 120) : null,
		binNumber: row.bin_number && /^[0-9]{6,8}$/.test(row.bin_number) ? row.bin_number : null,
		isBusinessCard: row.is_business_card,
		isDefault: row.is_default,
		createdByUserId: row.created_by_user_id,
		createdAt: new Date(row.created_at).toISOString(),
		isExpired: expired(row, now),
	};
}
// #endregion

// #region Reads
/**
 * Every card on file for the owner, default first then newest. Read with the caller's token, so a
 * non-member sees none — `finance.saved_cards` is visible to the owner's members only.
 */
export async function listCards(owner: ResolvedOwner, actor: ReadActor): Promise<SavedCard[]> {
	if (!canReadLive(actor)) return [];
	const query = getUserClient(actor.accessToken).schema("finance").from("saved_cards")
		.select(CARD_COLS)
		.eq("owner_id", owner.ownerId);
	const { data, error } = await (owner.isEntity
		? query.eq("owner_type", owner.ownerType)
		: query.in("owner_type", ["user", "freelancer"]))
		.order("is_default", { ascending: false })
		.order("created_at", { ascending: false });
	if (error) throw new Error(`finance.saved_cards read failed: ${error.message}`);
	const now = Date.now();
	return ((data ?? []) as unknown as CardRow[]).map((row) => toCard(row, owner, now));
}

/**
 * The card a card payment would use: the default when it is usable, else the newest usable one. An
 * entity may only pay with a BUSINESS card (the SSOT's `availableProviders` rule), so a personal card
 * on an entity's file is never pre-selected.
 */
export function defaultCardOf(cards: readonly SavedCard[], owner: ResolvedOwner): string | null {
	const usable = cards.filter((c) => !c.isExpired && (!owner.isEntity || c.isBusinessCard));
	return usable.find((c) => c.isDefault)?.id ?? usable[0]?.id ?? null;
}
// #endregion

// #region Writes
/** The outcome of a card write. */
export type CardOutcome =
	| { ok: true; message: string }
	| { ok: false; status: number; message: string };

/**
 * Make one card the owner's default. An expired card is refused rather than silently accepted, and so
 * is a personal card on an entity's file — it could never be charged there.
 *
 * Two statements, because the one-default-per-owner index would refuse the new default while the old
 * one still holds the slot: clear, then set. RLS (`manage_billing` for an entity) gates both.
 */
export async function setDefaultCard(
	cardId: string,
	owner: ResolvedOwner,
	actor: ReadActor,
): Promise<CardOutcome> {
	if (!canReadLive(actor)) return { ok: false, status: 401, message: "Sign in to manage your cards." };
	const cards = await listCards(owner, actor);
	const card = cards.find((c) => c.id === cardId);
	if (!card) return { ok: false, status: 404, message: "That card is no longer on file." };
	if (card.isExpired) {
		return { ok: false, status: 422, message: "That card has expired, so it can't be your default." };
	}
	if (owner.isEntity && !card.isBusinessCard) {
		return {
			ok: false,
			status: 422,
			message: "A business account can only default to a business card.",
		};
	}
	if (card.isDefault) return { ok: true, message: "That's already your default card." };

	// A fresh builder per statement: supabase-js shares one URL across statements built from the
	// same `from()`, so a reused builder carries the previous statement's filters into the next.
	const table = () => getUserClient(actor.accessToken).schema("finance").from("saved_cards");
	const current = cards.find((c) => c.isDefault);
	if (current) {
		const cleared = await table().update({ is_default: false }).eq("id", current.id).select("id");
		if (cleared.error) return failure(cleared.error);
		if ((cleared.data ?? []).length === 0) return forbidden();
	}
	const set = await table().update({ is_default: true }).eq("id", card.id).select("id");
	if (set.error) return failure(set.error);
	if ((set.data ?? []).length === 0) return forbidden();
	return { ok: true, message: `${label(card)} is now your default card.` };
}

/**
 * Remove a card from the owner's file. Removing the default promotes the next usable card, so an
 * account is never left with cards on file and none selected.
 */
export async function removeCard(
	cardId: string,
	owner: ResolvedOwner,
	actor: ReadActor,
): Promise<CardOutcome> {
	if (!canReadLive(actor)) return { ok: false, status: 401, message: "Sign in to manage your cards." };
	const cards = await listCards(owner, actor);
	const card = cards.find((c) => c.id === cardId);
	if (!card) return { ok: false, status: 404, message: "That card is no longer on file." };

	const table = () => getUserClient(actor.accessToken).schema("finance").from("saved_cards");
	const removed = await table().delete().eq("id", card.id).select("id");
	if (removed.error) return failure(removed.error);
	if ((removed.data ?? []).length === 0) return forbidden();

	if (card.isDefault) {
		const next = cards.find((c) =>
			c.id !== card.id && !c.isExpired && (!owner.isEntity || c.isBusinessCard)
		);
		if (next) await table().update({ is_default: true }).eq("id", next.id);
	}
	return { ok: true, message: `${label(card)} was removed.` };
}

/** `Visa •••• 4242`. */
function label(card: SavedCard): string {
	const brand = card.brand === "unknown" ? "Card" : card.brand[0].toUpperCase() + card.brand.slice(1);
	return card.last4 ? `${brand} •••• ${card.last4}` : brand;
}

/** RLS matched nothing: the caller may see the card but not manage the account's billing. */
function forbidden(): CardOutcome {
	return {
		ok: false,
		status: 403,
		message: "Only a member who manages this account's billing can change its cards.",
	};
}

function failure(error: { code?: string; message: string }): CardOutcome {
	if (error.code === "42501") return forbidden();
	throw new Error(`finance.saved_cards write failed: ${error.message}`);
}
// #endregion
