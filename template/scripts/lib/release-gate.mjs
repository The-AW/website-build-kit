/**
 * Production ships what GitHub's default branch has, and nothing else.
 *
 * Used by `scripts/deploy-aw.mjs`. A production deploy refuses unless:
 *   1. the working tree is clean (no staged, unstaged or untracked file that would ship);
 *   2. `git fetch origin` succeeds;
 *   3. HEAD is exactly `origin/<default branch>`, the default read from the remote
 *      (`git ls-remote --symref origin HEAD`, then `refs/remotes/origin/HEAD`), never assumed.
 *
 * ── THE FAILURE THIS EXISTS FOR ────────────────────────────────────────────
 * The deploy used to upload the working tree, whatever branch it was on, pushed or
 * not. An audit on 2026-11-23 found two sites live from commits that existed on one
 * Mac only, one live from an unmerged PR, and one where a later deploy from `main`
 * silently overwrote an unmerged fix: the contact form was dead for five days and
 * every check was green, because each deploy was internally consistent.
 *
 * `--allow-unmerged "<reason>"` is the one escape. It warns, and after the deploy it
 * appends the reason, the commit and the date to BUILD-STATE.md, so the gap is written
 * down where the next person reads.
 *
 * Every deploy, staging included, is stamped: `wrangler deploy --tag <sha> --message
 * "<branch> <sha>"`, so the Worker version itself says which commit is live.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

/* Overnight runs have nobody to answer a credential prompt; a fetch that waits for one
   hangs the deploy instead of failing it. */
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  ...(process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
};

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', env: GIT_ENV });
  return {
    ok: r.status === 0,
    out: (r.stdout ?? '').trim(),
    err: ((r.stderr ?? '').trim() || r.error?.message || `exit ${r.status}`).split(/\r?\n/).filter(Boolean).pop() ?? '',
  };
}

/** The commit this directory would deploy. `inRepo: false` outside a git work tree. */
export function readCommit() {
  if (!git(['rev-parse', '--is-inside-work-tree']).ok) return { inRepo: false };
  const head = git(['rev-parse', 'HEAD']);
  if (!head.ok) return { inRepo: true, sha: null, short: null, branch: null, dirty: [] };
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const status = git(['status', '--porcelain', '--untracked-files=all']);
  return {
    inRepo: true,
    sha: head.out,
    short: git(['rev-parse', '--short=12', 'HEAD']).out || head.out.slice(0, 12),
    branch: branch.ok ? branch.out : null,
    dirty: status.ok ? status.out.split(/\r?\n/).filter(Boolean) : ['(git status failed)'],
  };
}

function defaultBranch() {
  /* Ask the remote first: a local origin/HEAD is whatever it was at clone time, and
     a repository whose default moved (a migration branch promoted to main) keeps the
     old one forever. */
  const remote = git(['ls-remote', '--symref', 'origin', 'HEAD']);
  const m = remote.ok && remote.out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
  if (m) return m[1];
  const local = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (local.ok && local.out.startsWith('refs/remotes/origin/')) return local.out.slice('refs/remotes/origin/'.length);
  return null;
}

/**
 * Decide whether this checkout may go to production.
 * Returns { ok, problems: [{ what, todo }], commit, defaultBranch, originSha }.
 */
