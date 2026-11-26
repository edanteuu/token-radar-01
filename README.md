# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/edanteuu/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/edanteuu/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Build the best token launch radar. It reads a sealed snapshot of every protocol, finds the ones that record no token yet, and ranks them by an implied launch value fitted from the snapshot's own live-token market caps — a log-log fit of market cap on TVL, adjusted for seven-day growth and age, times launch odds from the peers' own token record — each row with a concrete farm plan, its cost, its hours and a FARM / THIN / SKIP verdict. Live-token protocols are shown apart with their market values, and pre-token protocols the board rule leaves out are listed with their reason.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=edanteuu&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
