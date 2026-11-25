import {
	type EmailInvitationState,
	type EmailInvitationView,
	invitationRolePhrase,
} from "@projective/types/projects";

/**
 * email-invitation-copy — what the `/invite/[token]` page says for each state of an email invitation
 * (PROJECTS NO1), and where its one way onward goes. Pure, so every state is pinned by a test: the
 * page offers Accept and Decline only for `open`, the one state the answer door takes.
 */

/** One state's copy: the heading, the sentence under it, whether it can be answered, and a way on. */
export interface EmailInvitationCopy {
	title: string;
	body: string;
	canAnswer: boolean;
	next: { label: string; href: string } | null;
}

/** Where a person adds and verifies another address. */
export const EMAIL_SETTINGS_HREF = "/settings/account#emails";

/** The page's copy for an email invitation as the signed-in reader sees it. */
export function emailInvitationCopy(view: EmailInvitationView): EmailInvitationCopy {
	const project = view.projectTitle ?? "this project";
	const where = view.stageName ?? project;
	const inviter = view.inviterName ?? "The person who invited you";
	const projectHref = view.projectSlug ? `/projects/${view.projectSlug}` : null;
	const copy: Record<EmailInvitationState, EmailInvitationCopy> = {
		open: {
			title: `Join ${where}`,
			body: `${inviter} invited you to ${
				view.stageName ? `${view.stageName} on ${project}` : project
			}, as ${invitationRolePhrase(view.role)}.`,
			canAnswer: true,
			next: null,
		},
		accepted: {
			title: `You're on ${project}`,
			body: "You accepted this invitation.",
			canAnswer: false,
			next: projectHref ? { label: "Open the project", href: projectHref } : null,
		},
		declined: {
			title: "You declined this invitation",
			body: `${inviter} has been told.`,
			canAnswer: false,
			next: { label: "Back to your projects", href: "/projects" },
		},
		expired: {
			title: "This invitation has expired",
			body: `Ask ${view.inviterName ?? "the person who invited you"} to invite you again.`,
			canAnswer: false,
			next: { label: "Back to your projects", href: "/projects" },
		},
		withdrawn: {
			title: "This invitation was withdrawn",
			body: `${inviter} cancelled it before it was answered.`,
			canAnswer: false,
			next: { label: "Back to your projects", href: "/projects" },
		},
		not_yours: {
			title: "This invitation is for another address",
			body: `${inviter} sent it to ${
				view.addressHint ?? "another address"
			}. Sign in with that address, or add and verify it on your account, then open the link again.`,
			canAnswer: false,
			next: { label: "Add an email address", href: EMAIL_SETTINGS_HREF },
		},
		invalid: {
			title: "This invitation link doesn't work",
			body: "Check the link in your email, or ask the person who invited you to send it again.",
			canAnswer: false,
			next: { label: "Back to your projects", href: "/projects" },
		},
	};
	return copy[view.state];
}
