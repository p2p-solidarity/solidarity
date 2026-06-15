/**
 * FieldPillRow — 1:1 port of Swift SharingTabView.fieldPills.
 * Wraps the enabled-field pill labels in a flexbox row; each pill is
 * 12pt medium text on pillBg, 1pt pillBorder, corner radius 4.
 *
 * Sort order mirrors Swift BusinessCardField.sortOrder:
 *   Name → Title → Company → Email → Phone → Profile → Social → Skills
 */
import { Text, View } from 'react-native';

import { Colors } from '@/constants/Colors';

export type EnabledField =
  | 'name'
  | 'title'
  | 'company'
  | 'email'
  | 'phone'
  | 'profileImage'
  | 'socialNetworks'
  | 'skills';

const SORT_ORDER: Readonly<Record<EnabledField, number>> = {
  name: 0,
  title: 1,
  company: 2,
  email: 3,
  phone: 4,
  profileImage: 5,
  socialNetworks: 6,
  skills: 7,
};

const SHORT_LABEL: Readonly<Record<EnabledField, string>> = {
  name: 'Name',
  title: 'Title',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  profileImage: 'Profile',
  socialNetworks: 'Social',
  skills: 'Skills',
};

export function FieldPillRow({ fields }: { fields: readonly EnabledField[] }) {
  const sorted = [...fields].sort((a, b) => SORT_ORDER[a] - SORT_ORDER[b]);
  return (
    <View className="flex-row flex-wrap" style={{ gap: 6 }}>
      {sorted.map((f) => (
        <View
          key={f}
          className="rounded bg-pillBg"
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderWidth: 1,
            borderColor: Colors.pillBorder,
          }}
        >
          <Text className="text-text2 text-[12px] font-medium">
            {SHORT_LABEL[f]}
          </Text>
        </View>
      ))}
    </View>
  );
}
