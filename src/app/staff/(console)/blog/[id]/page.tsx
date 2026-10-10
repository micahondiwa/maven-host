"use client"
import { StaffPermissionRoute } from "@/ui/components/staff/StaffRoute"
import { StaffBlogEditorPage } from "@/ui/pages/staff/BlogPages"
export default function Page() { return <StaffPermissionRoute permissions={["view_blog"]}><StaffBlogEditorPage /></StaffPermissionRoute> }
