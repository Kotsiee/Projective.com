-- Indexes: org (from 0003, 0314)

CREATE INDEX idx_business_roles_business ON org.business_roles (business_id);
CREATE INDEX idx_business_members_user ON org.business_members (user_id);
CREATE INDEX idx_team_roles_team ON org.team_roles (team_id);
CREATE INDEX idx_team_members_user ON org.team_members (user_id);
CREATE INDEX idx_user_bookmarks_lookup ON org.user_bookmarks (user_id, entity_type);
CREATE INDEX idx_org_invitations_token ON org.org_invitations (token);

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
