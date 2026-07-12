CREATE OR REPLACE FUNCTION projects.update_entity_project_counts()
RETURNS TRIGGER AS $$
DECLARE
    v_row projects.projects;
    v_owner_id uuid;
    v_owner_type text;
BEGIN
    -- On DELETE, NEW is unassigned; recompute for the removed row's owner using OLD.
    IF TG_OP = 'DELETE' THEN
        v_row := OLD;
    ELSE
        v_row := NEW;
    END IF;

    -- projects.projects is owned by a business (client_business_id) or an individual
    -- (owner_user_id). There is no team ownership at the project level, so there is no
    -- NEW.team_id column to branch on.
    IF v_row.client_business_id IS NOT NULL THEN
        v_owner_id := v_row.client_business_id;
        v_owner_type := 'business';
    ELSE
        v_owner_id := v_row.owner_user_id;
        v_owner_type := 'user';
    END IF;

    -- Update counts based on the entity type
    IF v_owner_type = 'user' THEN
        UPDATE org.users_public
        SET total_project_count = (SELECT count(*) FROM projects.projects WHERE owner_user_id = v_owner_id),
            active_project_count = (SELECT count(*) FROM projects.projects WHERE owner_user_id = v_owner_id AND status = 'active')
        WHERE user_id = v_owner_id;
    ELSE
        UPDATE org.business_profiles
        SET total_project_count = (SELECT count(*) FROM projects.projects WHERE client_business_id = v_owner_id),
            active_project_count = (SELECT count(*) FROM projects.projects WHERE client_business_id = v_owner_id AND status = 'active')
        WHERE id = v_owner_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_project_counts
AFTER INSERT OR UPDATE OF status OR DELETE ON projects.projects
FOR EACH ROW EXECUTE FUNCTION projects.update_entity_project_counts();