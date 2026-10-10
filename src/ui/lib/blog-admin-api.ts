import { apiRequest } from './api'

/** Client for the staff blog editor (/api/v1/blog/staff/...). */

export type StaffBlogStatus = 'draft' | 'published' | 'archived'
export type StaffBlogCategory = { id: string; name: string; slug: string; description: string }
export type StaffBlogTag = { id: string; name: string; slug: string }
export type StaffBlogPost = {
  id: string; title: string; slug: string; author: { id: string; email: string; name: string } | null; category: StaffBlogCategory | null; tags: StaffBlogTag[]
  excerpt: string; is_featured: boolean; status: StaffBlogStatus; published_at: string | null; seo_title: string; seo_description: string; created_at: string; updated_at: string
}
export type StaffBlogPostDetail = StaffBlogPost & { content: string; featured_image_url: string }
export type StaffBlogPostInput = {
  title: string; slug: string; category_id: string | null; tag_names: string[]; excerpt: string; content: string; featured_image_url: string
  is_featured: boolean; status: StaffBlogStatus; seo_title: string; seo_description: string
}

export const listStaffPosts = (params: Record<string, string>) =>
  apiRequest<{ count: number; next: string | null; previous: string | null; results: StaffBlogPost[] }>('/blog/staff/posts/', { params })
export const getStaffPost = (id: string) => apiRequest<StaffBlogPostDetail>(`/blog/staff/posts/${id}/`)
export const createStaffPost = (input: StaffBlogPostInput) => apiRequest<StaffBlogPostDetail>('/blog/staff/posts/', { method: 'POST', body: input })
export const updateStaffPost = (id: string, input: StaffBlogPostInput) => apiRequest<StaffBlogPostDetail>(`/blog/staff/posts/${id}/`, { method: 'PATCH', body: input })
export const deleteStaffPost = (id: string) => apiRequest<void>(`/blog/staff/posts/${id}/`, { method: 'DELETE' })
export const bulkPostStatus = (ids: string[], status: 'published' | 'archived') => apiRequest<{ updated: number }>('/blog/staff/posts/bulk-status/', { method: 'POST', body: { ids, status } })
export const listStaffCategories = () => apiRequest<StaffBlogCategory[]>('/blog/staff/categories/')
export const createStaffCategory = (name: string, description = '') => apiRequest<StaffBlogCategory>('/blog/staff/categories/', { method: 'POST', body: { name, description } })
