-- Aplicar somente depois que a aplicação que usa manage_company_user estiver publicada.
-- Leituras continuam protegidas por tenant_users_select_member.
drop policy if exists tenant_users_insert_admin on public.tenant_users;
drop policy if exists tenant_users_update_admin on public.tenant_users;
drop policy if exists tenant_users_delete_admin on public.tenant_users;
revoke insert, update, delete on public.tenant_users from authenticated;
