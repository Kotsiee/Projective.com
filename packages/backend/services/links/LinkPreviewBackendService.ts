import {
	classifyLink,
	type ExitCheck,
	type ExternalLinkPreview,
	LINK_PREVIEW_BATCH_MAX,
	type LinkPreview,
	type LinkPreviewResult,
	type ListingLinkPreview,
	normalizeLink,
	type ProfileLinkPreview,
	type ProjectLinkPreview,
} from "@projective/types/links";
import type { ExploreItem } from "@projective/types/explore";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { serverEnv } from "../../core/env.ts";
import { cachedScan, scanLink } from "../files/link-scan.ts";
import { urlSuspicion } from "../files/link-guards.ts";
import { ExploreBackendService } from "../explore/ExploreBackendService.ts";
import { ProfileBackendService } from "../profile/ProfileBackendService.ts";
import { ProjectBackendService } from "../projects/ProjectBackendService.ts";

/**
 * LinkPreviewBackendService — what a link inside a message shows its reader
 * (`POST /api/links/preview`). An INTERNAL link (this platform's own host) becomes a card read
 * through the service that owns it, under the reader's own identity — a profile, a project (with its
 * escrow position only for a reader who is party to it), a listing. An EXTERNAL link gets the link
 * safety service's verdict (`files/link-scan.ts`) and, only when that verdict is `safe`, the page's
 * title, description and re-hosted icon.
 *
 * The server does the fetching, so a reader's browser never contacts a host a sender chose; a
 * verdict is cached per URL by the scanner, so one link is scanned once however many people read it.
 * Signed-in readers only, and rate-limited, so the endpoint is not a general-purpose fetch proxy.
 */

// #region Limits
/** Preview requests per reader per minute. A page of messages asks once. */
const previewLimiter = new SlidingWindowLimiter({ max: 30, windowMs: 60_000 });

/** Interstitial scans per reader per minute. */
const exitLimiter = new SlidingWindowLimiter({ max: 20, windowMs: 60_000 });

const CARD_TTL_MS = 60_000;
const CARD_CACHE_MAX = 500;
const cards = new Map<string, { preview: LinkPreview | null; expires: number }>();
// #endregion

// #region Internal cards
function ratingOf(
	rating: {
		asHelper?: { value: number; count: number };
		asClient?: { value: number; count: number };
	} | undefined,
) {
	const track = rating?.asHelper?.count
		? rating.asHelper
		: rating?.asClient?.count
		? rating.asClient
		: null;
	return track
		? { rating: track.value.toFixed(1), reviewCount: track.count }
		: { rating: null, reviewCount: null };
}

async function profileCard(
	url: string,
	handle: string,
	actor: ReadActor,
): Promise<ProfileLinkPreview | null> {
	const read = await ProfileBackendService.overview(`@${handle}`, actor);
	if (read.ok && read.data) {
		const p = read.data.profile;
		return {
			kind: "profile",
			url,
			handle: p.handle.replace(/^@/, ""),
			name: p.name,
			avatar: p.avatar || null,
			...ratingOf(p.rating),
			standing: p.stats.standing,
		};
	}
	const item = await ExploreBackendService.item(handle);
	if (!item.ok || !item.data || !("craft" in item.data.item)) return null;
	const profile = item.data.item;
	return {
		kind: "profile",
		url,
		handle,
		name: profile.title,
		avatar: profile.owner.avatar || null,
		...ratingOf(profile.rating),
		standing: null,
	};
}

const FORMAT_LABELS: Record<string, string> = {
	pipeline: "Pipeline",
	one_off: "One-off",
	session: "Session",
};

async function projectCard(
	url: string,
	slug: string,
	actor: ReadActor,
): Promise<ProjectLinkPreview | null> {
	const read = await ProjectBackendService.item(slug, actor);
	if (read.ok && read.data) {
		const p = read.data.item;
		const overview = await ProjectBackendService.overview(slug, actor);
		const escrowed = overview.ok ? overview.data?.overview.finance?.escrowed : undefined;
		const total = p.totalStages ?? 0;
		return {
			kind: "project",
			url,
			slug,
			title: p.title,
			category: FORMAT_LABELS[p.format] ?? null,
			activeStage: total > 0
				? `Stage ${Math.min((p.completedStages ?? 0) + 1, total)} of ${total}`
				: null,
			escrow: escrowed
				? escrowed.minor > 0 ? `${escrowed.display} in escrow` : "Escrow not funded yet"
				: null,
		};
	}
	const item = await ExploreBackendService.item(slug);
	if (!item.ok || !item.data || item.data.item.type !== "projects") return null;
	const brief = item.data.item;
	return {
		kind: "project",
		url,
		slug,
		title: brief.title,
		category: brief.classification === "pipeline" ? "Pipeline" : "One-off",
		activeStage: brief.stage || null,
		escrow: null,
	};
}

function listingFrom(
	url: string,
	item: ExploreItem,
): ListingLinkPreview | ProjectLinkPreview | null {
	switch (item.type) {
		case "services":
			return {
				kind: "listing",
				url,
				id: item.id,
				title: item.title,
				cover: item.media ?? null,
				price: item.price || null,
				deliverable: item.serviceType,
			};
		case "products":
			return {
				kind: "listing",
				url,
				id: item.id,
				title: item.title,
				cover: item.media ?? null,
				price: item.price || null,
				deliverable: "Digital product",
			};
		case "articles":
			return {
				kind: "listing",
				url,
				id: item.id,
				title: item.title,
				cover: item.media ?? null,
				price: null,
				deliverable: `Article · ${item.readMinutes} min read`,
			};
		case "projects":
			return {
				kind: "project",
				url,
				slug: item.id,
				title: item.title,
				category: item.classification === "pipeline" ? "Pipeline" : "One-off",
				activeStage: item.stage || null,
				escrow: null,
			};
		default:
			return null;
	}
}

