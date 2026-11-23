import { assertEquals } from "@std/assert";
import type { SellerPromoCode } from "@projective/types/finance";
import {
	draftToPromoInput,
	expiryLabel,
	freshPromoDraft,
	perAccountLabel,
	percentLabel,
	redeemedLabel,
	scopeLabel,
	splitCodes,
} from "./promotions-model.ts";

const NOW = Date.UTC(2026, 10, 23, 12);

const code = (over: Partial<SellerPromoCode> = {}): SellerPromoCode => ({
	id: "c1",
	code: "SUMMER20",
	label: "Summer",
	kind: "percent",
	valueBp: 2000,
	value: null,
	startsAt: null,
	expiresAt: null,
	maxRedemptions: null,
	maxRedemptionsPerAccount: 1,
	redemptionCount: 3,
	listings: null,
	archivedAt: null,
	createdAt: "2026-11-01T00:00:00Z",
	...over,
});

Deno.test("promotions: a row states its discount, redemptions, expiry, scope and per-account limit", () => {
	assertEquals(percentLabel(code()), "20% off");
	assertEquals(percentLabel(code({ valueBp: 1250 })), "12.5% off");
	assertEquals(percentLabel(code({ kind: "flat", valueBp: null })), null);
	assertEquals(redeemedLabel(code()), "3 redeemed");
	assertEquals(redeemedLabel(code({ maxRedemptions: 50 })), "3 of 50 redeemed");
	assertEquals(expiryLabel(code(), NOW), "No expiry");
	assertEquals(
		expiryLabel(code({ expiresAt: "2026-11-30T23:59:59Z" }), NOW),
		"Expires 30 Nov 2026",
	);
	assertEquals(expiryLabel(code({ expiresAt: "2026-11-03T23:59:59Z" }), NOW), "Expired 3 Nov 2026");
	assertEquals(scopeLabel(code()), "All your products");
	assertEquals(scopeLabel(code({ listings: ["prd-a"] })), "1 listing");
	assertEquals(perAccountLabel(code()), "Once per account");
	assertEquals(perAccountLabel(code({ maxRedemptionsPerAccount: null })), "No per-account limit");
});

Deno.test("promotions: archived codes list after the live ones", () => {
	const { live, archived } = splitCodes([
		code({ id: "a", archivedAt: "2026-11-20T00:00:00Z" }),
		code({ id: "b" }),
	]);
	assertEquals(live.map((c) => c.id), ["b"]);
	assertEquals(archived.map((c) => c.id), ["a"]);
});

Deno.test("promotions: a draft becomes the API input, or names what stops it", () => {
	const ok = draftToPromoInput(
		{ ...freshPromoDraft("GBP"), code: " launch-10 ", label: "Launch" },
		NOW,
	);
	assertEquals(ok.ok && ok.input, {
		code: "LAUNCH-10",
		label: "Launch",
		kind: "percent",
		percent: 10,
		expiresAt: null,
		maxRedemptions: null,
		perAccount: 1,
	});
	const flat = draftToPromoInput(
		{
			...freshPromoDraft("GBP"),
			code: "FIVE",
			label: "Five off",
			kind: "flat",
			amount: 5,
			listings: ["prd-a"],
		},
		NOW,
	);
	assertEquals(flat.ok && [flat.input.amountMinor, flat.input.currency, flat.input.listings], [
		500,
		"GBP",
		["prd-a"],
	]);
	const bad = draftToPromoInput(
		{ ...freshPromoDraft("GBP"), code: "X", percent: 0, listings: [] },
		NOW,
	);
	assertEquals(bad.ok ? [] : Object.keys(bad.errors).sort(), [
		"code",
		"label",
		"listings",
		"percent",
	]);
});
