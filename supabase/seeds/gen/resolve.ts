/**
 * resolve.ts — turn the world spec's keys into ids, and the image assignments into asset rows.
 *
 * Every emitter reads the SAME resolved world, so a project's stage id in `06_projects.sql` is the
 * one its escrow references in `07_finance.sql` and its channel references in `08_comms.sql`. Ids
 * come from `uuidFor(namespace, key)`; an unknown key throws here, at generate time, which is the
 * only place a dangling reference is cheap to find.
 */

import { ARTICLES, PRODUCTS, SERVICES } from "./corpus.ts";
import { imageSize, mimeOf } from "./images.ts";
import { PORTFOLIO, SHOWCASES } from "./profiles.ts";
import { slugFor, uuidFor } from "./sql.ts";
import {
	ENTITIES,
	type Entity,
	type Persona,
	PERSONAS,
	PRODUCT_COVERS,
	PROJECTS,
	type ProjectSpec,
	SERVICE_COVERS,
} from "./world.ts";


// #region Types
export interface ResolvedPersona extends Persona {
	userId: string;
	email: string;
}

export interface ResolvedEntity extends Entity {
	entityId: string;
	ownerUserId: string;
	/** The wallet for this entity (`owner_type` = kind). */
	walletId: string;
}

/** A corpus principal (`@handle`) resolved to the account that owns its listings. */
export interface Principal {
	corpusHandle: string;
	kind: "user" | "freelancer" | "team" | "business";
	/** The account rows are written against. Team/business listings are owned by the owner account. */
	accountUserId: string;
	/** The team or business id, when the principal is an entity. */
	entityKey?: string;
	entityId?: string;
}

export interface Asset {
	id: string;
	bucket: "avatars" | "catalogue" | "project" | "showcase" | "public_assets";
	/**
	 * `files.items.purpose`. Absent = `library` (an upload the owner can pick again); `showcase` is a
	 * rendition the profile hero shows — the only kind the `showcase` bucket holds.
	 */
	purpose?: "library" | "showcase";
	/** Object name inside the bucket — first segment is the RLS anchor. */
	path: string;
	/** The file under `test_images/` the bytes come from. */
	source: string;
	displayName: string;
	ownerUserId: string;
	ownerType: "user" | "team" | "business";
	ownerEntityId: string | null;
	visibility: "public" | "link";
	mime: string;
	sizeBytes: number;
	width: number | null;
	height: number | null;
	sha256: string;
	createdDaysAgo: number;
}

export interface ResolvedStage {
	id: string;
	slug: string;
	key: string;
}

export interface ResolvedTicket {
	id: string;
	slug: string;
	key: string;
	escrowId: string | null;
}

export interface ResolvedProject extends ProjectSpec {
	projectId: string;
	slug: string;
	/** `client_business_id` when the client is a business, else null. */
	clientBusinessId: string | null;
	clientPersonaId: string | null;
	ownerUserId: string;
	stagesByKey: Map<string, ResolvedStage>;
	ticketsByKey: Map<string, ResolvedTicket>;
	/** `general` + one per stage key → `comms.project_channels.id`. */
	channelsByKey: Map<string, string>;
	submissionsByKey: Map<string, string>;
}

export interface World {
	personas: Map<string, ResolvedPersona>;
	entities: Map<string, ResolvedEntity>;
	principals: Map<string, Principal>;
	projects: Map<string, ResolvedProject>;
	assets: Asset[];
	/** persona key → avatar / banner asset. */
	personaAvatar: Map<string, Asset>;
	personaBanner: Map<string, Asset>;
	entityAvatar: Map<string, Asset>;
	entityBanner: Map<string, Asset>;
	/** persona key → experience index → logo asset. */
	experienceLogo: Map<string, Asset>;
	serviceCover: Map<string, Asset>;
	productCover: Map<string, Asset>;
	/** Article key → cover asset. */
	articleCover: Map<string, Asset>;
	/** `${articleKey}:${test_images filename}` → inline body image asset. */
	articleImage: Map<string, Asset>;
	/** submission key (`project:sub`) → deliverable assets. */
	submissionFiles: Map<string, Asset[]>;
	/** Persona or entity key → its showcase renditions, slot 1 first (`profiles.ts` `SHOWCASES`). */
	showcaseSlots: Map<string, Array<{ asset: Asset; alt: string }>>;
	/** `${personaKey}:${index}` → a "Selected work" piece's cover (`profiles.ts` `PORTFOLIO`). */
	portfolioCover: Map<string, Asset>;
	/** Corpus listing id → its database id. */
	serviceId: (corpusId: string) => string;
	productId: (corpusId: string) => string;
	articleId: (corpusId: string) => string;
	listingId: (corpusId: string) => string;
}
// #endregion

