import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/links.css";
import { Icon } from "@projective/ui/icons";
import {
	classifyLink,
	externalLinkHref,
	extractLinks,
	isFlaggedVerdict,
	type LinkPreview,
	type LinkTarget,
	segmentLinks,
} from "@projective/types/links";
import type { LinkScanStatus } from "@projective/types/files";
import {
	adoptPageHost,
	linkPreviews,
	pageHosts,
	requestLinkPreviews,
} from "../core/link-previews.ts";

/**
 * MessageLinks — how a message body's links render. {@link MessageText} turns written links into
 * anchors: an internal one goes to its path on this origin, an external one goes straight out only
 * when its scan came back safe and through the `/exit` interstitial otherwise (including before the
 * verdict arrives). {@link MessageLinkPreviews} adds one fixed-shape row per link beneath the text — a
 * mini card for a profile, project or listing, the page's title for a safe site, the warning badge for
 * a flagged one — and every state of a row has the same two lines, so a preview arriving never moves
 * the feed.
 */

const EXTERNAL_ANCHOR = {
	target: "_blank",
	rel: "noopener noreferrer nofollow ugc",
	referrerpolicy: "no-referrer",
} as const;

interface Destination {
	href: string;
	external: boolean;
}

function internalPath(url: string): string {
	const parsed = new URL(url);
	return `/${parsed.pathname.replace(/^[/\\]+/, "")}${parsed.search}${parsed.hash}`;
}

function verdictOf(preview: LinkPreview | null | undefined): LinkScanStatus | null {
	return preview?.kind === "external" ? preview.verdict : null;
}

function destinationOf(target: LinkTarget, preview: LinkPreview | null | undefined): Destination {
	if (target.kind === "external") {
		return { href: externalLinkHref(target.url, verdictOf(preview)), external: true };
	}
	return { href: internalPath(target.url), external: false };
}

function middot(parts: (string | null | undefined)[]): string {
	return parts.filter((p): p is string => !!p).join(" · ");
}

/** A message body with its written links as anchors. */
export function MessageText({ text }: { text: string }): JSX.Element {
	const hosts = pageHosts.value;
	const previews = linkPreviews.value;
	return (
		<>
			{segmentLinks(text).map((segment, i) => {
				if (segment.kind === "text") return segment.text;
				const preview = previews[segment.href];
				const to = destinationOf(classifyLink(segment.href, hosts), preview);
				return (
					<a
						key={i}
						class="msg-link"
						href={to.href}
						data-flagged={isFlaggedVerdict(verdictOf(preview)) ? "true" : undefined}
						{...(to.external ? EXTERNAL_ANCHOR : {})}
					>
						{segment.text}
					</a>
				);
			})}
		</>
	);
}

interface RowFace {
	lead: JSX.Element;
	title: JSX.Element | string;
	meta: string;
	state: "loading" | "ready" | "flagged" | "plain";
}

function leadImage(src: string | null, round: boolean): JSX.Element {
	return src
		? (
			<img
				class="msg-linkcard__img"
				data-round={round ? "true" : undefined}
				src={src}
				alt=""
				loading="lazy"
				decoding="async"
			/>
		)
		: <Icon name="link" />;
}

function faceOf(target: LinkTarget, preview: LinkPreview | null | undefined): RowFace {
	const where = target.kind === "external" ? target.host : internalPath(target.url);
	if (preview === undefined) {
		return {
			lead: <Icon name={target.kind === "external" ? "globe" : "link"} />,
			title: where,
			meta: target.kind === "external" ? "Checking link…" : "Loading preview…",
			state: "loading",
		};
	}
	if (preview === null) {
		return {
			lead: <Icon name={target.kind === "external" ? "globe" : "link"} />,
			title: where,
			meta: target.kind === "external"
				? "Not checked — opens through a safety page"
				: "Preview unavailable",
			state: "plain",
		};
	}
	switch (preview.kind) {
		case "profile":
			return {
				lead: leadImage(preview.avatar, true),
				title: preview.name,
				meta: middot([
					`@${preview.handle}`,
					preview.rating
						? `★ ${preview.rating}${preview.reviewCount ? ` (${preview.reviewCount})` : ""}`
						: null,
					preview.standing ? `Standing · ${preview.standing.label}` : null,
				]),
				state: "ready",
			};
		case "project":
			return {
				lead: <Icon name="folder" />,
				title: preview.title,
				meta: middot([preview.category, preview.activeStage, preview.escrow]),
				state: "ready",
			};
		case "listing":
			return {
				lead: leadImage(preview.cover, false),
				title: preview.title,
				meta: middot([preview.deliverable, preview.price]),
				state: "ready",
			};
		case "external": {
			if (isFlaggedVerdict(preview.verdict)) {
				return {
					lead: <Icon name="warning" />,
					title: (
						<span class="msg-linkcard__badge">
							{preview.verdict === "blocked"
								? "Blocked link — known to be unsafe"
								: "Suspicious link — proceed with caution"}
						</span>
					),
					meta: middot([preview.host, preview.reason]),
					state: "flagged",
				};
			}
			if (preview.verdict === "safe") {
				return {
					lead: leadImage(preview.faviconUrl, false),
					title: preview.title || preview.host,
					meta: middot([preview.host, preview.description]),
					state: "ready",
				};
			}
			return {
				lead: <Icon name="globe" />,
				title: preview.host,
				meta: preview.reason ?? "Not checked — opens through a safety page",
				state: "plain",
			};
		}
	}
}

function LinkPreviewRow(
	{ target, preview }: { target: LinkTarget; preview: LinkPreview | null | undefined },
): JSX.Element {
	const to = destinationOf(target, preview);
	const face = faceOf(target, preview);
	return (
		<a
			class="msg-linkcard"
			data-kind={preview?.kind ?? target.kind}
			data-state={face.state}
			href={to.href}
			{...(to.external ? EXTERNAL_ANCHOR : {})}
		>
			<span class="msg-linkcard__lead" aria-hidden="true">{face.lead}</span>
			<span class="msg-linkcard__text">
				<span class="msg-linkcard__title">{face.title}</span>
				<span class="msg-linkcard__meta">{face.meta}</span>
			</span>
		</a>
	);
}

/** One preview row per link in the body (three at most), beneath the text. */
export function MessageLinkPreviews({ text }: { text: string }): JSX.Element | null {
	const hosts = pageHosts.value;
	const targets = extractLinks(text)
		.map((url) => classifyLink(url, hosts))
		.filter((t) => t.kind !== "internal");
	const urls = targets.map((t) => t.url).join("\n");

	useEffect(() => {
		adoptPageHost();
		if (urls) requestLinkPreviews(urls.split("\n"));
	}, [urls]);

	if (targets.length === 0) return null;
	return (
		<div class="msg-links">
			{targets.map((t) => (
				<LinkPreviewRow key={t.url} target={t} preview={linkPreviews.value[t.url]} />
			))}
		</div>
	);
}
