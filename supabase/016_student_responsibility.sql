-- 016: Add responsibility field to students
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS responsibility TEXT DEFAULT '';

-- Update upsert_student RPC to include responsibility
CREATE OR REPLACE FUNCTION public.madrasa_rel_upsert_student(
  p_teacher_pin text, p_student jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT private.verify_teacher_pin(p_teacher_pin) THEN RAISE EXCEPTION 'invalid_pin'; END IF;
  INSERT INTO public.students (id, waqf_id, name, cls, roll, pin, color, note,
    father_name, father_occupation, contact, district, upazila, blood_group, enrollment_date,
    responsibility)
  VALUES (
    p_student->>'id', p_student->>'waqf_id', p_student->>'name', p_student->>'cls',
    p_student->>'roll', p_student->>'pin', p_student->>'color', p_student->>'note',
    p_student->>'father_name', p_student->>'father_occupation', p_student->>'contact',
    p_student->>'district', p_student->>'upazila', p_student->>'blood_group',
    NULLIF(p_student->>'enrollment_date', '')::date,
    COALESCE(p_student->>'responsibility', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, cls = EXCLUDED.cls, roll = EXCLUDED.roll,
    pin = EXCLUDED.pin, note = EXCLUDED.note,
    father_name = EXCLUDED.father_name, father_occupation = EXCLUDED.father_occupation,
    contact = EXCLUDED.contact, district = EXCLUDED.district,
    upazila = EXCLUDED.upazila, blood_group = EXCLUDED.blood_group,
    enrollment_date = EXCLUDED.enrollment_date,
    responsibility = EXCLUDED.responsibility;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_upsert_student(text, jsonb) TO anon;
