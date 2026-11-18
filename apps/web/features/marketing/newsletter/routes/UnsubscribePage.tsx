import { define } from "@web/utils/state.ts";
import NewsletterLinkPanel from "../islands/NewsletterLinkPanel.island.tsx";
import { unsubscribePageHandler } from "./link-handlers.ts";

/**
 * `/newsletter/unsubscribe?token=` — where a newsletter mail's unsubscribe link lands, and where a
 * GET of its `List-Unsubscribe` URL is forwarded (PRD-E11). The page writes nothing; the press of
 * Unsubscribe posts the token to `POST /api/newsletter/unsubscribe`.
 */
export const handler = unsubscribePageHandler;

export default define.page<typeof handler>(function NewsletterUnsubscribePage({ data }) {
	return <NewsletterLinkPanel {...data} />;
});
