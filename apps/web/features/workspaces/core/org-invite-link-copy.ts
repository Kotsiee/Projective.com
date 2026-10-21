import {
	kindCopy,
	type OrgInviteLinkState,
	type OrgInviteLinkView,
	workspaceHref,
} from "@projective/types/workspace";

/**
 * org-invite-link-copy — what the `/invite/[token]` landing page says for each state of a team's or
 * business's invite link (Decision #318), and where its one follow-up link goes. Pure, so every state
 * is pinned by a test: the page never offers "Ask to join" for a state the redeem door would refuse.
 */

/** One state's copy: the heading, the sentence under it, and an optional way onward. */
export interface OrgInviteLinkCopy {
	title: string;
	body: string;
	/** Whether the page offers the note + "Ask to join". */
	canAsk: boolean;
	next: { label: string; href: string } | null;
}

/** The landing page's copy for a workspace link as the signed-in holder sees it. */
export function orgInviteLinkCopy(view: OrgInviteLinkView): OrgInviteLinkCopy {
	const kind = view.kind ?? "team";
	const noun = kindCopy(kind).noun;
	const name = view.workspaceName ?? `this ${noun}`;
	const role = view.roleName ?? "Member";
	const by = view.sharedByName ?? `${name}'s admins`;
	const index = kind === "team" ? "/teams" : "/businesses";
	const home = view.workspaceHandle ? workspaceHref(kind, view.workspaceHandle) : index;
	const back = { label: `Back to your ${noun === "team" ? "teams" : "businesses"}`, href: index };
	const copy: Record<OrgInviteLinkState, OrgInviteLinkCopy> = {
		open: {
			title: `Ask to join ${name}`,
			body:
				`${by} shared a link to join ${name} as ${role}. Send a request — ${name}'s admins approve or decline it.`,
			canAsk: true,
			next: null,
		},
		requested: {
			title: "Request sent",
			body: `${name}'s admins will answer it. You'll be notified when they do.`,
			canAsk: false,
			next: back,
		},
		member: {
			title: `You're already in ${name}`,
			body: `You're a member of ${name}.`,
			canAsk: false,
			next: { label: `Open ${name}`, href: home },
		},
		invited: {
			title: `You're already invited to ${name}`,
			body: "Answer the invitation instead — there's no need to ask as well.",
			canAsk: false,
			next: { label: "Open your invitations", href: `${index}?view=invitations` },
		},
		persona: {
			title: "Teams are for freelancer accounts",
			body: `Joining ${name} takes a freelancer profile. Set one up, then open this link again.`,
			canAsk: false,
			next: { label: "Become a freelancer", href: "/become-partner" },
		},
		archived: {
			title: `${name} isn't taking new people`,
			body: `The ${noun} has been archived.`,
			canAsk: false,
			next: back,
		},
		revoked: {
			title: "This invite link has been turned off",
			body: "Ask whoever shared it for a new link.",
			canAsk: false,
			next: back,
		},
		invalid: {
			title: "This invite link doesn't work",
			body: "Check that you copied the whole link, or ask whoever shared it for a new one.",
			canAsk: false,
			next: back,
		},
	};
	return copy[view.state];
}
