/**
 * `/teams/[teamHandle]/catalogue` — a team's catalogue console, read and written as the team (Decision
 * #312). The `/catalogue` controller, scoped by its handler; it is a static segment, so the `[module]`
 * route never sees `catalogue`.
 */
export { default, handler } from "@features/catalogue/routes/console.tsx";
