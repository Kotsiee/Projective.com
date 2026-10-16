import type { JSX } from "preact";
import { Avatar, ProgressiveImage } from "@projective/ui/display";
import { ENTITY_LABEL } from "@features/view/core/view-model.ts";
import { personFallbackImage } from "@web/components/UserAvatar.tsx";
import { VerifiedBadge } from "../VerifiedBadge.tsx";
import {
	DetailHead,
	DetailPrice,
	DetailSkills,
	DetailSummary,
	Fact,
	FactGrid,
	InlineList,
	RatingFact,
} from "./DetailParts.tsx";
import { freelancerFloorAmount } from "../../core/pricing.ts";
import type { ProfileItem, RatingTrack } from "../../types/explore-types.ts";

/**
 * ProfileDetail — a freelancer, team, business or individual at a glance: banner and avatar, name,
 * the handle · specialism · location line, the profile's key figures and reputation tracks, the bio
 * and skills. A freelancer shows only the helper track — never their client track (§4a).
 */
export function ProfileDetail(
	{ item, titleId }: { item: ProfileItem; titleId: string },
): JSX.Element {
	const byline = [item.owner.handle];
	if (item.craft && item.craft !== item.summary) byline.push(item.craft);
	if (item.location) byline.push(item.location);

	return (
		<>
			<div class="ex-detail__profile">
				<div class="ex-detail__banner">
					{item.cover && (
						<ProgressiveImage src={item.cover} placeholder={item.coverPlaceholder} alt="" />
					)}
				</div>
				<Avatar
					image={item.owner.avatar}
					fallbackImage={personFallbackImage(item.owner.kind)}
					placeholder={item.owner.avatarPlaceholder}
					label={item.title}
					alt=""
					size="xl"
					shape={item.type === "businesses" ? "square" : "circle"}
					class="ex-detail__avatar"
				/>
			</div>
			<DetailHead
				eyebrow={[ENTITY_LABEL[item.type]]}
				title={item.title}
				titleId={titleId}
				badge={item.owner.verified && <VerifiedBadge size="md" owner={item.owner} />}
			>
				<InlineList items={byline} meta />
			</DetailHead>
			<FactGrid>
				<ProfileFacts item={item} />
				{profileRatings(item).map(([label, track]) => (
					<RatingFact key={label} label={label} rating={track} />
				))}
			</FactGrid>
			<DetailSummary text={item.summary} />
			<DetailSkills skills={item.skills} />
		</>
	);
}

function counted(n: number, one: string, many: string): string {
	return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The tracks a profile is rated on: whichever it carries, a freelancer's helper track only. */
function profileRatings(item: ProfileItem): Array<[string, RatingTrack | null]> {
	const helper = item.rating?.asHelper ?? null;
	const client = item.type === "freelancers" ? null : item.rating?.asClient ?? null;
	const rows: Array<[string, RatingTrack | null]> = [];
	if (helper || item.type === "freelancers") rows.push(["Rating as helper", helper]);
	if (client) rows.push(["Rating as client", client]);
	return rows.length ? rows : [["Rating", null]];
}

function ProfileFacts({ item }: { item: ProfileItem }): JSX.Element {
	if (item.type === "freelancers") {
		const floor = freelancerFloorAmount(item);
		return (
			<>
				{floor && (
					<Fact label="Services from">
						<DetailPrice amount={floor} fallback="" />
					</Fact>
				)}
				<Fact label="Delivered">{counted(item.delivered, "engagement", "engagements")}</Fact>
				{item.workload && <Fact label="Availability">{item.workload.status}</Fact>}
				<Fact label="Services">{`${item.servicePrices?.length ?? 0}`}</Fact>
				{item.products !== undefined && <Fact label="Products">{`${item.products}`}</Fact>}
			</>
		);
	}
	return (
		<>
			{item.delivered > 0 && (
				<Fact label="Delivered">{counted(item.delivered, "engagement", "engagements")}</Fact>
			)}
			{item.members
				? <Fact label="Team size">{counted(item.members, "person", "people")}</Fact>
				: null}
		</>
	);
}
