import { define } from "@web/utils/state.ts";
import RsvpGate from "../islands/RsvpGate.island.tsx";
import { handler } from "./rsvp-handler.ts";

/**
 * `/rsvp/[token]` — where a guest's email lands: an invitation for somebody with no account, on a page
 * with no shell (Decision #391). The handler lives in `rsvp-handler.ts`, apart from the page, so it
 * loads under `deno test`.
 */
export { handler };

export default define.page<typeof handler>(function RsvpPage({ data }) {
	return <RsvpGate {...data} />;
});
