"use client"
import NextLink from 'next/link'
import { usePathname, useRouter, useSearchParams as nextSearchParams, useParams as nextParams } from 'next/navigation'
import { useCallback, useEffect, type ComponentProps, type ReactNode } from 'react'
type LinkProps = Omit<ComponentProps<typeof NextLink>, 'href'> & { to: string }
export function Link({ to, ...props }: LinkProps) { return <NextLink href={to} {...props} /> }
export function NavLink({ to, end, className, ...props }: Omit<LinkProps,'className'> & { end?: boolean; className?: string | ((state: { isActive: boolean }) => string) }) {
 const path = routerPath(usePathname()); const target = routerPath(to); const active = end ? path === target : path === target || path.startsWith(target+'/')
 return <Link to={to} className={typeof className === 'function' ? className({isActive:active}) : className} aria-current={active ? 'page' : undefined} {...props} />
}
/** React Router reported paths without a trailing slash; Next.js (trailingSlash) keeps it. Ported pages compare paths, so strip it. */
const routerPath=(path: string)=>path.length>1?path.replace(/\/+$/,''):path
export function useLocation() { const pathname=routerPath(usePathname()); const search=nextSearchParams(); return {pathname,search:search.size?'?'+search.toString():'',hash:typeof window==='undefined'?'':window.location.hash,state:typeof window==='undefined'?null:window.history.state?.migrationNavigationState} }
export function useNavigate() {
 const router=useRouter()
 return useCallback((to: string | number, options?: {replace?:boolean;state?:unknown}) => {
  if(typeof to==='number'){if(to===-1) router.back(); else if(to===1) router.forward();return}
  if(options?.state)window.history.replaceState({...window.history.state,migrationNavigationState:options.state},'')
  if(options?.replace)router.replace(to);else router.push(to)
 },[router])
}
export function useSearchParams(): [URLSearchParams,(next: URLSearchParams | Record<string,string> | ((current:URLSearchParams)=>URLSearchParams), options?:{replace?:boolean})=>void] {
 const params=nextSearchParams(),router=useRouter(),pathname=usePathname()
 return [new URLSearchParams(params.toString()),(next,options)=>{const value=typeof next==='function'?next(new URLSearchParams(params.toString())):new URLSearchParams(next);const href=pathname+(value.size?'?'+value.toString():'');if(options?.replace)router.replace(href);else router.push(href)}]
}
export function useParams<T extends Record<string,string | undefined> = Record<string,string>>() { return nextParams() as T }
export function Navigate({to,replace,state}:{to:string;replace?:boolean;state?:unknown}) { const navigate=useNavigate();useEffect(()=>navigate(to,{replace,state}),[navigate,to,replace,state]);return null }
export function Outlet(): ReactNode { throw new Error('Nested views must use Next.js layout children') }
