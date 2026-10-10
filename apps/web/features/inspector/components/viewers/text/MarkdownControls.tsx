import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { ToolChoice, ToolGroup } from "../../controls/mod.ts";
import { useInspectorActions } from "../../InspectorContext.ts";
import type { ViewerProps } from "../viewer.ts";
import { CodeControls } from "./CodeControls.tsx";
import { revealHeading } from "./MarkdownStage.tsx";
import type { MarkdownTools } from "./text-tools.ts";

const MODES = [
	{ value: "rendered", label: "Rendered" },
	{ value: "source", label: "Source" },
] as const;

/** Headings deeper than this stay out of the contents list. */
const TOC_DEPTH = 3;

/** The markdown canvas's panel controls: view mode, then contents or the source controls. */
export function MarkdownControls({ shell, tools }: ViewerProps<MarkdownTools>): JSX.Element {
	const actions = useInspectorActions();
	const text = tools.text.value;
	const mode = tools.mode.value;
	const headings = (tools.rendered.value?.headings ?? []).filter((h) => h.level <= TOC_DEPTH);
	const top = headings.reduce((min, h) => Math.min(min, h.level), TOC_DEPTH);

	return (
		<>
			<ToolChoice label="Show" options={MODES} value={tools.mode} disabled={text === null} />
			{mode === "source" ? <CodeControls shell={shell} view={tools.view} text={text} /> : (
				<>
					{headings.length > 0
						? (
							<ToolGroup title="Contents">
								<nav class="ins-toc" aria-label="Contents">
									<ul class="ins-toc__list">
										{headings.map((h) => (
											<li key={h.id} class="ins-toc__item" data-depth={String(h.level - top)}>
												<button
													type="button"
													class="ins-toc__link"
													onClick={() => {
														const root = document.querySelector(".ins-md");
														if (root && revealHeading(root, h.id)) {
															shell.announce(h.text);
														}
													}}
												>
													{h.text}
												</button>
											</li>
										))}
									</ul>
								</nav>
							</ToolGroup>
						)
						: null}
					<div class="ins-text-actions">
						<Button
							size="sm"
							severity="neutral"
							variant="outlined"
							icon={<Icon name="copy" size="sm" />}
							label="Copy markdown"
							disabled={text === null}
							onClick={() => {
								if (text !== null) void actions.copy(text, "Copied the markdown source");
							}}
						/>
					</div>
				</>
			)}
		</>
	);
}
