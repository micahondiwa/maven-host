"use client"
import { StaffPermissionRoute } from '@/ui/components/staff/StaffRoute'
import { StaffManagementPage } from '@/ui/pages/staff/StaffManagementPage'
export default function Page() { return <StaffPermissionRoute permissions={['manage_users']}><StaffManagementPage /></StaffPermissionRoute> }
