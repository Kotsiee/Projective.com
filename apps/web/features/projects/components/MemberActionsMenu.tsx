import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { ActionMenu } from "@projective/ui/navigation";
import { Icon } from "@projective/ui/icons";
import { type MemberMenuInput, memberMenuModel } from "../core/member-menu.ts";

/**
 * MemberActionsMenu — the kebab on a roster card or row, built on the shared {@link ActionMenu} over
 * {@link memberMenuModel}: open the full profile, change role, invite to a stage, remove from a stage,
 * and remove from the project. An invitation is only an offer — the freelancer accepts or declines it
 * (Decision #139) — while a removal opens the consequence-aware confirmation first. Right-clicking the
 * card or table row it sits in opens the same menu (Decision #222).
 */
export type MemberActionsMenuProps = MemberMenuInput;

const AVOID = [".ui-app-shell__sidebar", ".ui-middle-nav__lane"];
const SURFACE = ".mem-card, tr";

export function MemberActionsMenu(props: MemberActionsMenuProps): JSX.Element | null {
	const { member } = props;
	const kebab = useRef<HTMLButtonElement | null>(null);
	const model = memberMenuModel(props);
	if (model.length === 0) return null;
	return (
		<ActionMenu
			model={model}
			placement="bottom-end"
			avoid={AVOID}
			surface={() => kebab.current?.closest<HTMLElement>(SURFACE) ?? null}
			aria-label={`Actions for ${member.party.name}`}
			trigger={(api) => (
				<button
					type="button"
					ref={(el) => {
						kebab.current = el;
						api.ref.current = el;
					}}
					class="mem-iconbtn"
					aria-haspopup="menu"
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					aria-label={`More actions for ${member.party.name}`}
					onClick={(event) => {
						event.stopPropagation();
						api.toggle();
					}}
				>
					<Icon name="kebab" size="sm" />
				</button>
			)}
		/>
	);
}
