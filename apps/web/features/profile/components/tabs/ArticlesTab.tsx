import type { JSX } from "preact";
import { ArticlesGridList } from "@features/explore/components/collections/ArticlesGridList.tsx";
import { Empty } from "./tab-shared.tsx";
import type { ArticleItem } from "../../types/profile-types.ts";

/**
 * ArticlesTab — the profile's Articles tab body. Reuses the explore {@link ArticlesGridList}
 * collection (root CLAUDE.md Part 2).
 */
export function ArticlesTab(
	{ items, authed }: { items: ArticleItem[]; authed: boolean },
): JSX.Element {
	return items.length ? <ArticlesGridList items={items} authed={authed} /> : <Empty />;
}
