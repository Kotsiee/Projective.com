CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    v_is_freelancer boolean := false;
    v_first_name text;
    v_last_name text;
    v_username text;
    v_dob date;
    v_objective text;
    v_skills text[];
    v_interests text[];
BEGIN
    -- Extract safe metadata strings
    v_first_name := NEW.raw_user_meta_data->>'first_name';
    v_last_name := NEW.raw_user_meta_data->>'last_name';
    v_username := NEW.raw_user_meta_data->>'username';
    v_dob := (NEW.raw_user_meta_data->>'dob')::date;
    v_objective := NEW.raw_user_meta_data->>'objective';

    IF v_objective = 'freelancer' OR v_objective = 'seller' THEN
        v_is_freelancer := true;
    END IF;

    -- Safely extract JSON arrays to Postgres Text Arrays
    IF NEW.raw_user_meta_data ? 'skills' AND jsonb_typeof(NEW.raw_user_meta_data->'skills') = 'array' THEN
        SELECT ARRAY(SELECT jsonb_array_elements_text(NEW.raw_user_meta_data->'skills')) INTO v_skills;
    ELSE
        v_skills := '{}'::text[];
    END IF;

    IF NEW.raw_user_meta_data ? 'interests' AND jsonb_typeof(NEW.raw_user_meta_data->'interests') = 'array' THEN
        SELECT ARRAY(SELECT jsonb_array_elements_text(NEW.raw_user_meta_data->'interests')) INTO v_interests;
    ELSE
        v_interests := '{}'::text[];
    END IF;

    -- 1. Insert Core Profile
    INSERT INTO org.users_public (
        user_id, first_name, last_name, username, dob, visibility, interests, is_freelancer
    ) VALUES (
        NEW.id, v_first_name, v_last_name, v_username, v_dob, 'unlisted', v_interests, v_is_freelancer
    );

    -- 2. Insert Email Relationship (Handles NULL verification times automatically)
    INSERT INTO org.user_emails (
        user_id, email, is_primary, verified_at
    ) VALUES (
        NEW.id, NEW.email, true, NEW.email_confirmed_at
    );

    -- 3. Persona Routing
    IF v_is_freelancer THEN
        INSERT INTO org.freelancer_profiles (user_id, skills)
        VALUES (NEW.id, v_skills);

        INSERT INTO security.session_context (user_id, active_profile_type, active_profile_id, updated_at)
        VALUES (NEW.id, 'freelancer', NEW.id, NOW())
        ON CONFLICT (user_id) DO UPDATE SET active_profile_type = 'freelancer', active_profile_id = NEW.id, updated_at = NOW();
    ELSE
        INSERT INTO security.session_context (user_id, active_profile_type, active_profile_id, updated_at)
        VALUES (NEW.id, NULL, NULL, NOW())
        ON CONFLICT (user_id) DO UPDATE SET active_profile_type = NULL, active_profile_id = NULL, updated_at = NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind the trigger to Auth creations
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();