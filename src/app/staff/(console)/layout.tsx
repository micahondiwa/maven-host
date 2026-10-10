"use client"
import type { ReactNode } from 'react'
import { StaffRoute } from '@/ui/components/staff/StaffRoute'
import { StaffShell } from '@/ui/components/staff/StaffShell'

/** Staff console. /staff/login and /staff/activate sit outside this group and stay public. */
export default function StaffConsoleLayout({ children }: { children: ReactNode }) {
  return <StaffRoute><StaffShell>{children}</StaffShell></StaffRoute>
}
