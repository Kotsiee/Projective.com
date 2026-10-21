import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { InviteLinkTokenSchema, type InviteLinkView } from "@projective/types/projects";
import { OrgInviteLinkTokenSchema, type OrgInviteLinkView } from "@projective/types/workspace";
import { InviteLinkService } from "@server/services/projects/InviteLinkService.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";
import { INVALID_LINK_VIEW } from "@server/services/workspace/live-invite-links.ts";
import InviteLinkLanding from "@web/features/projects/islands/InviteLinkLanding.island.tsx";
import OrgInviteLanding from "@web/features/workspaces/islands/OrgInviteLanding.island.tsx";

/**
 * `/invite/[token]` — where an invite link lands. Inside `(dashboard)`, so a guest is sent to
 * `/login` with this address as `redirectTo` and returns here signed in. Thin controller: the token's
 * shape decides whose link it is, then the fat service says what the link means to this person and
 * the island renders it.
 *
 *   - a stage invite link (24 base64url characters, Decision #145) → {@link InviteLinkService};
 *   - a team's or business's invite link (`w-` + 24, Decision #318) → {@link WorkspaceBackendService}.
 *
 * `noindex` and `no-referrer`: the path is a capability, so it is neither indexed nor announced to
 * the next site the reader opens.
 */

const INVITE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"x-robots-tag": "noindex, nofollow",
	"referrer-policy": "no-referrer",
	"cache-control": "private, no-store",
});

const INVALID: InviteLinkView = {
	state: "invalid",
	projectSlug: null,
	projectTitle: null,
	stageSlug: null,
	stageName: null,
	sharedByName: null,
	sharedByHandle: null,
};

type InviteData =
	| { scope: "stage"; token: string; view: InviteLinkView }
	| { scope: "workspace"; token: string; view: OrgInviteLinkView };

export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		const org = OrgInviteLinkTokenSchema.safeParse(ctx.params.token);
		if (org.success) {
			const result = await WorkspaceBackendService.resolveInviteLink(org.data, actor);
			const view = result.ok && result.data ? result.data : INVALID_LINK_VIEW;
			ctx.state.title = view.workspaceName ? `Join ${view.workspaceName}` : "Invite link";
			const data: InviteData = { scope: "workspace", token: org.data, view };
			return page(data, { headers: INVITE_HEADERS });
		}
		const token = InviteLinkTokenSchema.safeParse(ctx.params.token);
		let view = INVALID;
		if (token.success) {
			const result = await InviteLinkService.resolve(token.data, actor);
			if (result.ok && result.data) view = result.data;
		}
		ctx.state.title = view.stageName ? `Join ${view.stageName}` : "Invite link";
		const data: InviteData = { scope: "stage", token: token.success ? token.data : "", view };
		return page(data, { headers: INVITE_HEADERS });
	},
});

export default define.page<typeof handler>(function InvitePage({ data }) {
	return data.scope === "workspace"
		? <OrgInviteLanding token={data.token} view={data.view} />
		: <InviteLinkLanding token={data.token} view={data.view} />;
});
