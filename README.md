# OutfitRecco

Pick outfits from clothes you already own.

Upload photos of your wardrobe, answer five quick questions, and get outfit suggestions built from your own pieces. You also get a couple of pieces worth looking for, with links to find similar ones.

## Features

- **Photos, PDFs or Word files:** upload up to 30 pictures: photos, collages, PDF pages or the pictures inside a Word (.docx) file. The AI splits every look into separate pieces.
- **Pictures of your pieces:** the AI marks where each look is in your photos, and the app cuts it out, so pieces and outfits are shown with your own photos, not just names.
- **Duplicates merged by default:** when the same piece shows up in several photos, it counts once. Tap **Keep separate** if the AI guessed wrong.
- **Editable pieces:** untick anything you don't want to wear, change a piece's type, or add a missing one.
- **5-question quiz:** occasion, mood, weather, time of day, and comfort vs. statement.
- **From your wardrobe:** up to 3 outfits, each with a picture board, why it works and a styling tip. Pairs you've already worn together are marked.
- **Worth looking for:** 2 pieces you may not own, the closest thing you do own, and search links.
- **No accounts, no database:** photos go to the AI for analysis and aren't stored.
- **Passcode protected:** every API call needs the passcode, so nobody else can spend your API credits.

## How it works

```
Photos, PDFs, Word ──► pictures ──► /api/inventory ──► pieces + look boxes ─┐
                                                                             ├──► /api/recommend ──► outfits
Quiz answers ────────────────────────────────────────────────────────────────┘
```

1. The browser turns every file into pictures: PDF pages are drawn with [pdf.js](https://mozilla.github.io/pdf.js/) (loaded from jsDelivr only when you pick a PDF), and the pictures inside a Word file are read straight from the file. Old `.doc` files aren't supported.
2. The browser shrinks the pictures (to stay under Vercel's 4.5 MB request limit, and within the size Claude reads without resizing) and sends them to `/api/inventory`. This runs while you take the quiz. Claude returns the pieces plus a pixel box around every look; the browser uses the boxes to cut out a picture of each look.
3. You review the pieces. Flagged duplicates are merged unless you choose **Keep separate**.
4. `/api/recommend` merges duplicates, asks Claude for outfits as JSON, and checks every outfit in code: real item ids, valid shapes (one one-piece, or a top plus a bottom, with an optional layer) and no repeats. If anything breaks the rules, it asks once more with the problems listed.

## Tech stack

| Layer    | Choice                                             |
|----------|----------------------------------------------------|
| Frontend | HTML, CSS, vanilla JS                              |
| Backend  | Vercel serverless functions (Node.js)              |
| AI       | Claude Sonnet 5.5 (vision + structured JSON output) |
| Hosting  | Vercel Hobby (free)                                |

## Run it locally (VS Code)

**You need:** Node.js 20.12 or newer. For real AI answers you also need an Anthropic API key from [platform.claude.com](https://platform.claude.com).

1. Open the project folder in VS Code, then open a terminal with **Terminal → New Terminal**.
2. Install the dependencies (once, and again whenever `package.json` changes):
   ```bash
   npm install
   ```
   This creates the `node_modules` folder. It isn't in the repo, so skipping this step gives `Cannot find package '@anthropic-ai/sdk'`.
3. Try the app for free with canned answers:
   ```bash
   npm run dev -- --mock
   ```
   Open http://localhost:3000. The passcode is `test`. Stop the server with **Ctrl+C**.

   In this mode the app shows a **Demo mode** banner: the pieces and outfits are always the same saved sample answers, whatever you upload. Use it to try the screens, not to judge the AI.
4. For real answers, create your `.env` file and fill in both values:
   ```bash
   cp .env.example .env
   ```
   Then run `npm run dev` (without `--mock`) and use the passcode you chose.

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
│   ├── file-import.js    # PDFs and Word files → pictures
│   ├── config.js         # Picture limits (shared with the API)
│   └── quiz-options.js   # Quiz questions (shared with the API)
├── api/
│   ├── inventory.js      # Pictures → pieces and look boxes
│   ├── recommend.js      # Pieces + quiz → outfits
│   └── verify.js         # Passcode check
├── lib/
│   ├── claude.js         # Claude API call with a JSON schema
│   ├── wardrobe.js       # Clean-up, duplicate merging and outfit checks
│   ├── schemas.js        # JSON schemas for both calls
│   └── http.js           # Passcode and request helpers
├── prompts/              # The two system prompts
├── scripts/dev-server.js # Local server that mimics Vercel
└── tests/                # node --test
```

## Settings you can change

| What | Where |
|------|-------|
| Quiz questions and answers | `public/quiz-options.js` |
| What the AI is told to do | `prompts/inventory.md`, `prompts/recommend.md` |
| Model, effort, `max_tokens`, timeouts | top of `lib/claude.js` (the model can also be set with `ANTHROPIC_MODEL` in `.env`) |
| How many pictures, and the image size sent to Claude | `public/config.js` |
| Upload size budget | top of `public/app.js` |
| API key and passcode | `.env` locally, Vercel's environment variables when deployed |

Nothing about your wardrobe is hard-coded. The files in `tests/fixtures` are saved example answers used only by the tests and `--mock` mode.

## Tweaking the prompts

The prompts live in `prompts/` as plain Markdown, so you can test them in the Claude Console playground and paste improvements straight back. The JSON shape is fixed by `lib/schemas.js`.

## Tests

```bash
npm test
```

Covers duplicate merging, outfit checks, look boxes, reading Word files, the retry, passcode handling and input validation, using a fake Claude client.

## Tips for better results

- Separate photos work better than one collage, because a collage gets shrunk and fine prints blur. A Word file with one picture per look works well for the same reason; a PDF is read page by page, like a collage.
- Make sure every piece is visible. Layered items, such as a top under a jacket, are easily missed.
- Check the merged pieces on the review screen before getting outfits.

## Roadmap

- [ ] Footwear
- [ ] Remember the last upload (IndexedDB)
- [ ] AI-generated outfit pictures (needs an image-generation model; Claude reads images but doesn't create them)
- [ ] Auto-fill weather from location
