/**
 * `/explore` — the discovery surface. A thin route: the handler and page live in the explore
 * feature's controller, which the guest front page `/` shares (Decision #349).
 */
export { default, handler } from "@features/explore/routes/ExplorePage.tsx";
