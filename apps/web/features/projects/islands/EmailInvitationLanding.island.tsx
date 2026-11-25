import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/invite-landing.css";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { EmailInvitationView } from "@projective/types/projects";
import { RequestService } from "../core/RequestService.ts";
import { emailInvitationCopy } from "../core/email-invitation-copy.ts";
import { PayoutGateLink } from "@features/settings/components/PayoutGateLink.tsx";
import { ensureClientTrustConsent } from "@features/reviews/core/client-trust.ts";
import { ClientTrustDialog } from "@features/reviews/components/ClientTrustDialog.tsx";

/**
 * EmailInvitationLanding — the `/invite/[token]` page for an email invitation (PROJECTS NO1): who
 * invited the reader, to what, as which role, and, only when the invitation is theirs and open,
 * Accept and Decline. Accepting asks for the Informed Consent first when the client is warned
 * (Decision #486 (C)); a payout refusal links to the payout setup. The page's state is the server's
 * (`projects.email_invitation`); after an answer it moves to what a reload would read back.
 */
export interface EmailInvitationLandingProps {
	token: string;
	view: EmailInvitationView;
}

export default function EmailInvitationLanding(props: EmailInvitationLandingProps): JSX.Element {
	const view = useSignal<EmailInvitationView>(props.view);
	const busy = useSignal<"accept" | "decline" | null>(null);
	const error = useSignal<string | null>(null);
	const errorDetails = useSignal<unknown>(null);

	const copy = emailInvitationCopy(view.value);

	async function answer(accept: boolean): Promise<void> {
		if (busy.value) return;
		busy.value = accept ? "accept" : "decline";
		error.value = null;
		const project = view.value.projectSlug;
		if (accept && project && !(await ensureClientTrustConsent(project))) {
			busy.value = null;
			return;
		}
		const res = await RequestService.answerEmailInvitation({ token: props.token, accept });
		busy.value = null;
		if (res.ok && res.data) {
			view.value = {
				...view.value,
				state: res.data.state,
				projectSlug: res.data.projectSlug ?? view.value.projectSlug,
			};
			return;
		}
		error.value = res.message ?? "Your answer could not be sent — please try again.";
		errorDetails.value = res.details ?? null;
	}

	const glyph = view.value.state === "accepted" ? "check" : "mail";

	return (
		// Not a second `<main>`: the shell's canvas is the page's one main landmark.
		<div class="invite-landing">
			<span class="invite-landing__glyph" aria-hidden="true">
				<Icon name={glyph} size="lg" />
			</span>
			{view.value.projectTitle && (
				<p class="invite-landing__meta">
					{view.value.projectTitle}
					{view.value.inviterName ? ` · from ${view.value.inviterName}` : ""}
				</p>
			)}
			<h1 class="invite-landing__title">{copy.title}</h1>
			<p class="invite-landing__body">{copy.body}</p>

			{copy.canAnswer && (
				<div class="invite-landing__answer">
					<Button
						label="Accept"
						icon={<Icon name="check" size="sm" />}
						loading={busy.value === "accept"}
						disabled={busy.value === "decline"}
						onClick={() => void answer(true)}
					/>
					<Button
						label="Decline"
						severity="neutral"
						variant="outlined"
						loading={busy.value === "decline"}
						disabled={busy.value === "accept"}
						onClick={() => void answer(false)}
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
			<ClientTrustDialog />
		</div>
	);
}
