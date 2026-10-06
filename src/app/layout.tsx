import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Providers } from './providers'
import '../ui/styles/index.css'
export const metadata: Metadata = {title:'MavenHost',description:'Domains, hosting and business email from MavenHost.',icons:{icon:'/brand/mavenhost-favicon.svg'},robots:{index:false,follow:false}}
export default function RootLayout({children}:{children:ReactNode}) {return <html lang="en" data-theme="dark" suppressHydrationWarning><body><Providers>{children}</Providers></body></html>}
