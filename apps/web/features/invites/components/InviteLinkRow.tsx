import type { JSX } from "preact";
import { Button, Select, ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import type { InviteRoleOption } from "../core/invite-queue.ts";

/**
 * InviteLinkRow — the Invite modal's "Link access" row (Decision #405): what the ask-to-join link
 * does, in one sentence, and a switch that turns it on or off. **A link asks; it never seats** — on a
 * project stage (Decision #145) and on a team or business alike. A workspace's sentence holds the role
 * a request asks for; a project's names the stage. Reset replaces the URL (the old one stops at once).
 * Copying the link is the modal footer's job, so the row never carries the URL itself.
 */

// #region Props
/** Everything the row needs from the surface that owns the link. */
export interface InviteLinkControl {
	/** The absolute URL, or `null` while the link is off. */
	url: string | null;
	/** The stage a project's link asks to join; absent on a workspace. */
	stageName?: string;
	/** A workspace link's role, chosen in the sentence. */
	roles?: readonly InviteRoleOption[];
	roleId?: string | null;
	onRoleChange?: (roleId: string) => void;
	busy: boolean;
	error: string | null;
	onEnable: () => void;
	onDisable: () => void;
	onReset: () => void;
	/** Why no link can exist yet (a pipeline with no stage chosen), said in place of the switch. */
	unavailable?: string | null;
}
// #endregion

export function InviteLinkRow(props: InviteLinkControl): JSX.Element {
	const on = props.url !== null;
	const roles = props.roles ?? [];

	function lead(): JSX.Element | string {
		if (props.unavailable) return props.unavailable;
		if (!on) return "Only people you invite can join";
		if (roles.length > 0 && props.onRoleChange) {
			return (
				<>
					<span>Anyone with the link can ask to join as</span>
					<Select
						size="sm"
						class="inv-link__role"
						options={roles.map((r) => ({ label: r.name, value: r.id }))}
						value={props.roleId ?? ""}
						onValueChange={(next) => next && props.onRoleChange?.(next)}
						disabled={props.busy}
						panelWidth="auto"
						aria-label="Role a request through the link asks for"
					/>
				</>
			);
		}
		return props.stageName
			? `Anyone with the link can ask to join ${props.stageName}`
			: "Anyone with the link can ask to join";
	}

	return (
		<section class="inv-link" aria-labelledby="inv-link-title">
			<span class="inv-link__glyph" aria-hidden="true">
				<Icon name="link" size="sm" />
			</span>
			<div class="inv-link__text">
				<h3 class="inv-link__title" id="inv-link-title">Link access</h3>
				<p class="inv-link__lead">{lead()}</p>
			</div>
			{on && !props.unavailable && (
				<Tooltip content="Reset link" placement="top">
					<Button
						iconOnly
						rounded
						size="sm"
						variant="text"
						severity="secondary"
						class="ui-hit"
						icon={<Icon name="refresh" size="sm" />}
						aria-label="Reset link — the old one stops working"
						disabled={props.busy}
						onClick={props.onReset}
					/>
				</Tooltip>
			)}
			{!props.unavailable && (
				<ToggleSwitch
					size="sm"
					class="inv-link__switch"
					value={on}
					disabled={props.busy}
					aria-label="Link access"
					onValueChange={(next: boolean) => (next ? props.onEnable() : props.onDisable())}
				/>
			)}
			{props.error && <p class="inv-link__error" role="alert">{props.error}</p>}
		</section>
	);
}
