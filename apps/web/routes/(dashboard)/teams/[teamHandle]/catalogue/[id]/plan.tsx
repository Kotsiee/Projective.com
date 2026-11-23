/**
 * `/teams/[teamHandle]/catalogue/[id]/plan` — the session plan of a team's listing, read and written
 * as the team (Decision #312). The `/catalogue/[id]/plan` controller, scoped by its handler.
 */
export { default, handler } from "@features/catalogue/routes/plan.tsx";
