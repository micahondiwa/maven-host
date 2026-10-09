import {defineConfig} from 'vitest/config'
import {fileURLToPath} from 'node:url'
export default defineConfig({
 resolve:{alias:{'server-only':fileURLToPath(new URL('./node_modules/server-only/empty.js',import.meta.url))}},
 // Django-compatible PBKDF2 (1,000,000 iterations) makes account flows slow on CI runners.
 test:{include:['tests/**/*.test.ts'],environment:'node',fileParallelism:false,testTimeout:60_000,hookTimeout:60_000},
})
