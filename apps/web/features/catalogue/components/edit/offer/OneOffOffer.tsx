import type { JSX } from "preact";
import type {
	ListingDetail,
	OneOffOffer as OneOffOfferValue,
} from "../../../types/catalogue-types.ts";
import { problemRow, SCOPE_MAX } from "../../../core/offer-model.ts";
import { checkOffer, commitOffer } from "../../../core/offer-commit.ts";
import { useGatedDraft } from "../../../hooks/useGatedDraft.ts";
import { MilestoneEditor } from "./MilestoneEditor.tsx";
import { ScopeChecklist } from "./ScopeChecklist.tsx";
import { TurnaroundSlider } from "./TurnaroundSlider.tsx";
import { TeamRolesEditor } from "./TeamRolesEditor.tsx";
import { OfferGroup } from "./OfferGroup.tsx";

/**
 * OneOffOffer — a One-Off's (and a Direct Deliverable's) offer: its milestones, delivery time, what
 * is included and, for a Direct Deliverable, the team that delivers it. A Direct Deliverable is one
 * piece of work delivered once (it instantiates as a single Delivery stage), so it has no milestones
 * and its draft starts without any (Decision #525).
 */
export function OneOffOffer(
	props: { listing: ListingDetail; offer: OneOffOfferValue; withTeam: boolean },
): JSX.Element {
	const direct = props.listing.serviceType === "Direct Deliverable";
	const gated = useGatedDraft(
		direct ? { ...props.offer, milestones: [] } : props.offer,
		checkOffer,
		commitOffer,
	);
	const offer = gated.value.value as OneOffOfferValue;
	const update = (patch: Partial<OneOffOfferValue>) => gated.set({ ...offer, ...patch });

	return (
		<>
			{!direct && (
				<OfferGroup
					title="Milestones"
					hint="The points at which the buyer receives something. A short job can have just one."
				>
					<MilestoneEditor
						milestones={offer.milestones}
						onChange={(milestones) => update({ milestones: [...milestones] })}
						problemAt={problemRow(gated.problem.value, "milestones")}
					/>
				</OfferGroup>
			)}

			<OfferGroup title="Delivery">
				<TurnaroundSlider
					days={offer.turnaroundDays}
					onChange={(turnaroundDays) => update({ turnaroundDays })}
				/>
			</OfferGroup>

			<OfferGroup title="What's included" hint="One line per thing the buyer gets.">
				<ScopeChecklist
					label="Scope"
					lines={offer.scope}
					onChange={(scope) => update({ scope: [...scope] })}
					max={SCOPE_MAX}
					maxLength={140}
					placeholder="Add a line, then press Enter"
				/>
			</OfferGroup>

			{props.withTeam && (
				<OfferGroup title="Team" hint="Who delivers this, so buyers know what they're hiring.">
					<TeamRolesEditor
						roles={offer.teamRoles}
						onChange={(teamRoles) =>
							update({ teamRoles: [...teamRoles] })}
						problemAt={problemRow(gated.problem.value, "teamRoles")}
					/>
				</OfferGroup>
			)}
		</>
	);
}
