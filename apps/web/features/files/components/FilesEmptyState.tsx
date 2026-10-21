import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { EmptyState } from "@projective/ui/utils";

/** Props for {@link FilesEmptyState}. */
export interface FilesEmptyStateProps {
	/** A search or filter is narrowing the location — the emptiness is the filter's, not the folder's. */
	narrowed: boolean;
	/** The location is mounted from elsewhere and takes no uploads. */
	readOnly: boolean;
	/** Whether this viewer can upload here at all (a member without the right sees no CTA). */
	canUpload: boolean;
	/** The empty library's sentence, when the host's library is not the person's own. */
	note?: string;
	onUpload: () => void;
	onClearFilters: () => void;
}

/**
 * FilesEmptyState — what the hub body shows when a location lists nothing. Three readings, told apart
 * because each has a different way out: a narrowed view offers to clear its filters, a mounted
 * location explains why it cannot take files, and an empty writable folder invites the first upload
 * (the button or a drop anywhere on the body).
 */
export function FilesEmptyState(props: FilesEmptyStateProps): JSX.Element {
	if (props.narrowed) {
		return (
			<EmptyState
				class="fh-empty"
				icon={<Icon name="search" size="xl" />}
				title="Nothing matches"
				description="No files or folders here match your search and filters."
				actions={
					<Button
						severity="neutral"
						variant="outlined"
						size="sm"
						label="Clear filters"
						onClick={props.onClearFilters}
					/>
				}
			/>
		);
	}

	if (props.readOnly || !props.canUpload) {
		return (
			<EmptyState
				class="fh-empty"
				icon={<Icon name="folder" size="xl" />}
				title="Nothing here yet"
				description={props.readOnly
					? "This location is mounted here, so its files are managed where they live."
					: props.note ?? "Files added to this library will appear here."}
			/>
		);
	}

	return (
		<EmptyState
			class="fh-empty"
			size="lg"
			icon={<Icon name="folder" size="xl" />}
			title="This folder is empty"
			description={props.note ??
				"Upload files or drop them anywhere here. Links you save and folders you make appear here too."}
			actions={
				<Button
					label="Upload files"
					icon={<Icon name="upload" size="sm" />}
					onClick={props.onUpload}
				/>
			}
		/>
	);
}
