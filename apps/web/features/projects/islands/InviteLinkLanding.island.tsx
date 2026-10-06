import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/invite-landing.css";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { InviteLinkView } from "../types/projects-types.ts";
import { RequestService } from "../core/RequestService.ts";
import { inviteLinkCopy } from "../core/invite-link-copy.ts";

/**
 * InviteLinkLanding — the `/invite/[token]` page (Decision #145): where a stage invite link leads, who
 * shared it, and — only when the link is open to this person — an optional note and "Ask to join",
 * which files a pending request the project's managers answer. The page's state is the server's
 * (`fn_invite_link_state`); after a successful ask it moves to `requested` locally, exactly what a
 * reload would read back.
 */
export interface InviteLinkLandingProps {
	token: string;
	view: InviteLinkView;
}

export default function InviteLinkLanding(props: InviteLinkLandingProps): JSX.Element {
	const view = useSignal<InviteLinkView>(props.view);
	const note = useSignal("");
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);

	const copy = inviteLinkCopy(view.value);

	async function ask(): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		error.value = null;
		const res = await RequestService.redeemInviteLink({ token: props.token, message: note.value });
		busy.value = false;
		if (res.ok) {
			view.value = { ...view.value, state: "requested" };
			return;
		}
		error.value = res.message ?? "Your request could not be sent — please try again.";
	}

	return (
		<main class="invite-landing">
			<span class="invite-landing__glyph" aria-hidden="true">
				<Icon name={view.value.state === "requested" ? "check" : "user-plus"} size="lg" />
			</span>
			{view.value.projectTitle && (
				<p class="invite-landing__meta">
					{view.value.projectTitle}
					{view.value.sharedByName ? ` · shared by ${view.value.sharedByName}` : ""}
				</p>
			)}
			<h1 class="invite-landing__title">{copy.title}</h1>
			<p class="invite-landing__body">{copy.body}</p>

			{copy.canAsk && (
				<div class="invite-landing__ask">
					<label class="invite-landing__label" for="invite-landing-note">
						A note to the managers (optional)
					</label>
					<textarea
						id="invite-landing-note"
						class="invite-landing__note"
						rows={3}
						maxLength={4000}
						placeholder="What would you bring to this stage?"
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
			{error.value && <p class="invite-landing__error" role="alert">{error.value}</p>}
			{copy.next && (
				<a class="invite-landing__next" href={copy.next.href}>
					{copy.next.label}
					<Icon name="arrow-right" size="sm" />
				</a>
			)}
		</main>
	);
}
