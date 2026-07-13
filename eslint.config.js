import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Bare patterns only match at the config root; '**/' is needed to also
  // catch dist/coverage nested inside a git worktree (e.g. Claude Code's
  // native worktree tool places worktrees under .claude/worktrees/, each
  // with its own dist/coverage from local test/build runs).
  globalIgnores(['dist', 'coverage', '**/dist/**', '**/coverage/**', '.claude/worktrees/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
