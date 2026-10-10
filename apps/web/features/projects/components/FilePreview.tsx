import type { JSX } from "preact";
import "../styles/attachment-modal.css";
import { AudioVisualizer } from "@projective/ui/display";
import { ProgressiveImage } from "@projective/ui/display/image";
import { VideoPlayer } from "@projective/ui/display/video";
import { Icon } from "@projective/ui/icons";
import { MEDIA_PROXY_ROUTE } from "@projective/types/files";
import {
	assetMediaSrc,
	assetMediaSrcset,
	assetPlaceholder,
} from "@features/files/core/asset-media.ts";
import type { AssetItem } from "../types/projects-types.ts";
import { previewDownloadHref, previewIconName } from "./preview/preview-model.ts";
import { LEGACY_TEXT_LINES, useLegacyText } from "./preview/use-legacy-text.ts";

/** Props for {@link FilePreview}. */
export interface FilePreviewProps {
	file: AssetItem;
	/** The visible one of several: loads its picture eagerly. */
	active: boolean;
}

// #region Fixture samples
const SAMPLE: Record<string, string> = {
	ts:
		`import { signal } from "@preact/signals";\n\n// Derived view density for the file grid.\nexport const zoom = signal(0.62);\n\nexport function columnsFor(width: number, min: number): number {\n\treturn Math.max(1, Math.floor(width / min));\n}\n`,
	tsx:
		`export function Card({ title }: { title: string }) {\n\treturn (\n\t\t<div class="card">\n\t\t\t<h3>{title}</h3>\n\t\t</div>\n\t);\n}\n`,
	css:
		`.card {\n\tborder: 1px solid var(--outline);\n\tborder-radius: var(--radius-base);\n\tbackground: var(--surface);\n}\n`,
	json: `{\n\t"name": "tokens",\n\t"radius": { "base": 8, "lg": 12 },\n\t"enabled": true\n}\n`,
};

const KEYWORDS = new Set([
	"import",
	"from",
	"export",
	"function",
	"return",
	"const",
	"let",
	"var",
	"if",
	"else",
	"true",
	"false",
	"new",
	"class",
]);

