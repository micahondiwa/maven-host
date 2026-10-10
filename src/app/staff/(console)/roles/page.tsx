"use client"
import { StaffPermissionRoute } from '@/ui/components/staff/StaffRoute'
import { RoleManagementPage } from '@/ui/pages/staff/RoleManagementPage'
export default function Page() { return <StaffPermissionRoute permissions={['manage_roles']}><RoleManagementPage /></StaffPermissionRoute> }
