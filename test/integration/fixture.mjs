import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Fixture lives under the OS temp dir so it is never inside another git repository. */
export const FIXTURE_ROOT = join(tmpdir(), 'ghp-int-fixture');
export const REPO_DIR = join(FIXTURE_ROOT, 'repo');
export const NOREPO_DIR = join(FIXTURE_ROOT, 'norepo');
