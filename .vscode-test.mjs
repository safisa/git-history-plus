import { defineConfig } from '@vscode/test-cli';
import { REPO_DIR, FIXTURE_ROOT, NOREPO_DIR } from './test/integration/fixture.mjs';

// Uses the runner's own --user-data-dir/--extensions-dir (under .vscode-test/), never the user's profile.
export default defineConfig({
  files: 'out/test/integration/*.test.js',
  workspaceFolder: REPO_DIR,
  env: { GHP_TEST: '1', GHP_FIXTURE: FIXTURE_ROOT, GHP_NOREPO: NOREPO_DIR },
  mocha: { ui: 'tdd', timeout: 60000 },
});
