CREATE OR REPLACE FUNCTION comms.get_or_create_dm_thread(
    target_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, org, auth
AS $$
DECLARE
    v_current_user_id uuid := auth.uid();
    v_thread_id uuid;
BEGIN
    
    SELECT t.id INTO v_thread_id
    FROM comms.dm_threads t
    JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = v_current_user_id
    JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = target_user_id
    LIMIT 1;

    IF v_thread_id IS NOT NULL THEN
        RETURN v_thread_id;
    END IF;

    
    INSERT INTO comms.dm_threads (created_by_user_id)
    VALUES (v_current_user_id)
    RETURNING id INTO v_thread_id;

    
    INSERT INTO comms.dm_participants (thread_id, user_id)
    VALUES (v_thread_id, v_current_user_id), (v_thread_id, target_user_id);

    RETURN v_thread_id;
END;
$$;