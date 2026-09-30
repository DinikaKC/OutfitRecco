// api/recommend.js  →  POST /api/recommend
// Step 2 of the app: picks outfits from the user's pieces for their quiz answers.
//
// Request:  { quiz: { occasion, mood, weather, time, priority }, items: [ pieces after the user's edits ] }
// Response: { outfits: [...], ideas: [...], items: [ the merged pieces, for showing names ] }
//
// Flow: validate → merge duplicates → ask Claude → check the answer in code
//       → if broken, ask once more listing the problems → send the valid outfits back.

import { QUIZ } from "../public/quiz-options.js";
import { askForJson, loadPrompt, ModelError } from "../lib/claude.js";
import { checkPasscode, readJsonPost, sendError } from "../lib/http.js";
import { recommendSchema } from "../lib/schemas.js";
import {
  canMakeOutfit,
  checkRecommendation,
  mergeDuplicates,
  sanitizeClientItems,
  withNamesInText,
} from "../lib/wardrobe.js";

export default async function handler(req, res) {
  // 1. Only POST, only with the right passcode.
  const body = readJsonPost(req, res);
  if (!body || !checkPasscode(req, res)) return;

  // 2. Every quiz answer must be one of the options in public/quiz-options.js.
  const quiz = readQuiz(body.quiz);
  if (quiz.error) return sendError(res, 400, quiz.error);

  // 3. Re-check the pieces the browser sent (the user may have renamed, added or retyped some).
  const clean = sanitizeClientItems(body.items);
  if (clean.error) return sendError(res, 400, clean.error);

  // 4. Flagged duplicates are merged here unless the user chose "Keep separate".
  const items = mergeDuplicates(clean.items);
  if (!canMakeOutfit(items)) {
    return sendError(res, 422, "Add at least one dress or one-piece, or at least one top and one bottom.");
  }

  const system = loadPrompt("recommend"); // the stylist rules, in prompts/recommend.md
  const baseContent = formatRequest(quiz.answers, items);

  try {
    // 5. First attempt.
    let result = await askForJson({ system, content: baseContent, schema: recommendSchema });
    let checked = checkRecommendation(result, items);

    // 6. If any outfit broke the rules, try once more, telling the AI exactly what was wrong.
    //    Keep whichever attempt produced more valid outfits.
    if (checked.errors.length > 0) {
      const retryContent =
        `${baseContent}\n\n<previous_answer>\n${JSON.stringify(result)}\n</previous_answer>\n\n` +
        `<problems>\n${checked.errors.map((e) => `- ${e}`).join("\n")}\n</problems>\n\n` +
        "Your previous answer broke the rules above. Return a complete, corrected answer.";
      try {
        result = await askForJson({ system, content: retryContent, schema: recommendSchema });
        const retried = checkRecommendation(result, items);
        if (retried.outfits.length >= checked.outfits.length) checked = retried;
      } catch (err) {
        // The retry failed, but the first attempt still had some valid outfits: use those.
        if (checked.outfits.length === 0) throw err;
      }
    }

    // Nothing valid after two attempts.
    if (checked.outfits.length === 0 && checked.errors.length > 0) {
      return sendError(res, 502, "The AI couldn't build valid outfits. Try again.");
    }

    // 7. Swap any stray ids in the text for names, and send the result.
    const { outfits, ideas } = withNamesInText(checked, items);
    return res.status(200).json({ outfits, ideas, items });
  } catch (err) {
    if (err instanceof ModelError) return sendError(res, err.status, err.message);
    console.error(err);
    return sendError(res, 500, "Something went wrong while picking outfits.");
  }
}

// Returns { answers } if every question has a valid answer, otherwise { error }.
function readQuiz(input) {
  const answers = {};
  for (const question of QUIZ) {
    const value = input?.[question.key];
    if (!question.options.some((option) => option.value === value)) {
      return { error: `Answer the "${question.question}" question.` };
    }
    answers[question.key] = value;
  }
  return { answers };
}

// Builds the user message the AI sees, for example:
//   <quiz>
//   occasion: casual outing
//   mood: playful
//   ...
//   </quiz>
//   <inventory>
//   [ { "id": "i5", "name": "Black skinny jeans", "type": "bottom", ... } ]
//   </inventory>
// Only the fields that help with styling are sent, to keep the request small.
function formatRequest(answers, items) {
  const quizLines = Object.entries(answers).map(([key, value]) => `${key}: ${value}`).join("\n");
  const inventory = items.map(({ id, name, type, color, pattern, description, formality, seen_in }) => ({
    id, name, type, color, pattern, description, formality, seen_in,
  }));
  return `<quiz>\n${quizLines}\n</quiz>\n\n<inventory>\n${JSON.stringify(inventory, null, 1)}\n</inventory>`;
}
