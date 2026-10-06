export const BLOG_AUTHOR = {
  name: 'Micah Ondiwa',
  type: 'Person' as const,
  description: 'Micah Ondiwa writes software-development guides covering application architecture, modern stacks, developer tooling and reliable delivery.',
  profiles: [
    { label: 'LinkedIn', href: 'https://linkedin.com/in/micahondiwa' },
    { label: 'X', href: 'https://x.com/micahondiwa' },
    { label: 'GitHub', href: 'https://github.com/micahondiwa' },
  ],
}

export const MAVEN_HOST_AUTHOR = {
  name: 'MavenHost',
  type: 'Organization' as const,
  description: 'The MavenHost team publishes practical guidance on domains, DNS, hosting, business email, website operations and online services.',
  profiles: [] as { label: string; href: string }[],
}

const SOFTWARE_DEVELOPMENT_CATEGORIES = new Set([
  'ai-assisted-development', 'django-python', 'react-frontend', 'mern-stack',
  'frontend-web-design', 'vue-angular-svelte', 'next-js', 'node-js', 'php-laravel',
  'fastapi-flask', 'java-spring', 'net-development', 'go-rust-rails',
  'flutter-cross-platform', 'android-development', 'ios-development', 'databases-data',
  'devops-ci-cd', 'security-performance',
])

export function getBlogAuthor(categorySlug?: string | null) {
  return categorySlug && SOFTWARE_DEVELOPMENT_CATEGORIES.has(categorySlug)
    ? BLOG_AUTHOR
    : MAVEN_HOST_AUTHOR
}
