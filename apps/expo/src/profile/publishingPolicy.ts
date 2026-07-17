/** Public publishing is opt-in. This only permits automatic updates after a
 * profile already carries a public Nostr claim and the user enabled the
 * preference explicitly. */
export function shouldAutoRepublish(
  isAlreadyPublished: boolean,
  autoRepublishEnabled: boolean,
): boolean {
  return isAlreadyPublished && autoRepublishEnabled;
}
