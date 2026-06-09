export const MAX_SOURCE_MATERIAL_FILE_BYTES = 2_500_000;
export const MAX_SOURCE_MATERIAL_IMAGE_FILE_BYTES = 10_000_000;
export const MAX_SOURCE_MATERIAL_BASE64_CHARS = Math.ceil(MAX_SOURCE_MATERIAL_IMAGE_FILE_BYTES / 3) * 4;
export const MAX_SOURCE_MATERIAL_TEXT_CHARS = 80_000;
export const MAX_SOURCE_MATERIAL_AGENT_PROMPT_CHARS = 32_000;

export const SUPPORTED_SOURCE_MATERIAL_MEDIA_TYPES = [
  "application/json",
  "application/pdf",
  "application/x-ndjson",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/x-markdown",
] as const;

export const SUPPORTED_SOURCE_MATERIAL_EXTENSIONS = [
  ".csv",
  ".gif",
  ".jpeg",
  ".jpg",
  ".json",
  ".log",
  ".md",
  ".markdown",
  ".pdf",
  ".png",
  ".text",
  ".txt",
  ".webp",
] as const;

export const DEFAULT_PASTE_SOURCE_NAME = "Pasted source material";
export const DEFAULT_FILE_SOURCE_NAME = "Uploaded source material";
