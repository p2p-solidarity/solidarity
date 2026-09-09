import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Colors } from '@/constants/Colors';

import { ContactRow, type ContactRowProps } from './ContactRow';

/**
 * Compatibility name for the manifest-backed contact row. The v3 Contacts
 * surface deliberately removes the legacy avatar/job/radar treatment and
 * keeps only name, real source context, selection state, and a chevron.
 */
export type TrustGraphContactRowProps = ContactRowProps;

export function TrustGraphContactRow(props: TrustGraphContactRowProps): ReactNode {
  return (
    <View
      style={{
        borderRadius: 0,
        borderBottomWidth: 0.5,
        borderBottomColor: Colors.divider,
      }}
    >
      <ContactRow {...props} />
    </View>
  );
}
