import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { PdfEngine } from "./pdf-engine.ts";
import type { PdfOutlineItem } from "./pdf-tools.ts";

/** Props for {@link PdfOutline}. */
export interface PdfOutlineProps {
	items: readonly PdfOutlineItem[];
	engine: PdfEngine;
}

/** The document's bookmarks as a nested list; top-level branches start open. */
export function PdfOutline({ items, engine }: PdfOutlineProps): JSX.Element {
	return (
		<ul class="ins-pdf-outline">
			{items.map((item) => <OutlineEntry key={item.key} item={item} depth={0} engine={engine} />)}
		</ul>
	);
}

interface OutlineEntryProps {
	item: PdfOutlineItem;
	depth: number;
	engine: PdfEngine;
}

function OutlineEntry({ item, depth, engine }: OutlineEntryProps): JSX.Element {
	const open = useSignal(depth === 0);
	const branch = item.items.length > 0;
	const target = item.url
		? (
			<a class="ins-pdf-outline__link" href={item.url} target="_blank" rel="noopener noreferrer">
				{item.title}
			</a>
		)
		: item.dest !== null
		? (
			<button
				type="button"
				class="ins-pdf-outline__link"
				onClick={() => item.dest !== null && void engine.goToDest(item.dest)}
			>
				{item.title}
			</button>
		)
		: <span class="ins-pdf-outline__text">{item.title}</span>;

	return (
		<li class="ins-pdf-outline__item">
			<div class="ins-pdf-outline__row">
				{branch
					? (
						<Tooltip content={open.value ? "Collapse" : "Expand"}>
							<Button
								iconOnly
								rounded
								size="sm"
								variant="text"
								severity="secondary"
								class="ins-tool-button ui-hit"
								icon={<Icon name={open.value ? "chevron-down" : "chevron-right"} size="sm" />}
								aria-label={`${open.value ? "Collapse" : "Expand"} ${item.title}`}
								aria-expanded={open.value}
								onClick={() => (open.value = !open.value)}
							/>
						</Tooltip>
					)
					: <span class="ins-pdf-outline__spacer" aria-hidden="true" />}
				{target}
			</div>
			{branch && open.value
				? (
					<ul class="ins-pdf-outline__children">
						{item.items.map((child) => (
							<OutlineEntry key={child.key} item={child} depth={depth + 1} engine={engine} />
						))}
					</ul>
				)
				: null}
		</li>
	);
}
