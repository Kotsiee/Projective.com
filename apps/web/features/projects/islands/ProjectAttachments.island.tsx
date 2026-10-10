import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/fx-toolbar.css";
import "../styles/file-card.css";
import "../styles/attachment-modal.css";
import { InputText, MultiSelect } from "@projective/ui/fields";
import type { AssetItem, ExplorerFileItem, FileListPage } from "../types/projects-types.ts";
import { FILE_KIND_OPTIONS } from "../core/file-model.ts";
import { FileCard } from "../components/FileCard.tsx";
import { AttachmentPreviewModal } from "../components/AttachmentPreviewModal.tsx";
import { SearchIcon } from "../components/file-glyphs.tsx";

/**
 * ProjectAttachments — the Overview's reference files: the briefs and documents the client attached to
 * the project (`projects.project_attachments`), searchable by name and filterable by type, each opening
 * in the universal preview. Bytes stream through the media proxy (`/api/media/proxy/:fileId`), which
 * the server-resolved rows already address; nothing here builds a storage URL.
 *
 * The set is small (a project carries at most ten), so search and filter run over the SSR page in
 * place rather than refetching. Rename and star are the preview's optimistic local state, as on the
 * File Explorer.
 */
export interface ProjectAttachmentsProps {
	/** The engagement's route slug. */
	projectSlug: string;
	/** The project-files page resolved server-side, or `null` when the read failed. */
	initial: FileListPage | null;
}

export default function ProjectAttachments(
	{ projectSlug, initial }: ProjectAttachmentsProps,
): JSX.Element {
	const items = useSignal<ExplorerFileItem[]>(initial?.items ?? []);
	const query = useSignal("");
	const kinds = useSignal<string[]>([]);
	const openId = useSignal<string | null>(null);
	const viewerId = initial?.viewerId ?? "";

	const needle = query.value.trim().toLowerCase();
	const shown = items.value.filter((file) =>
		(kinds.value.length === 0 || kinds.value.includes(file.kind)) &&
		(!needle || file.name.toLowerCase().includes(needle))
	);
	const openIndex = openId.value ? shown.findIndex((file) => file.id === openId.value) : -1;

	if (initial === null) {
		return <p class="pjd-block__empty">The project files could not be loaded just now.</p>;
	}
	if (items.value.length === 0) {
		return <p class="pjd-block__empty">The client hasn’t attached any reference files.</p>;
	}

	return (
		<div class="pjd-files">
			<div class="fx-toolbar pjd-files__toolbar">
				<div class="fx-toolbar__search">
					<InputText
						type="search"
						variant="bare"
						size="sm"
						block
						placeholder="Search files…"
						aria-label="Search project files"
						value={query}
						onValueChange={(v: string) => (query.value = v)}
						start={
							<span class="fx-toolbar__searchicon" aria-hidden="true">
								<SearchIcon size={16} />
							</span>
						}
					/>
				</div>
				<span class="fx-toolbar__spacer" />
				<MultiSelect
					class="ui-field--bare"
					size="sm"
					display="chip"
					placeholder="All types"
					aria-label="Filter project files by type"
					options={FILE_KIND_OPTIONS}
					value={kinds}
					onValueChange={(v: string[]) => (kinds.value = v)}
				/>
			</div>

			{shown.length === 0
				? <p class="pjd-block__empty">No files match the current search and filters.</p>
				: (
					<ul class="pjd-files__grid" aria-label="Project files">
						{shown.map((file) => (
							<li key={file.id} class="pjd-files__cell">
								<FileCard file={file} onOpen={(f: AssetItem) => (openId.value = f.id)} />
							</li>
						))}
					</ul>
				)}

			<AttachmentPreviewModal
				open={openIndex >= 0}
				files={shown}
				startIndex={Math.max(0, openIndex)}
				viewerId={viewerId}
				projectId={projectSlug}
				onClose={() => (openId.value = null)}
				onRename={(id, name) =>
					items.value = items.value.map((f) => (f.id === id ? { ...f, name } : f))}
				onToggleStar={(id) =>
					items.value = items.value.map((f) => (f.id === id ? { ...f, starred: !f.starred } : f))}
				context={{ kind: "project", projectSlug }}
			/>
		</div>
	);
}
