# Contributing to Questables

Contributions are welcome. This document covers the licensing and sign-off requirements; see the
[Development Guide](./docs/development-guide.md) for setup, conventions, and testing.

## Licensing

Questables is licensed under the **GNU Affero General Public License version 3**, and only that
version — `AGPL-3.0-only` ([LICENSE](./LICENSE)). By contributing, you agree that your contribution
is licensed under the same terms.

The version is pinned rather than "or later" because Questables links GPL-3.0-only code
(`settlemaker`, itself constrained by watabou's TownGeneratorOS). Please do not submit patches that
relabel the project as `-or-later`; see [NOTICE](./NOTICE) for the reasoning.

There is **no CLA** — you keep the copyright in your own work. In exchange, the project cannot be
relicensed under proprietary terms without the agreement of everyone who has contributed. That is
deliberate: the AGPL is meant to guarantee that improvements to Questables stay available to the
people running it, including improvements made by forks operating it as a network service.

## Developer Certificate of Origin

Every commit must be signed off, certifying that you have the right to submit the work under the
project's license. Add the sign-off with `git commit -s`, which appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and email must be real and must match your commit author identity. Sign-off certifies
the Developer Certificate of Origin 1.1, reproduced in full below.

If you forget, amend the most recent commit with `git commit --amend -s`, or fix a whole branch
with `git rebase --signoff <base>`.

<details>
<summary>Developer Certificate of Origin 1.1 (full text)</summary>

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

</details>

## Third-party content

Do not add dependencies or content whose licence is incompatible with the AGPL. In particular:

- **Permissive licences** (MIT, ISC, BSD, Apache-2.0, MPL-2.0) are fine — they flow into the AGPL.
- **GPL-3.0** (either `-only` or `-or-later`) and **AGPL-3.0** are fine.
- **GPL-2.0-only, SSPL, "source available", and non-commercial licences are not** — they cannot be
  combined with AGPL-3.0.
- **Anything requiring AGPL-4.0-or-later** would break the GPL-3.0-only combination described in
  [NOTICE](./NOTICE). This is hypothetical today, but it is why the version is pinned.
- **Game content** must be SRD-derived or original. Do not contribute text, statblocks, or lore
  copied from published Wizards of the Coast books; only the System Reference Document is openly
  licensed. See [Attribution](./README.md#attribution).

If a contribution carries third-party code, say so in the PR description and include its licence.

## Before opening a pull request

```bash
npx tsc --noEmit                    # type check — Vite's dev server does not do this
npx eslint <the files you changed>  # see the caveat below
npm test                            # Jest suite
```

`npx tsc --noEmit` must be clean, with no new failures in `npm test`.

**Lint caveat.** `npm run lint` runs ESLint across the whole repo with `--max-warnings 0`, and it
**does not currently pass on a clean checkout** — there is a pre-existing backlog of 66 findings:

| Count | Rule | What it is |
|-------|------|-----------|
| 39 | `react-hooks/exhaustive-deps` | warnings, mostly in the map components |
| 20 | `no-undef` | `process`/`console` in `tests/*.js` — an ESLint config gap, not real defects |
| 3 | `no-empty` | empty catch blocks |
| 2 | `@typescript-eslint/no-unused-vars` | |
| 2 | — | unused `eslint-disable` directives |

So lint the files you touched and leave them clean, rather than running the repo-wide script and
trying to interpret a red result you did not cause. Please don't fold unrelated fixes from that
backlog into a feature PR; clearing it is worth doing as its own change, at which point this
section goes back to simply saying `npm run lint`.

Match the conventions already in the surrounding code: `snake_case` database columns and
`camelCase` API responses, business logic in services rather than routes, OpenLayers layers built
through the factories in `components/layers/`, and no business logic in `components/ui/`.
