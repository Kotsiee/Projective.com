import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { AudioVisualizer } from "@projective/ui/display";
import "../styles/article-view.css";
import { ViewIcon } from "../components/view-glyphs.tsx";
import type { ArticleBlock } from "@projective/types/explore";

/**
 * ArticleContent — renders the rich article body as a stream of structured blocks: nested headings
 * (`h2`/`h3`, each with the stable slug `id` the Table of Contents anchors to + scroll-spies), prose,
 * bullet lists, pull-quotes, inline images, embedded YouTube (a privacy facade — the poster loads no
 * third-party JS until the reader clicks play, then swaps to a `youtube-nocookie` iframe), and inline
 * audio players (the reusable `@projective/ui` `AudioVisualizer`). It is an island because the video
 * facade + audio players are interactive; the heading markup still SSRs, so the TOC scrollspy resolves
 * the anchors on first paint.
 */
export interface ArticleContentProps {
	blocks: ArticleBlock[];
}

function YouTubeEmbed({ block }: { block: ArticleBlock }): JSX.Element {
	const playing = useSignal(false);
	const poster = block.thumb ?? `https://i.ytimg.com/vi/${block.videoId}/hqdefault.jpg`;
	return (
		<figure class="art-embed">
			<div class="art-embed__frame">
				{playing.value
					? (
						<iframe
							class="art-embed__iframe"
							src={`https://www.youtube-nocookie.com/embed/${block.videoId}?autoplay=1&rel=0`}
							title={block.title ?? "Embedded video"}
							allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
							loading="lazy"
						/>
					)
					: (
						<button
							type="button"
							class="art-embed__play"
							onClick={() => (playing.value = true)}
							aria-label={`Play video: ${block.title ?? "walkthrough"}`}
						>
							<img class="art-embed__poster" src={poster} alt="" loading="lazy" />
							<span class="art-embed__badge" aria-hidden="true">
								<ViewIcon name="play" size={26} />
							</span>
							{block.title ? <span class="art-embed__title">{block.title}</span> : null}
						</button>
					)}
			</div>
			{block.caption ? <figcaption class="art-figcap">{block.caption}</figcaption> : null}
		</figure>
	);
}

function renderBlock(block: ArticleBlock, i: number): JSX.Element | null {
	switch (block.type) {
		case "heading":
			return <h2 key={i} id={block.id} class="art-h2">{block.text}</h2>;
		case "subheading":
			return <h3 key={i} id={block.id} class="art-h3">{block.text}</h3>;
		case "paragraph":
			return <p key={i} class="art-p">{block.text}</p>;
		case "quote":
			return <blockquote key={i} class="art-quote">{block.text}</blockquote>;
		case "list":
			return (
				<ul key={i} class="art-list">
					{(block.items ?? []).map((it, j) => <li key={j}>{it}</li>)}
				</ul>
			);
		case "image":
			return (
				<figure key={i} class="art-figure">
					<img class="art-figure__img" src={block.src} alt={block.alt ?? ""} loading="lazy" />
					{block.caption ? <figcaption class="art-figcap">{block.caption}</figcaption> : null}
				</figure>
			);
		case "youtube":
			return <YouTubeEmbed key={i} block={block} />;
		case "audio":
			return (
				<figure key={i} class="art-audio">
					{block.title
						? (
							<figcaption class="art-audio__title">
								<ViewIcon name="audio" size={16} />
								<span>{block.title}</span>
							</figcaption>
						)
						: null}
					<AudioVisualizer
						peaks={block.peaks ?? []}
						durationMs={block.durationMs ?? 0}
						src={block.src}
						durationLabel={block.durationLabel}
						showSpeed
						aria-label={block.title ?? "Audio clip"}
						class="art-audio__player"
					/>
				</figure>
			);
		default:
			return null;
	}
}

export default function ArticleContent({ blocks }: ArticleContentProps): JSX.Element {
	return <div class="art-body">{blocks.map(renderBlock)}</div>;
}
