import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { formatBytes } from "@projective/types/contact";
import { Icon } from "@projective/ui/icons";
import { styleVars } from "@ui/core/style.ts";
import { FileTypeIcon } from "@features/projects/components/FileTypeIcon.tsx";
import { archiveFormat, readArchive } from "../../../core/archive-read.ts";
import { archiveTotals, buildArchiveTree, initialExpansion } from "../../../core/archive-tree.ts";
import { rowSpan } from "../../../core/sheet-window.ts";
import type { ViewerProps } from "../viewer.ts";
import { archiveFacts, type ArchiveTools, toggleFolder } from "./archive-tools.ts";

const ROW_PX = 36;
const TREE_ID = "ins-archive";
const DATE = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

function dateLabel(iso: string | null): string {
	if (!iso) return "";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : DATE.format(date);
}

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1) : "";
}

/**
 * The archive canvas: a folder tree of what is inside, with each file's size and date, without
 * unpacking anything. A window over the tree's visible rows, so opening a folder of 50,000 files
 * costs the same as opening one of five.
 */
export function ArchiveStage({ shell, tools }: ViewerProps<ArchiveTools>): JSX.Element {
	const { asset } = shell;
	const tree = useRef<HTMLDivElement>(null);
	const top = useSignal(0);
	const viewHeight = useSignal(0);

	useEffect(() => {
		const format = archiveFormat(asset.name);
		if (!format) {
			shell.fail("This kind of archive can't be listed here. You can still download it.");
			return;
		}
		const controller = new AbortController();
		readArchive(asset.src, asset.sizeBytes, format, controller.signal)
			.then(({ members, truncated }) => {
				const root = buildArchiveTree(members);
				tools.truncated.value = truncated;
				tools.expanded.value = initialExpansion(root);
				tools.root.value = root;
				shell.facts.value = archiveFacts(archiveTotals(members), asset.sizeBytes);
				shell.status.value = "ready";
			})
			.catch(() => {
				if (controller.signal.aborted) return;
				shell.fail("This archive couldn't be read. It may be damaged or password-protected.");
			});
		return () => controller.abort();
	}, [shell, tools]);

	useLayoutEffect(() => {
		const node = tree.current;
		if (!node) return;
		const measure = () => (viewHeight.value = node.clientHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [tools.root.value !== null]);

	const root = tools.root.value;
	if (!root) return <div class="ins-archive" aria-hidden="true" />;

	const rows = tools.rows.value;
	const active = tools.active.value;
	const span = rowSpan(top.value, viewHeight.value, rows.length, ROW_PX);
	const activeIndex = rows.findIndex((row) => row.node.path === active);

	function moveTo(index: number): void {
		const target = rows[Math.max(0, Math.min(rows.length - 1, index))];
		if (!target) return;
		tools.active.value = target.node.path;
		const grid = tree.current;
		const at = rows.indexOf(target) * ROW_PX;
		if (!grid) return;
		if (at < grid.scrollTop) grid.scrollTop = at;
		else if (at + ROW_PX > grid.scrollTop + grid.clientHeight) {
			grid.scrollTop = at + ROW_PX - grid.clientHeight;
		}
	}

	function onKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const current = rows[activeIndex];
		const page = Math.max(1, Math.floor((tree.current?.clientHeight ?? 0) / ROW_PX) - 1);
		const open = current ? tools.expanded.peek().has(current.node.path) : false;
		switch (event.key) {
			case "ArrowDown":
				moveTo(activeIndex + 1);
				break;
			case "ArrowUp":
				moveTo(activeIndex - 1);
				break;
			case "PageDown":
				moveTo(activeIndex + page);
				break;
			case "PageUp":
				moveTo(activeIndex - page);
				break;
			case "Home":
				moveTo(0);
				break;
			case "End":
				moveTo(rows.length - 1);
				break;
			case "ArrowRight":
				if (current?.node.directory) {
					if (open) moveTo(activeIndex + 1);
					else toggleFolder(tools, current.node.path);
				}
				break;
			case "ArrowLeft":
				if (current?.node.directory && open) toggleFolder(tools, current.node.path);
				else if (current) {
					const parent = rows.slice(0, activeIndex).findLast((row) =>
						row.depth === current.depth - 1
					);
					if (parent) moveTo(rows.indexOf(parent));
				}
				break;
			case "Enter":
			case " ":
				if (current?.node.directory) toggleFolder(tools, current.node.path);
				break;
			default:
				return;
		}
		event.preventDefault();
	}

	return (
		<div class="ins-archive">
			{tools.truncated.value
				? (
					<p class="ins-archive__notice">
						This archive holds more than can be listed here. Download it to see everything.
					</p>
				)
				: null}
			<div class="ins-archive__head" aria-hidden="true">
				<span>Name</span>
				<span>Size</span>
				<span class="ins-archive__date">Modified</span>
			</div>
			{rows.length === 0 ? <p class="ins-archive__notice">This archive is empty.</p> : null}
			<div
				ref={tree}
				class="ins-archive__tree"
				role="tree"
				aria-label={`Contents of ${asset.name}`}
				aria-activedescendant={activeIndex >= span.first && activeIndex <= span.last
					? `${TREE_ID}-active`
					: undefined}
				tabIndex={0}
				onScroll={(event) => (top.value = event.currentTarget.scrollTop)}
				onKeyDown={onKeyDown}
				style={styleVars({
					"--archive-row": `${ROW_PX}px`,
					"--archive-height": `${rows.length * ROW_PX}px`,
					"--archive-offset": `${Math.max(span.first, 0) * ROW_PX}px`,
				})}
			>
				<div class="ins-archive__body" role="presentation">
					{rows.slice(span.first, span.last + 1).map(({ node, depth }) => {
						const open = node.directory && tools.expanded.value.has(node.path);
						const isActive = node.path === active;
						return (
							<div
								key={node.path}
								id={isActive ? `${TREE_ID}-active` : undefined}
								class="ins-archive__row"
								role="treeitem"
								aria-level={depth + 1}
								aria-expanded={node.directory ? open : undefined}
								aria-selected={isActive}
								data-active={isActive ? "true" : undefined}
								style={styleVars({ "--archive-depth": depth })}
								onClick={() => {
									tools.active.value = node.path;
									tree.current?.focus({ preventScroll: true });
									if (node.directory) toggleFolder(tools, node.path);
								}}
							>
								<span class="ins-archive__name">
									<span class="ins-archive__twist" data-open={open ? "true" : undefined}>
										{node.directory ? <Icon name="chevron-right" size="xs" /> : null}
									</span>
									{node.directory
										? (
											<span class="ins-archive__folder" aria-hidden="true">
												<Icon name="folder" size="sm" />
											</span>
										)
										: <FileTypeIcon file={{ ext: extensionOf(node.name) }} size={20} />}
									<span class="ins-archive__label">{node.name}</span>
									{node.encrypted
										? <Icon name="lock" size="xs" aria-label="Password-protected" />
										: null}
								</span>
								<span class="ins-archive__size">{formatBytes(node.size)}</span>
								<span class="ins-archive__date">{dateLabel(node.modified)}</span>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
