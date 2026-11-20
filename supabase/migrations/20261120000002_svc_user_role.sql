-- Edge Functions use the service role, which has no direct table access in
-- this project. They look up a caller's role through this function instead.
create function public.svc_user_role(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = p_user;
$$;
revoke all on function public.svc_user_role(uuid) from public, anon, authenticated;
grant execute on function public.svc_user_role(uuid) to service_role;
