# Independent PR 122 proof

Original reviewed base: `7c77c29dfe0aff833ccbd6adc5152594154dc1e9`.
Current-main baseline: `be0465891c06e49588200bc55079c23d47724a92`.
GitHub CI merge: `5939077139eff46efa1465f502655094ce3d0144` (parents: current-main baseline and fixed head).
Fixed head: `96348d296c39c5328c77ec0e9a15144fee8ba37a`.
Tested source tree: `eb1640089b7ff3676130bfc99dc469ad8b782b74`.

`manual-*-manifest.json` records clean exact heads before and after the native-input walkthroughs. The UI was used through the composer and activity controls at 1440 and 390 CSS pixels, against disposable daemons with invented data and the faux provider. `before/` shows current main; `after/` shows the fixed head; `merge/` independently checks GitHub's exact CI merge checkout. Chrome's computed accessible name is recorded under each width. GIFs sample these captured interaction states, rather than real-time motion.

`own-gate.log` is the independent check/contrast/typecheck/ordinary/build run on the source tree committed above. `manifest.json` records counts and limitations. Local Node was v26.3.1; the repository pins 26.13.0. Existing dependencies were reused without installs. The two ordinary skips and the expected failure are retained; no real screen-reader, physical phone, Docker, microVM or fault run is claimed.

For reproduction, place `review-fixture/*` in `.local/review122/` of the source checkout. `gate.mjs` runs the ordinary gate; `run-manual.mjs` expects a sibling `review-122-before` worktree at the base with the manual fixture copied to the same relative location. Both use disposable owned temp fixtures, OS-assigned ports and normal test-slot setup. Global box sweeping is disabled to avoid touching other sessions. See the PR comment for the regression, hook audit and signature verification.

`node .local/review122/run-manual.mjs integration` selects the current-main and CI-merge walkthroughs, with a sibling `review-122-merge` worktree prepared at that exact merge commit. CI records the fixed PR head but checks out the merge commit; its test counts include the intervening main changes and differ from the direct-head local gate. Relevant Chrome suites were skipped in CI, so the direct-head local Chrome gate and native walkthroughs supply that evidence.
