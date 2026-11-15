export const AI_CAPTION_SERVICES = [
  { id: "interior-cleaning", label: "Химчистка салона" },
  { id: "paint-polishing", label: "Полировка кузова" },
  { id: "ceramic-coating", label: "Керамическое покрытие" },
  { id: "detailing-wash", label: "Детейлинг-мойка" },
  { id: "glass-protection", label: "Защита стёкол" },
  { id: "headlight-restoration", label: "Восстановление фар" },
  { id: "leather-care", label: "Уход за кожаным салоном" },
  { id: "general-detailing", label: "Автодетейлинг" },
];

export const AI_CAPTION_TONES = [
  { id: "professional", label: "Профессиональный" },
  { id: "friendly", label: "Дружелюбный" },
  { id: "energetic", label: "Энергичный" },
];

export const AI_CAPTION_LANGUAGES = [
  { id: "ru", label: "Русский", instruction: "русском языке" },
  { id: "ro", label: "Română", instruction: "румынском языке" },
];

export const AI_CAPTION_STYLES = [
  { id: "process", label: "Показать процесс" },
  { id: "transformation", label: "Показать результат" },
  { id: "expertise", label: "Полезный совет" },
];

export function normalizeAiCaptionOutput(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Gemini вернул некорректный результат");
  }
  const caption = typeof value.caption === "string" ? value.caption.trim() : "";
  if (!caption || caption.length > 700) {
    throw new Error("Gemini вернул пустое или слишком длинное описание");
  }
  if (!Array.isArray(value.hashtags)) {
    throw new Error("Gemini вернул некорректные хэштеги");
  }
  const hashtags = value.hashtags
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.trim().replace(/^#*/, "#"))
    .filter((tag) => /^#[\p{L}\p{N}_]{2,40}$/u.test(tag))
    .slice(0, 8);
  return { caption, hashtags };
}
