import type { DevBasketScenario } from "@web/utils/dev-seam.ts";
import type {
	Basket,
	BasketOwnerSummary,
	BasketSummary,
	PurchaseOwnerType,
} from "../types/checkout-types.ts";

/**
 * dev-basket — the Dev Context Switcher's `basketScenario` axis, applied to the header drawer's reads.
 * Pure substitutions over a REAL answer, so every figure still comes from the server; writes are never
 * touched. Dev builds only (the seam reads `null` in production).
 */

/** Owner keys the `multi_owner` scenario invents; a read for one is answered from the personal basket. */
const DEV_PREFIX = "dev-";

/** Whether an owner key is one the scenario invented. */
export function isDevOwner(owner: string | null | undefined): boolean {
	return !!owner && owner.slice(owner.indexOf(":") + 1).startsWith(DEV_PREFIX);
}

/** Copy a real basket summary into an invented account. */
function cloneInto(
	base: BasketSummary,
	owner: string,
	ownerType: PurchaseOwnerType,
	id: string,
	name: string,
	isDefault: boolean,
): BasketSummary {
	return { ...base, id: `${owner}/${id}`, name, isDefault, ownerType, ownerId: owner };
}

/** The fullest real basket — what the invented accounts copy, and what reading one of them returns. */
function devBase(
	real: readonly BasketOwnerSummary[],
): { owner: string; basket: BasketSummary } | null {
	const all = real.filter((entry) => !isDevOwner(entry.owner))
		.flatMap((entry) => entry.baskets.map((basket) => ({ owner: entry.owner, basket })));
	return all.sort((a, b) => b.basket.itemCount - a.basket.itemCount)[0] ?? null;
}

/** The switcher's owners under a scenario: `multi_owner` adds a team and a business, each with a list. */
export function devOwners(
	real: readonly BasketOwnerSummary[],
	scenario: DevBasketScenario | undefined,
): readonly BasketOwnerSummary[] {
	if (scenario !== "multi_owner") return real;
	const base = devBase(real)?.basket;
	if (!base) return real;
	const invent = (
		kind: "team" | "business",
		name: string,
		list: string,
	): BasketOwnerSummary => {
		const owner = `${kind}:${DEV_PREFIX}${kind}`;
		return {
			owner,
			kind,
			name,
			avatar: null,
			baskets: [
				cloneInto(base, owner, kind, "main", "Main Basket", true),
				cloneInto(base, owner, kind, "list", list, false),
			],
		};
	};
	return [
		...real.filter((entry) => !isDevOwner(entry.owner)),
		invent("team", "Northwind Studio", "Sprint supplies"),
		invent("business", "Acme Ltd", "Office kit"),
	];
}

/** The scope a read is sent with: an invented owner reads the real basket it was copied from. */
export function devReadScope(
	owner: string | null,
	basketId: string | null,
	real: readonly BasketOwnerSummary[],
): { owner: string | null; basketId: string | null } {
	const base = isDevOwner(owner) ? devBase(real) : null;
	return base ? { owner: base.owner, basketId: base.basket.id } : { owner, basketId };
}

/**
 * A basket read under a scenario: `empty` drops every line; `unavailable` marks the first live line no
 * longer buyable; an invented owner's read is relabelled as the basket the switcher asked for.
 */
export function devBasket(
	basket: Basket,
	scenario: DevBasketScenario | undefined,
	asked: { owner: string | null; summary: BasketSummary | null },
): Basket {
	let out = basket;
	if (isDevOwner(asked.owner) && asked.summary) {
		out = {
			...out,
			id: asked.summary.id,
			name: asked.summary.name,
			isDefault: asked.summary.isDefault,
			ownerType: asked.summary.ownerType,
			ownerId: asked.summary.ownerId,
		};
	}
	if (scenario === "empty") {
		return {
			...out,
			items: [],
			groups: [],
			itemCount: 0,
			selectedCount: 0,
			savedForLaterCount: 0,
			unavailableCount: 0,
		};
	}
	if (scenario === "unavailable") {
		const target = out.items.find((item) => !item.savedForLater && item.available);
		if (!target) return out;
		return {
			...out,
			unavailableCount: out.unavailableCount + 1,
			selectedCount: out.selectedCount - (target.isSelectedForCheckout ? 1 : 0),
			items: out.items.map((item) =>
				item.id === target.id
					? {
						...item,
						available: false,
						isSelectedForCheckout: false,
						unavailableReason: "This listing is no longer available.",
					}
					: item
			),
		};
	}
	return out;
}
