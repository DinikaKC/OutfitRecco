// public/quiz-options.js
// The quiz questions and their allowed answers. Edit this file to change the quiz.
// It's shared by the browser (app.js renders the questions from it) and the API
// (api/recommend.js rejects any answer that isn't listed here).
//
//   key:      the name the answer is sent under
//   question: the heading shown on screen
//   value:    what the AI receives (keep it plain English)
//   label:    what the button shows

export const QUIZ = [
  {
    key: "occasion",
    question: "Where are you headed?",
    options: [
      { value: "office", label: "Office" },
      { value: "casual outing", label: "Casual outing" },
      { value: "date", label: "Date" },
      { value: "party", label: "Party" },
      { value: "festive or traditional event", label: "Festive / traditional" },
      { value: "travel", label: "Travel day" },
    ],
  },
  {
    key: "mood",
    question: "How do you want to feel?",
    options: [
      { value: "confident", label: "Confident" },
      { value: "cozy", label: "Cozy" },
      { value: "playful", label: "Playful" },
      { value: "minimal", label: "Minimal" },
      { value: "bold", label: "Bold" },
    ],
  },
  {
    key: "weather",
    question: "What's the weather like?",
    options: [
      { value: "hot and humid", label: "Hot & humid" },
      { value: "rainy", label: "Rainy" },
      { value: "mild", label: "Mild" },
      { value: "cold", label: "Cold" },
    ],
  },
  {
    key: "time",
    question: "What time of day?",
    options: [
      { value: "morning", label: "Morning" },
      { value: "afternoon", label: "Afternoon" },
      { value: "evening", label: "Evening" },
      { value: "night", label: "Night" },
    ],
  },
  {
    key: "priority",
    question: "Comfort or statement?",
    options: [
      { value: "comfort", label: "All comfort" },
      { value: "balanced", label: "A bit of both" },
      { value: "statement", label: "Make a statement" },
    ],
  },
];
