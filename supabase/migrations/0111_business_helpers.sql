CREATE OR REPLACE FUNCTION org.is_active_business_member(_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = org, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM org.business_members 
    WHERE business_id = _business_id 
    AND user_id = auth.uid() 
    AND status = 'active'
  );
$$;