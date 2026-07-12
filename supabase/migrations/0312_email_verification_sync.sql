-- US-001 · Multi-Persona Onboarding — keep the app-owned email-verification status
-- in lockstep with GoTrue.
--
-- Profiles for the email/password wizard are provisioned by handle_new_user()
-- (mig 0304) at the auth.users INSERT — i.e. BEFORE the user clicks the
-- confirmation link. provision_user_profile() therefore seeds
-- org.user_emails.verified_at from the (still NULL) email_confirmed_at and, until
-- now, nothing ever advanced it once the user confirmed. verified_at was dead
-- data for every email/password account.
--
-- This trigger closes that gap: whenever GoTrue stamps email_confirmed_at, we
-- mirror it into org.user_emails.verified_at so the value is a trustworthy,
-- app-owned view of verification the /verify subscription can poll.
--
-- Note on tokens: GoTrue still owns the confirmation token end-to-end. It is
-- single-use and invalidated the moment ConfirmBackendService calls verifyOtp
-- (see confirm.ts / ConfirmBackendService.ts). We deliberately do NOT introduce a
-- second, hand-rolled verification_token — that would only add an attack surface
-- with no benefit.

-- #region Sync trigger — email_confirmed_at -> user_emails.verified_at
CREATE OR REPLACE FUNCTION public.handle_email_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Fire only on the NULL -> timestamp transition (the first confirmation).
    -- email_change confirmations reuse this column but keep an existing value, so
    -- the guard also prevents clobbering an already-verified primary email.
    IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
        UPDATE org.user_emails
           SET verified_at = NEW.email_confirmed_at
         WHERE user_id = NEW.id
           AND lower(email) = lower(NEW.email)
           AND verified_at IS NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;

CREATE TRIGGER on_auth_user_confirmed
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_email_confirmed();
-- #endregion

-- #region Backfill — repair rows that confirmed before this migration existed
UPDATE org.user_emails ue
   SET verified_at = u.email_confirmed_at
  FROM auth.users u
 WHERE ue.user_id = u.id
   AND lower(ue.email) = lower(u.email)
   AND ue.verified_at IS NULL
   AND u.email_confirmed_at IS NOT NULL;
-- #endregion
