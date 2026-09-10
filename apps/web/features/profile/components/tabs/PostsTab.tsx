import type { JSX } from "preact";
import { ArticlesGridList } from "@features/explore/components/collections/ArticlesGridList.tsx";
import type { ProfileTabPayload } from "../../types/profile-types.ts";

/**
 * PostsTab — the Posts section: the profile's published articles through the explore
 * {@link ArticlesGridList} (lead tile + compact rows). A SERVER component; `profile-posts.css` only
 * neutralises the collection's spacing inside the panel.
 */
export interface PostsTabProps {
	payload: ProfileTabPayload;
	authed: boolean;
}

export function PostsTab({ payload, authed }: PostsTabProps): JSX.Element {
	return (
		<div class="pf-posts">
			<ArticlesGridList items={payload.articles} authed={authed} />
		</div>
	);
}
