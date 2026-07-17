import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('connection preferences UI wiring', () => {
  it('does not mount any Pear exchange hook while Pear is disabled', () => {
    const cardExchange = source('../../src/components/people/CardExchangeSection.tsx');
    const enabledStart = cardExchange.indexOf('function EnabledCardExchangeSection');
    const wrapper = cardExchange.slice(
      cardExchange.indexOf('export function CardExchangeSection'),
      enabledStart,
    );
    const enabled = cardExchange.slice(enabledStart);

    expect(wrapper).toContain('pearEnabled ? <EnabledCardExchangeSection');
    expect(wrapper).not.toContain('useCardRequestFlow(');
    expect(wrapper).not.toContain('usePresentRequestFlow(');
    expect(wrapper).not.toContain('useReachableMode(');
    expect(enabled).toContain('useCardRequestFlow(did)');
    expect(enabled).toContain('usePresentRequestFlow(did, PRESENT_CLAIMS)');
    expect(enabled).toContain('useReachableMode(did, peerLabel)');
  });

  it('gates the unknown-peer Pear entry point before its request hook mounts', () => {
    const pearConnect = source('../../src/components/people/PearConnectSection.tsx');
    const enabledStart = pearConnect.indexOf('function EnabledPearConnectSection');
    const wrapper = pearConnect.slice(
      pearConnect.indexOf('export function PearConnectSection'),
      enabledStart,
    );
    expect(wrapper).toContain('pearEnabled ? <EnabledPearConnectSection');
    expect(wrapper).not.toContain('useCardRequestFlow(');
    expect(pearConnect.slice(enabledStart)).toContain('useCardRequestFlow(did)');
  });

  it('tears down live Pear lanes when the preference is switched off', () => {
    const settings = source('../../app/settings/connections.tsx');
    expect(settings).toContain('if (!next) stopLaneManager()');
    expect(settings).toContain("setPreference('pearExchangeEnabled', next)");
  });

  it('labels Nostr as published only after live bidirectional verification', () => {
    const settings = source('../../app/settings/connections.tsx');
    expect(settings).toContain('verifyNostrBinding(record, makeKind0Fetcher(DEFAULT_RELAYS))');
    expect(settings).toContain("nostrVerification.state === 'verified'");
    expect(settings).toContain("t('connectionsSettings.configured')");
  });
});
