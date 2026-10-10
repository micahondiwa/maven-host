"use client"
import { StaffPermissionRoute } from '@/ui/components/staff/StaffRoute'
import { CustomerManagementPage } from '@/ui/pages/staff/CustomerManagementPage'
export default function Page() { return <StaffPermissionRoute permissions={['view_customer']}><CustomerManagementPage /></StaffPermissionRoute> }
