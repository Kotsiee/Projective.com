/**
 * `/projects/[projectSlug]/calendar` — the project-level schedule. The engagement-calendar controller
 * (`features/calendar/routes/project-calendar.tsx`), scoped to the whole project by the absent `channelId`.
 */
export { default, handler } from "@features/calendar/routes/project-calendar.tsx";
