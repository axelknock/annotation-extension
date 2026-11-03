## Commit message style

Use mitchellh style: start the subject (the first line) with a project area
and a short description of the change.

```text
<system>[/<subsystem>]: <summary>

<issue references, when applicable>

<motivation and explanation, when needed>
```

- Use a short, lowercase area prefix (the name before the colon). Add a
  subsystem with `/` when it helps identify the changed area. For example,
  use `content` for the element picker or `content/selection` for selection.
- Do not use Conventional Commits (a format with change types such as `feat`
  or `fix`) or its `type(scope)` syntax.
- Start the summary in lowercase. Use the imperative mood (state an action,
  such as `add` or `fix`). Do not add a final period.
- Keep the full subject under 50 characters. Wrap body lines at 72
  characters. This is the 50/72 rule.
- Put each relevant issue or review reference on a separate line after a
  blank line. Use GitHub references such as `#<number>` for this repository
  or `owner/repository#<number>` for another repository. Use `Fixes`,
  `Closes`, or `Resolves` only when the change resolves that issue. Omit
  references when none apply. Never invent issue or review numbers.
- Add a short body when the reason or behavior is not clear from the
  subject. Explain the previous behavior, the change, and why it is needed.
  Use plain prose. Do not repeat the diff (the list of changed lines) or
  add text that gives no useful information.
- Review the changed paths and recent Git subjects before you choose a
  prefix. Reuse a suitable area name. If none fits, choose a name that
  matches the project structure. Past prefixes do not limit future choices.

Examples:

```text
content/selection: fix overlap previews
readme: clarify collection mode
```
