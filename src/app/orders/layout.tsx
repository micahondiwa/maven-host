"use client"
import type { ReactNode } from 'react'
import { CustomerRoute } from '@/ui/components/account/CustomerRoute'

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return <CustomerRoute>{children}</CustomerRoute>
}
