import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { FileFamilySource } from "@projective/types/files";
import { FileTypeIcon } from "@features/projects/components/FileTypeIcon.tsx";
import "../styles/links.css";
import { adoptPageHost, pageHosts } from "../core/link-previews.ts";
import { fileCardUrl } from "../core/file-link-card.ts";

/** Props for {@link FileLinkCard}. */
export interface FileLinkCardProps {
	/** Where the card goes: a same-origin path, so a middle or modified click opens it in a tab. */
	href: string;
	name: string;
	/** The file's own facts, for its type tile. */
	file: FileFamilySource;
	/** The meta line ("PDF · 2.4 MB"); empty leaves it out. */
	meta: string;
	/** A same-origin picture of the file; `null`, or one that fails to load, draws the type tile. */
	thumbnail: string | null;
	/** A plain click opens the file in place (the preview modal); the link stays for the rest. */
	onOpen?: (trigger: HTMLElement) => void;
}

function isPlainClick(e: JSX.TargetedMouseEvent<HTMLElement>): boolean {
	return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}

/**
 * FileLinkCard — a file shared as a link, drawn the way a messenger unfurls one (Decision #401): its
 * picture or type tile, its name, what it is and how big, and the address in the footer. The whole
 * card is one link to the file's inspector, so it opens in a tab like any link, and a plain click opens
 * the file in place when the host offers that.
 */
export function FileLinkCard(props: FileLinkCardProps): JSX.Element {
	const { href, name, file, meta, thumbnail, onOpen } = props;
	const failed = useSignal<string | null>(null);

	useEffect(() => adoptPageHost(), []);

	const picture = thumbnail && failed.value !== thumbnail ? thumbnail : null;
	return (
		<a
			class="file-linkcard"
			href={href}
			aria-haspopup={onOpen ? "dialog" : undefined}
			onClick={onOpen
				? (e) => {
					if (!isPlainClick(e)) return;
					e.preventDefault();
					onOpen(e.currentTarget);
				}
				: undefined}
		>
			<span
				class="file-linkcard__media"
				data-picture={picture ? "true" : undefined}
				aria-hidden="true"
			>
				{picture
					? (
						<img
							class="file-linkcard__img"
							src={picture}
							alt=""
							loading="lazy"
							decoding="async"
							draggable={false}
							onError={() => (failed.value = picture)}
						/>
					)
					: <FileTypeIcon file={file} size={44} />}
			</span>
			<span class="file-linkcard__body">
				<span class="file-linkcard__name">{name}</span>
				{meta ? <span class="file-linkcard__meta">{meta}</span> : null}
				<span class="file-linkcard__url">{fileCardUrl(href, pageHosts.value[0] ?? "")}</span>
			</span>
		</a>
	);
}
