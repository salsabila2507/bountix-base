-- Allow a task creator to restore a withdrawn application back to pending
-- (reverse of applicant withdraw). Needed by restoreApplicationAction for owners.
-- Admin short-circuit unchanged. Applicant restore still forbidden.

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
           (OLD.status = 'pending' and NEW.status in ('accepted', 'rejected'))
           or (OLD.status = 'withdrawn' and NEW.status = 'pending')
         ) then
        raise exception 'task creator may only accept or reject pending applications, or restore a withdrawn application to pending';
      end if;
      return NEW;
    end if;

    raise exception 'not authorized to update this application';
  end if;

  return NEW;
end;
$$;
