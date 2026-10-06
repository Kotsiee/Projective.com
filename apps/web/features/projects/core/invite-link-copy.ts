import type { InviteLinkState, InviteLinkView } from "../types/projects-types.ts";

/**
 * invite-link-copy — what the `/invite/[token]` landing page says for each state of a stage invite
 * link (Decision #145), and where its one follow-up link goes. Pure, so every state is pinned by a
 * test: the page never offers "Ask to join" for a state the redeem door would refuse.
 */

/** One state's copy: the heading, the sentence under it, and an optional way onward. */
export interface InviteLinkCopy {
	title: string;
	body: string;
	/** Whether the page offers the note + "Ask to join". */
	canAsk: boolean;
	next: { label: string; href: string } | null;
}

/** The stage's own address, or the project's when the stage has no slug to route by. */
function stageHref(view: InviteLinkView): string | null {
	if (!view.projectSlug) return null;
	return view.stageSlug
		? `/projects/${view.projectSlug}/${view.stageSlug}`
		: `/projects/${view.projectSlug}`;
}

/** The landing page's copy for a link as the signed-in holder sees it. */
export function inviteLinkCopy(view: InviteLinkView): InviteLinkCopy {
	const stage = view.stageName ?? "this stage";
	const project = view.projectTitle ?? "this project";
	const by = view.sharedByName ?? "The project's managers";
	const onStage = stageHref(view);
	const copy: Record<InviteLinkState, InviteLinkCopy> = {
		open: {
			title: `Ask to join ${stage}`,
			body:
				`${by} shared a link to ${stage} on ${project}. Send a request — they accept or decline it.`,
			canAsk: true,
			next: null,
		},
		requested: {
			title: "Request sent",
			body: `You've asked to join ${stage}. You'll be notified when ${by} answers.`,
			canAsk: false,
			next: { label: "Back to your projects", href: "/projects" },
		},
		member: {
			title: `You're already on ${stage}`,
			body: `You hold a seat on ${stage} in ${project}.`,
			canAsk: false,
			next: onStage ? { label: "Open the stage", href: onStage } : null,
		},
		manager: {
			title: "This is your project's invite link",
			body:
				`Share it with people you'd like on ${stage}. Their requests arrive in the Members tab.`,
			canAsk: false,
			next: view.projectSlug
				? { label: "Open Members", href: `/projects/${view.projectSlug}/members?view=requests` }
				: null,
		},
		invited: {
			title: `You're already invited to ${stage}`,
			body: "Answer the invitation from your inbox — there's no need to ask as well.",
			canAsk: false,
			next: { label: "Open your inbox", href: "/messages" },
		},
		no_profile: {
			title: "Set up your freelancer profile first",
			body:
				`A seat on ${stage} is a freelancer seat. Create your freelancer profile, then open this link again.`,
			canAsk: false,
			next: { label: "Become a freelancer", href: "/become-partner" },
		},
		closed: {
			title: `${stage} isn't taking new people`,
			body: "The stage is finished or the project has closed.",
			canAsk: false,
			next: { label: "Back to your projects", href: "/projects" },
		},
		revoked: {
			title: "This invite link has been turned off",
			body: "Ask whoever shared it for a new link.",
			canAsk: false,
			next: { label: "Back to your projects", href: "/projects" },
		},
		invalid: {
			title: "This invite link doesn't work",
			body: "Check that you copied the whole link, or ask whoever shared it for a new one.",
			canAsk: false,
			next: { label: "Back to your projects", href: "/projects" },
		},
	};
	return copy[view.state];
}
