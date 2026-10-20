import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { ManagerCapNotice as ManagerCapNoticeView } from "../core/members-model.ts";

/**
 * ManagerCapNotice — a business's manager cap, said before the press (BU7, Decision #230 (b)): the
 * refusal map's `entitlement` sentence for `business_managers` in an `InlineNotice`, then the way
 * forward the viewer has as a MetaLine — "Changing plans isn't available yet." for the owner, whom to
 * ask for anybody else. No upgrade link: no surface lists Business Pro or changes a business's plan
 * yet (Decisions #246 FLAG 1, #247 (d)), and a link must land on a working surface (§3.11).
 *
 * Shared by the invite dialog, the member drawer and the Roles matrix; the words are
 * `core/members-model.ts`'s `managerCapNotice`, so all three say one thing.
 */
export function ManagerCapNotice(props: { notice: ManagerCapNoticeView }): JSX.Element {
	return (
		<div class="wsp-capnotice">
			<InlineNotice align="start" icon={<Icon name="info" />} text={props.notice.sentence} />
			<MetaLine size="xs" items={[props.notice.meta]} />
		</div>
	);
}
