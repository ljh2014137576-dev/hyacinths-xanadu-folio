export function recoverableBrokenFile(input: string): string {
  if (input.length > 0) {
    return input;
  // Deliberate syntax error: the adapter must report partial diagnostics and continue.
}
