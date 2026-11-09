-- Regression: task creator may restore withdrawn -> pending; applicant may not;
-- creator may not jump withdrawn -> accepted.
-- Run against a DB with migrations applied (including 20261109000000_...).
-- Requires auth.uid() stub via request.jwt.claim.sub and seeded rows, or adapt IDs.

\set ON_ERROR_STOP on

-- Assumes seed IDs from hunt20-a repro harness when run locally.
-- This file encodes the expected exception messages for CI wiring later.

DO $$
DECLARE
  app_id uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
BEGIN
  -- Ensure withdrawn via service bypass
  PERFORM set_config('request.jwt.claim.sub', '', false);
  UPDATE public.task_applications SET status = 'withdrawn' WHERE id = app_id;

  -- Creator restore succeeds
  PERFORM set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
  UPDATE public.task_applications SET status = 'pending' WHERE id = app_id;
  IF (SELECT status FROM public.task_applications WHERE id = app_id) IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'expected creator restore to pending';
  END IF;

  -- Reset
  PERFORM set_config('request.jwt.claim.sub', '', false);
  UPDATE public.task_applications SET status = 'withdrawn' WHERE id = app_id;

  -- Applicant restore fails
  PERFORM set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
  BEGIN
    UPDATE public.task_applications SET status = 'pending' WHERE id = app_id;
    RAISE EXCEPTION 'expected applicant restore to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'applicants may only withdraw%' THEN
      RAISE;
    END IF;
  END;

  -- Creator withdrawn -> accepted fails
  PERFORM set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
  BEGIN
    UPDATE public.task_applications SET status = 'accepted' WHERE id = app_id;
    RAISE EXCEPTION 'expected creator withdrawn->accepted to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'task creator may only accept or reject%' THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'restore_withdrawn_application checks passed';
END $$;
