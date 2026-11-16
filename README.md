# Seapoint Swim — GitHub Pages version

A mobile-first tide/sea-state planner for Seapoint, Dublin. **Static hosting, no server, no API keys, no AI credits.**

## How it works

- GitHub Actions fetches the Marine Institute’s Seapoint Beach tide model, Open-Meteo wind, air, waves and modelled sea temperature, Met Éireann warning feed, EPA bathing alerts, and M2 offshore buoy.
- It produces one static `site/data/conditions.json` for roughly the next eight days and redeploys `site/` directly to GitHub Pages.
- The page calculates the swimming verdict for the exact Dublin-local date/time in your browser from the published snapshot. If the snapshot is missing or over 90 minutes old, the browser requests fresh readings directly. The EPA’s Seapoint-specific beaches.ie feed supplies current bathing notices on this path.
- The visible status and source list disclose unavailable providers. Weather or notices that cannot be verified cannot produce a favourable window. Dated tide predictions and daylight remain available separately. An old routine water-quality sample *does not automatically* mean Caution; active bathing alerts are checked separately.
- Today, Tomorrow, custom date/time and the hour-by-hour overview work without a backend. Sea temperature, air temperature and wind chill appear immediately below the verdict.
- Tide preferences (roughly ±3 hours around high tide, varying with high-water height) are **heuristic**; no invented minimum water depth at the steps or metre safety threshold is used. Height above adjacent low tide is calculated only from levels with the same datum.

## Publish using GitHub Pages

1. Create a **public** repository named `seapoint-swim` with `main` as its default branch. Public repositories can use standard hosted GitHub Actions and GitHub Pages without an Actions-minute charge. Upload **all the contents of this folder**, including hidden `.github/` (do not upload the ZIP itself as a single repository file).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Go to **Actions → Refresh sea conditions and publish Seapoint Swim → Run workflow**. This fetches current data and publishes the site. You can inspect the returned logs and the source statuses in the run summary. The site URL will be `https://<OWNER>.github.io/seapoint-swim/`, subject to your repository and Pages settings.
4. The refresh is scheduled **every 15 minutes at :08, :23, :38, :53 UTC**, and also on push and on manual triggering. Scheduled starts are best-effort and may be delayed or occasionally skipped. After each completed main-branch refresh, a backup workflow waits until 15 minutes after its start and triggers another refresh if GitHub has not started one. This operates overnight without visitors.
5. To change to **every five minutes**, edit `.github/workflows/pages.yml` and replace the cron expression with `*/5 * * * *`. Every 30 minutes could be `7,37 * * * *`.

### Create/push from terminal (alternative to uploading files through browser)

Create an empty public repository on GitHub first, then from the extracted project folder run:

```bash
git init -b main
git add .
git commit -m "Create Seapoint Swim static website"
git remote add origin https://github.com/YOUR_USERNAME/seapoint-swim.git
git push -u origin main
```

## How often can it update?

The minimum GitHub Actions schedule is **five minutes**. I recommend 15 minutes (96 runs/day) for this application. The forecasts themselves are generally updated less frequently than the polling schedule. A scheduled workflow is not guaranteed to start at an exact minute. Public-repository scheduled workflows can become disabled after 60 days without repository activity, so a **monthly keepalive commit** is included in `.github/workflows/keepalive.yml` (requires the default branch to permit the Actions bot to push; if branch protection blocks it, schedule maintenance or re-enable the schedule yourself).

The refresh workflow **does not commit JSON snapshots to git** every 15 minutes. It creates a new GitHub Pages deployment with an updated snapshot. This avoids thousands of data commits.

## Test locally

Node 20+ required for the data updater. No dependencies.

```bash
npm test
node scripts/update-data.js
python3 -m http.server 4173 --directory site
```

Open `http://localhost:4173/`. Running `node scripts/update-data.js` requires outbound access to the marine and weather providers. Before the first refresh, `site/data/conditions.json` is deliberately marked **unavailable**. It contains no invented test readings.

## Reliability and limitations

- Wave heights are offshore **model forecasts**, not direct wave measurements at Seapoint steps. M2 is an offshore observation, not a Seapoint sensor. The wind-chill formula describes dry exposed skin, not chilling of wet skin after a swim.
- The listed Met Éireann warning feed may not cover every type of marine safety advisory; the site links to the official marine forecast to check additional notices.
- The updater gives each request a timeout and lists provider failure reasons in its workflow summary. A failed provider is **not** assumed to be safe. If a core tide, wind or wave source fails, verdicts cannot be favourable.
- Tide events come from the Marine Institute EPA Beaches model for Seapoint in south Dublin (IEEABWC090_0000_0100_MODELLED). Heights are relative to model mean sea level. The approximate three-hour rule is centred on the median predicted high for 2026 (1.36 m). The dated archive covers complete years published by the same model. Monthly maintenance imports newly released years automatically. The date picker can also request the selected dates directly. Unpublished dates show no tide prediction. Sunrise and sunset use local forecast times with a date-based astronomical estimate at the beach if either time is missing.
- GitHub Pages does not guarantee exact refresh timing or real-time measurements. Always inspect local conditions, access steps, currents, ferry wash, water quality and current weather warnings before entering the sea. Cold-water shock can happen below 15°C regardless of swimming experience.
- Tide table attribution: Marine Institute, EPA Beaches Model Predicted Tide Level, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Highs and lows are derived from the ten-minute model samples.

## Source docs

- [Marine Institute tide predictions](https://erddap.marine.ie/erddap/info/imiTidePredictionEpa/index.html)
- [Open-Meteo weather and marine APIs](https://open-meteo.com/en/docs/marine-weather-api)
- [Met Éireann marine forecast](https://www.met.ie/forecasts/marine-inland-lakes)
- [EPA bathing-water alerts](https://www.beaches.ie/)
- [GitHub Actions scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
