/**
 * `POST /api/sessions/webhooks/[provider]` — the old presence path (Decision #171), kept until the Zoom
 * app's Event Subscription is re-pointed at `/api/integrations/webhooks/zoom`. The same handler, so a
 * delivery behaves identically on either path.
 */
export { handler } from "@web/routes/api/integrations/webhooks/[provider].ts";
