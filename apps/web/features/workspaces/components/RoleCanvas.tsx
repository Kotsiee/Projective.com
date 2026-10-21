import type { JSX, RefObject } from "preact";
import type { Signal } from "@preact/signals";
import { MetaLine } from "@projective/ui/display";
import { HintPopover } from "@projective/ui/feedback";
import { Button, ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { WorkspaceCapability } from "@projective/types/workspace";
import {
	type CanvasRow,
	type RoleCanvas as RoleCanvasView,
	rolesTierProps,
} from "../core/roles-model.ts";
import { ConditionalGlyph } from "./role-glyphs.tsx";

/**
 * RoleCanvas — the Roles screen's detail pane (Decisions #320, #321): the selected role's capability
 * canvas.
 *
 * **Header.** The role's name (the figure step of the display register), a `MetaLine` of what kind of
 * role it is (a custom role with the preset it ranks as), who holds it and how much it allows, and its
 * one-line remit. Why a role is read-only — a preset, a role ranking above the viewer, a viewer without
 * Change roles — is a `HintPopover` beside the name, and every switch is disabled; the role's actions
 * and the save line are the footer band's (`RolesFooterRig`), never the body's.
 *
 * **Domains.** The kind's four capability domains (`core/capabilities.ts`), each a section-header label
 * with its "n of m" — its remit behind a "?" — over UNBOXED rows: the capability's name (body register),
 * its description behind a "?" (`ui-hint__trigger`), a warning glyph beside a consequential one, and,
 * said inline because they change what the switch can do, the configured rule bounding it while on and
 * why a row alone is fixed — then the `ToggleSwitch` on the inline-end edge, described by all of it.
 *
 * Dumb: every value is `core/roles-model.ts`'s, every switch is the island's controlled signal.
 */

export interface RoleCanvasProps {
	/** The canvas's id — the roster rows control it. */
	id: string;
	name: string;
	/** `canvasMeta`. */
	meta: readonly string[];
	/** `roleSummaryLine`. */
	summary: string;
	canvas: RoleCanvasView;
	/** An archive is in flight — every live switch waits. */
	busy: boolean;
	/** One controlled signal per capability the kind renders. */
	switches: ReadonlyMap<WorkspaceCapability, Signal<boolean>>;
	titleRef: RefObject<HTMLHeadingElement>;
	backRef: RefObject<HTMLDivElement>;
	onToggle: (capability: WorkspaceCapability) => void;
	onBack: () => void;
}

export function RoleCanvas(props: RoleCanvasProps): JSX.Element {
	const { canvas } = props;
	const titleId = `${props.id}-title`;

	return (
		<section
			id={props.id}
			class="wsp-roles__detail"
			aria-labelledby={titleId}
			aria-busy={props.busy || undefined}
		>
			<div class="wsp-roles__back" ref={props.backRef}>
				<Button
					{...rolesTierProps(5)}
					label="All roles"
					icon={<Icon name="arrow-left" />}
					onClick={props.onBack}
				/>
			</div>

			<header class="wsp-roles__head">
				<div class="wsp-roles__heading">
					<h2 id={titleId} class="wsp-roles__title" tabIndex={-1} ref={props.titleRef}>
						{props.name}
					</h2>
					{canvas.lock && (
						<HintPopover label={`Why ${props.name} is read-only`}>{canvas.lock}</HintPopover>
					)}
				</div>
				<MetaLine
					class="wsp-roles__meta"
					items={props.meta.map((text) => ({ text, tabular: true }))}
				/>
				<p class="wsp-roles__summary">{props.summary}</p>
			</header>

			{canvas.domains.map((domain) => {
				const headId = `${props.id}-${domain.key}`;
				return (
					<section key={domain.key} class="wsp-roles__domain" aria-labelledby={headId}>
						<div class="wsp-roles__domain-head">
							<h3 id={headId} class="wsp-roles__domain-title">{domain.title}</h3>
							<HintPopover label={`About ${domain.title}`}>{domain.description}</HintPopover>
							<span class="wsp-roles__domain-count">
								{domain.allowed} of {domain.rows.length}
								<span class="ui-visually-hidden">allowed</span>
							</span>
						</div>
						<ul class="wsp-roles__caps">
							{domain.rows.map((row) => (
								<CapabilityRow
									key={row.capability}
									id={`${props.id}-${row.capability}`}
									row={row}
									value={props.switches.get(row.capability)}
									disabled={canvas.lock !== null || row.lock !== null || props.busy}
									onToggle={props.onToggle}
								/>
							))}
						</ul>
					</section>
				);
			})}
		</section>
	);
}

// #region One capability
/**
 * One capability row — its words, then its switch. The description is on demand behind the label's
 * "?"; the switch is named by the capability and described by its rule and its lock, so a reader on
 * the switch hears why it is fixed.
 */
function CapabilityRow(props: {
	id: string;
	row: CanvasRow;
	value: Signal<boolean> | undefined;
	disabled: boolean;
	onToggle: (capability: WorkspaceCapability) => void;
}): JSX.Element {
	const { row, id } = props;
	const described = [row.rule ? `${id}-rule` : null, row.lock ? `${id}-lock` : null]
		.filter(Boolean).join(" ");
	return (
		<li class="wsp-roles__cap" data-on={row.on ? "" : undefined}>
			<div class="wsp-roles__cap-text">
				<span class="wsp-roles__cap-label">
					{row.label}
					{row.sensitive && (
						<span class="wsp-roles__cap-flag">
							<Icon name="warning" size="sm" />
							<span class="ui-visually-hidden">(sensitive)</span>
						</span>
					)}
					<HintPopover label={`About ${row.label}`}>{row.description}</HintPopover>
				</span>
				{row.rule && (
					<span id={`${id}-rule`} class="wsp-roles__cap-rule">
						<span class="wsp-roles__cap-glyph" aria-hidden="true">
							<ConditionalGlyph />
						</span>
						{row.rule}
					</span>
				)}
				{row.lock && (
					<span id={`${id}-lock`} class="wsp-roles__cap-lock">
						<span class="wsp-roles__cap-glyph" aria-hidden="true">
							<Icon name="lock" size="sm" />
						</span>
						{row.lock}
					</span>
				)}
			</div>
			<div class="wsp-roles__cap-switch">
				<ToggleSwitch
					value={props.value ?? row.on}
					disabled={props.disabled}
					aria-label={row.label}
					aria-describedby={described || undefined}
					onValueChange={() => props.onToggle(row.capability)}
				/>
			</div>
		</li>
	);
}
// #endregion