async function listingCard(url: string, id: string): Promise<LinkPreview | null> {
	const read = await ExploreBackendService.item(id);
	return read.ok && read.data ? listingFrom(url, read.data.item) : null;
}
// #endregion

// #region External
async function externalCard(url: string, host: string): Promise<ExternalLinkPreview> {
	const scan = await scanLink(url);
	const safe = scan.verdict === "safe";
	return {
		kind: "external",
		url,
		host,
		verdict: scan.verdict,
		title: safe ? scan.title : null,
		description: safe ? scan.description : null,
		faviconUrl: safe ? scan.faviconUrl : null,
		reason: safe ? null : scan.reason,
	};
}
// #endregion

// #region Service
/** The hosts that ARE this platform for a request: the serving origin and the configured app origin. */
function internalHostsFor(requestHost: string): string[] {
	const appUrl = serverEnv().appUrl;
	return URL.canParse(appUrl) ? [requestHost, new URL(appUrl).host] : [requestHost];
}

async function previewOne(
	url: string,
	actor: ReadActor,
	hosts: readonly string[],
): Promise<LinkPreview | null> {
	const href = normalizeLink(url);
	if (!href) return null;
	const target = classifyLink(href, hosts);
	if (target.kind === "external") return await externalCard(href, target.host);

	const key = `${actor.userId}\u0000${href}`;
	const hit = cards.get(key);
	if (hit && hit.expires > Date.now()) return hit.preview;

	let preview: LinkPreview | null = null;
	try {
		if (target.kind === "profile") preview = await profileCard(href, target.handle, actor);
		else if (target.kind === "project") preview = await projectCard(href, target.slug, actor);
		else if (target.kind === "listing") preview = await listingCard(href, target.id);
	} catch {
		preview = null;
	}
	cards.delete(key);
	cards.set(key, { preview, expires: Date.now() + CARD_TTL_MS });
	while (cards.size > CARD_CACHE_MAX) cards.delete(cards.keys().next().value!);
	return preview;
}

export class LinkPreviewBackendService {
	/**
	 * Resolve the previews for a batch of links, keyed by the URL asked about; a link with no card is
	 * simply absent from the answer. A link is internal when its host is the serving origin's
	 * (`requestHost`), the configured `APP_URL`'s, or one of the canonical product hosts.
	 */
	static async previews(
		urls: readonly string[],
		actor: ReadActor,
		requestHost: string,
	): Promise<ServiceResult<LinkPreviewResult>> {
		const internalHosts = internalHostsFor(requestHost);
		if (actor.userId.length === 0) {
			return fail(401, { message: "Sign in to see link previews." });
		}
		const decision = previewLimiter.take(actor.userId);
		if (!decision.allowed) {
			return fail(429, {
				message: "Too many link previews requested — try again in a moment.",
				details: { retryAt: new Date(Date.now() + decision.retryAfterMs).toISOString() },
			});
		}
		const unique = [...new Set(urls)].slice(0, LINK_PREVIEW_BATCH_MAX);
		const resolved = await Promise.all(
			unique.map(async (url) => [url, await previewOne(url, actor, internalHosts)] as const),
		);
		const previews: Record<string, LinkPreview> = {};
		for (const [url, preview] of resolved) if (preview) previews[url] = preview;
		return ok({ previews });
	}

	/**
	 * What the `/exit` interstitial shows for a link. A signed-in reader's visit scans it (rate-limited;
	 * past the limit the remembered verdict, if any, stands); a signed-out reader only ever sees a
	 * verdict someone else's scan left behind, so the page is never an anonymous fetch proxy. Either
	 * way the link's own shape (an odd port, an IP literal, a lookalike host) is judged locally when no
	 * verdict is remembered. A link to this platform needs no interstitial and comes back as its path.
	 */
	static async exitCheck(
		raw: string,
		actor: ReadActor,
		requestHost: string,
	): Promise<ServiceResult<ExitCheck>> {
		const href = normalizeLink(raw);
		if (!href) return fail(422, { message: "That isn't a link we can open." });
		const target = classifyLink(href, internalHostsFor(requestHost));
		if (target.kind !== "external") {
			const parsed = new URL(href);
			const path = `/${parsed.pathname.replace(/^[/\\]+/, "")}`;
			return ok({
				url: `${path}${parsed.search}${parsed.hash}`,
				host: parsed.hostname,
				verdict: "safe",
				reason: null,
				internal: true,
			});
		}
		const scan = actor.userId.length > 0 && exitLimiter.take(actor.userId).allowed
			? await scanLink(href)
			: cachedScan(href);
		if (scan) {
			return ok({
				url: href,
				host: target.host,
				verdict: scan.verdict,
				reason: scan.reason,
				internal: false,
			});
		}
		const suspicion = urlSuspicion(href);
		return ok({
			url: href,
			host: target.host,
			verdict: suspicion ? "suspicious" : "pending",
			reason: suspicion?.reason ?? null,
			internal: false,
		});
	}
}
// #endregion
