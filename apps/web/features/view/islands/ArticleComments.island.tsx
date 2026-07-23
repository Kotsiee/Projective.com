import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import "../styles/article-view.css";
import { profileHref } from "@features/explore/core/routing.ts";
import { ViewIcon } from "../components/view-glyphs.tsx";
import type { ArticleComment } from "@projective/types/explore";

/**
 * ArticleComments — the discussion section at the foot of the Articles view. Renders the composed
 * comment thread (author · body · date · likes · one level of replies) and a composer. Interactions are
 * optimistic client stubs until the comments write-path lands: posting prepends a local "Just now"
 * comment, and the like control toggles a client-side count. Guests are nudged to sign in to post.
 */
export interface ArticleCommentsProps {
	comments: ArticleComment[];
	authed: boolean;
	/** Sign-in bounce target for a guest who tries to post. */
	signInHref: string;
}

export default function ArticleComments(
	{ comments, authed, signInHref }: ArticleCommentsProps,
): JSX.Element {
	const list = useSignal<ArticleComment[]>(comments);
	const draft = useSignal("");
	const liked = useSignal<Record<string, boolean>>({});

	function post(): void {
		const text = draft.value.trim();
		if (!text) return;
		if (!authed) {
			globalThis.location.href = signInHref;
			return;
		}
		const fresh: ArticleComment = {
			id: `local-${list.value.length}-${text.length}`,
			author: { handle: "@you", name: "You", avatar: "", kind: "user" },
			body: text,
			createdAt: "",
			dateLabel: "Just now",
			likes: 0,
			replies: [],
		};
		list.value = [fresh, ...list.value];
		draft.value = "";
	}

	function toggleLike(id: string): void {
		liked.value = { ...liked.value, [id]: !liked.value[id] };
	}

	const total = list.value.reduce((a, c) => a + 1 + c.replies.length, 0);

	function likeBtn(id: string, base: number): JSX.Element {
		const on = !!liked.value[id];
		return (
			<button
				type="button"
				class="art-cmt__like"
				data-on={on ? "true" : undefined}
				aria-pressed={on}
				aria-label={on ? "Remove like" : "Like"}
				onClick={() => toggleLike(id)}
			>
				<ViewIcon name="like" size={15} />
				<span>{base + (on ? 1 : 0)}</span>
			</button>
		);
	}

	return (
		<section class="art-comments" aria-label="Comments">
			<h2 class="vw-h2 art-comments__title">
				<ViewIcon name="comment" size={20} />
				<span>{total} comment{total === 1 ? "" : "s"}</span>
			</h2>

			{/* Composer. */}
			<div class="art-composer">
				<Avatar image="" label={authed ? "You" : "Guest"} size={40} shape="circle" />
				<div class="art-composer__field">
					<textarea
						class="art-composer__input"
						placeholder={authed ? "Add to the discussion…" : "Sign in to join the discussion…"}
						value={draft.value}
						rows={2}
						aria-label="Write a comment"
						onInput={(e) => (draft.value = (e.target as HTMLTextAreaElement).value)}
					/>
					<div class="art-composer__foot">
						<button
							type="button"
							class="vw-cta vw-cta--primary art-composer__post"
							disabled={authed && draft.value.trim().length === 0}
							onClick={post}
						>
							<ViewIcon name="send" size={16} />
							<span>{authed ? "Post comment" : "Sign in to post"}</span>
						</button>
					</div>
				</div>
			</div>

			{/* Thread. */}
			<ol class="art-cmt-list" role="list">
				{list.value.map((c) => (
					<li key={c.id} class="art-cmt">
						<a class="art-cmt__avatar" href={profileHref(c.author.handle)} aria-hidden="true">
							<Avatar
								image={c.author.avatar}
								label={c.author.name}
								size={40}
								shape={c.author.kind === "business" ? "square" : "circle"}
							/>
						</a>
						<div class="art-cmt__main">
							<div class="art-cmt__head">
								<a class="art-cmt__author" href={profileHref(c.author.handle)}>{c.author.name}</a>
								<span class="art-cmt__date">{c.dateLabel}</span>
							</div>
							<p class="art-cmt__body">{c.body}</p>
							<div class="art-cmt__actions">
								{likeBtn(c.id, c.likes)}
								<button type="button" class="art-cmt__reply">
									<ViewIcon name="reply" size={15} />
									<span>Reply</span>
								</button>
							</div>

							{c.replies.length > 0
								? (
									<ol class="art-cmt-list art-cmt-list--replies" role="list">
										{c.replies.map((r) => (
											<li key={r.id} class="art-cmt art-cmt--reply">
												<a
													class="art-cmt__avatar"
													href={profileHref(r.author.handle)}
													aria-hidden="true"
												>
													<Avatar
														image={r.author.avatar}
														label={r.author.name}
														size={32}
														shape={r.author.kind === "business" ? "square" : "circle"}
													/>
												</a>
												<div class="art-cmt__main">
													<div class="art-cmt__head">
														<a class="art-cmt__author" href={profileHref(r.author.handle)}>
															{r.author.name}
														</a>
														<span class="art-cmt__date">{r.dateLabel}</span>
													</div>
													<p class="art-cmt__body">{r.body}</p>
													<div class="art-cmt__actions">{likeBtn(r.id, r.likes)}</div>
												</div>
											</li>
										))}
									</ol>
								)
								: null}
						</div>
					</li>
				))}
			</ol>
		</section>
	);
}
