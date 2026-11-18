import { define } from "@web/utils/state.ts";
import NewsletterLinkPanel from "../islands/NewsletterLinkPanel.island.tsx";
import { confirmPageHandler } from "./link-handlers.ts";

/**
 * `/newsletter/confirm?token=` — where the newsletter's confirmation mail lands (PRD-E11). The page
 * writes nothing; the person's press of Confirm posts the token to `POST /api/newsletter/confirm`.
 */
export const handler = confirmPageHandler;

export default define.page<typeof handler>(function NewsletterConfirmPage({ data }) {
	return <NewsletterLinkPanel {...data} />;
});
