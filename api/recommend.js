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

// POST { quiz: { occasion, mood, weather, time, priority }, items: [...] } → { outfits, ideas, items }
export default async function handler(req, res) {
  const body = readJsonPost(req, res);
  if (!body || !checkPasscode(req, res)) return;

  const quiz = readQuiz(body.quiz);
  if (quiz.error) return sendError(res, 400, quiz.error);

  const clean = sanitizeClientItems(body.items);
  if (clean.error) return sendError(res, 400, clean.error);

  // Flagged duplicates are merged here unless the user chose "Keep separate".
  const items = mergeDuplicates(clean.items);
  if (!canMakeOutfit(items)) {
    return sendError(res, 422, "Add at least one dress or one-piece, or at least one top and one bottom.");
  }

  const system = loadPrompt("recommend");
  const baseContent = formatRequest(quiz.answers, items);

  try {
    let result = await askForJson({ system, content: baseContent, schema: recommendSchema });
    let checked = checkRecommendation(result, items);

    // One retry, telling the model exactly what was wrong. Keep whichever answer is better.
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
        if (checked.outfits.length === 0) throw err;
      }
    }

    if (checked.outfits.length === 0 && checked.errors.length > 0) {
      return sendError(res, 502, "The AI couldn't build valid outfits. Try again.");
    }

    const { outfits, ideas } = withNamesInText(checked, items);
    return res.status(200).json({ outfits, ideas, items });
  } catch (err) {
    if (err instanceof ModelError) return sendError(res, err.status, err.message);
    console.error(err);
    return sendError(res, 500, "Something went wrong while picking outfits.");
  }
}

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

function formatRequest(answers, items) {
  const quizLines = Object.entries(answers).map(([key, value]) => `${key}: ${value}`).join("\n");
  const inventory = items.map(({ id, name, type, color, pattern, description, formality, seen_in }) => ({
    id, name, type, color, pattern, description, formality, seen_in,
  }));
  return `<quiz>\n${quizLines}\n</quiz>\n\n<inventory>\n${JSON.stringify(inventory, null, 1)}\n</inventory>`;
}
