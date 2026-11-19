import { assert, assertEquals } from "@std/assert";
import type { ReadActor } from "../read-actor.ts";
import {
	actsAsHolder,
	countingBody,
	deliveredWhole,
	deliveryHeaders,
	deliveryOf,
	entitlementRefusal,
	holderOf,
	purchaseOf,
	streamDelivery,
	versionFile,
	versionFiles,
} from "./delivery.ts";

// #region Fixtures
const BUYER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const BUSINESS = "33333333-3333-4333-8333-333333333333";
const FILE_A = "44444444-4444-4444-8444-444444444444";
const FILE_B = "55555555-5555-4555-8555-555555555555";
const VERSION = "66666666-6666-4666-8666-666666666666";

function actor(over: Partial<ReadActor> = {}): ReadActor {
	return {
		userId: BUYER,
		contextId: BUYER,
		contextType: "personal",
		accessToken: "t",
		...over,
	} as ReadActor;
}

const MANIFEST = [
	{
		fileId: FILE_A,
		name: "Source.zip",
		label: "Source",
		extension: ".zip",
		bytes: 4000,
		mime: "application/zip",
	},
	{
		fileId: FILE_B,
		name: "Guide.pdf",
		label: "Guide",
		extension: ".pdf",
		bytes: 600,
		mime: "application/pdf",
	},
];

const ACTIVE = { status: "active", holder_type: "user", holder_id: BUYER, version_id: VERSION };
// #endregion

// #region The holder
Deno.test("a personal context holds as its person; an entity context as the entity", () => {
	assertEquals(holderOf(actor()), { type: "user", id: BUYER });
	assertEquals(holderOf(actor({ contextType: "business", contextId: BUSINESS })), {
		type: "business",
		id: BUSINESS,
	});
	assertEquals(holderOf(actor({ contextType: "business", contextId: "" })), null);
	assertEquals(holderOf(actor({ userId: "" })), null);
});

Deno.test("a business member acting personally does not hold the business's purchase", () => {
	const row = { holder_type: "business", holder_id: BUSINESS };
	assertEquals(actsAsHolder(actor(), row), false);
	assertEquals(actsAsHolder(actor({ contextType: "business", contextId: BUSINESS }), row), true);
});
// #endregion

// #region The gate
Deno.test("the gate passes only an active entitlement the acting context holds, with files", () => {
	assertEquals(entitlementRefusal(actor(), ACTIVE), null);
	assertEquals(entitlementRefusal(actor(), null), "no_entitlement");
	assertEquals(
		entitlementRefusal(actor({ userId: STRANGER, contextId: STRANGER }), ACTIVE),
		"not_holder",
	);
	assertEquals(entitlementRefusal(actor(), { ...ACTIVE, status: "refunded" }), "not_active");
	assertEquals(entitlementRefusal(actor(), { ...ACTIVE, status: "revoked" }), "not_active");
	assertEquals(entitlementRefusal(actor(), { ...ACTIVE, version_id: null }), "no_files");
});

Deno.test("a refunded or a foreign entitlement is refused by the holder check before the status", () => {
	// A foreign row the caller's JWT could read (a stale cache, an operator) still answers as not theirs.
	assertEquals(
		entitlementRefusal(actor({ userId: STRANGER, contextId: STRANGER }), {
			...ACTIVE,
			status: "refunded",
		}),
		"not_holder",
	);
});

Deno.test("only a file of the version is served, and a malformed entry never is", () => {
	assertEquals(versionFile(MANIFEST, FILE_B)?.name, "Guide.pdf");
	assertEquals(versionFile(MANIFEST, STRANGER), undefined);
	assertEquals(versionFiles([...MANIFEST, { fileId: "not-a-uuid", name: "" }, null]).length, 2);
	assertEquals(versionFiles({ not: "an array" }), []);
});

Deno.test("a malformed address is a 404 before any session or database is consulted", async () => {
	const request = {
		method: "GET" as const,
		range: null,
		ifRange: null,
		ifNoneMatch: null,
		ifModifiedSince: null,
		signal: new AbortController().signal,
	};
	assertEquals((await streamDelivery(actor(), "prd-23456789ab", FILE_A, request)).status, 404);
	assertEquals((await streamDelivery(actor(), "ent-23456789ab", "../etc", request)).status, 404);
	assertEquals((await streamDelivery(actor(), "ent-0000000000", FILE_A, request)).status, 404);
});
// #endregion

