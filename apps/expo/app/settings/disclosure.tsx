/**
 * Selective disclosure settings — mirrors Swift SelectiveDisclosureSettingsView.
 * Per-field toggles for each sharing level (public / professional / personal).
 */
import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { ThemedSurface, ThemedText } from '@/components/themed';
import { businessCardFieldSchema, type BusinessCardField } from '@solidarity/shared';

const LEVELS = ['public', 'professional', 'personal'] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_LABEL: Readonly<Record<Level, string>> = {
  public: 'Public',
  professional: 'Professional',
  personal: 'Personal',
};

const FIELDS = businessCardFieldSchema.options;

const DEFAULTS: Readonly<Record<Level, ReadonlySet<BusinessCardField>>> = {
  public: new Set(['name']),
  professional: new Set(['name', 'title', 'company', 'email']),
  personal: new Set(['name', 'email', 'phone']),
};

export default function DisclosureSettings() {
  const [matrix, setMatrix] = useState<Record<Level, Set<BusinessCardField>>>({
    public: new Set(DEFAULTS.public),
    professional: new Set(DEFAULTS.professional),
    personal: new Set(DEFAULTS.personal),
  });

  const toggle = (level: Level, field: BusinessCardField) => {
    setMatrix((prev) => {
      const next = new Set(prev[level]);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return { ...prev, [level]: next };
    });
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Selective disclosure</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          Choose which fields you share at each level. Changes apply to
          future exchanges only.
        </ThemedText>
      </View>

      {LEVELS.map((level) => (
        <View key={level} className="mt-4">
          <ThemedText variant="caption" tone="tertiary" className="mx-4 mb-1">
            {LEVEL_LABEL[level].toUpperCase()}
          </ThemedText>
          {FIELDS.map((field) => (
            <ThemedSurface
              key={`${level}-${field}`}
              variant="card"
              padded
              className="mx-4 mt-1 flex-row items-center justify-between"
            >
              <ThemedText variant="bodyLarge">{field}</ThemedText>
              <Switch
                value={matrix[level].has(field)}
                onValueChange={() => { toggle(level, field); }}
              />
            </ThemedSurface>
          ))}
        </View>
      ))}

      <View className="h-10" />
    </ScrollView>
  );
}
