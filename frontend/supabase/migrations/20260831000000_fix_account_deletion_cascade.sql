-- Issue #232: Fix Account Deletion Cascades
-- 
-- 1. Drop the old FK constraints that cascaded deletes
-- 2. Add new constraints that use SET NULL (auth -> profile) and RESTRICT (profile -> credentials)
-- 3. Add a trigger to block DELETEs on the credentials table outright.

-- Fix Institutions
-- Re-run safety (#308): only while institutions.auth_user_id exists. On a
-- fresh install it always does here; after the column is dropped, re-applying
-- schema.sql skips this legacy block (a later migration supersedes it).
DO $guard$
BEGIN
IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'auth_user_id'
) THEN
ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_auth_user_id_fkey;
ALTER TABLE public.institutions ADD CONSTRAINT institutions_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END IF;
END
$guard$;


-- Fix Students
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_auth_user_id_fkey;
ALTER TABLE public.students ADD CONSTRAINT students_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Fix Credentials (student relation)
ALTER TABLE public.credentials DROP CONSTRAINT IF EXISTS credentials_student_id_fkey;
ALTER TABLE public.credentials ADD CONSTRAINT credentials_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE RESTRICT;

-- Fix Credentials (institution relation)
ALTER TABLE public.credentials DROP CONSTRAINT IF EXISTS credentials_institution_id_fkey;
ALTER TABLE public.credentials ADD CONSTRAINT credentials_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES public.institutions(id) ON DELETE RESTRICT;

-- Database-level guard against deleting credentials
CREATE OR REPLACE FUNCTION public.prevent_credential_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Deleting credentials is not allowed. They are immutable business records.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS block_credential_delete ON public.credentials;
CREATE TRIGGER block_credential_delete
    BEFORE DELETE ON public.credentials
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_credential_deletion();
