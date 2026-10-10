"use client"
import type { ReactNode } from 'react'
import { CustomerRoute } from '@/ui/components/account/CustomerRoute'
import { AccountShell } from '@/ui/components/account/AccountShell'

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <CustomerRoute><AccountShell>{children}</AccountShell></CustomerRoute>
}
