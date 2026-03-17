import { defineConfig } from 'vite-plus';

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  lint: {
    plugins: ['oxc', 'typescript', 'unicorn', 'react'],
    ignorePatterns: [
      'apps/web/src/components/ui/',
      '.vscode/',
      '.agent/',
      '.codex/',
      'docs/',
      'vite.config.ts',
      'AGENTS.md',
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    sortTailwindcss: {},
    sortPackageJson: false,
    ignorePatterns: [
      'apps/web/src/components/ui/',
      '.vscode/',
      '.agent/',
      '.codex/',
      'docs/',
      'vite.config.ts',
      'AGENTS.md',
    ],
  },
});
