#!/usr/bin/env bash
# Autonomous QC loop: propose candidates from the latest failures, climb them on the live department, then run the
# QC gate against evals/baseline.json. It can run in the background: all output goes to a log in /tmp, and the
# script prints the log's path first. Exits non-zero if the gate finds a regression or the climb could not finish.
#   scripts/qc-loop.sh                                         # foreground, log still written
#   nohup scripts/qc-loop.sh > /dev/null 2>&1 &; tail -f /tmp/qc-loop-*.log
set -uo pipefail
cd "$(dirname "$0")/.."
log="/tmp/qc-loop-$(date +%Y%m%d-%H%M%S).log"
echo "log: $log"
exec > >(tee -a "$log") 2>&1
start=$(date +%s)
step() { echo "== $1 ($(($(date +%s) - start)) s)"; }

if [ ! -f evals/qc-latest.json ]; then
  step "qc (no failures recorded yet)"
  node evals/qc.mjs
fi
step "propose"
node evals/propose.mjs || exit 2
step "climb"
node evals/climb.mjs || { echo "climb failed; see above"; exit 2; }
step "qc"
node evals/qc.mjs
status=$?
step "diff against the live department"
node scripts/brane-policy.mjs diff
step "done, exit $status"
exit $status
