import "../../../styles/viewer-frame.css";
import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { EMBED_LOAD_TIMEOUT_MS, type ProviderEmbed } from "@projective/types/files";
import { Loader } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";

/** Props for {@link ProviderFrame}. */
export interface ProviderFrameProps {
	embed: ProviderEmbed;
	/** The file's name, for the frame's accessible title. */
	name: string;
	/** Where "Open in …" goes (the provider's own page, through `/exit` when a link must); null hides it. */
	openHref: string | null;
	/** The standard fallback, with the sentence saying why the frame gave way. */
	fallback: (reason: string) => ComponentChildren;
	/** How long the frame may take to report `load`; default {@link EMBED_LOAD_TIMEOUT_MS}. */
	timeoutMs?: number;
}

type FramePhase = "loading" | "ready" | "failed";

/**
 * ProviderFrame — the second rung of the preview ladder: the file drawn by its provider's own viewer
 * (a Google Drive or Docs preview, a YouTube, Vimeo or Loom player, a Figma embed) in a sandboxed
 * frame. An `error`, or no `load` within the timeout, swaps the frame for the standard fallback, so a
 * provider that is down, blocked or slow never leaves the preview blank. Key it by `embed.src`.
 */
export function ProviderFrame(props: ProviderFrameProps): JSX.Element {
	const { embed, name, openHref, fallback, timeoutMs = EMBED_LOAD_TIMEOUT_MS } = props;
	const phase = useSignal<FramePhase>("loading");

	useEffect(() => {
		const watchdog = setTimeout(() => {
			if (phase.peek() === "loading") phase.value = "failed";
		}, timeoutMs);
		return () => clearTimeout(watchdog);
	}, [embed.src, timeoutMs]);

	if (phase.value === "failed") {
		return <>{fallback(`${embed.label} didn't load this preview.`)}</>;
	}

	return (
		<div class="ins-frame" data-phase={phase.value} data-provider={embed.provider}>
			<iframe
				class="ins-frame__view"
				src={embed.src}
				title={`${name} — ${embed.label} preview`}
				sandbox={embed.sandbox}
				allow={embed.allow}
				referrerpolicy={embed.referrerPolicy}
				allowFullScreen
				onLoad={() => {
					if (phase.peek() === "loading") phase.value = "ready";
				}}
				onError={() => (phase.value = "failed")}
			/>
			{phase.value === "loading"
				? (
					<div class="ins-frame__wait">
						<Loader label={`Loading the ${embed.label} preview…`} />
					</div>
				)
				: null}
			{openHref
				? (
					<div class="ins-frame__bar">
						<a
							class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm ins-frame__open"
							href={openHref}
							target="_blank"
							rel="noopener noreferrer nofollow ugc"
							referrerpolicy="no-referrer"
						>
							<span class="ui-button__icon">
								<Icon name="external-link" size="sm" />
							</span>
							<span class="ui-button__label">{`Open in ${embed.label}`}</span>
						</a>
					</div>
				)
				: null}
		</div>
	);
}
