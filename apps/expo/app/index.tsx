/**
 * Onboarding gate — mirrors Swift ContentView.swift's AppStorage condition.
 * Uses the MMKV-backed preferences store so the gate paints synchronously
 * on warm starts (aniseekr-expo CLAUDE.md rule 10 — no skeleton flash).
 */
import { Redirect } from 'expo-router';

import { destinationForOnboardingState } from '@/navigation/primaryTabs';
import { usePreferences } from '@/settings/preferences';

export default function Index() {
  const completed = usePreferences((s) => s.hasCompletedOnboarding);
  return <Redirect href={destinationForOnboardingState(completed)} />;
}
