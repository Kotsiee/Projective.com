import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { statusMeta } from "../core/catalogue-model.ts";
import { AlertIcon, KindIcon, StarGlyph } from "./catalogue-glyphs.tsx";
import type { ListingSummary } from "../types/catalogue-types.ts";

/**
 * ListingLaneRow — one compact listing row in the navigation lane's status sections. Icon-first (§B.6):
 * a small circular cover thumbnail when the listing has media, else the kind glyph (product cube /
 * service star) as the fallback — plus the title, with iconographic status signals only (a
 * needs-attention triangle, a promoted
 * star, a live pulsing dot) — never inline status prose; the explaining words live in the portal
 * Tooltip. Links to the manage page; the active listing is tinted.
 */
export interface ListingLaneRowProps {
	listing: ListingSummary;
	href: string;
	active: boolean;
}

export function ListingLaneRow({ listing, href, active }: ListingLaneRowProps): JSX.Element {
	const meta = statusMeta(listing.status);
	return (
		<a
			class="cat-lrow"
			href={href}
			data-active={active ? "true" : undefined}
			data-kind={listing.kind}
			aria-current={active ? "page" : undefined}
		>
			<span class="cat-lrow__icon" aria-hidden="true">
				{listing.cover
					? <img class="cat-lrow__thumb" src={listing.cover} alt="" loading="lazy" />
					: <KindIcon kind={listing.kind} size={18} />}
			</span>
			<span class="cat-lrow__title">{listing.title}</span>
			<span class="cat-lrow__signals" aria-hidden="true">
				{listing.needsAttention && (
					<Tooltip content="Needs attention" placement="top">
						<span class="cat-lrow__sig cat-lrow__sig--alert">
							<AlertIcon size={14} />
						</span>
					</Tooltip>
				)}
				{listing.promoted && (
					<Tooltip content="Promoted" placement="top">
						<span class="cat-lrow__sig cat-lrow__sig--promo">
							<StarGlyph size={13} filled />
						</span>
					</Tooltip>
				)}
				{listing.status === "published" && (
					<Tooltip content={meta.label} placement="top">
						<span
							class="cat-lrow__dot"
							data-tone={meta.tone}
							role="status"
							aria-label={meta.label}
						/>
					</Tooltip>
				)}
			</span>
		</a>
	);
}
