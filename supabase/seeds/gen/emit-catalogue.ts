/**
 * emit-catalogue.ts — `04_marketplace.sql` (service blueprints) and `05_catalogue.sql` (products,
 * articles, the seller listings over both, their galleries and skills, the reviews buyers left on
 * them, and the paid placements behind the "AD" disclosures).
 *
 * Everything here comes from `./corpus.ts` — seed-only data, frozen once from the retired runtime
 * fixtures — plus `./reviews.ts`. The running app reads these rows back; it never sees the corpus.
 */

import { plainTextToHtml } from "@projective/types/richtext";
import { ARTICLES, type CorpusArticleBlock, PRODUCTS, SERVICES } from "./corpus.ts";
import { LISTING_REVIEWS } from "./reviews.ts";
import { ago, ahead, arr, HEADER, id, insert, jsonb, num, q, slugFor, uuidFor } from "./sql.ts";
import type { Asset, Principal, World } from "./resolve.ts";
import { ENTITIES, SKILLS } from "./world.ts";

// #region Helpers

/** Rich-text documents are stored as `{ html }`, the shape every editor on the platform writes. */
function richText(text: string): string {
	return jsonb({ html: plainTextToHtml(text) });
}

/** The corpus owner handle resolved to the account (and entity) that owns the row. */
function ownerOf(world: World, handle: string): Principal {
	const principal = world.principals.get(handle);
	if (!principal) throw new Error(`catalogue: no principal owns "${handle}"`);
	return principal;
}

/** Persona keys that may NOT review a listing owned by `handle`: its owner and the owning team. */
function conflictedReviewers(world: World, handle: string): Set<string> {
	const owner = ownerOf(world, handle);
	const out = new Set<string>();
	for (const p of world.personas.values()) {
		if (p.userId === owner.accountUserId) out.add(p.key);
	}
	if (owner.entityKey) {
		const entity = ENTITIES.find((e) => e.key === owner.entityKey);
		for (const m of entity?.members ?? []) out.add(m.persona);
		if (entity) out.add(entity.owner);
	}
	return out;
}

/** Persona key → user id, refusing an unknown key at generate time rather than at reset time. */
function reviewerId(world: World, key: string): string {
	const persona = world.personas.get(key);
	if (!persona) throw new Error(`catalogue: unknown reviewer persona "${key}"`);
	return persona.userId;
}

/** The skill vocabulary seeded into `org.skills` (`world.ts` SKILLS); every listing skill must name one. */
const SKILL_SLUGS = new Set(SKILLS.map(([slug]) => slug));

const DELIVERY_MODEL_PRICING: Record<string, string> = {
	pipeline: "flat_fee",
	one_off: "flat_fee",
	direct_deliverable: "flat_fee",
	session: "per_seat",
	group_session: "per_seat",
};

/**
 * The gallery a listing opens with: its own cover first, then other pictures by the SAME owner — the
 * owner's banner and the covers of their other listings. Never someone else's work: a gallery that
 * borrowed another seller's image would be showing a buyer something this seller did not make.
 */
function galleryOf(world: World, handle: string, cover: Asset | undefined): Asset[] {
	const owner = ownerOf(world, handle);
	const frames: Asset[] = [];
	const push = (a: Asset | undefined) => {
		if (a && !frames.some((f) => f.id === a.id)) frames.push(a);
	};
	push(cover);
	if (owner.entityKey) push(world.entityBanner.get(owner.entityKey));
	else {
		for (const p of world.personas.values()) {
			if (p.userId === owner.accountUserId) push(world.personaBanner.get(p.key));
		}
	}
	for (const s of SERVICES) if (s.owner === handle) push(world.serviceCover.get(s.key));
	for (const p of PRODUCTS) if (p.owner === handle) push(world.productCover.get(p.key));
	return frames.slice(0, 5);
}

// #endregion

// #region 04 — marketplace

