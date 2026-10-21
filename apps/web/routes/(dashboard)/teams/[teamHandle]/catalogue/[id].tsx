/**
 * `/teams/[teamHandle]/catalogue/[id]` — one of a team's listings in the item workspace, read and
 * written as the team (Decision #312). The `/catalogue/[id]` controller, scoped by its handler.
 */
export { default, handler } from "@features/catalogue/routes/workspace.tsx";
