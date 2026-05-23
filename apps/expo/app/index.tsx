/**
 * Onboarding gate — mirrors Swift ContentView.swift conditional based on
 * AppStorage("hasCompletedOnboarding"). Replaced here with a sync MMKV
 * lookup (initialised in app/_layout.tsx) so the gate doesn't flash a
 * skeleton on warm starts (aniseekr-expo CLAUDE.md rule 10).
 *
 * Until MMKV is bootstrapped from the layout, we redirect to onboarding by
 * default. Once Phase 1's storage layer is wired into the layout, replace
 * the placeholder with `getMmkv().getBoolean('hasCompletedOnboarding')`.
 */
import { Redirect } from 'expo-router';

export default function Index() {
  // TODO(Phase 5c): read MMKV-backed onboarding flag synchronously here.
  const completed = false;
  return <Redirect href={completed ? '/(tabs)/people' : '/onboarding'} />;
}
