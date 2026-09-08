import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('unfinished action honesty', () => {
  it('routes group legal rows to the existing legal pages', () => {
    const settings = source('../../app/settings/groups.tsx');

    expect(settings).toContain("router.push('/legal/privacy')");
    expect(settings).toContain("router.push('/legal/terms')");
    expect(settings).not.toContain('privacyToast');
    expect(settings).not.toContain('termsToast');
  });

  it('does not expose group credential issuance before signing and delivery exist', () => {
    const entry = source('../../src/components/groups/GroupVCIssuanceSection.tsx');
    const canonicalRoute = source('../../app/groups/[id]/issue-vc.tsx');
    const legacyRoute = source('../../app/credentials/issue.tsx');

    expect(entry).not.toContain("pathname: '/groups/[id]/issue-vc'");
    expect(entry).toContain('disabled');
    expect(entry).toContain("t('groupIssue.unavailableReason')");
    expect(canonicalRoute).toContain("t('groupIssue.unavailableReason')");
    expect(canonicalRoute).not.toContain('fakeResults');
    expect(canonicalRoute).not.toContain('setTimeout');
    expect(legacyRoute).not.toContain('unsigned.placeholder.jwt');
    expect(legacyRoute).not.toContain('addCredential');
  });

  it('does not advertise a group invite that no route can redeem', () => {
    const detail = source('../../app/groups/[id].tsx');
    const sections = source('../../src/components/groups/GroupDetailSections.tsx');

    expect(detail).not.toContain('<InviteSection');
    expect(sections).not.toContain('solidarity://groups/join?gid=');
  });

  it('persists the creator member and awaits group mutations before success UI', () => {
    const create = source('../../app/groups/new.tsx');
    const detail = source('../../app/groups/[id].tsx');
    const settings = source('../../app/settings/groups.tsx');

    expect(create).toContain('await upsertMember({');
    expect(create).toContain('role: \'owner\'');
    expect(create).toContain('commitment: commitment ?? undefined');
    expect(detail).toContain('await upsertMember(next)');
    expect(detail).toContain('showError({');
    expect(detail).not.toContain('<CredentialIssuersSection');
    expect(detail).not.toContain('<DeliverySettingsSection');
    expect(settings).toContain('await deleteGroup(group.id)');
    expect(settings).toContain("summary: t('settingsGroups.deleteFailed')");
  });

  it('removes locally generated OID4VP requests whose callback can never submit', () => {
    const scan = source('../../app/scan/index.tsx');
    const shareQr = source('../../app/share/qr.tsx');
    const oidcRequest = source('../../app/settings/oidc-request.tsx');
    const credentials = source('../../app/credentials/index.tsx');
    const vcSettings = source('../../app/settings/vc.tsx');

    expect(scan).not.toContain("router.push('/share/qr')");
    expect(shareQr).not.toContain('buildOid4VpRequestUrl');
    expect(shareQr).toContain('return <Redirect href="/scan" />');
    expect(oidcRequest).not.toContain('buildOid4VpRequestUrl');
    expect(oidcRequest).toContain('return <Redirect href="/scan" />');
    expect(credentials).toContain("const onReceiveOidc = () => {\n    router.push('/scan');");
    expect(vcSettings).toContain("router.push('/scan')");
    expect(vcSettings).not.toContain("router.push('/settings/oidc-request')");
  });

  it('commits the remote-notification toggle only after registration succeeds', () => {
    const notifications = source('../../app/settings/notifications.tsx');

    expect(notifications).toContain('const registration = await registerForPushNotificationsAsync');
    expect(notifications).toContain('if (!registration)');
    expect(notifications).toContain("setPref('notificationsRemote', false)");
    expect(notifications).toContain('await unregister()');
    expect(notifications).toContain("summary: t('notifications.remote.updateFailed')");
    expect(notifications).not.toContain('.catch(() => undefined)');
  });

  it('routes privacy controls to the sharing settings that actually build the QR', () => {
    const privacy = source('../../app/settings/privacy.tsx');
    const disclosure = source('../../app/settings/disclosure.tsx');
    const sharing = source('../../app/settings/share-settings.tsx');

    expect(privacy).toContain('return <Redirect href="/settings/share-settings" />');
    expect(disclosure).toContain('return <Redirect href="/settings/share-settings" />');
    expect(privacy).not.toContain('<SelectiveDisclosureBody');
    expect(disclosure).not.toContain('useState<Record<SharingLevel');
    expect(sharing).toContain('buildRuntimeSolidarityQrWire(');
    expect(sharing).toContain("prefs.set('share");
  });

  it('retires reachable prototype routes instead of exposing fake-success controls', () => {
    for (const path of [
      '../../app/id/index.tsx',
      '../../app/id/dashboard.tsx',
      '../../app/id/personal.tsx',
    ]) {
      const route = source(path);
      expect(route).toContain('return <Redirect href="/id/zk-settings" />');
      expect(route).not.toContain('refreshPending');
    }

    const groups = source('../../app/id/groups.tsx');
    const ocr = source('../../app/cards/ocr.tsx');
    const delivery = source('../../app/groups/[id]/delivery.tsx');
    expect(groups).toContain('return <Redirect href="/settings/groups" />');
    expect(ocr).toContain('return <Redirect href="/cards/edit" />');
    expect(ocr).not.toContain('OCR coming soon');
    expect(delivery).toContain("pathname: '/groups/[id]'");
    expect(delivery).not.toContain('saveDeliverySettings');
  });

  it('does not offer pull-to-refresh on authoritative local-only group data', () => {
    const list = source('../../app/settings/groups.tsx');
    const detail = source('../../app/groups/[id].tsx');

    expect(list).not.toContain('RefreshControl');
    expect(detail).not.toContain('RefreshControl');
  });

  it('surfaces failures from user-initiated external links', () => {
    for (const path of [
      '../../src/components/me/PagePreviewItems.tsx',
      '../../src/components/scan/VerifiedProfileView.tsx',
      '../../src/components/people/personDetailSupport.tsx',
      '../../app/people/declared/[id].tsx',
    ]) {
      const surface = source(path);
      expect(surface).not.toContain('.catch(() => undefined)');
      expect(surface).toContain("t('mePage.linkErrorTitle')");
      expect(surface).toContain("t('mePage.linkErrorMessage')");
    }
  });

  it('keeps destructive detail actions on-screen when persistence fails', () => {
    const card = source('../../app/cards/edit.tsx');
    const credential = source('../../app/credentials/[id].tsx');
    const shoutout = source('../../app/shoutouts/[id].tsx');

    expect(card).toContain("summary: t('cardsList.deleteFailed')");
    expect(credential).toContain("summary: t('credentialDetail.removeFailed')");
    expect(shoutout).toContain("summary: t('peopleList.deleteFailed')");
    expect(credential).toContain('await confirmDialog({');
  });

  it('enforces the configured biometric gate before presenting a proof', () => {
    const credential = source('../../app/credentials/[id].tsx');

    expect(credential).toContain('await requireSensitiveAction(');
    expect(credential).toContain("'presentProof'");
    expect(credential).toContain("t('security.prompt.presentProof')");
    // `security.error.*` — the keys that actually exist in the locale files.
    // This used to read `security.biometric.*`, a namespace no locale defines,
    // so a failed gate toasted the raw key string at the user.
    expect(credential).toContain("t(`security.error.${gate.reason}`)");
    expect(credential).not.toContain('TODO(biometric-gate): wrap in');
  });
});
