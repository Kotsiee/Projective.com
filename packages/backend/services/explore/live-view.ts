import { getAnonClient } from "../../core/supabase.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { PIPELINE_HIGH, PIPELINE_LOW } from "./pricing.ts";
import { lowestActivePrice } from "./query.ts";
import { resolveSkill } from "./skills.ts";
import type { Catalog, CatalogMedia, ProfileRow } from "./live-catalog.ts";
import { displayPrice, peekCatalog } from "./live-catalog.ts";
import {
	type ArticleAsset,
	type ArticleBlock,
	type ArticleTocEntry,
	type ArticleViewExtra,
	BlueprintStageSchema,
	BlueprintTeamRoleSchema,
	type EntityMedia,
	type EntityPricing,
	type EntityReview,
	type EntitySeller,
	type EntityView,
	type ExploreItem,
	type ExploreOwner,
	licenceTerms,
	parseStoredList,
	type ProductFile,
	type ProductFormat,
	ProductManifestEntrySchema,
	type ProductViewExtra,
	type ProjectMetric,
	type ProjectStage,
	type ProjectStageStatus,
	type ProjectViewExtra,
	revisionAllowanceKind,
	type ReviewSummary,
	type ServiceItem,
	type ServiceModel,
	type ServiceRole,
	type ServiceViewExtra,
	type StageRevisions,
	type StageRole,
	StoredArticleBlockSchema,
	StoredProductCompatSchema,
	StoredProductSpecSchema,
	type TicketPrice,
	type TrustFact,
} from "@projective/types/explore";
import { IntakeFieldSchema } from "@projective/types/services";
import type { VerificationTier as ProfileTier } from "@projective/types/profile";

/**
 * live-view — the composed `/view/[id]` page, built from Postgres.
 *
 * The item and its gallery come from the shared discovery load ({@link Catalog}); the one extra read
 * is the item's REVIEWS, which are per-item and would bloat the shared load for no card's benefit.
 * Every section maps from a column: a stage showcase from the blueprint's `stage_template`, a product
 * ledger from `specs` / `file_manifest` / `compatibility`, an article body from `body`, a project's
 * stage flow from its stages, staffing roles and open seats. Where no column backs a section it is
 * EMPTY — an article has no comments table, so its thread is empty; there is no measured reply time,
 * so the lane shows no response badge. The retired fixture filled all of those in.
 */

// #region Formatting primitives

/** A per-ticket price: fixed when `min === max`, else a range. Major units in, label pre-formatted. */
function ticketPrice(min: number, max: number, currency: string, unit = " / ticket"): TicketPrice {
	const lo = Math.round(min);
	const hi = Math.round(max);
	const label = lo === hi
		? `${displayPrice(lo * 100, currency)}${unit}`
		: `${displayPrice(lo * 100, currency)} – ${displayPrice(hi * 100, currency)}${unit}`;
	return { min: lo, max: hi, label };
}

