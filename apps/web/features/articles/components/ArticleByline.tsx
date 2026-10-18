import type { JSX } from "preact";
import type { EditorialArticleAuthor } from "@projective/types/editorial";

/** Props for {@link ArticleByline}. */
export interface ArticleBylineProps {
	author: EditorialArticleAuthor;
	/** `lg` for the end-of-article author block; the header byline is the default size. */
	size?: "md" | "lg";
}

/**
 * ArticleByline — who wrote the article, as the article's contact information (`<address>`): the
 * author's picture, their name (a link to their public page when they have one) and their role.
 * Unboxed: a byline is a fact about the article, not a card. The picture is decorative — the name
 * beside it says who it is.
 */
export function ArticleByline({ author, size = "md" }: ArticleBylineProps): JSX.Element {
	return (
		<address class={size === "lg" ? "artl-byline artl-byline--lg" : "artl-byline"}>
			<img
				class={size === "lg"
					? "artl-byline__avatar artl-byline__avatar--lg"
					: "artl-byline__avatar"}
				src={author.avatar.src}
				alt=""
				width={author.avatar.w}
				height={author.avatar.h}
				loading="lazy"
				decoding="async"
			/>
			<span class="artl-byline__text">
				<span class="artl-byline__name">
					{author.href ? <a href={author.href} rel="author">{author.name}</a> : author.name}
				</span>
				<span class="artl-byline__role">{author.role}</span>
			</span>
		</address>
	);
}
