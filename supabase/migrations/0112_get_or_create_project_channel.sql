CREATE OR REPLACE FUNCTION comms.get_or_create_project_channel(
    p_project_id uuid,
    p_stage_id uuid,
    p_name text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_channel_id uuid;
BEGIN
    
    SELECT id INTO v_channel_id
    FROM comms.project_channels
    WHERE project_id = p_project_id AND stage_id = p_stage_id
    LIMIT 1;

    IF v_channel_id IS NOT NULL THEN
        RETURN v_channel_id;
    END IF;

    
    INSERT INTO comms.project_channels (project_id, stage_id, name)
    VALUES (p_project_id, p_stage_id, p_name)
    RETURNING id INTO v_channel_id;

    RETURN v_channel_id;
END;
$$;