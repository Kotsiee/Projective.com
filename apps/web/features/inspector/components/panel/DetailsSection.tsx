import type { JSX } from "preact";
import type { InspectorShell } from "../../core/inspector-shell.ts";
import { accessDetails, fileDetails, shortHash } from "../../core/inspector-model.ts";
import { useInspectorActions } from "../InspectorContext.ts";
import { ToolButton } from "../controls/ToolButton.tsx";
import { Fact, OwnerFact, PlainFact, UploadedFact } from "./facts.tsx";

/** Props for {@link DetailsSection}. */
export interface DetailsSectionProps {
	shell: InspectorShell;
	titleId: string;
}

/** Everything known about the file, as a definition list; rows without a value are omitted. */
export function DetailsSection({ shell, titleId }: DetailsSectionProps): JSX.Element {
	const { asset } = shell;
	const actions = useInspectorActions();

	return (
		<section class="ins-panel__section" aria-labelledby={titleId}>
			<h2 id={titleId} class="ins-panel__title">Details</h2>
			<dl class="ins-facts">
				{fileDetails(asset, shell.facts.value).map((row) => <PlainFact key={row.key} row={row} />)}
				<UploadedFact asset={asset} />
				<OwnerFact asset={asset} />
				{accessDetails(asset).map((row) => <PlainFact key={row.key} row={row} />)}
				{asset.contentHash
					? (
						<Fact label="Content hash">
							<span class="ins-facts__hash">
								<code class="ins-facts__code" title={asset.contentHash}>
									{shortHash(asset.contentHash)}
								</code>
								<ToolButton
									icon="copy"
									label="Copy content hash"
									onClick={() => void actions.copy(asset.contentHash ?? "", "Content hash copied")}
								/>
							</span>
						</Fact>
					)
					: null}
			</dl>
		</section>
	);
}
