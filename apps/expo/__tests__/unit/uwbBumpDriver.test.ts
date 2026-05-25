/**
 * UWB Bump driver — state machine + consent-gate parity tests against
 * docs/dev-sandbox-identity-graph.md §3.3.1 + §13.4 + §13.5.
 */
import { describe, expect, test } from 'bun:test';

import {
  type BumpEvent,
  createBumpDriver,
} from '@/matching/uwbBumpDriver';

function harness(opts?: { alwaysConfirm?: boolean; invite?: (peerId: string) => void }) {
  const events: BumpEvent[] = [];
  const invited: string[] = [];
  const driver = createBumpDriver({
    alwaysConfirm: opts?.alwaysConfirm ?? false,
    onEvent: (e) => { events.push(e); },
    invitePeer: (peerId) => {
      invited.push(peerId);
      opts?.invite?.(peerId);
    },
    cooldownMs: 10,
  });
  return { driver, events, invited };
}

describe('uwbBumpDriver — UWB branch', () => {
  test('idle → approaching → confirmed in three close frames; auto-invite + flash + haptic transitions', () => {
    const { driver, events, invited } = harness();
    driver.ingestDistanceUpdate('peer-a', 0.05); // 5cm × 3
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    const states = events.filter((e) => e.kind === 'stateChanged').map((e) => e.kind === 'stateChanged' ? e.state.kind : '');
    expect(states).toEqual(['approaching', 'approaching', 'confirmed']);
    expect(events.some((e) => e.kind === 'flashRequested' && e.peerId === 'peer-a')).toBe(true);
    expect(events.some((e) => e.kind === 'autoInvite' && e.peerId === 'peer-a')).toBe(true);
    expect(events.some((e) => e.kind === 'consentSheetRequested')).toBe(false);
    expect(invited).toEqual(['peer-a']);
  });

  test('pulled away (> 30cm) before threshold returns to idle, no haptic storm, no auto-invite', () => {
    const { driver, events, invited } = harness();
    driver.ingestDistanceUpdate('peer-a', 0.50); // far first signal
    driver.ingestDistanceUpdate('peer-a', 0.05); // close
    driver.ingestDistanceUpdate('peer-a', 0.40); // pulled away
    const last = events.filter((e) => e.kind === 'stateChanged').pop();
    expect(last?.kind === 'stateChanged' && last.state.kind).toBe('idle');
    expect(invited).toEqual([]);
    expect(events.some((e) => e.kind === 'flashRequested')).toBe(false);
  });

  test('framesSeen does not advance on mid-range ticks (anti-noise)', () => {
    const { driver, events, invited } = harness();
    driver.ingestDistanceUpdate('peer-a', 0.05); // close
    driver.ingestDistanceUpdate('peer-a', 0.15); // mid-range — stays approaching but no frame increment
    driver.ingestDistanceUpdate('peer-a', 0.20); // mid-range
    expect(invited).toEqual([]);
    const lastApproach = events
      .filter((e) => e.kind === 'stateChanged' && e.state.kind === 'approaching')
      .pop();
    if (lastApproach?.kind !== 'stateChanged' || lastApproach.state.kind !== 'approaching') throw new Error('expected approaching');
    expect(lastApproach.state.framesSeen).toBe(1);
  });
});

describe('uwbBumpDriver — RSSI branch (§13.4 — Android non-UWB, pre-U1 iOS)', () => {
  test('three strong-RSSI frames request consent sheet instead of auto-invite', () => {
    const { driver, events, invited } = harness();
    driver.ingestRssi('peer-a', -45); // close
    driver.ingestRssi('peer-a', -45);
    driver.ingestRssi('peer-a', -45);
    expect(invited).toEqual([]); // no auto-invite on RSSI branch
    const consent = events.find((e) => e.kind === 'consentSheetRequested');
    if (consent?.kind !== 'consentSheetRequested') throw new Error('expected consent sheet');
    expect(consent.peerId).toBe('peer-a');
    expect(consent.reason).toBe('rssi');
  });
});

