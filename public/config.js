// public/config.js
// Limits shared by the browser (public/app.js) and the API (api/inventory.js),
// so the two can't drift apart. Change them here only.

// Most pictures one inventory request may contain. A PDF counts one picture per page,
// and a Word file one picture per image inside it. More pictures means a slower,
// pricier inventory call (roughly 1,000 to 5,000 input tokens per picture).
export const MAX_PICTURES = 30;

// The largest picture Claude reads without shrinking it first (Sonnet 5.5 and other
// Claude 4.7+ models). The browser keeps every picture within these limits, so the
// look boxes Claude returns are in the same pixels as the picture we hold.
// If you switch ANTHROPIC_MODEL to an older model such as Haiku 4.5, set both to 1568.
export const CLAUDE_MAX_EDGE = 2576;
export const CLAUDE_MAX_IMAGE_TOKENS = 4784; // Claude counts ⌈width/28⌉ × ⌈height/28⌉ tokens per image
