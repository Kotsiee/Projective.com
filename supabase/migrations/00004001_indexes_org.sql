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
