/**
 * Profile section bodies (root CLAUDE.md §8 Decision #96 — the four consolidated tabs). Each section
 * is a thin server component: Work composes the explore collections + the masonry + the roster; the
 * other three render their own lists. {@link ../ProfileTabContent.tsx} dispatches to these by tab.
 */
export { Empty, formatDate, newestFirst } from "./tab-shared.tsx";
export { WorkTab } from "./WorkTab.tsx";
export { ExperienceTab } from "./ExperienceTab.tsx";
export { ReviewsTab } from "./ReviewsTab.tsx";
export { PostsTab } from "./PostsTab.tsx";
