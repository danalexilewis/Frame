export function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

export function formatCodeBlock(text: string): string {
  return `\`\`\`\n${text}\n\`\`\``;
}

export function formatCliError(error: unknown, label = "Error"): string {
  return `${label}:\n${formatCodeBlock(normalizeError(error))}`;
}

export function formatCliMessage(label: string, message: string): string {
  return `${label}:\n${formatCodeBlock(message)}`;
}
