import type { JSX } from "preact";
import { useSignalEffect } from "@preact/signals";
import { Button, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import {
	ToolButton,
	ToolButtonGroup,
	ToolGroup,
	ToolReadout,
	ToolRow,
	ToolToggle,
} from "../../controls/mod.ts";
import { useInspectorActions } from "../../InspectorContext.ts";
import {
	type CodeView,
	FONT_STEPS,
	formatCount,
	goToTypedLine,
	matchSummary,
	setQuery,
	stepFont,
	stepMatch,
} from "./text-tools.ts";

const FIND_ID = "ins-text-find";
const GOTO_ID = "ins-text-goto";

/** Props for {@link CodeControls}. */
export interface CodeControlsProps {
	shell: InspectorShell;
	view: CodeView;
	/** The whole text, for Copy all. */
	text: string | null;
}

/** Panel controls of a source view: display, find, go to line and copy. */
export function CodeControls({ shell, view, text }: CodeControlsProps): JSX.Element {
	const actions = useInspectorActions();

	useSignalEffect(() => {
		const target = view.focus.value;
		if (!target) return;
		const timer = setTimeout(() => {
			view.focus.value = null;
			const field = document.getElementById(target === "find" ? FIND_ID : GOTO_ID);
			if (field instanceof HTMLInputElement && document.activeElement !== field) {
				field.focus();
				field.select();
			}
		}, 0);
		return () => clearTimeout(timer);
	});

	const step = (delta: number) => {
		const said = stepMatch(view, delta);
		if (said) shell.announce(said);
	};

	const goTo = () => {
		const line = goToTypedLine(view);
		shell.announce(line === null ? "Type a line number first" : `Line ${line}`);
	};

	const onFindKey = (event: KeyboardEvent) => {
		if (event.key === "Enter") {
			event.preventDefault();
			step(event.shiftKey ? -1 : 1);
		} else if (event.key === "Escape" && view.query.peek().length > 0) {
			event.preventDefault();
			setQuery(view, "");
		}
	};

	const fontStep = view.fontStep.value;
	const fontPx = view.fontPx.value;
	const summary = matchSummary(view);
	const hasMatches = view.matches.value.length > 0;
	const lineCount = view.lines.value.length;

	return (
		<>
			<ToolGroup title="Display">
				<ToolToggle label="Wrap long lines" value={view.wrap} />
				<ToolToggle label="Line numbers" value={view.lineNumbers} />
				<ToolRow label="Text size">
					<ToolButtonGroup label="Text size">
						<ToolButton
							icon="zoom-out"
							label="Smaller text"
							shortcut="-"
							disabled={fontStep <= 0}
							onClick={() => stepFont(view, -1)}
						/>
						<ToolReadout value={fontPx === null ? "–" : `${fontPx} px`} label="Text size" />
						<ToolButton
							icon="zoom-in"
							label="Larger text"
							shortcut="+"
							disabled={fontStep >= FONT_STEPS.length - 1}
							onClick={() => stepFont(view, 1)}
						/>
					</ToolButtonGroup>
				</ToolRow>
				{view.highlightSkipped
					? <p class="ins-text-note">Syntax colours are off for files over 1 MB.</p>
					: null}
			</ToolGroup>

			<ToolGroup title="Find">
				<InputText
					id={FIND_ID}
					type="search"
					size="sm"
					fluid
					value={view.query}
					onValueChange={(next) => setQuery(view, next)}
					onKeyDown={onFindKey}
					placeholder="Find in file"
					aria-label="Find in file"
					autoComplete="off"
					spellcheck={false}
					enterKeyHint="search"
					start={<Icon name="search" size="sm" />}
				/>
				<ToolRow label={summary.length > 0 ? summary : "Type to search"}>
					<ToolButtonGroup label="Matches">
						<ToolButton
							icon="chevron-up"
							label="Previous match"
							shortcut="Shift+N"
							disabled={!hasMatches}
							onClick={() => step(-1)}
						/>
						<ToolButton
							icon="chevron-down"
							label="Next match"
							shortcut="N"
							disabled={!hasMatches}
							onClick={() => step(1)}
						/>
					</ToolButtonGroup>
				</ToolRow>
			</ToolGroup>

			<ToolGroup title="Go to line">
				<div class="ins-text-goto">
					<InputText
						id={GOTO_ID}
						type="number"
						size="sm"
						fluid
						value={view.gotoValue}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							goTo();
						}}
						placeholder={`1–${formatCount(Math.max(lineCount, 1))}`}
						aria-label={`Line number, 1 to ${Math.max(lineCount, 1)}`}
						autoComplete="off"
						enterKeyHint="go"
					/>
					<ToolButton icon="arrow-right" label="Go to line" onClick={goTo} />
				</div>
			</ToolGroup>

			<div class="ins-text-actions">
				<Button
					size="sm"
					severity="neutral"
					variant="outlined"
					icon={<Icon name="copy" size="sm" />}
					label="Copy all"
					disabled={text === null}
					onClick={() => {
						if (text === null) return;
						void actions.copy(text, `Copied ${formatCount(lineCount)} lines`);
					}}
				/>
			</div>
		</>
	);
}
