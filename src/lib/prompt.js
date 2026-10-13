// The AI prompt is a fixed template; the builder only fills in the blanks.
// It runs in the browser, so it costs nothing.

export const SUBJECTS = [
  { id: 'language', label: 'A language' },
  { id: 'science', label: 'Science' },
  { id: 'history', label: 'History' },
  { id: 'math', label: 'Math' },
  { id: 'other', label: 'Something else' },
];

/** Front/back presets per subject: [front, back, what the front holds, what the back holds, example front, example back] */
export const SIDE_PRESETS = {
  language: [
    { a: '{known}', b: '{learning}', da: 'a word or short phrase in {known}', db: 'the same in {learning}', ea: 'How do you get to work?', eb: '…' },
  ],
  science: [
    { a: 'Term', b: 'Definition', da: 'a scientific term', db: 'a short definition in a few words', ea: 'Photosynthesis', eb: 'How plants turn light into energy' },
    { a: 'Question', b: 'Answer', da: 'a short question', db: 'a short answer', ea: 'Powerhouse of the cell?', eb: 'Mitochondria' },
  ],
  history: [
    { a: 'Event', b: 'Year', da: 'a historical event', db: 'the year it happened', ea: 'Fall of the Berlin Wall', eb: '1989' },
    { a: 'Person', b: 'Known for', da: 'a historical figure', db: 'what they are known for, in a few words', ea: 'Ada Lovelace', eb: 'First computer program' },
  ],
  math: [
    { a: 'Problem', b: 'Answer', da: 'a short problem', db: 'the answer only', ea: '12 × 7', eb: '84' },
    { a: 'Formula', b: 'Name', da: 'a formula written in plain text', db: 'its name', ea: 'a² + b² = c²', eb: 'Pythagorean theorem' },
  ],
  other: [
    { a: 'Question', b: 'Answer', da: 'a short question', db: 'a short answer', ea: '…', eb: '…' },
    { a: 'Term', b: 'Definition', da: 'a term', db: 'a short definition', ea: '…', eb: '…' },
  ],
};

export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const SIZES = [20, 50, 100];

const fill = (s, v) => s.replace(/\{known\}/g, v.known || 'English').replace(/\{learning\}/g, v.learning || 'Dutch');

export function describeTopic(v) {
  if (v.subject === 'language') return `${v.learning || 'a new language'} for someone who speaks ${v.known || 'English'}`;
  const subject = SUBJECTS.find((s) => s.id === v.subject)?.label ?? '';
  const topic = v.topic?.trim();
  if (v.subject === 'other') return topic || 'a topic of my choice';
  return topic ? `${subject}: ${topic}` : subject;
}

export function buildPrompt(v) {
  const a = v.front.trim();
  const b = v.back.trim();
  const altRule = v.alternatives
    ? `- If more than one answer is right for "${b}", put them all in the same cell separated by a vertical bar, like: answer one|answer two`
    : `- Give exactly one answer in "${b}".`;

  return [
    `Make ${v.count} flashcards for learning ${describeTopic(v)}. Level: ${v.level.toLowerCase()}.`,
    ...(v.focus?.trim() ? [`Focus on: ${v.focus.trim()}.`] : []),
    '',
    'Each flashcard has two sides:',
    `- Front ("${a}"): ${v.frontHint || 'the prompt'}.`,
    `- Back ("${b}"): ${v.backHint || 'the answer'}. Keep it short enough to type from memory.`,
    '',
    'Reply with only a CSV inside one code block, and nothing else:',
    `- The first row is exactly: ${csvCell(a)},${csvCell(b)}`,
    '- Then one flashcard per row, exactly two columns.',
    '- Wrap a cell in double quotes if it contains a comma.',
    altRule,
    '- No numbering, no explanations, no repeated fronts.',
    '- Check that every answer is correct.',
  ].join('\n');
}

const csvCell = (s) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Starting values for the front/back step when a subject is chosen. */
export function presetFor(subject, v, index = 0) {
  const p = (SIDE_PRESETS[subject] ?? SIDE_PRESETS.other)[index];
  return {
    front: fill(p.a, v),
    back: fill(p.b, v),
    frontHint: fill(p.da, v),
    backHint: fill(p.db, v),
    exampleFront: p.ea,
    exampleBack: p.eb,
  };
}

/**
 * The same request for Alle's own AI (api/generate-deck.js): no CSV formatting,
 * the cards come back as structured data through a tool call.
 */
export function buildAppPrompt(v) {
  const a = v.front.trim();
  const b = v.back.trim();
  return [
    `Make ${v.count} flashcards for learning ${describeTopic(v)}. Level: ${v.level.toLowerCase()}.`,
    ...(v.focus?.trim() ? [`Focus on: ${v.focus.trim()}.`] : []),
    '',
    'Each flashcard has two sides:',
    `- Front ("${a}"): ${v.frontHint || 'the prompt'}.`,
    `- Back ("${b}"): ${v.backHint || 'the answer'}. Keep it short enough to type from memory.`,
    '',
    v.alternatives
      ? `- If more than one answer is right for "${b}", put them all in the back separated by a vertical bar, like: answer one|answer two`
      : `- Give exactly one answer on the back.`,
    '- No numbering, no explanations, no repeated fronts.',
    '- Check that every answer is correct.',
    '',
    'Save the flashcards with the save_flashcards tool.',
  ].join('\n');
}
