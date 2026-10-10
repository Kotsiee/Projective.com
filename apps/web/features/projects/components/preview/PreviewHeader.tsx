import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useDismiss } from "@projective/ui/hooks";
import { Icon } from "@projective/ui/icons";
import type { AssetItem } from "../../types/projects-types.ts";
import type { PreviewIconName } from "./preview-model.ts";
import { PreviewAction, PreviewLinkAction } from "./PreviewAction.tsx";

/** Props for {@link PreviewHeader}. */
export interface PreviewHeaderProps {
	file: AssetItem;
	/** The id the dialog is labelled by. */
	titleId: string;
	icon: PreviewIconName;
	/** `Format · Size · W × H` (or the duration), already composed. */
	meta: string;
	canRename: boolean;
	onRename: (name: string) => void;
	onToggleStar: () => void;
	/** Where the original downloads from; null hides the control. */
	downloadHref: string | null;
	/** Record-then-download for stored bytes; without it the link downloads directly. */
	onDownload?: () => void;
	/** The inspector page; null when the file has no stored bytes to inspect. */
	inspectHref: string | null;
	/** The side panel's toggle (desktop); null hides it. */
	aside: { open: boolean; controls: string; onToggle: () => void } | null;
	onClose: () => void;
	/** Arrow keys page through the group while focus is in the header. */
	onKeyDown?: (event: JSX.TargetedKeyboardEvent<HTMLElement>) => void;
}

const COPIED_MS = 1800;

/**
 * The preview's header: category mark, the name (renamed in place when allowed) over its meta line,
 * then the action rig — star, download, copy link, open in a new tab, the side-panel toggle, close.
 */
export function PreviewHeader(props: PreviewHeaderProps): JSX.Element {
	const {
		file,
		titleId,
		icon,
		meta,
		canRename,
		onRename,
		onToggleStar,
		downloadHref,
		onDownload,
		inspectHref,
		aside,
		onClose,
		onKeyDown,
	} = props;
	const editing = useSignal(false);
	const draft = useSignal("");
	const copied = useSignal(false);
	const status = useSignal("");
	const inputRef = useRef<HTMLInputElement>(null);
	const nameRef = useRef<HTMLButtonElement>(null);

	// #region Rename
	const startEdit = () => {
		if (!canRename) return;
		draft.value = file.name;
		editing.value = true;
	};
	const finish = () => {
		editing.value = false;
		setTimeout(() => {
			const active = document.activeElement;
			if (active && active !== document.body && active.isConnected) return;
			nameRef.current?.focus({ preventScroll: true });
		}, 0);
	};
	const commit = () => {
		if (!editing.peek()) return;
		const next = draft.value.trim();
		finish();
		if (next && next !== file.name) onRename(next);
	};
	const cancel = () => {
		if (editing.peek()) finish();
	};
	useDismiss({
		open: editing.value,
		onDismiss: cancel,
		panelRef: inputRef,
		closeOnOutside: false,
	});
	// #endregion

	// #region Copy link
	useEffect(() => {
		if (!copied.value) return;
		const timer = setTimeout(() => {
			copied.value = false;
			status.value = "";
		}, COPIED_MS);
		return () => clearTimeout(timer);
	}, [copied.value]);

	const copyLink = (href: string) => {
		const clipboard = globalThis.navigator?.clipboard;
		const url = new URL(href, globalThis.location.origin).toString();
		if (!clipboard) {
			status.value = "Copying isn't available here.";
			return;
		}
		clipboard.writeText(url).then(
			() => {
				copied.value = true;
				status.value = "Link copied.";
			},
			() => {
				status.value = "Couldn't copy the link.";
			},
		);
	};
	// #endregion

	return (
		<header class="fx-modal__head" onKeyDown={onKeyDown}>
			<span class="fx-modal__glyph" aria-hidden="true">
				<Icon name={icon} size="md" />
			</span>
			<div class="fx-modal__heading">
				<h2 id={titleId} class="fx-modal__title">
					{editing.value
						? (
							<>
								<span class="ui-visually-hidden">{file.name}</span>
								<input
									ref={inputRef}
									class="fx-modal__rename"
									type="text"
									value={draft.value}
									autoFocus
									aria-label="Rename file"
									onInput={(e) => (draft.value = e.currentTarget.value)}
									onBlur={commit}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											commit();
										}
									}}
								/>
							</>
						)
						: canRename
						? (
							<button
								ref={nameRef}
								type="button"
								class="fx-modal__name"
								data-editable="true"
								aria-label={`${file.name}, rename`}
								onClick={startEdit}
							>
								<span class="fx-modal__nametext">{file.name}</span>
								<span class="fx-modal__nameedit" aria-hidden="true">
									<Icon name="edit" size="xs" />
								</span>
							</button>
						)
						: (
							<span class="fx-modal__name" title={file.name}>
								<span class="fx-modal__nametext">{file.name}</span>
							</span>
						)}
				</h2>
				{meta ? <p class="fx-modal__meta">{meta}</p> : null}
			</div>
			<div class="fx-modal__actions">
				<PreviewAction
					icon="star"
					label={file.starred ? "Unstar" : "Star"}
					pressed={file.starred}
					filled={file.starred}
					class="fx-modal__action--star"
					onClick={onToggleStar}
				/>
				{downloadHref && onDownload
					? <PreviewAction icon="download" label="Download" onClick={onDownload} />
					: downloadHref
					? <PreviewLinkAction icon="download" label="Download" href={downloadHref} download />
					: null}
				{inspectHref
					? (
						<PreviewAction
							icon={copied.value ? "check" : "link"}
							label={copied.value ? "Link copied" : "Copy link"}
							onClick={() => copyLink(inspectHref)}
						/>
					)
					: null}
				{inspectHref
					? (
						<span class="fx-modal__wide">
							<PreviewLinkAction
								icon="external-link"
								label="Open in new tab"
								href={inspectHref}
								external
							/>
						</span>
					)
					: null}
				{aside
					? (
						<PreviewAction
							icon="panel-right"
							label={aside.open ? "Hide details" : "Show details"}
							pressed={aside.open}
							controls={aside.controls}
							onClick={aside.onToggle}
						/>
					)
					: null}
				<PreviewAction icon="close" label="Close preview" onClick={onClose} />
			</div>
			<span class="ui-visually-hidden" role="status" aria-live="polite">{status.value}</span>
		</header>
	);
}
