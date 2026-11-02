---
name: land
description: |
  Land scoped changes in axelknock/annotation-extension only when the user
  explicitly invokes this skill and asks to land them. Verify delivery to
  origin/master, then clean up this task's branches. Review, preparation,
  installation, and updates to this skill do not authorize landing.
disable-model-invocation: true
---

# Land

Use `$land` in Codex or `/skill:land` in Pi with an explicit request to land
changes. That request authorizes the stated publication and branch cleanup.
Ask only for unclear scope or an additional required gate. Installation alone
does not authorize this workflow.

## Project process and sources

The destination is `master` at
<https://github.com/axelknock/annotation-extension>, through remote `origin`.
Check that identity before each publication. Do not silently choose a different
repository or branch.

Use a fast-forward (advance the destination without a merge commit). Squash
(combine) related task commits before integration. Use Git, GitHub's `gh`
command-line tool, Node.js, and Python 3. Inspect current command definitions
and installed tool behavior before use. Project dependency setup below is
part of landing. Do not install unrelated tools.

Read these sources again for each landing request:

- Applicable `AGENTS.md` files: commit coherent work on a branch; combine
  related commits before integration; never create merge commits or rewrite
  unrelated history. Follow the current documentation style rules.
- [README.md](../../../README.md): install the unpacked extension and use
  `demo.html` to check browser behavior. Preserve the intentional `txt` fence.
- [package.json](../../../package.json): `npm test` runs `playwright test`.
- [playwright.config.js](../../../playwright.config.js) and
  [tests/selection.spec.js](../../../tests/selection.spec.js): browser checks
  and the optional existing-browser executable setting.
- [manifest.json](../../../manifest.json): extension files, permissions,
  and browser requirements.
- [LICENSE](../../../LICENSE): preserve the copyright and permission notice.
- Any current contribution files, hooks, tests, scripts, hosted rules, and
  review requirements. Inspect scripts before executing them.

The inspected project has a browser test suite and no build script or hosted
workflows. No required reviews, signing, sign-off, contributor agreement,
changelog rule, or requirement for human-written submission text was found.
The destination was unprotected, the authenticated account had push permission,
and no branch rules applied. These findings are observations, not permanent
exemptions.
Preserve any new requirements and their exceptions. Keep required human
actions as gates. Do not substitute agent approval or generated text for them.

## 1. Establish scope and current state

Run all project commands from the current repository root. Read state before
any mutation:

```sh
git --no-optional-locks rev-parse --show-toplevel
git --no-optional-locks status --short --branch
git --no-optional-locks remote -v
git --no-optional-locks branch -avv
git --no-optional-locks worktree list --porcelain
git --no-optional-locks log -12 --oneline --decorate
```

Inspect each worktree (a separate checkout). Determine the current branch,
task changes, destination, and other checkouts that use these branches.
Stop if the landing scope or ownership is unclear. Do not include another
branch's work because it shares the repository.

Use the GitHub connector for available read operations. For rules that the
connector cannot inspect, use these explicit read operations:

```sh
land_repo=axelknock/annotation-extension
gh api --method GET "repos/$land_repo"
gh api --method GET "repos/$land_repo/branches/master"
gh api --method GET "repos/$land_repo/branches/master/protection"
gh api --method GET "repos/$land_repo/rulesets" --paginate
gh api --method GET "repos/$land_repo/rules/branches/master" --paginate
gh api --method GET "repos/$land_repo/actions/workflows" --paginate
```

Set `land_repo` in each new shell. Record the destination revision, permissions,
required checks, and rules. An explicit "Branch not protected" response,
confirmed by the branch response and an empty effective rule list, establishes
that no branch protection applies. An access error does not. Inspect applicable
ruleset details when the summaries are not sufficient. Stop if the required
rules or permissions cannot be verified.

This process publishes directly. If rules require a pull request (PR), a
review request before integration, a queue, or another process, report the
specific gate and ask for a revised workflow. Never bypass it with administrator
access. A PR is a proposed change on GitHub. If the only permitted process
requires merge commits, stop because it conflicts with the user's instructions.