describe('uwbBumpDriver — §13.5 same-peer-twice always shows sheet', () => {
  test('second bump on same peer in same session requests sheet even on UWB branch', () => {
    const { driver, events, invited } = harness();
    // First bump — auto-invite
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    expect(invited).toEqual(['peer-a']);
    // Simulate the exchange finishing
    driver.notifySessionEvent('peer-a', 'established');
    driver.notifySessionEvent('peer-a', 'dataReceived');
    driver.forceIdle('peer-a');
    // Second bump — must request sheet
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    const sheetsForPeerA = events.filter((e) => e.kind === 'consentSheetRequested' && e.peerId === 'peer-a');
    expect(sheetsForPeerA.length).toBe(1);
    expect(sheetsForPeerA[0]?.kind === 'consentSheetRequested' && sheetsForPeerA[0].reason).toBe('sameSession');
    expect(invited.length).toBe(1); // still only the first
  });

  test('resetSessionMemory clears the auto-invite set (matching stopped+restarted)', () => {
    const { driver, events, invited } = harness();
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.forceIdle('peer-a');
    driver.resetSessionMemory();
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    expect(invited).toEqual(['peer-a', 'peer-a']); // both auto-invited
    expect(events.some((e) => e.kind === 'consentSheetRequested')).toBe(false);
  });
});

describe('uwbBumpDriver — alwaysConfirm escape hatch (§13.5)', () => {
  test('with alwaysConfirm=true the UWB branch also requests the sheet', () => {
    const { driver, events, invited } = harness({ alwaysConfirm: true });
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    expect(invited).toEqual([]);
    const consent = events.find((e) => e.kind === 'consentSheetRequested');
    if (consent?.kind !== 'consentSheetRequested') throw new Error('expected consent sheet');
    expect(consent.reason).toBe('alwaysConfirm');
  });
});

describe('uwbBumpDriver — session lifecycle transitions (§3.3.1 pseudocode)', () => {
  test('confirmed → exchanging on sessionEstablished, → cooldown on dataReceived, → idle after cooldown ms', async () => {
    const { driver, events } = harness();
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.notifySessionEvent('peer-a', 'established');
    expect(driver.peerState('peer-a').kind).toBe('exchanging');
    driver.notifySessionEvent('peer-a', 'dataReceived');
    expect(driver.peerState('peer-a').kind).toBe('cooldown');
    await new Promise((resolve) => setTimeout(resolve, 30)); // cooldownMs is 10 in harness
    expect(driver.peerState('peer-a').kind).toBe('idle');
    const order = events
      .filter((e) => e.kind === 'stateChanged' && e.peerId === 'peer-a')
      .map((e) => e.kind === 'stateChanged' ? e.state.kind : '');
    expect(order).toEqual(['approaching', 'approaching', 'confirmed', 'exchanging', 'cooldown', 'idle']);
  });

  test('sessionEnded mid-exchange jumps directly to idle (peer disappeared)', () => {
    const { driver } = harness();
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.ingestDistanceUpdate('peer-a', 0.05);
    driver.notifySessionEvent('peer-a', 'established');
    driver.notifySessionEvent('peer-a', 'ended');
    expect(driver.peerState('peer-a').kind).toBe('idle');
  });
});

describe('uwbBumpDriver — simulateProgression (Lab + tests)', () => {
  test('docs §10 scripted bump 50→20→8→8→8 cm fires exactly one heavy/flash/auto-invite', async () => {
    const { driver, events, invited } = harness();
    await driver.simulateProgression('peer-a', 'uwb', [0.50, 0.20, 0.08, 0.08, 0.08], 0);
    expect(invited).toEqual(['peer-a']);
    expect(events.filter((e) => e.kind === 'flashRequested').length).toBe(1);
    const confirmedCount = events.filter((e) => e.kind === 'stateChanged' && e.state.kind === 'confirmed').length;
    expect(confirmedCount).toBe(1);
  });

  test('docs §10 pull-away path 0→50→20→8→8→40 cm returns to idle with zero auto-invite', async () => {
    const { driver, events, invited } = harness();
    await driver.simulateProgression('peer-a', 'uwb', [0.00, 0.50, 0.20, 0.08, 0.08, 0.40], 0);
    expect(invited).toEqual([]);
    expect(events.filter((e) => e.kind === 'flashRequested').length).toBe(0);
  });
});
