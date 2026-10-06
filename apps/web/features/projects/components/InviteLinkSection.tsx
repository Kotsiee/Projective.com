import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { ShareLinkBar } from "@features/share/components/ShareLinkBar.tsx";
import { INVITE_SHARE_TARGETS } from "@features/share/core/share-targets.ts";
import { absoluteUrl } from "@features/share/core/share-request.ts";
import type { StageInviteLinkState } from "../hooks/useStageInviteLink.ts";

/**
 * InviteLinkSection — the invite modal's stage link (Decision #145): the link with Copy and the
 * external shortcuts, Create while the stage has none, and Reset · Turn off once it does. The hint
 * states the rule plainly — the link lets someone ASK to join; every request is answered in Requests.
 */
export interface InviteLinkSectionProps {
	state: StageInviteLinkState;
	stageName: string;
	projectTitle: string;
}

export function InviteLinkSection(
	{ state, stageName, projectTitle }: InviteLinkSectionProps,
): JSX.Element {
	const link = state.link.value;
	const busy = state.busy.value;

	return (
		<section class="invite-share__section" aria-labelledby="invite-share-link">
			<h3 class="invite-share__heading" id="invite-share-link">Invite link · {stageName}</h3>
			<ShareLinkBar
				url={link ? absoluteUrl(link.path) : null}
				title={`Join ${stageName} on ${projectTitle}`}
				text="You're invited to ask to join this stage on Projective."
				targets={INVITE_SHARE_TARGETS}
				label={`Invite link for ${stageName}`}
				emptyNote={busy ? "Loading the invite link…" : "No invite link for this stage yet"}
				createLabel="Create link"
				onCreate={() => void state.act("ensure")}
				busy={busy}
				actions={link && (
					<>
						<Button
							variant="text"
							severity="secondary"
							size="sm"
							label="Reset link"
							icon={<Icon name="refresh" size="sm" />}
							disabled={busy}
							onClick={() => void state.act("reset")}
						/>
						<Button
							variant="text"
							severity="secondary"
							size="sm"
							label="Turn off"
							icon={<Icon name="close" size="sm" />}
							disabled={busy}
							onClick={() => void state.act("revoke")}
						/>
					</>
				)}
			/>
			<p class="invite-share__hint">
				Anyone with the link can ask to join{" "}
				{stageName}. You accept or decline each request in Requests.
			</p>
			{state.error.value && <p class="invite-share__error" role="alert">{state.error.value}</p>}
			{state.notice.value && <p class="invite-share__hint" role="status">{state.notice.value}</p>}
		</section>
	);
}