/** A human byte size — MB below a gigabyte, one decimal above. Formatted ONCE, here. */
function byteLabel(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Mon YYYY` in UTC, so SSR and the client agree about which month a review landed in. */
function monthLabel(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `D Mon YYYY` in UTC. */
function longDate(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ""
		: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A URL-safe anchor from a heading. */
function slugify(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// #endregion

// #region Gallery, pricing, trust

/** The catalogue gallery as the view's media strip. There is no separate thumbnail rendition yet. */
function galleryOf(catalog: Catalog, item: ExploreItem): EntityMedia[] {
	const frames: CatalogMedia[] = catalog.galleryById.get(item.id) ?? [];
	return frames.map((f, i) => ({
		src: f.src,
		placeholder: f.placeholder,
		thumb: f.src,
		thumbPlaceholder: f.placeholder,
		alt: f.alt || `${item.title} — view ${i + 1}`,
		kind: "image" as const,
	}));
}

/**
 * The lane's price block — the same shape the card helper (`pricing.servicePricing`) prints, so the
 * page agrees with the card that linked to it: a Pipeline as a `0.5×–2.0×` per-ticket range, a Session
 * per session, a Group Session per seat, everything else its fixed price.
 */
function pricingFor(item: ExploreItem): EntityPricing {
	switch (item.type) {
		case "services": {
			const currency = item.currency ?? "USD";
			if (item.serviceType === "Pipeline" && item.ticketPrice) {
				const min = Math.round(item.ticketPrice * PIPELINE_LOW);
				const max = Math.round(item.ticketPrice * PIPELINE_HIGH);
				return {
					mode: "pipeline",
					display: `${displayPrice(min * 100, currency)} – ${displayPrice(max * 100, currency)}`,
					caption: "Per ticket · scales with workload intensity",
					min,
					max,
				};
			}
			if (item.serviceType === "Session" && item.sessionPrice) {
				return {
					mode: "session",
					display: `${displayPrice(item.sessionPrice * 100, currency)} / session`,
					caption: "Billed per booked session",
				};
			}
			if (item.serviceType === "Group Session" && item.sessionPrice) {
				return {
					mode: "session",
					display: `${displayPrice(item.sessionPrice * 100, currency)} / seat`,
					caption: "Per attendee seat · booked per session",
				};
			}
			if (item.serviceType === "Direct Deliverable") {
				return { mode: "fixed", display: item.price, caption: "Fixed scope · one payment" };
			}
			return { mode: "fixed", display: item.price, caption: "One-off fixed price" };
		}
		case "products":
			return { mode: "fixed", display: item.price, caption: "One-time purchase" };
		case "freelancers": {
			const low = item.servicePrices?.length ? lowestActivePrice(item.servicePrices) : null;
			return low === null
				? { mode: "quote", display: "Contact for pricing" }
				: {
					mode: "quote",
					display: `from ${displayPrice(low * 100, "USD")}`,
					caption: "Across active services",
				};
		}
		case "projects":
			return item.budget
				? { mode: "quote", display: item.budget, caption: "Project budget" }
				: { mode: "quote", display: "Budget on request" };
		case "articles":
			return { mode: "quote", display: "Free to read", caption: `${item.readMinutes} min read` };
		default:
			return { mode: "quote", display: "Contact for pricing" };
	}
}

/** The listing's declared revision allowance as the trust row states it — or null if undeclared. */
function revisionsOf(item: ServiceItem, stageTicket: number): StageRevisions | null {
	if (item.freeRevisions === undefined && item.extraRevisionPrice === undefined) return null;
	const extra = item.extraRevisionPrice;
	const currency = item.currency ?? "USD";
	return {
		free: item.freeRevisions ?? 0,
		extraPrice: extra === 0
			? { min: 0, max: 0, label: "Free" }
			: extra === undefined
			? ticketPrice(stageTicket, stageTicket, currency)
			: ticketPrice(extra, extra, currency),
	};
}

/** One sentence per revision offer, classified by the SSOT so the trust row and the ledger agree. */
function revisionValue(revisions: StageRevisions): string {
	switch (revisionAllowanceKind(revisions)) {
		case "unlimited":
			return "Unlimited";
		case "metered":
			return "Billed per round";
		default:
			return `${revisions.free} included per stage`;
	}
}

/**
 * The operational facts under the lane's CTAs. Each is a fact the platform can stand behind: a
 * delivery window the seller declared, a revision offer they priced, a verification that happened,
 * and the escrow protection that is platform policy for every staged engagement. There is no reply
 * time — nothing measures one yet — and no refund window for products, because none is published.
 */
function trustFor(item: ExploreItem): TrustFact[] {
	const facts: TrustFact[] = [];
	if (item.type === "services") {
		if (item.delivery) facts.push({ icon: "delivery", label: "Delivery", value: item.delivery });
		const revisions = revisionsOf(item, item.ticketPrice ?? 0);
		if (revisions) {
			facts.push({ icon: "revisions", label: "Revisions", value: revisionValue(revisions) });
		}
	} else if (item.type === "products") {
		facts.push({ icon: "delivery", label: "Access", value: "Instant download" });
	} else if (item.type === "projects" && item.stage) {
		facts.push({ icon: "delivery", label: "Stage", value: item.stage });
	}
	const topRated = (item.rating?.asHelper?.value ?? 0) >= 4.8 &&
		(item.rating?.asHelper?.count ?? 0) >= 3 && !!item.owner.verified;
	facts.push({
		icon: "seller",
		label: "Seller",
		value: topRated ? "Top Rated · verified" : item.owner.verified ? "Verified seller" : "Active seller",
	});
	if (item.type === "services" || item.type === "projects") {
		facts.push({ icon: "escrow", label: "Protection", value: "Funds held in escrow" });
	}
	return facts;
}

// #endregion

// #region Rails

/** Other items by the same creator — the "More by …" rail. */
function moreByOwner(catalog: Catalog, item: ExploreItem): ExploreItem[] {
	return catalog.items
		.filter((it) =>
			it.owner.handle === item.owner.handle && it.id !== item.id &&
			(it.type === "services" || it.type === "products" || it.type === "articles")
		)
		.slice(0, 8);
}

/** Same type, same category first, a different owner preferred — the "Similar" rail. */
function similarTo(catalog: Catalog, item: ExploreItem): ExploreItem[] {
	const category = (it: ExploreItem) =>
		it.type === "services" || it.type === "products" ? it.category : null;
	return catalog.items
		.filter((it) => it.id !== item.id && it.type === item.type)
		.map((it) => ({
			it,
			score: (category(it) !== null && category(it) === category(item) ? 2 : 0) +
				(it.owner.handle !== item.owner.handle ? 1 : 0) +
				(it.owner.verified ? 1 : 0),
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, 8)
		.map((s) => s.it);
}

// #endregion

// #region Reviews

interface ReviewRow {
	id: string;
	reviewer_user_id: string;
	project_id: string | null;
	rating: number | string;
	title: string | null;
	comment: string;
	created_at: string;
}

/** The review subject a view item is scored under, or null for items nobody reviews directly. */
function reviewSubject(catalog: Catalog, item: ExploreItem): { id: string; type: string } | null {
	if (item.type === "services") {
		const bp = catalog.blueprintBySlug.get(item.id);
		return bp ? { id: bp.id, type: "service_blueprint" } : null;
	}
	if (item.type === "products") {
		const pr = catalog.productBySlug.get(item.id);
		return pr ? { id: pr.id, type: "product" } : null;
	}
	return null;
}

/** The directory row as a review byline; a reviewer outside the public directory stays anonymous. */
function authorOf(row: ProfileRow | undefined): ExploreOwner {
	if (!row) return { handle: "", name: "Projective member", avatar: "", kind: "user" };
	return {
		handle: `@${row.handle}`,
		name: row.name,
		avatar: publicObjectUrl(row.avatar_bucket, row.avatar_path) ?? "",
		kind: row.entity_type,
		verified: row.verified,
	};
}

async function reviewsFor(
	catalog: Catalog,
	item: ExploreItem,
): Promise<{ summary: ReviewSummary; list: EntityReview[] }> {
	const empty = { summary: { average: 0, count: 0, distribution: [0, 0, 0, 0, 0] }, list: [] };
	const subject = reviewSubject(catalog, item);
	if (!subject) return empty;
	const { data, error } = await getAnonClient()
		.schema("reviews")
		.from("entity_reviews")
		.select("id, reviewer_user_id, project_id, rating, title, comment, created_at")
		.eq("target_entity_id", subject.id)
		.eq("target_entity_type", subject.type)
		.order("created_at", { ascending: false })
		.limit(100);
	if (error) throw new Error(`explore view: reading reviews failed — ${error.message}`);
	const rows = (data ?? []) as ReviewRow[];
	if (!rows.length) return empty;

	const distribution = [0, 0, 0, 0, 0];
	let total = 0;
	const list: EntityReview[] = rows.map((r) => {
		const rating = Number(r.rating);
		total += rating;
		distribution[Math.min(4, Math.max(0, Math.round(rating) - 1))]++;
		return {
			id: r.id,
			author: authorOf(catalog.profileById.get(r.reviewer_user_id)),
			rating,
			track: "helper" as const,
			title: r.title ?? "",
			body: r.comment,
			createdAt: r.created_at,
			dateLabel: monthLabel(r.created_at),
			// No reviews table carries the other party's rating back, so reciprocity is unknown — false.
			reciprocal: false,
			// A review tied to a delivered engagement; a listing review with no project is not.
			verifiedEngagement: r.project_id !== null,
		};
	});
	const average = Math.round((total / rows.length) * 100) / 100;
	return {
		summary: {
			average,
			count: rows.length,
			distribution,
			asHelper: { value: average, count: rows.length },
		},
		list,
	};
}

// #endregion

// #region Seller

/** The attained tier label. A verified entity with no recorded level has no tier to disclose. */
function tierOf(row: ProfileRow | undefined): ProfileTier | null {
	if (!row?.verified || !row.verification_tier) return null;
	const tier = `L${Math.min(3, Math.max(1, row.verification_tier))}` as ProfileTier;
	return tier;
}

/** The provider line's facts, from the same directory row the profile header reads. */
function sellerFor(catalog: Catalog, item: ExploreItem): EntitySeller {
	const row = catalog.profileByHandle.get(item.owner.handle);
	if (!row) return { headline: "", tier: null, standing: null };
	// The rung comes from the public directory row, under the profile's own rule: a seller with no
	// computed standing reads as "New", and a buyer has none.
	const level = Number(row.standing_level);
	const standing = Number.isInteger(level) && level >= 1 && level <= 5 && row.standing_label
		? { level, label: row.standing_label.slice(0, 40) }
		: null;
	return { headline: (row.headline ?? "").slice(0, 160), tier: tierOf(row), standing };
}

// #endregion

// #region Service extension

const SERVICE_MODEL: Record<ServiceItem["serviceType"], ServiceModel> = {
	"Pipeline": "pipeline",
	"One-Off": "one-off",
	"Direct Deliverable": "direct",
	"Session": "session",
	"Group Session": "group-session",
};

function serviceViewFor(catalog: Catalog, item: ServiceItem): ServiceViewExtra | undefined {
	const bp = catalog.blueprintBySlug.get(item.id);
	if (!bp) return undefined;
	const model = SERVICE_MODEL[item.serviceType];
	const isPipeline = model === "pipeline";
	const showcaseStages = model === "pipeline" || model === "one-off";
	const bookable = model === "session" || model === "group-session";
	const group = model === "group-session";
	const currency = item.currency ?? "USD";

	const template = parseStoredList(BlueprintStageSchema, bp.stage_template);
	const stages: ProjectStage[] = showcaseStages
		? template.map((st, i) => {
			const standard = (st.priceCents ?? 0) / 100;
			const price = st.priceCents === undefined
				? { min: 0, max: 0, label: "Priced on scope" }
				: isPipeline
				? ticketPrice(standard * PIPELINE_LOW, standard * PIPELINE_HIGH, currency)
				: ticketPrice(standard, standard, currency, "");
			const revisions = revisionsOf(item, price.min);
			return {
				id: `stage-${i + 1}-${slugify(st.name)}`,
				index: i + 1,
				name: st.name,
				description: st.description,
				status: "upcoming" as ProjectStageStatus,
				seatKind: "seats" as const,
				openSeats: 0,
				seatsTotal: 0,
				seatsFilled: 0,
				roles: [],
				price,
				skills: st.skills.map(resolveSkill),
				deliverables: st.deliverables,
				turnaround: st.turnaround,
				dependency: i > 0 ? `After ${template[i - 1].name}` : undefined,
				revisions: revisions ?? undefined,
			};
		})
		: [];

	const roles: ServiceRole[] = model === "direct"
		? parseStoredList(BlueprintTeamRoleSchema, bp.team_roles).map((r) => ({
			name: r.name,
			summary: r.summary,
			skills: r.skills.map(resolveSkill),
			count: r.count,
		}))
		: [];

	const seatsPerSession = group ? bp.max_seats_per_cohort : undefined;
	const sessionMinutes = bookable ? bp.session_minutes ?? undefined : undefined;
	const sessionCount = model === "session" ? bp.session_count ?? 1 : undefined;
	const bookingSummary = bookable
		? group
			? `${item.delivery}${seatsPerSession ? ` · up to ${seatsPerSession} seats` : ""}`
			: (sessionCount ?? 1) > 1 && sessionMinutes
			? `${sessionCount} × ${sessionMinutes} min sessions`
			: item.delivery
		: undefined;

	return {
		model,
		modelLabel: item.serviceType,
		showcaseStages,
		stages,
		roles,
		bookable,
		group,
		seatsPerSession,
		bookingSummary,
		sessionCount,
		sessionMinutes,
		intake: parseStoredList(IntakeFieldSchema, bp.intake_fields),
	};
}

// #endregion

// #region Product extension

/**
 * The template the product page previews with. The stored `format` is the delivery taxonomy
 * (`catalogue.product_format`: download, template, preset, source_code, …); the view's format is the
 * PREVIEW taxonomy (3D, audio, video preset, code kit, …). A `download` or `bundle` says nothing about
 * what is inside, so its category decides; every other stored format maps directly.
 */
function viewFormatOf(stored: string, category: string, title: string): ProductFormat {
	switch (stored) {
		case "template":
			return "template";
		case "source_code":
			return "code-kit";
		case "preset":
			return /motion|video|lut|grade/i.test(`${category} ${title}`) ? "video-preset" : "graphic";
		case "font":
		case "ebook":
			return "template";
		case "course":
			return "video-preset";
	}
	const haystack = `${category} ${title}`;
	if (/3d|model|blender|render|scene/i.test(haystack)) return "asset-3d";
	if (/audio|sound|music|stem|sample/i.test(haystack)) return "audio";
	return "graphic";
}

const FORMAT_LABEL: Record<ProductFormat, string> = {
	"template": "Template",
	"asset-3d": "3D asset",
	"audio": "Audio stems",
	"video-preset": "Video preset",
	"code-kit": "Code kit",
	"graphic": "Graphic pack",
};

function productViewFor(
	catalog: Catalog,
	item: Extract<ExploreItem, { type: "products" }>,
): ProductViewExtra | undefined {
	const pr = catalog.productBySlug.get(item.id);
	if (!pr) return undefined;
	const format = viewFormatOf(pr.format, pr.category, item.title);
	const files: ProductFile[] = parseStoredList(ProductManifestEntrySchema, pr.file_manifest).map(
		(f) => ({ extension: f.extension, label: f.label, bytes: f.bytes, sizeLabel: byteLabel(f.bytes) }),
	);
	const payloadBytes = files.reduce((sum, f) => sum + f.bytes, 0);
	const cover = catalog.galleryById.get(item.id)?.[0];
	return {
		format,
		formatLabel: FORMAT_LABEL[format],
		files,
		payloadBytes,
		payloadLabel: payloadBytes > 0 ? byteLabel(payloadBytes) : "",
		specs: parseStoredList(StoredProductSpecSchema, pr.specs),
		compatibility: parseStoredList(StoredProductCompatSchema, pr.compatibility),
		licence: licenceTerms(pr.licence, pr.attribution_required),
		// The one artefact that genuinely exists is the cover; an audio clip or a code excerpt would
		// have to be invented, so the canvas shows the picture the seller uploaded.
		preview: cover ? { kind: "image", src: cover.src } : undefined,
	};
}

// #endregion

// #region Article extension

function articleViewFor(
	catalog: Catalog,
	item: Extract<ExploreItem, { type: "articles" }>,
): ArticleViewExtra | undefined {
	const row = catalog.articleBySlug.get(item.id);
	if (!row) return undefined;
	const stored = parseStoredList(StoredArticleBlockSchema, row.body);
	const toc: ArticleTocEntry[] = [];
	const assets: ArticleAsset[] = [];
	const blocks: ArticleBlock[] = stored.flatMap((b): ArticleBlock[] => {
		switch (b.type) {
			case "heading":
			case "subheading": {
				const id = b.id ?? slugify(b.text);
				toc.push({ id, text: b.text, level: b.type === "heading" ? 2 : 3 });
				return [{ type: b.type, id, text: b.text }];
			}
			case "paragraph":
			case "quote":
				return [{ type: b.type, text: b.text }];
			case "list":
				return [{ type: "list", items: b.items }];
			case "image": {
				const src = publicObjectUrl(b.bucket, b.path);
				if (!src) return [];
				assets.push({ kind: "image", src, thumb: src, label: b.alt || item.title });
				return [{ type: "image", src, thumb: src, alt: b.alt, caption: b.caption }];
			}
		}
	});
	const publishedAt = row.published_at ?? row.created_at;
	return {
		thumbnail: item.media ?? "",
		publishedAt,
		publishedLabel: longDate(publishedAt),
		readMinutes: row.read_minutes,
		topic: row.topic,
		blocks,
		toc,
		assets,
		// There is no comments table; the discussion section renders its empty state.
		comments: [],
	};
}

// #endregion

// #region Project extension

/** The stored stage status as the stage-flow treatment. */
function stageStatus(status: string): ProjectStageStatus {
	if (status === "approved" || status === "paid") return "completed";
	if (status === "in_progress" || status === "assigned" || status === "submitted" || status === "revisions") {
		return "active";
	}
	return "upcoming";
}

function projectViewFor(
	catalog: Catalog,
	item: Extract<ExploreItem, { type: "projects" }>,
): ProjectViewExtra | undefined {
	const entry = catalog.projectBySlug.get(item.id);
	if (!entry) return undefined;
	const { row, stages, roles, seats } = entry;
	const currency = row.currency;
	const owner = catalog.profileByHandle.get(item.owner.handle);

	const flow: ProjectStage[] = stages.map((s, i) => {
		const stageRoles = roles.filter((r) => r.project_stage_id === s.id);
		const openSeatRows = seats.filter((o) => o.project_stage_id === s.id && o.status !== "filled");
		const unit = (s.unit_price_cents ?? 0) / 100;
		const roleList: StageRole[] = stageRoles.map((r) => {
			const each = (r.budget_amount_cents ?? s.unit_price_cents ?? 0) / 100;
			return {
				name: r.role_title,
				openSeats: Math.max(1, r.quantity ?? 1),
				price: ticketPrice(each, each, currency),
			};
		});
		const seatKind = roleList.length ? "roles" as const : "seats" as const;
		const openSeats = seatKind === "roles"
			? roleList.reduce((sum, r) => sum + r.openSeats, 0)
			: openSeatRows.length;
		const seatsTotal = Math.max(openSeats, s.seat_count ?? s.seat_limit ?? openSeats);
		const seatPrice = openSeatRows.length
			? ticketPrice(
				Math.min(...openSeatRows.map((o) => (o.budget_min_cents ?? s.unit_price_cents ?? 0) / 100)),
				Math.max(...openSeatRows.map((o) => (o.budget_max_cents ?? s.unit_price_cents ?? 0) / 100)),
				currency,
			)
			: ticketPrice(unit, unit, currency);
		const price = seatKind === "roles" && roleList.length
			? ticketPrice(
				Math.min(...roleList.map((r) => r.price.min)),
				Math.max(...roleList.map((r) => r.price.max)),
				currency,
			)
			: seatPrice;
		return {
			id: s.slug,
			index: i + 1,
			name: s.name,
			description: s.description_text ?? "",
			status: stageStatus(s.status),
			seatKind,
			seatSummary: seatKind === "seats" ? openSeatRows[0]?.description_of_need ?? undefined : undefined,
			openSeats,
			seatsTotal,
			seatsFilled: Math.max(0, seatsTotal - openSeats),
			roles: roleList,
			price,
			skills: (s.skills ?? []).map(resolveSkill),
			dependency: i > 0 && !s.parallel ? `After ${stages[i - 1].name}` : undefined,
		};
	});

	const openSeats = flow.reduce((sum, s) => sum + s.openSeats, 0);
	const totalSeats = flow.reduce((sum, s) => sum + s.seatsTotal, 0);
	const priced = flow.filter((s) => s.price.max > 0);
	const projectTicket = priced.length
		? ticketPrice(
			Math.min(...priced.map((s) => s.price.min)),
			Math.max(...priced.map((s) => s.price.max)),
			currency,
		)
		: { min: 0, max: 0, label: "Priced per stage" };
	const classification = item.classification;
	const current = flow.find((s) => s.status === "active") ?? flow.find((s) => s.status === "upcoming");
	const metrics: ProjectMetric[] = [
		{ icon: "type", label: "Type", value: classification === "pipeline" ? "Pipeline" : "One-Off" },
		{ icon: "stages", label: "Stages", value: String(flow.length) },
		{ icon: "seats", label: "Open seats", value: String(openSeats) },
	];
	if (projectTicket.max > 0) metrics.push({ icon: "ticket", label: "Ticket", value: projectTicket.label });
	if (item.roles.length) metrics.push({ icon: "roles", label: "Roles", value: String(item.roles.length) });

	return {
		banner: owner ? publicObjectUrl(owner.banner_bucket, owner.banner_path) ?? "" : "",
		ownerHeadline: owner?.headline ?? "",
		ownerVerified: !!owner?.verified,
		classification,
		classificationLabel: classification === "pipeline" ? "Pipeline" : "One-Off",
		stage: classification === "pipeline" ? current?.name : undefined,
		stages: flow,
		finance: { ticketPrice: projectTicket, openSeats, totalSeats },
		metrics,
	};
}

// #endregion

// #region Deliverables

/** The "what you get" list: the seller's own words, never a restatement of the listing's metadata. */
function deliverablesFor(catalog: Catalog, item: ExploreItem): string[] {
	if (item.type === "services") {
		const bp = catalog.blueprintBySlug.get(item.id);
		const declared = bp?.deliverables ?? [];
		if (declared.length) return declared;
		return parseStoredList(BlueprintStageSchema, bp?.stage_template).flatMap((s) => s.deliverables)
			.slice(0, 8);
	}
	if (item.type === "products") {
		const pr = catalog.productBySlug.get(item.id);
		return parseStoredList(ProductManifestEntrySchema, pr?.file_manifest).map((f) =>
			`${f.label} (${f.extension})`
		);
	}
	if (item.type === "projects") return item.roles;
	return [];
}

// #endregion

/**
 * The composed page for an item from the most recently LOADED catalogue, synchronously and without
 * reviews — for the synchronous booking and instantiate paths, which resolved the item from that same
 * snapshot a line earlier. `null` only when no catalogue has loaded in this process.
 */
export function composeLoadedViewPage(item: ExploreItem): EntityView | null {
	const catalog = peekCatalog();
	return catalog ? composeViewPage(catalog, item) : null;
}

/** The reviews block for an item with none loaded — what a caller that needs no reviews passes. */
export const NO_REVIEWS: EntityView["reviews"] = {
	summary: { average: 0, count: 0, distribution: [0, 0, 0, 0, 0] },
	list: [],
};

/** Compose the full `/view/[id]` payload for a catalogue item, reviews included. */
export async function buildLiveViewPage(catalog: Catalog, item: ExploreItem): Promise<EntityView> {
	return composeViewPage(catalog, item, await reviewsFor(catalog, item));
}

/**
 * Compose the page SYNCHRONOUSLY from an already-loaded catalogue, with the reviews supplied.
 *
 * The booking and instantiate paths need the listing's service shape (its model, session format,
 * stage template and intake questions) and nothing about its reviews; they call this with
 * {@link NO_REVIEWS} rather than paying for a reviews read they would discard. One composer serves
 * both, so the booking flow validates answers against exactly the intake the page rendered.
 */
export function composeViewPage(
	catalog: Catalog,
	item: ExploreItem,
	reviews: EntityView["reviews"] = NO_REVIEWS,
): EntityView {
	return {
		item,
		seller: sellerFor(catalog, item),
		gallery: galleryOf(catalog, item),
		pricing: pricingFor(item),
		trust: trustFor(item),
		deliverables: deliverablesFor(catalog, item),
		moreByOwner: moreByOwner(catalog, item),
		similar: similarTo(catalog, item),
		reviews,
		project: item.type === "projects" ? projectViewFor(catalog, item) : undefined,
		article: item.type === "articles" ? articleViewFor(catalog, item) : undefined,
		service: item.type === "services" ? serviceViewFor(catalog, item) : undefined,
		product: item.type === "products" ? productViewFor(catalog, item) : undefined,
	};
}
