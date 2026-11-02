import { execFile, type ExecFileException } from 'node:child_process';

export const DEFAULT_MAX_BUFFER = 256 * 1024 * 1024;

export class GitError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public stderr: string,
    public args: string[],
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface RunGitOptions {
  input?: string;
  maxBuffer?: number;
  signal?: AbortSignal;
}

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
}

function exec<T extends string | Buffer>(
  gitPath: string,
  cwd: string,
  args: string[],
  encoding: 'utf8' | 'buffer',
  opts: RunGitOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = execFile(
      gitPath,
      args,
      {
        cwd,
        encoding,
        env: gitEnv(),
        maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
        windowsHide: true,
        signal: opts.signal,
      },
      (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        if (error) {
          const err = stderr.toString();
          const code = typeof error.code === 'number' ? error.code : -1;
          reject(
            new GitError(`git ${args.join(' ')} failed: ${err.trim() || error.message}`, code, err, args),
          );
          return;
        }
        resolve(stdout as T);
      },
    );
    // Always close stdin: without input, a git command that reads it (e.g. `shortlog` in a repo with
    // no refs) would otherwise wait forever and leak the process.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(opts.input);
  });
}

export function runGit(gitPath: string, cwd: string, args: string[], opts?: RunGitOptions): Promise<string> {
  return exec<string>(gitPath, cwd, args, 'utf8', opts);
}

export function runGitBuffer(gitPath: string, cwd: string, args: string[]): Promise<Buffer> {
  return exec<Buffer>(gitPath, cwd, args, 'buffer');
}

export function resolveGitPath(fromGitExtension?: string, fromSetting?: string | null): string {
  return fromGitExtension || fromSetting || 'git';
}
