/**
 * `/projects/[projectSlug]/[channelId]/calendar` — the channel's Calendar tab. The engagement-calendar
 * controller (`features/calendar/routes/project-calendar.tsx`), scoped to the channel by `channelId`.
 */
export { default, handler } from "@features/calendar/routes/project-calendar.tsx";
