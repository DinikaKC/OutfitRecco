// Quiz questions and allowed answers.
// Shared by the browser (to render the quiz) and the API (to validate answers).

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