export function emitMarketplace(world: World): string {
	const out: string[] = [
		HEADER(
			"04_marketplace.sql — service blueprints",
			"marketplace.service_blueprints owns HOW a service is delivered and priced: its stage template, its team, its session format and its intake questions. Its publication (gallery, taxonomy, promotion) is catalogue.listings, seeded in 05. Team-owned services carry owner_type='team' and are keyed to the team owner's freelancer profile.",
		),
	];

	const rows = SERVICES.map((s, i) => {
		const owner = ownerOf(world, s.owner);
		const isTeam = owner.kind === "team";
		const isSession = s.model === "session" || s.model === "group_session";
		for (const slug of s.skills) {
			if (!SKILL_SLUGS.has(slug)) throw new Error(`catalogue: ${s.key} names unknown skill "${slug}"`);
		}
		return [
			id(world.serviceId(s.key)),
			q(isTeam ? "team" : "freelancer"),
			id(isTeam ? owner.entityId : null),
			id(owner.accountUserId),
			q(s.title),
			q(slugFor("svc", s.key)),
			richText(s.summary),
			q(s.summary),
			q(s.model),
			q(DELIVERY_MODEL_PRICING[s.model]),
			String(s.priceMinor),
			num(s.ticketPriceMinor ?? null),
			num(s.sessionPriceMinor ?? null),
			q(s.currency),
			q(s.category),
			id(world.serviceCover.get(s.key)?.id),
			num(s.freeRevisions ?? null),
			num(s.extraRevisionPriceMinor ?? null),
			String(!isSession),
			String(s.model === "group_session" ? s.seatsPerSession ?? 12 : 1),
			String(s.model === "group_session"),
			jsonb(s.intake),
			jsonb(
				s.stages.map((st) => ({
					name: st.name,
					description: st.description,
					deliverables: st.deliverables,
					turnaround: st.turnaround,
					priceCents: st.priceMinor,
					skills: st.skills,
				})),
			),
			jsonb(s.teamRoles),
			arr(s.deliverables),
			num(isSession ? s.sessionMinutes ?? null : null),
			num(s.model === "session" ? s.sessionCount ?? 1 : null),
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
				"intake_fields",
				"stage_template",
				"team_roles",
				"deliverables",
				"session_minutes",
				"session_count",
				"is_published",
				"created_at",
			],
			rows,
		),
	);
	return out.join("\n");
}

// #endregion

// #region 05 — catalogue

/** Resolve an article's stored body: image blocks point at the seeded OBJECT, never at a URL. */
function articleBody(world: World, key: string, blocks: CorpusArticleBlock[]): unknown[] {
	return blocks.map((b) => {
		if (b.type !== "image") return b;
		const asset = world.articleImage.get(`${key}:${b.asset}`);
		if (!asset) throw new Error(`catalogue: article ${key} image ${b.asset} was not resolved`);
		return {
			type: "image",
			bucket: asset.bucket,
			path: asset.path,
			alt: b.alt ?? "",
			...(b.caption ? { caption: b.caption } : {}),
		};
	});
}

/** The plain-text twin of an article body, for search and card blurbs. */
function articleText(blocks: CorpusArticleBlock[]): string {
	return blocks
		.flatMap((b) =>
			b.type === "list" ? b.items ?? [] : b.type === "image" ? [] : b.text ? [b.text] : []
		)
		.join("\n\n");
}

