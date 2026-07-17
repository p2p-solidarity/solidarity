/**
 * `router.back()` that can never dispatch an unhandled GO_BACK: with no
 * history behind the current screen (deep-link entry, a stack replaced
 * after onboarding, state restoration) it REPLACES to `fallback` instead
 * of firing a warning no-op that strands the user.
 *
 * Default fallback is the root gate (`/`, `app/index.tsx`), which routes
 * onboarded users to the tabs and fresh installs to onboarding. Settings
 * sub-pages pass `'/settings'` so a stranded back lands on their hub.
 */
import { router, type Href } from 'expo-router';

export function safeBack(fallback: Href = '/'): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}
