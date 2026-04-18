-- 017: Add review_status to documents (pending/done), admin-only
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'done';

-- Existing student-uploaded docs start as pending review
UPDATE public.documents SET review_status = 'pending'
WHERE review_status = 'done'
  AND (storage_path LIKE 'documents/%' OR storage_path NOT LIKE 'teacher/%')
  AND is_read = false;

-- Update insert_document: student uploads → pending, teacher uploads → done
-- ON CONFLICT: only allow done→done or pending→done (never undo a review)
CREATE OR REPLACE FUNCTION public.madrasa_rel_insert_document(
  p_pin text, p_role text, p_doc jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok boolean := false;
BEGIN
  IF p_role = 'teacher' THEN
    v_ok := private.verify_teacher_pin(p_pin);
  ELSE
    v_ok := EXISTS (SELECT 1 FROM public.students WHERE id = (p_doc->>'student_id') AND pin = p_pin);
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'invalid_pin'; END IF;

  INSERT INTO public.documents (id, student_id, student_name, file_name, file_type, file_size,
    category, note, storage_path, file_url, is_read, uploaded_at, review_status)
  VALUES (
    p_doc->>'id', p_doc->>'student_id', COALESCE(p_doc->>'student_name', ''),
    p_doc->>'file_name', COALESCE(p_doc->>'file_type', ''),
    COALESCE((p_doc->>'file_size')::bigint, 0),
    COALESCE(p_doc->>'category', 'general'), COALESCE(p_doc->>'note', ''),
    p_doc->>'storage_path', p_doc->>'file_url',
    COALESCE((p_doc->>'is_read')::boolean, false),
    COALESCE((p_doc->>'uploaded_at')::timestamptz, now()),
    COALESCE(p_doc->>'review_status', CASE WHEN p_role = 'student' THEN 'pending' ELSE 'done' END)
  )
  ON CONFLICT (id) DO UPDATE SET
    file_url = EXCLUDED.file_url,
    is_read = EXCLUDED.is_read,
    review_status = CASE WHEN EXCLUDED.review_status = 'done' THEN 'done'
                         ELSE documents.review_status END;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_insert_document(text, text, jsonb) TO anon;

-- Mark a document as reviewed (teacher only)
CREATE OR REPLACE FUNCTION public.madrasa_rel_mark_doc_reviewed(
  p_teacher_pin text, p_doc_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT private.verify_teacher_pin(p_teacher_pin) THEN RAISE EXCEPTION 'invalid_pin'; END IF;
  UPDATE public.documents SET review_status = 'done', is_read = true WHERE id = p_doc_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_mark_doc_reviewed(text, text) TO anon;
