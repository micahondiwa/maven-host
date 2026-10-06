import {defineConfig,globalIgnores} from 'eslint/config'
import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
export default defineConfig([
 globalIgnores(['.next/**','.local/**','next-env.d.ts']),
 ...tseslint.configs.recommended,
 {files:['**/*.{ts,tsx}'],plugins:{'react-hooks':hooks},rules:{'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}],'react-hooks/rules-of-hooks':'error','react-hooks/exhaustive-deps':'warn'}},
])
