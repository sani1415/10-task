-- Allow a logged-in student to change only their own PIN.
-- SECURITY DEFINER is required because direct access to public.waqf_students is
-- blocked by RLS; the old PIN and waqf ID are verified inside this function.
CREATE OR REPLACE FUNCTION public.madrasa_rel_student_update_pin(
  p_waqf text,
  p_old_pin text,
  p_new_pin text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_waqf IS NULL OR btrim(p_waqf) = '' THEN
    RAISE EXCEPTION 'invalid_waqf';
  END IF;

  IF p_old_pin IS NULL OR p_old_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'invalid_pin';
  END IF;

  IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'invalid_new_pin';
  END IF;

  UPDATE public.waqf_students
  SET pin = p_new_pin
  WHERE waqf_id = btrim(p_waqf)
    AND pin = p_old_pin;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'invalid_pin';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.madrasa_rel_student_update_pin(text, text, text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_student_update_pin(text, text, text) TO anon;