// #region Lookups
export type Lookup = Pick<World, "personas" | "entities">;

export function persona(world: Lookup, key: string): ResolvedPersona {
	const p = world.personas.get(key);
	if (!p) throw new Error(`world: unknown persona "${key}"`);
	return p;
}

export function entity(world: Lookup, key: string): ResolvedEntity {
	const e = world.entities.get(key);
	if (!e) throw new Error(`world: unknown entity "${key}"`);
	return e;
}

/** A key that may name a persona OR an entity — returns whichever it is. */
export function party(world: Lookup, key: string): { kind: "user"; persona: ResolvedPersona } | {
	kind: "team" | "business";
	entity: ResolvedEntity;
} {
	const p = world.personas.get(key);
	if (p) return { kind: "user", persona: p };
	const e = world.entities.get(key);
	if (e) return { kind: e.kind, entity: e };
	throw new Error(`world: "${key}" is neither a persona nor an entity`);
}

export function project(world: World, key: string): ResolvedProject {
	const p = world.projects.get(key);
	if (!p) throw new Error(`world: unknown project "${key}"`);
	return p;
}

export function walletIdFor(ownerType: string, ownerId: string): string {
	return uuidFor("wallet", `${ownerType}:${ownerId}:USD`);
}
// #endregion

// #region Build
const IMAGE_DIR = new URL("../../../test_images/", import.meta.url);

async function readImage(name: string): Promise<{ bytes: Uint8Array; sha256: string }> {
	const bytes = await Deno.readFile(new URL(name, IMAGE_DIR));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
	return { bytes, sha256 };
}

const imageCache = new Map<
	string,
	{ size: ReturnType<typeof imageSize>; bytes: number; sha256: string }
>();

async function imageFacts(name: string) {
	let facts = imageCache.get(name);
	if (!facts) {
		const { bytes, sha256 } = await readImage(name);
		facts = { size: imageSize(bytes), bytes: bytes.byteLength, sha256 };
		imageCache.set(name, facts);
	}
	return facts;
}

async function asset(
	spec: Omit<Asset, "id" | "mime" | "sizeBytes" | "width" | "height" | "sha256">,
): Promise<Asset> {
	const facts = await imageFacts(spec.source);
	return {
		...spec,
		id: uuidFor("asset", `${spec.bucket}/${spec.path}`),
		mime: mimeOf(spec.source),
		sizeBytes: facts.bytes,
		width: facts.size?.width ?? null,
		height: facts.size?.height ?? null,
		sha256: facts.sha256,
	};
}

function extOf(name: string): string {
	return name.toLowerCase().split(".").pop() ?? "bin";
}

