import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, sep, dirname, join } from 'node:path';
import type { ToolDef } from '../agentLoop.js';

/**
 * fs_write / fs_read — sandboxed to the shared qa/ directory. Agents use these
 * for artefacts the DB doesn't hold: the test plan, generated Playwright specs,
 * coverage matrix, sign-off report. Any path outside qa/ is rejected.
 */
export function resolveSandboxed(qaRoot: string, relPath: string): string {
  const root = resolve(qaRoot);
  // Agents address artefacts as "qa/<path>" (how tasks and bus signals name them),
  // while the schema says paths are relative to qa/ — accept both forms.
  const rel = relPath.replace(/^qa[\\/]+/i, '');
  const target = resolve(root, rel);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path escapes the qa/ sandbox: ${relPath}`);
  }
  return target;
}

export function fsWriteTool(qaRoot: string): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'fs_write',
        description:
          'Write a text file inside the shared qa/ directory (paths are relative to qa/, e.g. "specs/login.spec.ts" or "test-plan.md"). Overwrites if it exists. Paths outside qa/ are rejected.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'path relative to qa/' },
            content: { type: 'string', description: 'full file content' },
          },
          required: ['path', 'content'],
        },
      },
    },
    run: (args: { path: string; content: string }) => {
      const target = resolveSandboxed(qaRoot, args.path);
      // Models sometimes try to "create a folder" with an empty extension-less
      // write (run #7: fs_write "automation" → empty FILE → every later write
      // under automation/ failed and the agent misdiagnosed it as a missing
      // browser). Directories are implicit — reject the attempt with guidance.
      if (!args.content?.trim() && !/\.[A-Za-z0-9]+$/.test(args.path)) {
        return `ERROR: fs_write creates FILES; directories are created automatically when you write a file inside them. ` +
          `Do not pre-create folders — write the actual file, e.g. "${args.path.replace(/[\\/]+$/, '')}/runner.ts".`;
      }
      if (existsSync(target) && statSync(target).isDirectory()) {
        return `ERROR: qa/${args.path} is a directory — pass a FILE path inside it instead.`;
      }
      // Self-heal a parent component that exists as an EMPTY file (a previous
      // failed "mkdir" attempt); a non-empty file blocking the path is an error.
      const root = resolve(qaRoot);
      for (let dir = dirname(target); dir.length > root.length; dir = dirname(dir)) {
        if (existsSync(dir) && statSync(dir).isFile()) {
          if (statSync(dir).size === 0) { unlinkSync(dir); continue; }
          return `ERROR: cannot write qa/${args.path} — a FILE already exists at "${dir.slice(root.length + 1)}". ` +
            `You previously wrote a file where a directory is needed; choose a different path.`;
        }
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, args.content);
      return `Wrote ${args.content.length} chars to qa/${args.path}.`;
    },
  };
}

export function fsReadTool(qaRoot: string): ToolDef {
  return {
    schema: {
      type: 'function',
      function: {
        name: 'fs_read',
        description:
          'Read a text file inside the shared qa/ directory (path relative to qa/). Pass a directory path to list its files instead.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'path relative to qa/, e.g. "test-plan.md" or "specs"' },
          },
          required: ['path'],
        },
      },
    },
    run: (args: { path: string }) => {
      const target = resolveSandboxed(qaRoot, args.path);
      if (!existsSync(target)) return `ERROR: qa/${args.path} does not exist.`;
      try {
        return readFileSync(target, 'utf8') || '(empty file)';
      } catch {
        // EISDIR — list the directory instead.
        const entries = readdirSync(target);
        return entries.length ? entries.map((e) => join(args.path, e)).join('\n') : '(empty directory)';
      }
    },
  };
}
