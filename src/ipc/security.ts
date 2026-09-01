export const isTrustedSenderUrl = (
  senderUrl: string,
  developmentUrl: string | undefined,
  productionUrl: string,
): boolean => {
  if (developmentUrl === undefined) return senderUrl === productionUrl;
  try {
    const sender = new URL(senderUrl);
    const development = new URL(developmentUrl);
    return sender.origin === development.origin;
  } catch {
    return false;
  }
};
