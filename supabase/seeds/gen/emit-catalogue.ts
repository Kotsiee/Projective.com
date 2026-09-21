/**
 * emit-catalogue.ts — `04_marketplace.sql` (service blueprints) and `05_catalogue.sql` (products,
 * articles, the seller listings over both, and the cover media that points at the seeded assets).
 *
 * Both files are derived from the discovery corpus so a listing in the database is the same
 * listing the app renders from fixtures — same title, same price, same owner.
 */

import { exploreMocks } from "../../../packages/backend/mocks/mod.ts";
import { ago, HEADER, id, insert, jsonb, num, q, slugFor } from "./sql.ts";
import type { World } from "./resolve.ts";

const { ARTICLES, PRODUCTS, SERVICES } = exploreMocks;

/** Parse a formatted price ("$4,800", "From £120 / ticket") into integer minor units. */
function priceMinorOf(item: { priceMinor?: number; price?: string }): number {
	if (typeof item.priceMinor === "number") return item.priceMinor;
	const digits = String(item.price ?? "").replace(/[^0-9.]/g, "");
	const n = Number(digits);
	return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

const DELIVERY_MODEL: Record<string, string> = {
	"Pipeline": "pipeline",
	"One-Off": "one_off",
	"Direct Deliverable": "direct_deliverable",
	"Session": "session",
	"Group Session": "group_session",
};

const PRODUCT_FORMAT: Record<string, string> = {
	presets: "preset",
	templates: "template",
	icons: "download",
};

function cents(major: number | undefined): string {
	return major === undefined ? "NULL" : String(Math.round(major * 100));
}

export function emitMarketplace(world: World): string {
	const out: string[] = [
		HEADER(
			"04_marketplace.sql — service blueprints",
			"marketplace.service_blueprints owns HOW a service is delivered and priced. Its publication (gallery, taxonomy, promotion) is catalogue.listings, seeded in 05. Team-owned services carry owner_type='team' and are keyed to the team owner's freelancer profile.",
		),
	];

	const rows = SERVICES.map((s, i) => {
		const owner = world.principals.get(s.owner.handle)!;
		const model = DELIVERY_MODEL[s.serviceType] ?? "one_off";
		const isTeam = owner.kind === "team";
		const isSession = model === "session" || model === "group_session";
		return [
			id(world.serviceId(s.id)),
			q(isTeam ? "team" : "freelancer"),
			id(isTeam ? owner.entityId : null),
			id(owner.accountUserId),
			q(s.title),
			q(slugFor("svc", s.id)),
			jsonb({ text: s.summary }),
			q(s.summary),
			q(model),
			q(isSession ? "per_seat" : "flat_fee"),
			String(priceMinorOf(s)),
			cents(s.ticketPrice),
			cents(s.sessionPrice),
			"'USD'",
			q(s.category),
			id(world.serviceCover.get(s.id)?.id),
			num(s.freeRevisions ?? null),
			cents(s.extraRevisionPrice),
			String(model !== "session" && model !== "group_session"),
			model === "group_session" ? "12" : "1",
			String(model === "group_session"),
			"true",
			ago(90 - i * 3),
		];
	});

	out.push(
		insert(
			"marketplace.service_blueprints",
			[
				"id",
				"owner_type",
				"owner_team_id",
				"freelancer_profile_id",
				"title",
				"slug",
				"description",
				"description_text",
				"delivery_model",
				"pricing_model",
				"price_cents",
				"ticket_price_cents",
				"session_price_cents",
				"currency",
				"category",
				"cover_file_id",
				"free_revisions",
				"extra_revision_price_cents",
				"requires_upfront_escrow",
				"max_seats_per_cohort",
				"allow_continuous_enrollment",
				"is_published",
				"created_at",
			],
			rows,
		),
	);
	return out.join("\n");
}

export function emitCatalogue(world: World): string {
	const out: string[] = [
		HEADER(
			"05_catalogue.sql — products, articles and the seller listings over them",
			"catalogue owns the PUBLICATION layer. A listing points at its subject (a service blueprint or a product) rather than restating its price, so the two cannot disagree. Cover media references the files.items rows seeded in 02.",
		),
	];

	// Products.
	out.push(
		insert(
			"catalogue.products",
			[
				"id",
				"owner_user_id",
				"owner_team_id",
				"title",
				"description",
				"description_text",
				"format",
				"category",
				"price_cents",
				"currency",
				"licence",
				"attribution_required",
				"file_manifest",
				"span",
				"created_at",
			],
			PRODUCTS.map((p, i) => {
				const owner = world.principals.get(p.owner.handle)!;
				return [
					id(world.productId(p.id)),
					id(owner.accountUserId),
					id(owner.kind === "team" ? owner.entityId : null),
					q(p.title),
					jsonb({ text: p.summary }),
					q(p.summary),
					q(PRODUCT_FORMAT[p.category] ?? "download"),
					q(p.category),
					String(priceMinorOf(p)),
					q(p.currency ?? "USD"),
					"'standard'",
					"false",
					jsonb([{ name: `${p.id}.zip`, bytes: 18_400_000 + i * 2_100_000, format: "zip" }]),
					String(p.span ?? 1),
					ago(80 - i * 4),
				];
			}),
		),
	);

	// Articles.
	out.push(
		insert(
			"catalogue.articles",
			[
				"id",
				"owner_user_id",
				"slug",
				"title",
				"topic",
				"summary",
				"body",
				"body_text",
				"read_minutes",
				"status",
				"published_at",
			],
			ARTICLES.map((a, i) => {
				const owner = world.principals.get(a.owner.handle)!;
				return [
					id(world.articleId(a.id)),
					id(owner.accountUserId),
					q(a.id),
					q(a.title),
					q(a.topic ?? ""),
					q(a.summary),
					jsonb([{ type: "paragraph", text: a.summary }]),
					q(a.summary),
					String(Math.max(1, Math.round(a.readMinutes ?? 1))),
					"'published'",
					ago(30 + i * 5),
				];
			}),
		),
	);

	// Listings: one per product, one per service.
	const listingRows: string[][] = [];
	const mediaRows: string[][] = [];
	PRODUCTS.forEach((p, i) => {
		const owner = world.principals.get(p.owner.handle)!;
		const listingId = world.listingId(p.id);
		listingRows.push([
			id(listingId),
			id(owner.accountUserId),
			id(owner.kind === "team" ? owner.entityId : null),
			"'product'",
			"'published'",
			"NULL",
			id(world.productId(p.id)),
			q(p.title),
			jsonb({ text: p.summary }),
			q(p.summary),
			q(p.category),
			"'Instant download'",
			String(priceMinorOf(p)),
			q(p.currency ?? "USD"),
			"NULL",
			"NULL",
			"NULL",
			"NULL",
			"NULL",
			String(!!p.sponsored),
			String(120 + i * 37),
			String(3 + i),
			ago(75 - i * 4),
			ago(80 - i * 4),
		]);
		const cover = world.productCover.get(p.id);
		if (cover) {
			mediaRows.push([id(cover.id), id(listingId), id(cover.id), "NULL", q(p.title), "0"]);
		}
	});
	SERVICES.forEach((s, i) => {
		const owner = world.principals.get(s.owner.handle)!;
		const listingId = world.listingId(s.id);
		const model = DELIVERY_MODEL[s.serviceType] ?? "one_off";
		listingRows.push([
			id(listingId),
			id(owner.accountUserId),
			id(owner.kind === "team" ? owner.entityId : null),
			"'service'",
			"'published'",
			id(world.serviceId(s.id)),
			"NULL",
			q(s.title),
			jsonb({ text: s.summary }),
			q(s.summary),
			q(s.category),
			q(s.delivery),
			String(priceMinorOf(s)),
			"'USD'",
			cents(s.ticketPrice),
			cents(s.sessionPrice),
			model === "group_session" ? "12" : "NULL",
			num(s.freeRevisions ?? null),
			cents(s.extraRevisionPrice),
			String(!!s.sponsored),
			String(240 + i * 53),
			String(2 + (i % 5)),
			ago(85 - i * 3),
			ago(90 - i * 3),
		]);
		const cover = world.serviceCover.get(s.id);
		if (cover) {
			mediaRows.push([id(cover.id), id(listingId), id(cover.id), "NULL", q(s.title), "0"]);
		}
	});

	out.push(
		insert(
			"catalogue.listings",
			[
				"id",
				"owner_user_id",
				"owner_team_id",
				"kind",
				"status",
				"service_blueprint_id",
				"product_id",
				"title",
				"description",
				"description_text",
				"category",
				"delivery_label",
				"amount_cents",
				"currency",
				"ticket_price_cents",
				"session_price_cents",
				"seats_per_session",
				"free_revisions",
				"extra_revision_price_cents",
				"promoted",
				"view_count",
				"order_count",
				"published_at",
				"created_at",
			],
			listingRows,
		),
	);

	// The arbiter is named explicitly: `uq_listing_media_position` is DEFERRABLE, and a deferrable
	// unique constraint may not be a conflict arbiter, so a bare ON CONFLICT DO NOTHING fails here.
	out.push(
		insert(
			"catalogue.listing_media",
			["id", "listing_id", "file_id", "url", "alt_text", "position"],
			mediaRows,
			"(id)",
		),
	);

	return out.join("\n");
}
