import { page } from "fresh";
import { EmptyState } from "@projective/ui/utils";
import type { RoomJoinState } from "@projective/types/scheduling";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { RoomBackendService } from "@server/services/integrations/RoomBackendService.ts";

/**
 * `/meet/[roomSlug]` — into a meeting room, as the signed-in person (Decision #383).
 *
 * An open room answers `303` to that person's own link at the provider, so joining is one press from
 * the calendar, an email or an external calendar entry, all of which carry only this address. Any other
 * state says why not and where to go next. The page is never cached, and sends no referrer to the
 * provider, because the address and the link are both a person's own.
 */

/** What a person is told when there is no link to give them yet. */
const WHY_NOT: Record<Exclude<RoomJoinState, "open">, { title: string; body: string }> = {
	upcoming: {
		title: "This room isn't open yet",
		body: "It opens shortly before the start. Come back then, or join from your calendar.",
	},
	ended: { title: "This meeting has ended", body: "The room is closed." },
	cancelled: { title: "This meeting was cancelled", body: "There is nothing to join." },
	not_party: {
		title: "This room isn't yours",
		body: "Only the people on this meeting can join it.",
	},
	needs_rsvp: {
		title: "Say you're coming first",
		body: "Accept the invitation on your calendar, and this link will take you in.",
	},
	unfunded: {
		title: "This session isn't paid for yet",
		body: "The room opens once your seat is paid for.",
	},
	unconfirmed: {
		title: "This call isn't confirmed yet",
		body: "The room opens once both of you have agreed the time.",
	},
	no_room: {
		title: "The room isn't ready",
		body: "The host's meeting room hasn't been created yet. Check back shortly.",
	},
};

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

export const handler = define.handlers({
	async GET(ctx) {
		const res = await RoomBackendService.join(ctx.params.roomSlug, readActor(ctx));
		if (res.ok && res.data?.url) {
			return new Response(null, { status: 303, headers: { location: res.data.url, ...NO_STORE } });
		}
		const state = res.ok && res.data ? res.data.state : null;
		ctx.state.title = "Meeting · Projective";
		return page(
			{ why: state && state !== "open" ? WHY_NOT[state] : null, failure: res.ok ? null : res.message ?? null },
			{ headers: NO_STORE },
		);
	},
});

export default define.page<typeof handler>(function MeetPage({ data }) {
	const why = data.why ?? { title: "We couldn't open this meeting", body: data.failure ?? "Try again in a moment." };
	return (
		<EmptyState
			title={why.title}
			heading={1}
			description={`${why.body} Joining records your attendance, which protects your payment.`}
			actions={
				<a
					class="ui-button ui-button--primary ui-button--outlined ui-button--size-md ui-button--rounded"
					href="/calendar"
				>
					<span class="ui-button__label">Back to your calendar</span>
				</a>
			}
		/>
	);
});
