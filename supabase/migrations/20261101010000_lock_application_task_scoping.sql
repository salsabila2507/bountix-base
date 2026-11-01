-- =====================================================================
-- Bountix: lock task_applications.task_id against re-targeting
-- =====================================================================
--
-- guard_task_applications() validates application status transitions but
-- never validates that the row stays attached to the same task. RLS
-- ("Applicants can update own application") only requires
-- NEW.applicant_id = auth.uid(), and "Task creators can update
-- applications" only requires the updater to own the NEW row's task.
--
-- Consequence: any authenticated user holding an accepted application
-- (status left unchanged) can UPDATE its task_id to a task they were
-- never accepted on and inherit the accepted state there:
--
--   1. Attacker A applies to task T1 (friendly creator); T1's creator
--      accepts.
--   2. A updates that application row's task_id from T1 to victim task
--      T2. The applicant branch only checks status transitions, so the
--      update passes RLS and the trigger.
--   3. A now passes the task_submissions guard (application must be
--      accepted, and task_id must match the application's task) and can
--      flood T2's review queue with unsolicited submissions although
--      T2's creator never accepted anyone.
--
-- Patch: non-admin updates may no longer change task_id. Everything
-- else (status transitions, message edits for applicants, accept/
-- reject for creators) behaves exactly as before. Body mirrors
-- 20260606020000_public_soft_open_access.sql.
-- =====================================================================

create or replace function public.guard_task_applications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_task_creator uuid;
begin
  if v_uid is null then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.applicant_id is distinct from v_uid then
      raise exception 'applicant_id must equal the current user';
    end if;

    v_task_creator := public.task_creator_id(NEW.task_id);
    if v_task_creator is null then
      raise exception 'task does not exist';
    end if;
    if v_task_creator = v_uid and not public.is_admin(v_uid) then
      raise exception 'cannot apply to your own task';
    end if;

    if not public.user_can_work_task(NEW.task_id, v_uid) then
      raise exception 'Only Early Contributors can work on this task.';
    end if;

    if NEW.status is distinct from 'pending' then
      raise exception 'new applications must start as pending';
    end if;

    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if public.is_admin(v_uid) then
      return NEW;
    end if;

    -- Applications are permanently scoped to the task they were created
    -- for; moving one would carry its status (e.g. 'accepted') to a task
    -- whose creator never made that decision.
    if NEW.task_id is distinct from OLD.task_id then
      raise exception 'task_id cannot be changed on an existing application';
    end if;

    if v_uid = OLD.applicant_id then
      if NEW.status is distinct from OLD.status
         and not (OLD.status = 'pending' and NEW.status = 'withdrawn') then
        raise exception 'applicants may only withdraw a pending application';
      end if;
      return NEW;
    end if;

    v_task_creator := public.task_creator_id(OLD.task_id);
    if v_uid = v_task_creator then
      if NEW.status is distinct from OLD.status
         and not (
           OLD.status = 'pending'
           and NEW.status in ('accepted', 'rejected')
         ) then
        raise exception 'task creator may only accept or reject pending applications';
      end if;
      return NEW;
    end if;

    raise exception 'not authorized to update this application';
  end if;

  return NEW;
end;
$$;
