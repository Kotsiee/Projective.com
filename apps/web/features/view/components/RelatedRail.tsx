import type { ComponentChildren, JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { EntityCard } from "@features/explore/components/cards/EntityCard.tsx";
import { RailCell } from "@features/explore/components/RailCell.tsx";
import { RailHeading, type RailHeadingLevel } from "@features/explore/components/RailHeading.tsx";
import HomeRail from "@features/explore/islands/HomeRail.island.tsx";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { ExploreItem } from "@projective/types/explore";
import { type EntityGroup, groupItemsByType } from "../core/view-model.ts";

/**
 * The most single-type blocks one recommendation section may render.
 *
 * The cross-sell measured 73% of total page height — two sections, each fanning out into up to five
 * labelled blocks. The height came from the number of BLOCKS, not the number of items: a rail scrolls,
 * so items are free, while every extra block adds a heading and a full row. Two blocks keeps a
 * section's "more of the same, plus one adjacent thing" shape and bounds it; the rest is one click
 * away behind "See all". `groupItemsByType` already orders transactional formats first, so the
 * survivors are the commercially useful ones.
 */
const MAX_GROUPS = 2;

/** Props for {@link RelatedSection}. */
export interface RelatedSectionProps {
	/** Stable section id — the rail anchors and heading ids derive from it (`ex-{id}`). */
	id: string;
	title: string;
	subtitle?: string;
	items: ExploreItem[];
	ctx: HrefContext;
	authed: boolean;
	seeAllHref?: string;
}

/**
 * RelatedSection — a titled recommendation section ("More by this creator" / "Similar & recommended")
 * built from Explore's own section module: every block is a {@link HomeRail} in its `contained`
 * variant holding server-rendered {@link RailCell}s. A project block's cells are sized to the rail
 * (`ex-rail--projects`: one card on a phone, two on a laptop, three or four on an ultrawide). A
 * section with one format IS that rail; a section with two is a titled set whose blocks take level-3
 * headings. "See all" rides the module's action slot. Renders nothing when there are no items.
 */
export function RelatedSection(
	{ id, title, subtitle, items, ctx, authed, seeAllHref }: RelatedSectionProps,
): JSX.Element | null {
	if (items.length === 0) return null;
	const groups = groupItemsByType(items).slice(0, MAX_GROUPS);
	const seeAll = seeAllHref ? <SeeAll href={seeAllHref} /> : undefined;

	if (groups.length === 1) {
		return (
			<div class="vw-related">
				<RelatedGroup
					group={groups[0]}
					id={id}
					lead={title}
					subtitle={subtitle}
					href={seeAllHref}
					action={seeAll}
					level={2}
					ctx={ctx}
					authed={authed}
				/>
			</div>
		);
	}

	return (
		<div class="vw-related">
			<section class="vw-related__set" aria-labelledby={`ex-${id}-title`}>
				<header class="ex-rail__head">
					<RailHeading id={id} lead={title} href={seeAllHref} />
					{seeAll}
				</header>
				{subtitle ? <p class="ex-rail__sub">{subtitle}</p> : null}
				{groups.map((group) => (
					<RelatedGroup
						key={group.type}
						group={group}
						id={`${id}-${group.type}`}
						lead={group.label}
						level={3}
						ctx={ctx}
						authed={authed}
					/>
				))}
			</section>
		</div>
	);
}

function SeeAll({ href }: { href: string }): JSX.Element {
	return (
		<a class="ex-viewall ex-rail__action" href={href}>
			<span>See all</span>
			<Icon name="arrow-right" aria-hidden />
		</a>
	);
}

function RelatedGroup(
	{ group, id, lead, subtitle, href, action, level, ctx, authed }: {
		group: EntityGroup;
		id: string;
		lead: string;
		subtitle?: string;
		href?: string;
		action?: ComponentChildren;
		level: RailHeadingLevel;
		ctx: HrefContext;
		authed: boolean;
	},
): JSX.Element {
	return (
		<HomeRail
			id={id}
			lead={lead}
			href={href}
			subtitle={subtitle}
			level={level}
			variant="contained"
			action={action}
			label={group.label}
			modifier={group.type === "projects" ? "ex-rail--projects" : undefined}
		>
			{group.items.map((item) => (
				<RailCell key={item.id}>
					<EntityCard item={item} ctx={ctx} authed={authed} productLayout="fixed" />
				</RailCell>
			))}
		</HomeRail>
	);
}
