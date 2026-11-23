/**
 * `/teams/[teamHandle]/catalogue/[id]/questions` — the buyer questions of a team's listing, read and
 * written as the team (Decision #312). The `/catalogue/[id]/questions` controller, scoped by its
 * handler.
 */
export { default, handler } from "@features/catalogue/routes/questions.tsx";
