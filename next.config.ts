import type { NextConfig } from 'next'
// `standalone` produces a self-contained server (.next/standalone/server.js) for the cPanel Node.js app.
const config: NextConfig = { output: 'standalone', images: { unoptimized: true }, poweredByHeader: false, trailingSlash: true, async headers() { return [{ source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }, { key: 'X-Frame-Options', value: 'DENY' }] }] } }
export default config