// #region Headers
Deno.test("the delivery class: no-store, an attachment named by the version, same-origin, sandboxed", () => {
	const h = deliveryHeaders({ name: "Brand kit — final.zip", mime: "text/html" });
	assertEquals(h.get("cache-control"), "private, no-store");
	assert(h.get("content-disposition")!.startsWith("attachment; filename="));
	assert(
		h.get("content-disposition")!.includes("filename*=UTF-8''Brand%20kit%20%E2%80%94%20final.zip"),
	);
	assertEquals(h.get("cross-origin-resource-policy"), "same-origin");
	assertEquals(h.get("content-security-policy"), "default-src 'none'; sandbox");
	assertEquals(h.get("x-content-type-options"), "nosniff");
	assertEquals(h.get("x-robots-tag"), "noindex, nofollow");
	assertEquals(h.get("referrer-policy"), "no-referrer");
	// Uploader bytes are never HTML on the app origin (invariant 6).
	assert(h.get("content-type") !== "text/html");
	for (const [, value] of h) assert(!/storage|supabase|originals/i.test(value), value);
});
// #endregion

// #region What counts as delivered (ruling A8)
Deno.test("a whole 200 or a 0-to-last 206 counts as delivered; anything less does not", () => {
	assertEquals(deliveredWhole(200, new Headers({ "content-length": "4000" }), 4000), true);
	assertEquals(deliveredWhole(200, new Headers({ "content-length": "4000" }), 3999), false);
	assertEquals(
		deliveredWhole(206, new Headers({ "content-range": "bytes 0-3999/4000" }), 4000),
		true,
	);
	assertEquals(
		deliveredWhole(206, new Headers({ "content-range": "bytes 100-3999/4000" }), 3900),
		false,
	);
	assertEquals(
		deliveredWhole(206, new Headers({ "content-range": "bytes 0-99/4000" }), 100),
		false,
	);
	assertEquals(deliveredWhole(304, new Headers(), 0), false);
	assertEquals(deliveredWhole(200, new Headers(), 10), false);
});

Deno.test("the counting body reports what it passed on, and an aborted body reports nothing", async () => {
	let seen: number | null = null;
	const body = countingBody(new Blob([new Uint8Array(1500), new Uint8Array(500)]).stream(), (n) => {
		seen = n;
	});
	assertEquals((await new Response(body).arrayBuffer()).byteLength, 2000);
	assertEquals(seen, 2000);

	let aborted: number | null = null;
	const cut = countingBody(new Blob([new Uint8Array(10)]).stream(), (n) => {
		aborted = n;
	});
	await cut.cancel();
	assertEquals(aborted, null);
});
// #endregion

// #region The purchases view
Deno.test("a purchase lists its files; only an active, ready one carries their addresses", () => {
	const row = {
		id: "e",
		slug: "ent-23456789ab",
		status: "active",
		licence: "commercial",
		seats: 1,
		created_at: "2026-11-18T10:00:00Z",
		first_delivered_at: null,
		order_line_id: "l",
		product_versions: {
			id: VERSION,
			product_id: "p",
			version: 2,
			manifest: MANIFEST,
			ready_at: "2026-11-18T09:00:00Z",
		},
	};
	const ready = purchaseOf(row, { title: "Brand kit", order_id: "o" }, "PJ-2026-ABCDEF")!;
	assertEquals(ready.delivery, "ready");
	assertEquals(ready.files.map((f) => f.href), [
		`/api/downloads/ent-23456789ab/${FILE_A}`,
		`/api/downloads/ent-23456789ab/${FILE_B}`,
	]);
	assertEquals([ready.title, ready.orderReference, ready.version], [
		"Brand kit",
		"PJ-2026-ABCDEF",
		2,
	]);

	const refunded = purchaseOf({ ...row, status: "refunded" }, undefined, undefined)!;
	assertEquals([refunded.status, refunded.files.every((f) => f.href === null)], ["refunded", true]);

	const preparing = purchaseOf(
		{ ...row, product_versions: { ...row.product_versions, ready_at: null } },
		undefined,
		undefined,
	)!;
	assertEquals([preparing.delivery, preparing.files.every((f) => f.href === null)], [
		"preparing",
		true,
	]);

	const bare = purchaseOf({ ...row, product_versions: null }, undefined, undefined)!;
	assertEquals([bare.delivery, bare.files.length, bare.version], ["none", 0, null]);
	assertEquals(deliveryOf(null), "none");
	assertEquals(purchaseOf({ ...row, slug: "prd-23456789ab" }, undefined, undefined), null);
});
// #endregion
