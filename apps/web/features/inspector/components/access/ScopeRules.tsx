import type { JSX } from "preact";
import { ToggleSwitch } from "@projective/ui/fields";
import { HintPopover } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { AccessContainer } from "@projective/types/files";

/** Props for {@link ScopeRules}. */
export interface ScopeRulesProps {
	container: AccessContainer;
	/** The draft's member switch, for an entity library. */
	memberAccess: boolean | null;
	/** The owner flips the member switch; an editor reads it. */
	canManage: boolean;
	/** Messages carrying the file as a link share; the owner only. */
	messageShares: number | null;
	/** Whether grants and link shares open the file at the draft's tier. */
	active: boolean;
	onMemberAccess: (next: boolean) => void;
}

function messageLine(count: number, active: boolean): string {
	const noun = count === 1 ? "message" : "messages";
	return active
		? `Also open to the people you sent it to as a link in ${count} ${noun}.`
		: `${count} link ${count === 1 ? "share" : "shares"} in ${noun} won't open while it's private.`;
}

/**
 * The access the file's place hands out before anyone is added: an entity library's members (a switch
 * for the owner), a project's people (always, and said so), and the people it went to as a link in a
 * message. Nothing renders for a personal file nobody was sent.
 */
export function ScopeRules(props: ScopeRulesProps): JSX.Element | null {
	const { container, memberAccess, canManage, messageShares, active } = props;
	const shares = messageShares ?? 0;
	if (container.kind === "personal" && shares === 0) return null;

	return (
		<div class="ins-access__group ins-access__scope">
			{container.kind === "entity"
				? (
					<div class="ins-access__rule">
						{canManage
							? (
								<ToggleSwitch
									size="sm"
									value={memberAccess ?? container.memberAccess}
									onValueChange={props.onMemberAccess}
									label={`Everyone in ${container.name} can view`}
								/>
							)
							: (
								<p class="ins-access__fact">
									<span class="ins-access__glyph" aria-hidden="true">
										<Icon name="members" size="sm" />
									</span>
									{(memberAccess ?? container.memberAccess)
										? `Everyone in ${container.name} can view`
										: `Only ${container.name}'s admins and the people added below`}
								</p>
							)}
						<HintPopover label={`About access for ${container.name}`}>
							<p>
								A file in{" "}
								{container.name}'s library is open to all its members by default. Turn this off and
								only you, {container.name}'s admins and the people you add below can open it.
							</p>
						</HintPopover>
					</div>
				)
				: null}

			{container.kind === "project"
				? (
					<div class="ins-access__rule">
						<p class="ins-access__fact">
							<span class="ins-access__glyph" aria-hidden="true">
								<Icon name="lock" size="sm" />
							</span>
							Everyone on {container.name} can open it
						</p>
						<HintPopover label={`About access for ${container.name}`}>
							<p>
								Files in a project stay open to everyone on it: they're part of the engagement's
								record, which stage reviews and disputes rely on. You can still add people outside
								the project, or share it by link.
							</p>
						</HintPopover>
					</div>
				)
				: null}

			{shares > 0
				? (
					<div class="ins-access__rule">
						<p class="ins-access__fact">
							<span class="ins-access__glyph" aria-hidden="true">
								<Icon name="message" size="sm" />
							</span>
							{messageLine(shares, active)}
						</p>
						<HintPopover label="About files sent as a link">
							<p>
								Choosing Only you takes their access away too. Copies you sent stay with the people
								who received them.
							</p>
						</HintPopover>
					</div>
				)
				: null}
		</div>
	);
}
