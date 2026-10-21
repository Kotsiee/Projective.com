/**
 * `/teams/[teamHandle]/catalogue/[id]/simulate` — the buyer simulation of a team's listing, read as
 * the team and framed by its workspace's Preview tab (Decision #312). The `/catalogue/[id]/simulate`
 * controller, scoped by its handler.
 */
export { default, handler } from "@features/catalogue/routes/simulate.tsx";
