// Matches strings that contain only emoji (including skin tone modifiers, ZWJ sequences, keycap sequences, flags)
export const EMOJI_ONLY_RE = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Regional_Indicator}{2}|[\u200d\uFE0F]|\d\uFE0F?\u20E3)+$/u

export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim()
  // Up to ~12 emoji characters to avoid huge text on long strings
  return trimmed.length > 0 && trimmed.length <= 30 && EMOJI_ONLY_RE.test(trimmed)
}
