import type { ComponentChildren, JSX } from "preact";
import { ProgressiveImage, RatingStars } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { PriceOrigin } from "@features/view/components/entity-view-parts.tsx";
import { SkillPills } from "../SkillPill.tsx";
import type { PriceAmount } from "../../core/pricing.ts";
import type { ExploreItem, RatingTrack, SkillRef } from "../../types/explore-types.ts";

// #region Media
/** The preview's picture: a 16:10 cover, or a short `banner` strip (a brief's client banner). */
export function DetailMedia(
	{ src, placeholder, banner = false }: {
		src: string;
		placeholder?: ExploreItem["mediaPlaceholder"];
		banner?: boolean;
	},
): JSX.Element {
	return (
		<div class={banner ? "ex-detail__media ex-detail__media--banner" : "ex-detail__media"}>
			<ProgressiveImage src={src} placeholder={placeholder} alt="" />
		</div>
	);
}
// #endregion

// #region Head
/**
 * The identity block: the category line, the one title heading (the dialog's name, via `titleId`),
 * then whatever attributes it — the provider for a listing, the handle for a profile.
 */
export function DetailHead(
	{ eyebrow, title, titleId, badge, children }: {
		eyebrow: readonly string[];
		title: string;
		titleId: string;
		/** A mark that belongs to the title itself (a profile's verification crest). */
		badge?: ComponentChildren;
		children?: ComponentChildren;
	},
): JSX.Element {
	return (
		<div class="ex-detail__head">
			<p class="ex-detail__eyebrow">
				{eyebrow.map((part, i) => (
					<span class="ex-detail__eyebrowpart" key={`${i}:${part}`}>
						{i > 0 && <span class="ex-detail__dot" aria-hidden="true">·</span>}
						{part}
					</span>
				))}
			</p>
			<h2 id={titleId} class="ex-detail__title">
				<span>{title}</span>
				{badge}
			</h2>
			{children}
		</div>
	);
}
// #endregion

// #region Facts
/** The key-metrics grid — a `<dl>` of {@link Fact}s. */
export function FactGrid({ children }: { children: ComponentChildren }): JSX.Element {
	return <dl class="ex-detail__facts">{children}</dl>;
}

/** One key metric: a meta-register label over its value. */
export function Fact(
	{ label, children }: { label: string; children: ComponentChildren },
): JSX.Element {
	return (
		<div class="ex-detail__fact">
			<dt class="ex-detail__factlabel">{label}</dt>
			<dd class="ex-detail__factvalue">{children}</dd>
		</div>
	);
}

/**
 * A price in the viewer's display currency, the figure the card showed: "From" when it is a floor,
 * the pre-formatted fallback when no structured amount exists, and the per-unit noun after it. A
 * converted figure discloses its original currency on a line beneath, as the page's price does.
 */
export function DetailPrice(
	{ amount, fallback, unit, isFloor = false }: {
		amount: PriceAmount | null;
		fallback: string;
		unit?: string;
		isFloor?: boolean;
	},
): JSX.Element {
	return (
		<span class="ex-detail__price">
			<span class="ex-detail__figure">
				{isFloor && <span class="ex-detail__from">From</span>}
				{amount
					? <MoneyView minor={amount.minor} currency={amount.currency} hideOrigin />
					: fallback}
				{unit && <span class="ex-detail__unit">/ {unit}</span>}
			</span>
			{amount && (
				<PriceOrigin minor={amount.minor} currency={amount.currency} class="ex-detail__origin" />
			)}
		</span>
	);
}

/** The item's own rating as a fact, or "No reviews yet" when nobody has rated it. */
export function RatingFact(
	{ label, rating }: { label: string; rating: RatingTrack | null },
): JSX.Element {
	return (
		<Fact label={label}>
			{rating
				? (
					<RatingStars
						value={rating.value}
						count={rating.count}
						compact
						size="sm"
						label={`${label}: ${rating.value.toFixed(1)} out of 5 from ${rating.count} ${
							rating.count === 1 ? "review" : "reviews"
						}`}
					/>
				)
				: <span class="ex-detail__none">No reviews yet</span>}
		</Fact>
	);
}
// #endregion

// #region Body
/** The description excerpt — the page carries the full text. */
export function DetailSummary({ text }: { text: string }): JSX.Element | null {
	if (!text) return null;
	return <p class="ex-detail__summary">{text}</p>;
}

/** A titled block under the summary (skills, a brief's phase plan). */
export function DetailSection(
	{ title, children }: { title: string; children: ComponentChildren },
): JSX.Element {
	return (
		<section class="ex-detail__section">
			<h3 class="ex-detail__label">{title}</h3>
			{children}
		</section>
	);
}

/** Facts that are not controls, as one middot-separated line (§B.11.2); `meta` sets it in the meta register. */
export function InlineList(
	{ items, meta = false }: { items: readonly string[]; meta?: boolean },
): JSX.Element {
	return (
		<p class={meta ? "ex-detail__inline ex-detail__inline--meta" : "ex-detail__inline"}>
			{items.map((text, i) => (
				<span class="ex-detail__inlineitem" key={`${i}:${text}`}>
					{i > 0 && <span class="ex-detail__dot" aria-hidden="true">·</span>}
					{text}
				</span>
			))}
		</p>
	);
}

/** The item's skills as their search links, capped for a preview. */
export function DetailSkills({ skills }: { skills: readonly SkillRef[] }): JSX.Element | null {
	if (skills.length === 0) return null;
	return (
		<DetailSection title="Skills">
			<SkillPills skills={[...skills]} max={6} />
		</DetailSection>
	);
}
// #endregion
