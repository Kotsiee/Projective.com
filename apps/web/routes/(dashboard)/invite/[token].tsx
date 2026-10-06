import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { InviteLinkTokenSchema, type InviteLinkView } from "@projective/types/projects";
import { InviteLinkService } from "@server/services/projects/InviteLinkService.ts";
import InviteLinkLanding from "@web/features/projects/islands/InviteLinkLanding.island.tsx";

/**
 * `/invite/[token]` — where a stage invite link lands (Decision #145). Inside `(dashboard)`, so a
 * guest is sent to `/login` with this address as `redirectTo` and returns here signed in. Thin
 * controller: validate the token's shape, ask the fat {@link InviteLinkService} what the link means
 * to this person, hand the answer to the island.
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

export const handler = define.handlers({
	async GET(ctx) {
		const token = InviteLinkTokenSchema.safeParse(ctx.params.token);
		let view = INVALID;
		if (token.success) {
			const result = await InviteLinkService.resolve(token.data, readActor(ctx));
			if (result.ok && result.data) view = result.data;
		}
		ctx.state.title = view.stageName ? `Join ${view.stageName}` : "Invite link";
		return page({ token: token.success ? token.data : "", view }, { headers: INVITE_HEADERS });
	},
});

export default define.page<typeof handler>(function InvitePage({ data }) {
	return <InviteLinkLanding token={data.token} view={data.view} />;
});
