# Deploy to mindmakina.com (DO App Platform)

Uses your **existing** Mind Makina static app — **no new Space ($0 extra)**.

Files live at `Mind Makina/artbliss-deck/` and deploy with the main site on push to `rskillstudio/Mind-Makina`.

## URLs

- https://mindmakina.com/artbliss-deck
- https://mindmakina.com/artbliss-deck/deck.html

## Refresh + copy to Mind Makina repo

```bash
cd art-bliss-research
npm run deploy:mindmakina
```

Then push Mind Makina:

```bash
cd "../Mind Makina"
git add artbliss-deck/
git commit -m "Update Artbliss investor deck"
git push origin main
```

DO App Platform auto-deploys from GitHub (see `Mind Makina/.do/app.yaml`).
