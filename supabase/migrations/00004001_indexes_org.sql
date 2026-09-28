-- Indexes: org (from 0003, 0314)

CREATE INDEX idx_business_roles_business ON org.business_roles (business_id);
CREATE INDEX idx_business_members_user ON org.business_members (user_id);
CREATE INDEX idx_team_roles_team ON org.team_roles (team_id);
CREATE INDEX idx_team_members_user ON org.team_members (user_id);
CREATE INDEX idx_user_bookmarks_lookup ON org.user_bookmarks (user_id, entity_type);
-- (No separate token index: `token` is UNIQUE, which is already an index.)

-- #region Workspace membership invariants (Decision #122)
-- These are the constraints a row-level CHECK cannot state, because each one spans rows.

-- Exactly one active owner per entity. Not deferrable (a partial unique index never is), which is why
-- org.transfer_workspace_ownership demotes the outgoing owner BEFORE seating the successor.
CREATE UNIQUE INDEX uq_team_members_one_owner ON org.team_members (team_id) WHERE role = 'owner' AND status = 'active';
CREATE UNIQUE INDEX uq_business_members_one_owner ON org.business_members (business_id) WHERE role = 'owner' AND status = 'active';

-- Each preset exists once per entity, and a live role's name is unique within it (case-insensitively;
-- an archived role frees its name).
CREATE UNIQUE INDEX uq_team_roles_preset ON org.team_roles (team_id, preset) WHERE preset IS NOT NULL;
CREATE UNIQUE INDEX uq_business_roles_preset ON org.business_roles (business_id, preset) WHERE preset IS NOT NULL;
CREATE UNIQUE INDEX uq_team_roles_name ON org.team_roles (team_id, lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX uq_business_roles_name ON org.business_roles (business_id, lower(name)) WHERE archived_at IS NULL;

-- A person or an address has at most one PENDING invitation to an entity, so a double-press or a
-- re-send cannot stack offers. The RPC maps the violation to "they already have a pending invitation".
CREATE UNIQUE INDEX uq_org_invitations_pending_user ON org.org_invitations (COALESCE(team_id, business_id), target_user_id)
    WHERE status = 'pending' AND target_user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_org_invitations_pending_email ON org.org_invitations (COALESCE(team_id, business_id), lower(target_email))
    WHERE status = 'pending' AND target_email IS NOT NULL;

-- The invitee's inbox and the entity's queue.
CREATE INDEX idx_org_invitations_target_user ON org.org_invitations (target_user_id) WHERE status = 'pending';
CREATE INDEX idx_org_invitations_team ON org.org_invitations (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX idx_org_invitations_business ON org.org_invitations (business_id) WHERE business_id IS NOT NULL;

-- Foreign keys a role archive or a manager removal has to scan.
CREATE INDEX idx_team_members_role ON org.team_members (role_id);
CREATE INDEX idx_business_members_role ON org.business_members (role_id);
CREATE INDEX idx_team_members_reports_to ON org.team_members (reports_to) WHERE reports_to IS NOT NULL;
CREATE INDEX idx_business_members_reports_to ON org.business_members (reports_to) WHERE reports_to IS NOT NULL;
-- #endregion

CREATE INDEX idx_organisations_owner ON org.organisations (owner_user_id);
CREATE INDEX idx_organisations_handle ON org.organisations (lower(handle));
CREATE INDEX idx_organisation_members_user ON org.organisation_members (user_id);
CREATE INDEX idx_organisation_members_org ON org.organisation_members (organisation_id);

-- #region Public profile resolution + the profile detail ledgers (00001040)
-- org.fn_resolve_profile matches a handle case-insensitively in four namespaces; without these the
-- profile page's first read is a sequential scan of every user, team and business on the platform.
CREATE INDEX idx_users_public_username_lower ON org.users_public (lower(username));
CREATE INDEX idx_teams_slug_lower ON org.teams (lower(slug));
CREATE INDEX idx_business_profiles_slug_lower ON org.business_profiles (lower(slug));

-- The Experience section reads each ledger by owner in the owner's own order.
CREATE INDEX idx_education_entries_user ON org.education_entries (user_id, sort_order);
CREATE INDEX idx_experience_entries_user ON org.experience_entries (user_id, sort_order);
CREATE INDEX idx_certifications_user ON org.certifications (user_id, sort_order);
CREATE INDEX idx_portfolios_user ON org.portfolios (user_id, sort_order);
-- #endregion
