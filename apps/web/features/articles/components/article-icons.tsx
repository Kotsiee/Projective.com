import { Icon } from "@projective/ui/icons";
import type { ArticleGlyphs } from "../core/article-glyphs.ts";

/** The registry glyphs the article routes provide through `ArticleGlyphContext`. */
export const ARTICLE_ICONS: ArticleGlyphs = {
	back: () => <Icon name="arrow-left" />,
	forward: () => <Icon name="arrow-right" />,
	chosen: () => <Icon name="check" size="xs" class="artl-topic__check" />,
};
