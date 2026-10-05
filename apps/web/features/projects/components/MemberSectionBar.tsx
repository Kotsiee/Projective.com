import type { JSX } from "preact";
import { type LaneTabOption, LaneTabs } from "@projective/ui/navigation";
import type { MemberSection } from "../core/member-sections.ts";

/**
 * MemberSectionBar — the glass pill above the shared toolbar (the slot the Submissions explorer gives
 * its breadcrumb trail): the section tabs on the left, a quiet context line on the right.
 *
 * Counts are never printed in a pill (DESIGN_SYSTEM §D.1, Decision #128(c)): a section with something
 * awaiting the viewer carries the `LaneTabs` dot with the number SPOKEN in its accessible name, and
 * the context line states the figures as words in the meta register. A viewer offered only one section
 * gets no tabs at all — a tab strip with one tab is a control that does nothing.
 */
export interface MemberSectionBarProps {
	sections: readonly MemberSection[];
	active: MemberSection;
	onSelect: (section: MemberSection) => void;
	/** Open requests awaiting a decision — drives the Requests dot. */
	openRequests: number;
	/** The id of the section panel the tabs control. */
	panelId: string;
	/** The muted context line ("12 people · 8 of 12 seats"). */
	meta: string | null;
}

const LABELS: Record<MemberSection, string> = {
	members: "Members",
	requests: "Requests",
	invitations: "Invitations",
};

export function MemberSectionBar(props: MemberSectionBarProps): JSX.Element | null {
	const tabs = props.sections.length > 1;
	if (!tabs && !props.meta) return null;
	const options: LaneTabOption<MemberSection>[] = props.sections.map((section) => ({
		value: section,
		label: LABELS[section],
		dot: section === "requests" && props.openRequests > 0,
		hint: section === "requests" && props.openRequests > 0
			? `${props.openRequests} awaiting a decision`
			: undefined,
	}));

	return (
		<div class="mem-sectionbar">
			{tabs && (
				<LaneTabs<MemberSection>
					label="Member sections"
					class="mem-sectionbar__tabs"
					value={props.active}
					options={options}
					panelId={props.panelId}
					onSelect={props.onSelect}
				/>
			)}
			<span class="mem-sectionbar__spacer" />
			{props.meta && <p class="mem-sectionbar__meta">{props.meta}</p>}
		</div>
	);
}
