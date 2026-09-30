# OutfitRecco

Pick outfits from clothes you already own.

Upload photos of your wardrobe, answer five quick questions, and get outfit suggestions built from your own pieces. You also get a couple of pieces worth looking for, with links to find similar ones.

## Features

- **Photo-based wardrobe:** upload up to 10 photos (a collage, outfit photos or flat-lays). The AI splits every look into separate pieces.
- **Duplicates merged by default:** when the same piece shows up in several photos, it counts once. Tap **Keep separate** if the AI guessed wrong.
- **Editable pieces:** untick anything you don't want to wear, change a piece's type, or add a missing one.
- **5-question quiz:** occasion, mood, weather, time of day, and comfort vs. statement.
- **From your wardrobe:** up to 3 outfits, each with why it works and a styling tip. Pairs you've already worn together are marked.
- **Worth looking for:** 2 pieces you may not own, the closest thing you do own, and search links.
- **No accounts, no database:** photos go to the AI for analysis and aren't stored.
- **Passcode protected:** every API call needs the passcode, so nobody else can spend your API credits.

## How it works

```
Photos ──► /api/inventory ──► pieces you can edit ─┐
                                                    ├──► /api/recommend ──► outfits
Quiz answers ───────────────────────────────────────┘
```

1. The browser shrinks the photos (to stay under Vercel's 4.5 MB request limit) and sends them to `/api/inventory`. This runs while you take the quiz.
2. You review the pieces. Flagged duplicates are merged unless you choose **Keep separate**.
3. `/api/recommend` merges duplicates, asks Claude for outfits as JSON, and checks every outfit in code: real item ids, valid shapes (one one-piece, or a top plus a bottom, with an optional layer) and no repeats. If anything breaks the rules, it asks once more with the problems listed.

## Tech stack

| Layer    | Choice                                             |
|----------|----------------------------------------------------|
| Frontend | HTML, CSS, vanilla JS                              |
| Backend  | Vercel serverless functions (Node.js)              |
| AI       | Claude Sonnet 5.5 (vision + structured JSON output) |
| Hosting  | Vercel Hobby (free)                                |

## Run it locally

**You need:** Node.js 20 or newer, and an Anthropic API key from [platform.claude.com](https://platform.claude.com).

```bash
git clone https://github.com/DinikaKC/OutfitRecco.git
cd OutfitRecco
npm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY and APP_PASSCODE
npm run dev
```

Open http://localhost:3000 and enter your passcode.

**Try it without an API key:** `npm run dev -- --mock` uses canned answers from `tests/fixtures`, so you can click through the whole app for free. The passcode is `test`.

## Deploy to Vercel

1. Set a monthly spend limit on your Anthropic account first.
2. Install the CLI and deploy:
   ```bash
   npm i -g vercel
   vercel                          # links the project; accept the defaults
   vercel env add ANTHROPIC_API_KEY
   vercel env add APP_PASSCODE
   vercel --prod
   ```
   Or import the GitHub repo in the Vercel dashboard and add the two environment variables there. Every push to `main` then deploys automatically.

If `APP_PASSCODE` isn't set, the API refuses every request.

The Hobby plan is free for personal, non-commercial use. Functions can run for up to 300 seconds, which is plenty.

## Project structure

```
├── public/               # Static site
│   ├── index.html
│   ├── app.js            # Upload, quiz, piece review and results
│   ├── styles.css
│   └── quiz-options.js   # Quiz questions (shared with the API)
├── api/
│   ├── inventory.js      # Photos → pieces
│   ├── recommend.js      # Pieces + quiz → outfits
│   └── verify.js         # Passcode check
├── lib/
│   ├── claude.js         # Claude API call with a JSON schema
│   ├── wardrobe.js       # Duplicate merging and outfit checks
│   ├── schemas.js        # JSON schemas for both calls
│   └── http.js           # Passcode and request helpers
├── prompts/              # The two system prompts
├── scripts/dev-server.js # Local server that mimics Vercel
└── tests/                # node --test
```

## Tweaking the prompts

The prompts live in `prompts/` as plain Markdown, so you can test them in the Claude Console playground and paste improvements straight back. The JSON shape is fixed by `lib/schemas.js`.

## Tests

```bash
npm test
```

Covers duplicate merging, outfit checks, the retry, passcode handling and input validation, using a fake Claude client.

## Tips for better results

- Separate photos work better than one collage, because a collage gets shrunk and fine prints blur.
- Make sure every piece is visible. Layered items, such as a top under a jacket, are easily missed.
- Check the merged pieces on the review screen before getting outfits.

## Roadmap

- [ ] Footwear
- [ ] Remember the last upload (IndexedDB)
- [ ] Generated images for "Worth looking for" ideas
- [ ] Auto-fill weather from location