Read the authoritative remote before deciding to publish again:

```sh
git ls-remote --symref origin HEAD refs/heads/master
```

During an explicit landing request, fetch the destination, then compare the
scoped changes with it. Check for an earlier successful landing, including one
that combined or reapplied the original commits. If the changes are already
present, verify that result and continue only with safe cleanup.

## 2. Protect work and prepare the integration

Record the starting branch, revision, task paths, task branch tips, and remote
tips. Protect relevant uncommitted work. Do not discard, stage, stash, commit,
or otherwise alter unrelated work. Use a commit limited to task paths or an
isolated branch when permitted. Stop if safe isolation is unavailable.

If the checkout has no branch, create an unused branch under `codex/` before
committing. Commit whenever the scoped work is coherent and its relevant checks
pass. Do not stage the whole checkout without checking each included path.
Complete applicable documentation, changelog, signing, and contribution duties.

Synchronize the destination:

```sh
git fetch --no-tags origin \
  refs/heads/master:refs/remotes/origin/master
```

Inspect the complete difference and history from the current `origin/master`.
Combine only related task commits and use a clear final message. Keep a recovery
branch before replacing local commits. Never rewrite a published branch or
force-push shared history. If the task branch is shared or includes unrelated
commits, use a new private integration branch and apply only the scoped changes.

Prepare one task commit on the current destination. For a task-only local
branch, rebase (reapply its commits) onto `origin/master` and combine the task
commits. An isolated integration branch with only the scoped changes is also
valid. Do not reset a checkout that contains work to retain. Recheck the final
changed files against the requested scope. The destination must be an ancestor
of the candidate, and the new history must contain no merge commits:

```sh
git merge-base --is-ancestor origin/master HEAD
git rev-list --merges origin/master..HEAD
git diff --stat origin/master HEAD
git diff origin/master HEAD
```

The merge-commit list must be empty. Set `land_base` to the full destination
revision and `land_candidate` to the full validated candidate revision. Preserve
these identities for the rest of this attempt.

Resolve conflicts automatically when the intended result is clear. Preserve
unrelated work. If intent is unclear, stop and ask. Leave a recoverable state
and report whether a rebase or other integration remains in progress. Conflict
resolution or any other candidate change invalidates affected validation.

## 3. Validate the exact candidate

Reinspect current command definitions and run all applicable project checks.
If project dependencies are absent, run `npm ci` after inspecting the current
package scripts. If a suitable Chromium browser is already installed, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path. Otherwise, use
`npx --no-install playwright install chromium`, as described in `README.md`.
Do not download a browser when the installed one is sufficient.

Run these checks against the candidate:

```sh
git diff --check "$land_base" "$land_candidate"
node --check content.js
node --check service-worker.js
python3 -m json.tool manifest.json >/dev/null
npm test
```

The Python command parses JavaScript Object Notation (JSON), the manifest
format.
For manifest changes, also check that referenced scripts and icons exist and
that permissions and browser requirements match the requested behavior.
For skill changes, validate their complete metadata, references, and agent
invocation settings with installed validators or loaders. Do not execute a
landing workflow as an installation test. Documentation-only changes need the
applicable document checks and the automated suite. A manual extension check
is needed only for runtime or browser-visible changes. The automated browser
suite uses simulated extension and clipboard services; it does not establish
that the unpacked extension works in a real browser profile.

For runtime or browser-visible changes, load this checkout as an unpacked
extension through `chrome://extensions`, as described in `README.md`. Serve the
demo using:

```sh
python3 -m http.server 8765
```

Visit <http://localhost:8765/demo.html>. Check the affected behavior. Relevant
checks include toolbar and keyboard activation, selection, confirm and cancel,
markers and badge count, single and combined clipboard text, region screenshot,
text download, and exit. Check the intended clipboard `txt` fence. Include
restricted-page handling when affected. Stop only the server started for this
verification. Record what was checked and the exact candidate revision. Do not
claim browser validation if no suitable browser or evidence is available; stop
for the specific missing runtime check.

