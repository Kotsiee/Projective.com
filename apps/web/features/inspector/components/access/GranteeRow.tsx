import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Button, Select } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	type GranteeKind,
	type GrantRole,
	grantRoleLabel,
	grantRoleNote,
} from "@projective/types/files";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import type { DraftGrant } from "../../core/access-draft.ts";

/** Props for {@link GranteeRow}. */
export interface GranteeRowProps {
	grant: DraftGrant;
	/** The refused save's message for this grantee. */
	error: string | null;
	/** Whether the levels and Remove act; a paused list is shown without them. */
	editable: boolean;
	onRole: (role: GrantRole) => void;
	onRemove: () => void;
}

const KIND_LABEL: Readonly<Record<GranteeKind, string>> = {
	user: "Person",
	team: "Team",
	business: "Business",
	project: "Project",
};

const ROLE_OPTIONS = (["viewer", "editor"] as const).map((role) => ({
	value: role,
	label: grantRoleLabel(role),
	description: grantRoleNote(role),
}));

/** One grantee: their face or mark, their name and what they are, their level, and Remove. */
export function GranteeRow(
	{ grant, error, editable, onRole, onRemove }: GranteeRowProps,
): JSX.Element {
	const detail = grant.detail ?? KIND_LABEL[grant.kind];
	return (
		<li class="ins-access__grantee" data-error={error ? "true" : undefined}>
			{grant.kind === "user"
				? <UserAvatar image={grant.avatar} label={grant.name} size={32} />
				: <Avatar image={grant.avatar} label={grant.name} size={32} shape="square" />}
			<span class="ins-access__who">
				<span class="ins-access__name">{grant.name}</span>
				<span class="ins-access__detail">{detail}</span>
				{error ? <span class="ins-access__row-error" role="alert">{error}</span> : null}
			</span>
			{editable
				? (
					<span class="ins-access__controls">
						<Select
							key={`${grant.kind}:${grant.id}:${grant.role}`}
							class="ins-access__role"
							size="sm"
							options={ROLE_OPTIONS}
							value={grant.role}
							aria-label={`Access level for ${grant.name}`}
							onValueChange={(next) => onRole(next === "editor" ? "editor" : "viewer")}
						/>
						<Tooltip content={`Remove ${grant.name}`}>
							<Button
								iconOnly
								rounded
								size="sm"
								variant="text"
								severity="secondary"
								class="ins-access__remove ui-hit"
								icon={<Icon name="close" size="sm" />}
								aria-label={`Remove ${grant.name}`}
								onClick={onRemove}
							/>
						</Tooltip>
					</span>
				)
				: <span class="ins-access__level">{grantRoleLabel(grant.role)}</span>}
		</li>
	);
}
