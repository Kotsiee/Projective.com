CREATE OR REPLACE FUNCTION org.create_team(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = org, public
AS $$
DECLARE
  new_team_id uuid;
  new_team_slug text;
  invite_record jsonb;
  _id uuid;
  v_owner_id uuid;
  v_currency text;
  v_wallet_id uuid;
BEGIN

  _id := COALESCE((payload->>'id')::uuid, gen_random_uuid());
  v_owner_id := (payload->>'owner_id')::uuid;
  v_currency := COALESCE(payload->>'currency', 'USD');

  -- `bio` is the jsonb rich-text column; branding is stored as files.items
  -- references (avatar_file_id / banner_file_id), not URLs.
  INSERT INTO org.teams (
    id,
    owner_user_id,
    name,
    slug,
    headline,
    bio,
    avatar_file_id,
    banner_file_id,
    visibility,
    payout_model,
    default_payout_settings
  )
  VALUES (
    _id,
    v_owner_id,
    payload->>'name',
    payload->>'slug',
    COALESCE(payload->>'headline', ''),
    COALESCE(payload->'description', '{}'::jsonb),
    NULLIF(payload->>'avatar_file_id', '')::uuid,
    NULLIF(payload->>'banner_file_id', '')::uuid,
    COALESCE(payload->>'visibility', 'invite_only'),
    COALESCE(payload->>'payout_model', 'manager_discretion'),
    COALESCE(payload->'default_payout_settings', '{}'::jsonb)
  )
  RETURNING id, slug INTO new_team_id, new_team_slug;


  INSERT INTO org.team_members (
    team_id,
    user_id,
    role,
    status
  )
  VALUES (
    new_team_id,
    v_owner_id,
    'owner',
    'active'
  );

  -- AC5: initialise the Team Vault (finance.wallets) and link it as the team treasury.
  INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents)
  VALUES ('team', new_team_id, v_currency, 0)
  RETURNING id INTO v_wallet_id;

  UPDATE org.teams SET treasury_wallet_id = v_wallet_id WHERE id = new_team_id;


  IF payload ? 'invites' AND jsonb_array_length(payload->'invites') > 0 THEN
    FOR invite_record IN SELECT * FROM jsonb_array_elements(payload->'invites')
    LOOP
      INSERT INTO org.org_invitations (
        inviter_user_id,
        target_email,
        team_id,
        token,
        status
      )
      VALUES (
        v_owner_id,
        invite_record->>'email',
        new_team_id,
        encode(gen_random_bytes(32), 'hex'),
        'pending'
      );
    END LOOP;
  END IF;

  -- AC6: immutable audit trail. security.audit_logs has no `authenticated` grant, so
  -- it can only be written from a SECURITY DEFINER context such as this one.
  INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata, actor_team_id)
  VALUES (
    v_owner_id, 'team.created', 'org.teams', new_team_id,
    jsonb_build_object('slug', new_team_slug, 'name', payload->>'name', 'currency', v_currency),
    new_team_id
  );

  RETURN jsonb_build_object(
    'team_id', new_team_id,
    'team_slug', new_team_slug
  );

EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Team handle already exists' USING ERRCODE = '23505';
END;
$$;
