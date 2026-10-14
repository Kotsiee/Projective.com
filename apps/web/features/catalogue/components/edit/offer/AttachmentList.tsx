import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { PRODUCT_ATTACHMENTS_MAX } from "@projective/types/catalogue";
import type { FileKind } from "@projective/types/files";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import type { AttachmentRef } from "../../../types/catalogue-types.ts";
import { addAttachments, attachmentOf, bytesLabel, removeItem } from "../../../core/offer-model.ts";

const PICKER_ID = "catalogue-attachments";

/** What a product bundle delivers: anything but pictures and links, archives included. */
const ATTACHABLE: FileKind[] = ["video", "audio", "pdf", "doc", "code", "archive", "file"];

/** Props for {@link AttachmentList}. */
export interface AttachmentListProps {
	attachments: readonly AttachmentRef[];
	onChange: (attachments: readonly AttachmentRef[]) => void;
}

/**
 * AttachmentList — the files a product delivers, attached from the seller's library (documents,
 * source, audio, video and ZIP bundles; never a URL). Each row is the file's name with its format
 * and size as meta text, not chips. At most twenty-four.
 */
export function AttachmentList(props: AttachmentListProps): JSX.Element {
	const { attachments, onChange } = props;
	const skipped = useSignal<string | null>(null);
	const room = PRODUCT_ATTACHMENTS_MAX - attachments.length;

	const take = (assets: AssetItem[]) => {
		const rows = assets.map((a) =>
			attachmentOf({
				id: a.id,
				assetId: a.assetId ?? null,
				name: a.name,
				ext: a.ext,
				sizeBytes: a.sizeBytes,
			})
		);
		const usable = rows.filter((r): r is AttachmentRef => r !== null);
		skipped.value = usable.length < rows.length
			? "A file without an extension can't be listed in a bundle, so it was left out."
			: null;
		onChange(addAttachments(attachments, usable, PRODUCT_ATTACHMENTS_MAX));
	};

	return (
		<div class="cat-offer__files-wrap">
			{attachments.length > 0
				? (
					<ul class="cat-offer__files" aria-label="Delivered files">
						{attachments.map((file, i) => (
							<li key={`${file.fileId ?? file.name}-${i}`} class="cat-offer__file">
								<Icon name="attachment" size="xs" class="cat-offer__file-mark" />
								<span class="cat-offer__file-name">{file.name}</span>
								<span class="cat-offer__file-meta">
									{file.label} · {file.extension} · {bytesLabel(file.bytes)}
								</span>
								<button
									type="button"
									class="cat-offer__remove"
									aria-label={`Remove ${file.name}`}
									onClick={() =>
										onChange(removeItem(attachments, i))}
								>
									<Icon name="close" size="2xs" />
								</button>
							</li>
						))}
					</ul>
				)
				: (
					<p class="cat-sec__hint">
						Nothing attached yet. Buyers receive these files after paying.
					</p>
				)}
			{skipped.value && <p class="cat-sec__hint" role="status">{skipped.value}</p>}
			{room > 0
				? (
					<Button
						label="Attach from your files"
						icon={<Icon name="attachment" size="xs" />}
						severity="neutral"
						variant="outlined"
						size="sm"
						onClick={() =>
							openPicker({
								requesterId: PICKER_ID,
								title: "Attach files to this product",
								kinds: ATTACHABLE,
								multiple: true,
								max: room,
							})}
					/>
				)
				: <p class="cat-sec__hint">A product delivers at most {PRODUCT_ATTACHMENTS_MAX} files.</p>}
			<AssetPicker requesterId={PICKER_ID} onPick={take} />
		</div>
	);
}