export async function buildWorld(): Promise<World> {
	const personas = new Map<string, ResolvedPersona>();
	for (const p of PERSONAS) {
		personas.set(p.key, {
			...p,
			userId: uuidFor("user", p.handle),
			email: `${p.handle}@projective.dev`,
		});
	}

	const entities = new Map<string, ResolvedEntity>();
	for (const e of ENTITIES) {
		const owner = personas.get(e.owner);
		if (!owner) throw new Error(`world: entity "${e.key}" owner "${e.owner}" is unknown`);
		const entityId = uuidFor(e.kind, e.slug);
		entities.set(e.key, {
			...e,
			entityId,
			ownerUserId: owner.userId,
			walletId: walletIdFor(e.kind, entityId),
		});
	}

	// Every corpus principal must resolve to an account, or a listing's FK dangles.
	const principals = new Map<string, Principal>();
	for (const p of personas.values()) {
		if (p.corpusHandle) {
			principals.set(p.corpusHandle, {
				corpusHandle: p.corpusHandle,
				kind: p.role === "freelancer" ? "freelancer" : "user",
				accountUserId: p.userId,
			});
		}
	}
	for (const e of entities.values()) {
		principals.set(e.corpusHandle, {
			corpusHandle: e.corpusHandle,
			kind: e.kind,
			accountUserId: e.ownerUserId,
			entityKey: e.key,
			entityId: e.entityId,
		});
	}
	for (const item of [...SERVICES, ...PRODUCTS, ...ARTICLES]) {
		if (!principals.has(item.owner)) {
			throw new Error(
				`world: corpus item "${item.key}" is owned by ${item.owner}, which no persona or entity claims`,
			);
		}
	}

	// Assets.
	const assets: Asset[] = [];
	const personaAvatar = new Map<string, Asset>();
	const personaBanner = new Map<string, Asset>();
	const entityAvatar = new Map<string, Asset>();
	const entityBanner = new Map<string, Asset>();
	const experienceLogo = new Map<string, Asset>();
	const serviceCover = new Map<string, Asset>();
	const productCover = new Map<string, Asset>();
	const articleCover = new Map<string, Asset>();
	const articleImage = new Map<string, Asset>();
	const submissionFiles = new Map<string, Asset[]>();

	for (const p of personas.values()) {
		if (p.avatar) {
			const a = await asset({
				bucket: "avatars",
				path: `${p.userId}/avatar.${extOf(p.avatar)}`,
				source: p.avatar,
				displayName: `${p.name} — profile photo`,
				ownerUserId: p.userId,
				ownerType: "user",
				ownerEntityId: null,
				visibility: "public",
				createdDaysAgo: p.joinedDaysAgo - 1,
			});
			assets.push(a);
			personaAvatar.set(p.key, a);
		}
		if (p.banner) {
			const a = await asset({
				bucket: "avatars",
				path: `${p.userId}/banner.${extOf(p.banner)}`,
				source: p.banner,
				displayName: `${p.name} — profile banner`,
				ownerUserId: p.userId,
				ownerType: "user",
				ownerEntityId: null,
				visibility: "public",
				createdDaysAgo: p.joinedDaysAgo - 2,
			});
			assets.push(a);
			personaBanner.set(p.key, a);
		}
		for (const [i, x] of (p.experience ?? []).entries()) {
			if (!x.logo) continue;
			const a = await asset({
				bucket: "avatars",
				path: `${p.userId}/logos/${x.org.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${
					extOf(x.logo)
				}`,
				source: x.logo,
				displayName: `${x.org} — logo`,
				ownerUserId: p.userId,
				ownerType: "user",
				ownerEntityId: null,
				visibility: "public",
				createdDaysAgo: p.joinedDaysAgo - 3,
			});
			assets.push(a);
			experienceLogo.set(`${p.key}:${i}`, a);
		}
	}

	for (const e of entities.values()) {
		if (e.avatar) {
			const noun = e.kind === "team" ? "avatar" : "logo";
			const a = await asset({
				bucket: "avatars",
				path: `${e.entityId}/${noun}.${extOf(e.avatar)}`,
				source: e.avatar,
				displayName: `${e.name} — ${noun}`,
				ownerUserId: e.ownerUserId,
				ownerType: e.kind,
				ownerEntityId: e.entityId,
				visibility: "public",
				createdDaysAgo: e.createdDaysAgo - 1,
			});
			assets.push(a);
			entityAvatar.set(e.key, a);
		}
		if (e.banner) {
			const a = await asset({
				bucket: "avatars",
				path: `${e.entityId}/banner.${extOf(e.banner)}`,
				source: e.banner,
				displayName: `${e.name} — banner`,
				ownerUserId: e.ownerUserId,
				ownerType: e.kind,
				ownerEntityId: e.entityId,
				visibility: "public",
				createdDaysAgo: e.createdDaysAgo - 1,
			});
			assets.push(a);
			entityBanner.set(e.key, a);
		}
	}

	// Profile presentation (`profiles.ts`). A showcase slot is laid out exactly as the media pipeline
	// writes a rendition — `{owner}/showcase/{rendition}/full.{ext}` in the public `showcase` bucket —
	// so a seeded slot and an uploaded one are indistinguishable to every reader. A portfolio cover is
	// an ordinary library upload in `public_assets`, which is also what makes it pickable again from the
	// owner's media library.
	const showcaseSlots = new Map<string, Array<{ asset: Asset; alt: string }>>();
	for (const spec of SHOWCASES) {
		if (spec.slots.length === 0 || spec.slots.length > 6) {
			throw new Error(`profiles: showcase "${spec.owner}" must have one to six slots`);
		}
		const owner = party({ personas, entities }, spec.owner);
		const ownerId = owner.kind === "user" ? owner.persona.userId : owner.entity.entityId;
		const slots: Array<{ asset: Asset; alt: string }> = [];
		for (const [i, slot] of spec.slots.entries()) {
			const rendition = uuidFor("showcase-rendition", `${spec.owner}:${i + 1}`);
			const a = await asset({
				bucket: "showcase",
				path: `${ownerId}/showcase/${rendition}/full.${extOf(slot.image)}`,
				source: slot.image,
				displayName: `${owner.kind === "user" ? owner.persona.name : owner.entity.name} — showcase ${i + 1}`,
				ownerUserId: owner.kind === "user" ? owner.persona.userId : owner.entity.ownerUserId,
				ownerType: owner.kind,
				ownerEntityId: owner.kind === "user" ? null : owner.entity.entityId,
				visibility: "public",
				purpose: "showcase",
				createdDaysAgo: 30 - i,
			});
			assets.push(a);
			slots.push({ asset: a, alt: slot.alt });
		}
		showcaseSlots.set(spec.owner, slots);
	}

	const portfolioCover = new Map<string, Asset>();
	const pieceIndex = new Map<string, number>();
	for (const piece of PORTFOLIO) {
		const p = persona({ personas, entities }, piece.persona);
		const i = pieceIndex.get(piece.persona) ?? 0;
		pieceIndex.set(piece.persona, i + 1);
		const a = await asset({
			bucket: "public_assets",
			path: `${p.userId}/portfolio/${i + 1}.${extOf(piece.image)}`,
			source: piece.image,
			displayName: `${piece.title} — cover`,
			ownerUserId: p.userId,
			ownerType: "user",
			ownerEntityId: null,
			visibility: "public",
			createdDaysAgo: 60 - i * 7,
		});
		assets.push(a);
		portfolioCover.set(`${piece.persona}:${i}`, a);
	}

	for (const s of SERVICES) {
		const cover = SERVICE_COVERS[s.key];
		if (!cover) continue;
		const owner = principals.get(s.owner)!;
		const a = await asset({
			bucket: "catalogue",
			path: `${owner.accountUserId}/services/${s.key}.${extOf(cover)}`,
			source: cover,
			displayName: `${s.title} — cover`,
			ownerUserId: owner.accountUserId,
			ownerType: owner.entityId ? owner.kind as "team" | "business" : "user",
			ownerEntityId: owner.entityId ?? null,
			visibility: "public",
			createdDaysAgo: 90,
		});
		assets.push(a);
		serviceCover.set(s.key, a);
	}
	for (const p of PRODUCTS) {
		const cover = PRODUCT_COVERS[p.key];
		if (!cover) continue;
		const owner = principals.get(p.owner)!;
		const a = await asset({
			bucket: "catalogue",
			path: `${owner.accountUserId}/products/${p.key}.${extOf(cover)}`,
			source: cover,
			displayName: `${p.title} — cover`,
			ownerUserId: owner.accountUserId,
			ownerType: owner.entityId ? owner.kind as "team" | "business" : "user",
			ownerEntityId: owner.entityId ?? null,
			visibility: "public",
			createdDaysAgo: 80,
		});
		assets.push(a);
		productCover.set(p.key, a);
	}
	// Articles: a cover, plus one stored object per distinct inline image — the body references the
	// OBJECT (bucket + path), never a URL, so the live reader builds the address the same way it builds
	// every other image on the platform.
	for (const art of ARTICLES) {
		const owner = principals.get(art.owner)!;
		const ownerType = owner.entityId ? owner.kind as "team" | "business" : "user";
		const cover = await asset({
			bucket: "catalogue",
			path: `${owner.accountUserId}/articles/${art.key}/cover.${extOf(art.cover)}`,
			source: art.cover,
			displayName: `${art.title} — cover`,
			ownerUserId: owner.accountUserId,
			ownerType,
			ownerEntityId: owner.entityId ?? null,
			visibility: "public",
			createdDaysAgo: 40,
		});
		assets.push(cover);
		articleCover.set(art.key, cover);
		for (const block of art.blocks) {
			if (block.type !== "image") continue;
			const key = `${art.key}:${block.asset}`;
			if (articleImage.has(key)) continue;
			const a = await asset({
				bucket: "catalogue",
				path: `${owner.accountUserId}/articles/${art.key}/${block.asset}`,
				source: block.asset,
				displayName: block.alt ?? art.title,
				ownerUserId: owner.accountUserId,
				ownerType,
				ownerEntityId: owner.entityId ?? null,
				visibility: "public",
				createdDaysAgo: 40,
			});
			assets.push(a);
			articleImage.set(key, a);
		}
	}

	// Projects.
	const projects = new Map<string, ResolvedProject>();
	for (const spec of PROJECTS) {
		const projectId = uuidFor("project", spec.corpusId ?? spec.key);
		const client = party({ personas, entities }, spec.client);
		const owner = personas.get(spec.owner);
		if (!owner) throw new Error(`world: project "${spec.key}" owner "${spec.owner}" is unknown`);
		const stagesByKey = new Map<string, ResolvedStage>();
		for (const s of spec.stages) {
			stagesByKey.set(s.key, {
				key: s.key,
				id: uuidFor("stage", `${spec.key}:${s.key}`),
				slug: slugFor("stg", `${spec.key}:${s.key}`),
			});
		}
		const ticketsByKey = new Map<string, ResolvedTicket>();
		for (const t of spec.tickets) {
			if (!stagesByKey.has(t.stage)) {
				throw new Error(`world: ticket "${spec.key}:${t.key}" names unknown stage "${t.stage}"`);
			}
			ticketsByKey.set(t.key, {
				key: t.key,
				id: uuidFor("ticket", `${spec.key}:${t.key}`),
				slug: slugFor("tkt", `${spec.key}:${t.key}`),
				escrowId: t.payment === "unpaid" ? null : uuidFor("escrow", `${spec.key}:${t.key}`),
			});
		}
		const channelsByKey = new Map<string, string>();
		channelsByKey.set("general", uuidFor("channel", `${spec.key}:general`));
		for (const s of spec.stages) {
			channelsByKey.set(s.key, uuidFor("channel", `${spec.key}:${s.key}:stage_all`));
		}
		const submissionsByKey = new Map<string, string>();
		for (const sub of spec.submissions) {
			const submissionId = uuidFor("submission", `${spec.key}:${sub.key}`);
			submissionsByKey.set(sub.key, submissionId);
			const stage = stagesByKey.get(spec.tickets.find((t) => t.key === sub.ticket)!.stage)!;
			const by = personas.get(sub.by);
			if (!by) throw new Error(`world: submission "${spec.key}:${sub.key}" by unknown "${sub.by}"`);
			const files: Asset[] = [];
			for (const [source, name] of sub.files) {
				files.push(
					await asset({
						bucket: "project",
						path: `${projectId}/stages/${stage.slug}/${name}`,
						source,
						displayName: name,
						ownerUserId: by.userId,
						ownerType: "user",
						ownerEntityId: null,
						visibility: "link",
						createdDaysAgo: sub.daysAgo,
					}),
				);
			}
			assets.push(...files);
			submissionFiles.set(`${spec.key}:${sub.key}`, files);
		}
		projects.set(spec.key, {
			...spec,
			projectId,
			slug: slugFor("prj", spec.corpusId ?? spec.key),
			clientBusinessId: client.kind === "business" ? client.entity.entityId : null,
			clientPersonaId: client.kind === "user" ? client.persona.userId : null,
			ownerUserId: owner.userId,
			stagesByKey,
			ticketsByKey,
			channelsByKey,
			submissionsByKey,
		});
	}

	return {
		personas,
		entities,
		principals,
		projects,
		assets,
		personaAvatar,
		personaBanner,
		entityAvatar,
		entityBanner,
		experienceLogo,
		serviceCover,
		productCover,
		articleCover,
		articleImage,
		submissionFiles,
		showcaseSlots,
		portfolioCover,
		serviceId: (cid) => uuidFor("service", cid),
		productId: (cid) => uuidFor("product", cid),
		articleId: (cid) => uuidFor("article", cid),
		listingId: (cid) => uuidFor("listing", cid),
	};
}
// #endregion
