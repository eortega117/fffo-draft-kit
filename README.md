# FFFO — Fantasy Football Draft Kit

A static, no-backend draft board. Users upload their own rankings (CSV or Excel), then
work the board live during their draft — tag Target/Avoid, bump players up or down by
overall or position rank, and mark players Drafted to pull them from the pool. There's no
database or login — when you're ready to step away, click **Export Board** to download a
CSV of your current state (order, tags, drafted players and all), then re-upload that same
file next time to pick up exactly where you left off. Finished a draft and want to reuse
the same board for another one? **Undraft All** clears every drafted flag in one click
while keeping your custom order and Target/Avoid tags intact.

No build step, no dependencies to install — just static HTML/CSS/JS plus two CDN-loaded
libraries (PapaParse for CSV, SheetJS for Excel).

## Files

- `index.html` — page structure (upload screen + board screen)
- `styles.css` — all styling
- `app.js` — parsing, ranking logic, filters, persistence

## Run it locally

Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Create a new repo (or use an existing one) on GitHub.
2. Copy `index.html`, `styles.css`, and `app.js` into the repo root (or into a `/docs`
   folder if you'd rather keep them out of the root — just adjust the Pages settings to
   match).
3. Commit and push:
   ```bash
   git add index.html styles.css app.js
   git commit -m "Add FFFO draft kit"
   git push
   ```
4. On GitHub: go to the repo's **Settings → Pages**.
5. Under **Build and deployment**, set **Source** to "Deploy from a branch."
6. Set **Branch** to `main` (or whichever branch you pushed to) and the folder to `/root`
   (or `/docs` if that's where you put the files).
7. Save. GitHub will give you a URL like `https://yourusername.github.io/your-repo/` —
   it usually takes a minute or two to go live.

That's it — no Actions workflow or build step required since there's nothing to compile.

## Ranking logic (for reference)

- **Overall Rank ▲/▼** swaps the player with their immediate neighbor in the full list.
- **Position Rank ▲/▼** leapfrogs the player past the next/previous player of the *same
  position*, landing immediately after/before them — everyone in between shifts to fill
  the gap. Position Rank itself is always recalculated live from the current order, so it's
  never something you have to manage directly.
- **Target / Avoid** are mutually exclusive; clicking the active one again clears it.
- **Drafted** dims the row and removes it from the "available" view (toggle "Show
  drafted" to bring it back into view, or click "Undo").

## Upload format

Columns: Overall Rank, Player, Team, Position, Position Rank, Bye Week.

- **Position** can be given as just the letters (`RB`, `WR`) or combined with the rank
  (`RB1`, `WR10`) — either way the app splits/derives it correctly, and a separate
  Position Rank column is optional. `DST` and `DEF` are automatically normalized to `TD`.
- Re-uploading a file that was **exported** from the app (which includes extra `Tag` and
  `Drafted` columns) restores your board exactly as you left it.

## Extending it later

- Want cross-device sync or an account system again? Swap the CSV export/import round
  trip for calls to Supabase (or any backend) — the rest of the app doesn't need to change.
- Want more columns (ADP, Tier, notes)? Add them to `COLUMN_MAP` in `app.js` and to the
  template generator in `downloadTemplate()`.
