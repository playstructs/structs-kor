# Playtest harness

Ten player profiles, and three ways of putting each one in front of the game:

| Layer | What it does | Command | Speed |
|---|---|---|---|
| **Simulation** | Plays the demo base headless (the same `src/game/demo.ts` the browser runs) for thousands of blocks per persona over many seeds. Measures balance, friction and stability, and checks invariants every 10 blocks. | `pnpm playtest:sim` | ~1,000–2,000 blocks/s |
| **Browser** | Each persona drives the real client in its **own persistent Chrome profile** (`playtest/.profiles/<id>`), on its own device, network, zoom and motion settings, with game time fast-forwarded. Probes errors, performance, layout, accessibility (axe WCAG 2.2 AA), i18n, save integrity and safety. | `pnpm playtest:browser` | ~2–4 min per persona |
| **AI** | Claude plays as each persona from screenshots and a numbered control list, writes notes as it goes and a review at the end. One synthesis pass then merges every persona's notes with the sim and browser findings into a ranked triage list. | `pnpm playtest:ai` | needs `ANTHROPIC_API_KEY` |

`pnpm playtest` runs all three into one folder (`playtest/reports/<stamp>/`) and builds `report.html`, a self-contained page with every finding, screenshot and chart.

```bash
pnpm playtest                                   # everything, against the live site
pnpm playtest:sim --seeds 8 --blocks 6000       # balance and stability only (CI gate)
pnpm preview --port 5195 &                      # then, for heavy browser runs:
pnpm playtest:browser --target http://localhost:5195/ --fresh
pnpm playtest:browser --personas accessibility,chaos --steps title,keyboard-demo,a11y-audit
pnpm playtest:ai --personas newcomer --steps 40
pnpm playtest:report                            # rebuild report.html for the latest run
```

## The profiles (`profiles.ts`)

| | Who | Device · input | Exists to answer |
|---|---|---|---|
| 민지 · 신병 | First-timer on a phone, plays in 5-minute bursts | mobile · touch · 4G | Can someone who does almost nothing still progress? Is coming back rewarding? |
| 도현 · 산업가 | Economy min-maxer | desktop · mouse | Does the economy curve plateau? Is overclocking worth it? Do codex numbers match? |
| 준호 · 군벌 | Aggressive raider | desktop · keyboard | Is constant raiding dominant? Are forecasts honest? |
| 서연 · 상인 | Market speculator | laptop · mouse | Can a pure trader keep up? Are loans a trap? |
| 혜진 · 거북이 | Defensive builder | tablet · touch · reduced motion | Is pure defence viable? Does reduced motion work? |
| 태양 · 외교관 | Guild and social player, long absences | laptop · mouse | Do social systems pay off? Is catch-up fair? |
| 지우 · 완성주의자 | Achievement hunter | desktop · mouse | Is every system reachable? How long to a new era? |
| 현우 · 스피드러너 | Speedrunner, keyboard only, multiple tabs | desktop · keyboard | Fastest World Engine? Degenerate loops? Multi-tab save safety? |
| 수진 · 접근성 | Low vision, 200% zoom, keyboard only | laptop · keyboard · reduced motion | Can the whole loop be played without a mouse? |
| 혼돈 · QA 원숭이 | Fuzzer | desktop · mouse · 3G | Does any input crash or corrupt state? |

Each profile carries its sim policy (`sim/policies.ts`), browser journey (`browser/journeys.ts`), AI brief and the outcomes it expects (`expect`). Add a profile there and every layer picks it up.

## Gates

- **Hard gates** fail CI: exceptions thrown by any order or block, broken invariants (`sim/invariants.ts`), sim throughput, and blocker findings in the browser (page errors, a corrupted save, non-finite state, a keyboard dead end).
- **Design targets** are reported but only fail with `--strict`: death-spiral rate, raid loss share, order refusal rate (friction), milestone timing, idle time, and dominance (no persona's median worth more than 8× another's).
- **Known issues** live in `baseline.json`. Hard gates skip them, so CI catches only new bugs. When you fix one, delete its entry and the gate will guard it from then on.
- Studio-wide thresholds are in `budgets.ts`.

## Safety

Guest and demo mode only. The harness never signs in or enlists. It aborts any non-GET request that leaves the site's origin, and keeps every persona (and the monkey) off `/login`, `/start`, `/profile` and wallet controls. The AI playtester's clicks go through the same guard. GitHub Pages throttles bursts of about 10k requests. The browser layer therefore runs two personas at a time against a live host, backs off and retries on HTTP 429, and marks a throttled persona as unplayed rather than failed. For full runs, point it at `pnpm preview`.

## CI (`.github/workflows/playtest.yml`)

- **Pull requests and main:** typecheck, the simulation gates, and all ten browser personas against a local build of the commit.
- **Nightly and on demand:** every layer against the live site. This includes the Claude playtesters when the `ANTHROPIC_API_KEY` secret is set.
- Every run uploads its report folder as an artifact.