Inspect required hosted checks and reviews for the exact candidate or resulting
integration tree required by the current process. Use these read operations for
commit evidence:

```sh
gh api --method GET \
  "repos/$land_repo/commits/$land_candidate/check-runs" --paginate
gh api --method GET \
  "repos/$land_repo/commits/$land_candidate/status"
```

Record check names, result revisions, conclusions, and run links. Missing,
pending, failed, stale, or unverifiable required results block publication.
An empty status list with an aggregate `pending` state is not a pending required
check when the rules and workflow inspection confirm that none are required.
It is also not evidence that a check passed. Preserve required human reviews.
If required pre-publication checks cannot run without a PR, stop for that
workflow gate; do not push directly to obtain the results.

Any candidate change requires renewed checks and reviews where the prior
evidence no longer applies. Never label a required check optional to proceed.

## 4. Publish to the destination

Immediately before publication, recheck remote identity, destination revision,
permissions, effective rules, candidate identity, clean scoped state, changed
files, and validation evidence. If `master` moved, integrate the new destination
and validate the new candidate. Do not publish an unreviewed replacement.

Publish the recorded candidate with a normal fast-forward push:

```sh
git push origin "$land_candidate:refs/heads/master"
```

Do not use force options, a merge commit, or protection bypass. If the push is
rejected because the destination moved, inspect, integrate, and validate again.
If the result is uncertain, read the remote before retrying. Stop and report a
concrete blocker when permission, rules, or tool failures prevent completion.

This direct workflow does not publish a task branch, PR, release, tag,
browser-store upload, or deployment. A separate request is needed to add those
operations. Never change the workflow silently to complete publication.

## 5. Verify the destination and report

After the push, read the authoritative destination through both Git and GitHub:

```sh
git ls-remote origin refs/heads/master
gh api --method GET "repos/$land_repo/branches/master"
git fetch --no-tags origin \
  refs/heads/master:refs/remotes/origin/master
```

Check that the candidate is present on `origin/master`. If later commits have
advanced the destination, verify ancestry and that the intended changes remain.
Compare the landed changes against the validated changes, including the final
combined commit when the original commit identities changed. Inspect the
published integration history for merge commits. Verify applicable hosted
results for the landed revision; rerun relevant local checks against that exact
revision if prior evidence does not cover it. A queued operation, prepared
branch, or open PR does not establish landing.

Report the repository and branch, landed revision and commit link, and actual
validation evidence. If publication or verification is incomplete, say
**did not land**, describe any partial publication, retain the work, and give
the specific next step. Inspect uncertain outcomes before another attempt.

## 6. Clean up only after verified landing

Recheck task branch tips, complete landed changes, uncommitted work, and
checkout use before deletion. Fetch the destination. If this checkout is clean
and `master` is not used by another checkout, switch to `master` and update it
with `git merge --ff-only origin/master`. Stop if its history cannot advance
without rewriting work. Do not move another checkout's branch. If it is in use
elsewhere, use a detached checkout of the verified destination only when safe.
Report why this checkout did not switch to `master`.

Delete only this task's local branch after it is no longer checked out
anywhere. Prefer `git branch -d`. If combined or reapplied commits prevent that
check, verify the full landed changes and unchanged branch tip before using
`git branch -D`.
Do not infer complete landing from a matching commit message.

This workflow normally publishes no task branch. If this task already has a
remote branch, verify its recorded tip and complete landed changes before
removing it. Use a deletion guarded by that exact remote tip:

```sh
git push --force-with-lease="refs/heads/$land_task:$land_remote_tip" \
  origin ":refs/heads/$land_task"
```

Set `land_task` and `land_remote_tip` only from the verified task identity.
The lease is for this scoped deletion, never for rewriting a shared branch.
If the tip changed or ownership is uncertain, retain the branch. Keep `master`,
recovery branches, unrelated branches, and all worktree directories. Do not run
worktree removal, pruning, or archive operations. Report retained work and
cleanup failures separately from landing success.