function highlight(line: string): JSX.Element[] {
	const out: JSX.Element[] = [];
	const commentAt = line.indexOf("//");
	const code = commentAt >= 0 ? line.slice(0, commentAt) : line;
	const comment = commentAt >= 0 ? line.slice(commentAt) : "";
	const re = /("[^"]*"|'[^']*'|`[^`]*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|\s+|[^\s\w])/g;
	let m: RegExpExecArray | null;
	let key = 0;
	while ((m = re.exec(code)) !== null) {
		const t = m[0];
		let cls: string | undefined;
		if (/^["'`]/.test(t)) cls = "fx-code__tok fx-code__tok--str";
		else if (/^\d/.test(t)) cls = "fx-code__tok fx-code__tok--num";
		else if (KEYWORDS.has(t)) cls = "fx-code__tok fx-code__tok--kw";
		out.push(cls ? <span key={key++} class={cls}>{t}</span> : <span key={key++}>{t}</span>);
	}
	if (comment) out.push(<span key={key++} class="fx-code__tok fx-code__tok--cmt">{comment}</span>);
	return out;
}
// #endregion

// #region Renderers
function Placeholder(
	{ file, reason }: { file: AssetItem; reason?: string },
): JSX.Element {
	const isLink = file.source === "link" && file.link !== null;
	const download = previewDownloadHref(file);
	return (
		<div class="fx-preview fx-preview--doc">
			<span class="fx-preview__glyph" aria-hidden="true">
				<Icon name={previewIconName(file.kind)} size="xl" />
			</span>
			<p class="fx-preview__name">{isLink ? file.link?.title || file.name : file.name}</p>
			<p class="fx-preview__meta">
				{isLink ? file.link?.domain : [file.ext.toUpperCase(), file.sizeLabel].filter(Boolean)
					.join(" · ")}
			</p>
			{reason ? <p class="fx-preview__note">{reason}</p> : null}
			{isLink && file.link
				? (
					<a
						class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm fx-preview__action"
						href={file.link.url}
						target="_blank"
						rel="noopener noreferrer"
					>
						<span class="ui-button__icon">
							<Icon name="external-link" size="sm" />
						</span>
						<span class="ui-button__label">Open link</span>
					</a>
				)
				: download
				? (
					<a
						class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm fx-preview__action"
						href={download}
						download={file.name}
					>
						<span class="ui-button__icon">
							<Icon name="download" size="sm" />
						</span>
						<span class="ui-button__label">Download</span>
					</a>
				)
				: null}
		</div>
	);
}

function ImagePreview({ file, active }: FilePreviewProps): JSX.Element {
	const src = assetMediaSrc(file) ?? assetMediaSrc(file, "md");
	if (!src) return <Placeholder file={file} />;
	return (
		<figure class="fx-preview fx-preview--image">
			<ProgressiveImage
				class="fx-preview__picture"
				src={src}
				srcset={assetMediaSrcset(file) ?? undefined}
				sizes="(max-width: 767.98px) 100vw, 70vw"
				alt={file.name}
				fit="contain"
				placeholder={assetPlaceholder(file)}
				loading={active ? "eager" : "lazy"}
				draggable={false}
				fallback={<Icon name="image" size="xl" />}
			/>
		</figure>
	);
}

function VideoPreview({ file }: { file: AssetItem }): JSX.Element {
	const src = assetMediaSrc(file);
	const media = file.metadata?.media;
	const poster = assetMediaSrc(file, "md") ??
		(media?.kind === "video" ? media.posterDataUrl : null) ?? undefined;
	if (!src) return <Placeholder file={file} />;
	return (
		<div class="fx-preview fx-preview--video">
			<div class="fx-preview__screen">
				<VideoPlayer
					variant="full"
					src={src}
					poster={poster}
					label={file.name}
					fit="contain"
					preload="metadata"
				/>
			</div>
		</div>
	);
}

function durationMsOf(file: AssetItem): number {
	const media = file.metadata?.media;
	if (media?.kind === "audio" || media?.kind === "video") return media.durationMs;
	const parts = (file.durationLabel ?? "").split(":").map((p) => Number.parseInt(p, 10));
	if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return 0;
	return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
}

const FLAT_PEAKS = Array.from({ length: 96 }, () => 0.3);

function AudioPreview({ file }: { file: AssetItem }): JSX.Element {
	const media = file.metadata?.media;
	const peaks = media?.kind === "audio" && media.peaks.length > 0 ? media.peaks : FLAT_PEAKS;
	const src = file.messageAudioUrl ?? assetMediaSrc(file) ?? undefined;
	return (
		<div class="fx-preview fx-preview--audio">
			<div class="fx-preview__player">
				<AudioVisualizer
					src={src}
					peaks={peaks}
					durationMs={durationMsOf(file)}
					durationLabel={file.durationLabel ?? undefined}
					showSpeed
					aria-label={`Audio · ${file.name}`}
				/>
			</div>
		</div>
	);
}

function CodePreview({ file }: { file: AssetItem }): JSX.Element {
	const original = assetMediaSrc(file);
	const proxied = original !== null && original.startsWith(`${MEDIA_PROXY_ROUTE}/`)
		? original
		: null;
	const read = useLegacyText(proxied, file.sizeBytes);
	if (proxied && read.status !== "ready") {
		if (read.status === "loading") {
			return (
				<div class="fx-preview fx-preview--doc" role="status">
					<p class="fx-preview__note">Loading {file.name}…</p>
				</div>
			);
		}
		return <Placeholder file={file} reason={read.status === "error" ? read.message : undefined} />;
	}
	const text = proxied && read.status === "ready" ? read.text : SAMPLE[file.ext] ?? SAMPLE.ts;
	const all = text.replace(/\n$/, "").split("\n");
	const lines = all.slice(0, LEGACY_TEXT_LINES);
	return (
		<div class="fx-preview fx-preview--code">
			<pre class="fx-code" tabIndex={0} aria-label={`${file.name} source`}><code>
				{lines.map((line, i) => (
					<span key={i} class="fx-code__line">
						<span class="fx-code__ln" aria-hidden="true">{i + 1}</span>
						<span class="fx-code__src">{line ? highlight(line) : " "}</span>
					</span>
				))}
			</code></pre>
			{all.length > lines.length
				? (
					<p class="fx-preview__note">
						Showing the first {LEGACY_TEXT_LINES.toLocaleString()} of {all.length.toLocaleString()}
						{" "}
						lines.
					</p>
				)
				: null}
		</div>
	);
}
// #endregion

/**
 * FilePreview — the row's own renderer for one file, where the inspector's canvas does not apply (a
 * fixture, a link, a connector file) and wherever a surface draws a file inline (the submission
 * review and pre-submit stages, the public share page). Stored bytes are read through the media
 * proxy: a picture with its BlurHash, a playable video, an audio player, the file's real text for
 * code; anything else names itself and offers its download.
 */
export function FilePreview({ file, active }: FilePreviewProps): JSX.Element {
	switch (file.kind) {
		case "image":
			return <ImagePreview file={file} active={active} />;
		case "video":
			return <VideoPreview file={file} />;
		case "audio":
			return <AudioPreview file={file} />;
		case "code":
			return <CodePreview file={file} />;
		default:
			return <Placeholder file={file} />;
	}
}