export function emitCatalogue(world: World): string {
	const out: string[] = [
		HEADER(
			"05_catalogue.sql — products, articles, listings, galleries, skills, reviews and placements",
			"catalogue owns the PUBLICATION layer. A listing points at its subject (a service blueprint or a product) rather than restating its price, so the two cannot disagree. Every image is a files.items row seeded in 02; every rating is derived by the review trigger from the rows written here.",
		),
	];

	// #region Products
	out.push(
		insert(
			"catalogue.products",
			[
				"id",
				"slug",
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
				"compatibility",
				"specs",
				"span",
				"created_at",
			],
			PRODUCTS.map((p, i) => {
				const owner = ownerOf(world, p.owner);
				return [
					id(world.productId(p.key)),
					q(slugFor("prd", p.key)),
					id(owner.accountUserId),
					id(owner.kind === "team" ? owner.entityId : null),
					q(p.title),
					richText(p.summary),
					q(p.summary),
					q(p.format),
					q(p.category),
					String(p.priceMinor),
					q(p.currency),
					q(p.licence),
					String(p.attributionRequired),
					jsonb(p.files),
					jsonb(p.compatibility),
					jsonb(p.specs),
					String(p.span),
					ago(80 - i * 4),
				];
			}),
		),
	);
	// #endregion

	// #region Articles
	out.push(
		insert(
			"catalogue.articles",
			[
				"id",
				"slug",
				"owner_user_id",
				"owner_team_id",
				"title",
				"topic",
				"summary",
				"body",
				"body_text",
				"cover_file_id",
				"read_minutes",
				"status",
				"published_at",
				"created_at",
			],
			ARTICLES.map((a, i) => {
				const owner = ownerOf(world, a.owner);
				return [
					id(world.articleId(a.key)),
					q(slugFor("art", a.key)),
					id(owner.accountUserId),
					id(owner.kind === "team" ? owner.entityId : null),
					q(a.title),
					q(a.topic),
					q(a.summary),
					jsonb(articleBody(world, a.key, a.blocks)),
					q(articleText(a.blocks)),
					id(world.articleCover.get(a.key)?.id),
					String(Math.max(1, Math.round(a.readMinutes))),
					"'published'",
					ago(30 + i * 5),
					ago(32 + i * 5),
				];
			}),
		),
	);
	// #endregion

	// #region Listings, galleries, skills, tags
	const listingRows: string[][] = [];
	const mediaRows: string[][] = [];
	const skillRows: string[][] = [];
	const tagRows: string[][] = [];

	const addGallery = (listingId: string, handle: string, cover: Asset | undefined, title: string) => {
		galleryOf(world, handle, cover).forEach((asset, position) => {
			mediaRows.push([
				id(uuidFor("listing_media", `${listingId}:${asset.id}`)),
				id(listingId),
				id(asset.id),
				"NULL",
				q(position === 0 ? title : `${title} — view ${position + 1}`),
				String(position),
			]);
		});
	};
	const addSkills = (listingId: string, slugs: string[]) => {
		for (const slug of slugs) {
			skillRows.push([id(listingId), id(uuidFor("skill", slug))]);
		}
	};

	PRODUCTS.forEach((p, i) => {
		const owner = ownerOf(world, p.owner);
		const listingId = world.listingId(p.key);
		listingRows.push([
			id(listingId),
			id(owner.accountUserId),
			id(owner.kind === "team" ? owner.entityId : null),
			"'product'",
			"'published'",
			"NULL",
			id(world.productId(p.key)),
			q(p.title),
			richText(p.summary),
			q(p.summary),
			q(p.category),
			"'Instant download'",
			String(p.priceMinor),
			q(p.currency),
			"NULL",
			"NULL",
			"NULL",
			"NULL",
			"NULL",
			String(p.sponsored),
			String(120 + i * 37),
			String(3 + i),
			ago(75 - i * 4),
			ago(80 - i * 4),
		]);
		addGallery(listingId, p.owner, world.productCover.get(p.key), p.title);
		addSkills(listingId, p.skills);
		tagRows.push([id(listingId), q(p.category)]);
	});
	SERVICES.forEach((s, i) => {
		const owner = ownerOf(world, s.owner);
		const listingId = world.listingId(s.key);
		listingRows.push([
			id(listingId),
			id(owner.accountUserId),
			id(owner.kind === "team" ? owner.entityId : null),
			"'service'",
			"'published'",
			id(world.serviceId(s.key)),
			"NULL",
			q(s.title),
			richText(s.summary),
			q(s.summary),
			q(s.category),
			q(s.delivery),
			String(s.priceMinor),
			q(s.currency),
			num(s.ticketPriceMinor ?? null),
			num(s.sessionPriceMinor ?? null),
			s.model === "group_session" ? String(s.seatsPerSession ?? 12) : "NULL",
			num(s.freeRevisions ?? null),
			num(s.extraRevisionPriceMinor ?? null),
			String(s.sponsored),
			String(240 + i * 53),
			String(2 + (i % 5)),
			ago(85 - i * 3),
			ago(90 - i * 3),
		]);
		addGallery(listingId, s.owner, world.serviceCover.get(s.key), s.title);
		addSkills(listingId, s.skills);
		tagRows.push([id(listingId), q(s.category)]);
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
	out.push(
		insert("catalogue.listing_skills", ["listing_id", "skill_id"], skillRows, "(listing_id, skill_id)"),
	);
	out.push(insert("catalogue.listing_tags", ["listing_id", "tag"], tagRows, "(listing_id, tag)"));
	// #endregion

	// #region Reviews
	// The rating trigger (`reviews.recalculate_entity_rating`) recomputes each subject's average and
	// count as these land, so the numbers every card prints are derived from these rows.
	const reviewRows: string[][] = [];
	const addReviews = (key: string, handle: string, targetId: string, targetType: string) => {
		const barred = conflictedReviewers(world, handle);
		for (const [reviewer, rating, title, comment, daysAgo] of LISTING_REVIEWS[key] ?? []) {
			if (barred.has(reviewer)) {
				throw new Error(`catalogue: ${reviewer} may not review ${key} — they own or staff it`);
			}
			if (comment.trim().length < 100) {
				throw new Error(`catalogue: review of ${key} by ${reviewer} is under 100 characters`);
			}
			reviewRows.push([
				id(uuidFor("listing_review", `${key}:${reviewer}`)),
				id(targetId),
				q(targetType),
				id(reviewerId(world, reviewer)),
				"NULL",
				rating.toFixed(2),
				q(title),
				q(comment),
				ago(daysAgo),
				ago(daysAgo),
			]);
		}
	};
	for (const s of SERVICES) addReviews(s.key, s.owner, world.serviceId(s.key), "service_blueprint");
	for (const p of PRODUCTS) addReviews(p.key, p.owner, world.productId(p.key), "product");

	out.push(
		insert(
			"reviews.entity_reviews",
			[
				"id",
				"target_entity_id",
				"target_entity_type",
				"reviewer_user_id",
				"project_id",
				"rating",
				"title",
				"comment",
				"created_at",
				"updated_at",
			],
			reviewRows,
		),
	);
	// #endregion

	// #region Paid placements
	// One active placement per sponsored listing, so every "AD" disclosure the discovery surfaces
	// print is answerable from a ledger row rather than from a flag nobody paid for.
	const placementRows: string[][] = [];
	const addPlacement = (key: string, handle: string, type: string, entityId: string) => {
		const owner = ownerOf(world, handle);
		placementRows.push([
			id(uuidFor("placement", key)),
			id(owner.accountUserId),
			q(type),
			id(entityId),
			"'explore_home'",
			ago(7),
			ahead(23),
			String(4_900),
			"'USD'",
		]);
	};
	for (const s of SERVICES) if (s.sponsored) addPlacement(s.key, s.owner, "service", world.serviceId(s.key));
	for (const p of PRODUCTS) if (p.sponsored) addPlacement(p.key, p.owner, "product", world.productId(p.key));

	out.push(
		insert(
			"marketplace.promoted_placements",
			[
				"id",
				"sponsor_user_id",
				"entity_type",
				"entity_id",
				"surface",
				"starts_at",
				"ends_at",
				"spend_cents",
				"currency",
			],
			placementRows,
		),
	);
	// #endregion

	return out.join("\n");
}

// #endregion
