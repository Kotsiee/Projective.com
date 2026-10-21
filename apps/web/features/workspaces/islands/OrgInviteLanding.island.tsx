import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "@features/projects/styles/invite-landing.css";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { JOIN_REQUEST_MESSAGE_MAX, type OrgInviteLinkView } from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { orgInviteLinkCopy } from "../core/org-invite-link-copy.ts";
import { PayoutGateLink } from "@features/settings/components/PayoutGateLink.tsx";

/**
 * OrgInviteLanding — the `/invite/[token]` page for a team's or business's invite link (Decision
 * #318): which entity, at which role, who shared it, and — only when the link is open to this person
 * — an optional note and "Ask to join", which files a pending request the entity's admins answer. The
 * page's state is the server's (`org.fn_org_invite_link_state`); after a successful ask it moves to
 * `requested` locally, exactly what a reload would read back. Shares the stage link's page layout
 * (`invite-landing.css`) — one column of text with a single optional form.
 */
export interface OrgInviteLandingProps {
	token: string;
	view: OrgInviteLinkView;
}

export default function OrgInviteLanding(props: OrgInviteLandingProps): JSX.Element {
	const view = useSignal<OrgInviteLinkView>(props.view);
	const note = useSignal("");
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	const errorDetails = useSignal<unknown>(null);

	const copy = orgInviteLinkCopy(view.value);

	async function ask(): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		error.value = null;
		const res = await WorkspaceService.redeemInviteLink({
			token: props.token,
			message: note.value,
		});
		busy.value = false;
		if (res.ok) {
			view.value = { ...view.value, state: "requested" };
			return;
		}
		// A refused state the page did not know yet (another tab asked, the link was reset) moves the
		// page to it, so the copy and the offer agree with the server.
		const reason = res.details?.reason;
		const known = typeof reason === "string" && reason in STATE_FROM_REASON
			? STATE_FROM_REASON[reason]
			: null;
		if (known) {
			view.value = { ...view.value, state: known };
			return;
		}
		error.value = res.message ?? "Your request could not be sent — please try again.";
		errorDetails.value = res.details ?? null;
	}

	return (
		// Not a second `<main>`: the shell's canvas is the page's one main landmark.
		<div class="invite-landing">
			<span class="invite-landing__glyph" aria-hidden="true">
				<Icon name={view.value.state === "requested" ? "check" : "user-plus"} size="lg" />
			</span>
			{view.value.workspaceName && (
				<p class="invite-landing__meta">
					{view.value.workspaceName}
					{view.value.roleName ? ` · as ${view.value.roleName}` : ""}
					{view.value.sharedByName ? ` · shared by ${view.value.sharedByName}` : ""}
				</p>
			)}
			<h1 class="invite-landing__title">{copy.title}</h1>
			<p class="invite-landing__body">{copy.body}</p>

			{copy.canAsk && (
				<div class="invite-landing__ask">
					<label class="invite-landing__label" for="org-invite-landing-note">
						A note to the admins (optional)
					</label>
					<textarea
						id="org-invite-landing-note"
						class="invite-landing__note"
						rows={3}
						maxLength={JOIN_REQUEST_MESSAGE_MAX}
						placeholder={`Why you'd like to join ${view.value.workspaceName ?? "them"}`}
						value={note.value}
						onInput={(e) => (note.value = (e.target as HTMLTextAreaElement).value)}
					/>
					<Button
						label="Ask to join"
						icon={<Icon name="send" size="sm" />}
						loading={busy.value}
						onClick={() => void ask()}
					/>
				</div>
			)}
			{error.value && (
				<p class="invite-landing__error" role="alert">
					{error.value} <PayoutGateLink details={errorDetails.value} />
				</p>
			)}
			{copy.next && (
				<a class="invite-landing__next" href={copy.next.href}>
					{copy.next.label}
					<Icon name="arrow-right" size="sm" />
				</a>
			)}
		</div>
	);
}

/** The redeem refusals' `details.reason` that name a page state (`live-invite-links.redeemRefusal`). */
const STATE_FROM_REASON: Readonly<Record<string, OrgInviteLinkView["state"]>> = {
	revoked: "revoked",
	archived: "archived",
	member: "member",
	invited: "invited",
	requested: "requested",
	persona: "persona",
};