export function releaseGate() {
  const commit = readCommit();
  const problems = [];
  const result = (extra = {}) => ({ ok: problems.length === 0, problems, commit, defaultBranch: null, originSha: null, ...extra });

  if (!commit.inRepo) {
    problems.push({
      what: 'this directory is not a git repository, so nothing proves what would ship.',
      todo: "deploy production from a clone of the site's GitHub repository.",
    });
    return result();
  }
  if (!commit.sha) {
    problems.push({ what: 'this repository has no commits yet.', todo: 'commit, push and merge to the default branch first.' });
    return result();
  }
  if (commit.dirty.length) {
    const shown = commit.dirty.slice(0, 8).map((l) => l.trim()).join(', ');
    const more = commit.dirty.length > 8 ? ` and ${commit.dirty.length - 8} more` : '';
    problems.push({
      what: `the working tree is not clean: ${commit.dirty.length} uncommitted change(s) would ship without being in git (${shown}${more}).`,
      todo: 'commit them on a branch, open a PR to the default branch and merge it, then deploy from the default branch; or discard them (git restore <file>, delete the untracked file) if they must not ship.',
    });
  }
  if (!git(['remote', 'get-url', 'origin']).ok) {
    problems.push({
      what: 'this repository has no "origin" remote, so it cannot be compared with GitHub.',
      todo: 'git remote add origin <targets.repositoryUrl from aw-migration.json>, then git fetch origin.',
    });
    return result();
  }
  const branch = defaultBranch();
  /* Only the default branch, with an explicit refspec: a CI checkout is shallow and a
     plain fetch would pull every branch's history, and a --single-branch clone of some
     other branch would never update origin/<default> at all. */
  const fetch = git(['fetch', '--quiet', 'origin', ...(branch ? [`+refs/heads/${branch}:refs/remotes/origin/${branch}`] : [])]);
  if (!fetch.ok) {
    problems.push({
      what: `git fetch origin failed, so this checkout cannot be compared with GitHub (${fetch.err}).`,
      todo: 'fix the network or the GitHub credentials until "git fetch origin" succeeds, then run the deploy again.',
    });
    return result({ defaultBranch: branch });
  }
  if (!branch) {
    problems.push({
      what: "could not tell origin's default branch (git ls-remote --symref origin HEAD gave none and refs/remotes/origin/HEAD is not set).",
      todo: 'git remote set-head origin --auto, then run the deploy again.',
    });
    return result();
  }
  const origin = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}^{commit}`]);
  if (!origin.ok) {
    problems.push({
      what: `origin/${branch} is missing after the fetch.`,
      todo: `git fetch origin ${branch}, then run the deploy again.`,
    });
    return result({ defaultBranch: branch });
  }
  const originSha = origin.out;
  if (originSha !== commit.sha) {
    const counts = git(['rev-list', '--left-right', '--count', `HEAD...refs/remotes/origin/${branch}`]);
    const [ahead, behind] = counts.ok ? counts.out.split(/\s+/).map(Number) : [NaN, NaN];
    const here = `HEAD ${commit.short} (${commit.branch ? `branch ${commit.branch}` : 'detached'})`;
    const there = `origin/${branch} is ${originSha.slice(0, 12)}`;
    const onDefault = commit.branch === branch;
    if (ahead > 0 && behind === 0 && onDefault) {
      problems.push({
        what: `${here} has ${ahead} commit(s) that origin/${branch} does not have: they are not pushed.`,
        todo: `git push origin ${branch}, then run the deploy again.`,
      });
    } else if (ahead === 0 && behind > 0) {
      problems.push({
        what: `${here} is ${behind} commit(s) behind origin/${branch}; deploying it would roll production back past work already merged.`,
        todo: `git switch ${branch} && git pull --ff-only, then run the deploy again.`,
      });
    } else {
      problems.push({
        what: `${here} is not origin/${branch}: ${Number.isNaN(ahead) ? 'it differs' : `${ahead} commit(s) not on origin/${branch}, ${behind} on origin/${branch} not here`}; ${there}.`,
        todo: `push this branch, open a PR to ${branch} and merge it, then git switch ${branch} && git pull --ff-only and deploy from there.`,
      });
    }
  }
  return result({ defaultBranch: branch, originSha });
}

/** The refusal (or, with the escape, the warning) as lines, ready to print. */
export function describeGate(gate) {
  const target = gate.defaultBranch ? `origin/${gate.defaultBranch}` : 'origin/<default branch>';
  return {
    headline: `production deploys only from ${target}, and this checkout is not it. Nothing was built or deployed.`,
    lines: [
      ...gate.problems.flatMap((p) => [p.what, `→ ${p.todo}`]),
      `Production must equal ${target}: merge to the default branch, push, then deploy from it.`,
      'Emergency only: --allow-unmerged "<reason>" deploys anyway, warns, and appends the reason, commit and date to BUILD-STATE.md.',
    ],
  };
}

/* Wrangler limits: a version tag is at most 25 characters, a message at most 100. */
const clean = (s) => String(s).replace(/[^A-Za-z0-9._\/@+#:-]/g, '_');

/**
 * `--tag` / `--message` for `wrangler deploy`. Empty outside a git work tree.
 * `windowsShell`: spawnSync with `shell: true` joins argv unquoted, so a message with a
 * space becomes two arguments on cmd.exe unless it is quoted here.
 */
export function stampArgs(commit, { unmerged = false, windowsShell = false } = {}) {
  if (!commit?.inRepo || !commit.sha) return [];
  const dirty = commit.dirty?.length > 0;
  const tag = `${commit.short}${dirty ? '-dirty' : ''}`.slice(0, 25);
  const suffix = `${dirty ? ' +uncommitted' : ''}${unmerged ? ' UNMERGED' : ''}`;
  const room = 100 - commit.sha.length - 1 - suffix.length;
  const branch = clean(commit.branch ?? 'detached').slice(0, Math.max(room, 1));
  const message = `${branch} ${commit.sha}${suffix}`;
  return ['--tag', tag, '--message', windowsShell ? `"${message}"` : message];
}

/** Append the escape-hatch record. Returns the file written. */
export function recordUnmerged({ gate, reason, worker, file = 'BUILD-STATE.md', now = new Date() }) {
  const target = gate.defaultBranch ? `origin/${gate.defaultBranch}` : 'origin/<default branch>';
  const c = gate.commit ?? {};
  const header = existsSync(file) && !readFileSync(file, 'utf8').endsWith('\n') ? '\n' : '';
  appendFileSync(file, [
    header,
    `## ⚠ Unmerged production deploy · ${now.toISOString()}`,
    '',
    `- Commit: \`${c.sha ?? 'none (not a git repository)'}\`${c.branch ? ` on branch \`${c.branch}\`` : ''}${c.dirty?.length ? `, plus ${c.dirty.length} uncommitted change(s)` : ''}`,
    `- ${target}: ${gate.originSha ? `\`${gate.originSha}\`` : 'unknown'}`,
    `- Worker: ${worker}`,
    `- Reason (--allow-unmerged): ${String(reason).replace(/\s+/g, ' ').trim()}`,
    `- Gate refused because: ${gate.problems.map((p) => p.what).join(' ')}`,
    `- Open until production equals ${target}: merge, push, and deploy again from it without --allow-unmerged.`,
    '',
  ].join('\n'));
  return file;
}
