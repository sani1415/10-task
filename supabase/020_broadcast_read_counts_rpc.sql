-- ══════════════════════════════════════════════
-- 020_broadcast_read_counts_rpc.sql
-- Returns per-broadcast read counts so teacher can see "X/Y দেখেছেন" receipts.
-- Student copies of broadcasts carry extra->>'bc_id' (original _bc message ID)
-- and extra->>'bc_copy' = 'true'. Count is_read=true per bc_id.
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.madrasa_rel_broadcast_read_counts(p_teacher_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.verify_teacher_pin(p_teacher_pin) THEN
    RAISE EXCEPTION 'invalid_pin';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    FROM (
      SELECT
        extra->>'bc_id'                                    AS bc_id,
        COUNT(*) FILTER (WHERE is_read = true)::int        AS read_count,
        COUNT(*)::int                                       AS total_count
      FROM public.messages
      WHERE extra->>'bc_copy' = 'true'
        AND extra->>'bc_id' IS NOT NULL
      GROUP BY extra->>'bc_id'
    ) t
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.madrasa_rel_broadcast_read_counts(text) TO anon;
