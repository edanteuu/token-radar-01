# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/edanteuu/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/edanteuu/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Build the best token launch radar. It reads a sealed snapshot of every protocol, finds the ones that record no token yet, and ranks them by an implied launch value from an equal-weight ensemble of three fitted predictors — a log-log fit of market cap on TVL, the same fit with a fitted seven-day-growth coefficient, and the base fit times a maturity prior — log-averaged, times launch odds from the peers' own token record. Every value term was kept or dropped on five blind tests (walk-forward at three cutoffs, leave-one-out, 5-fold): the ensemble beats the flat 0.25 × TVL baseline on all five, with multipliers of ×1.26–×1.33 on median error. Every row carries jackknife+ 80% and 90% intervals (about ×13 and ×38 — the honest range on 128 comps), an integrity strip, and a concrete farm plan costed by chain with minimum viable capital, break-even implied value, net $/hour and a FARM / THIN / SKIP verdict. Live-token protocols are shown apart with their market values, and pre-token protocols the board rule leaves out are listed with their reason.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot>
```

Node 22, standard library only. Deterministic: the same snapshot gives the same bytes out.

---

<sub>Entered on [make.fun](https://make.fun/?ref=edanteuu&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
