"use client"
import { StaffPermissionRoute } from '@/ui/components/staff/StaffRoute'
import { CustomerDetailPage } from '@/ui/pages/staff/CustomerDetailPage'
export default function Page() { return <StaffPermissionRoute permissions={['view_customer', 'view_invoice', 'view_payment']}><CustomerDetailPage /></StaffPermissionRoute> }
