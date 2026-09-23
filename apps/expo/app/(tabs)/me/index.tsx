import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeProfileGate, MeProfilePage } from '@/components/me';
import { useProfileStore } from '@/profile/store';
import { preparePageDesign, usePageDesignStore } from '@/page/pageDesignStore';

export default function MeTab() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ addProof?: string }>();
  const record = useProfileStore((state) => state.record);
  const jws = useProfileStore((state) => state.jws);
  const status = useProfileStore((state) => state.status);
  const linkVisibility = useProfileStore((state) => state.linkVisibility);
  // T7: the QR / URL-fragment share surface publishes the SHARED projection
  // (public + link-only links), never the full record. Falls back to the full
  // record for a pre-T7 profile that has no cached projection yet — safe, as
  // such a profile has no private links.
  const shared = useProfileStore((state) => state.shared);
  const published = useProfileStore((state) => state.published);
  const nostrPublishedJws = useProfileStore((state) => state.nostrPublishedJws);
  const shareRecord = shared?.record ?? record;
  const shareJws = shared?.jws ?? jws;
  const nostrShortUrlReady = published !== null && nostrPublishedJws === published.jws;
  const addProofRequested = params.addProof === '1';
  const pageDesignStatus = usePageDesignStore((state) => state.status);
  const adoptPublishedPage = usePageDesignStore((state) => state.adoptPublishedPage);
  const openAddProof = useCallback(() => {
    router.push('/passport');
  }, []);

  useEffect(() => {
    if (!addProofRequested || status !== 'ready') return;
    router.setParams({ addProof: '0' });
    openAddProof();
  }, [addProofRequested, openAddProof, status]);

  useEffect(() => {
    if (pageDesignStatus !== 'loading') return;
    void preparePageDesign();
  }, [pageDesignStatus]);

  useEffect(() => {
    if (pageDesignStatus !== 'ready' || !record) return;
    adoptPublishedPage(record.page);
  }, [adoptPublishedPage, pageDesignStatus, record]);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      {status === 'ready' && record && jws && shareRecord && shareJws ? (
        <MeProfilePage
          record={record}
          jws={jws}
          linkVisibility={linkVisibility}
          publicRecord={published?.record ?? record}
          publicPage={published ? { record: published.record, jws: published.jws } : null}
          shareRecord={shareRecord}
          shareJws={shareJws}
          nostrShortUrlReady={nostrShortUrlReady}
          bottomInset={insets.bottom}
          onEdit={() => {
            router.push('/me/edit');
          }}
          onEditAvatar={() => {
            router.push({ pathname: '/me/edit', params: { avatar: '1' } });
          }}
          onAddLink={() => {
            router.push({ pathname: '/me/edit', params: { add: '1' } });
          }}
          onImportLinks={() => {
            router.push({ pathname: '/me/edit', params: { importLinks: '1' } });
          }}
          onOpenSettings={() => {
            router.push('/settings');
          }}
          onOpenBindings={() => {
            openAddProof();
          }}
        />
      ) : (
        <MeProfileGate
          onCreatePage={() => {
            router.push('/me/edit');
          }}
          onSetUpIdentity={() => {
            router.push('/onboarding?replay=1');
          }}
        />
      )}
    </View>
  );
}
