#!/bin/sh
# Vercel's ignored build step for the hosted app (web/vercel.json, a Vercel project of its own whose root is web/):
# 0 skips the deploy, 1 builds it. Only the branch `app` is ever built, and it is that project's production branch.
# The hosted app speaks to daemons people installed, and banda keeps no compatibility between versions, so what the
# origin serves is a release's build and never main's: a release moves `app` to its tag, and nothing else deploys.
[ "$VERCEL_GIT_COMMIT_REF" != app ]
