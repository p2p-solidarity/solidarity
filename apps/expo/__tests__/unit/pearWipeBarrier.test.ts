import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('Pear local-wipe barrier', () => {
  it('captures a pre-exchange epoch and reports failed instead of persisting late cards', () => {
    const glue = source('src/pear/mutualExchangeGlue.ts');
    const responder = source('src/pear/useCardExchange.ts');
    const initiator = source('src/pear/useMutualCardExchange.ts');
    const protocol = source('src/pear/mutualExchange.ts');

    expect(glue).toContain('createIncomingCardSaver');
    expect(glue).toContain('canCommitLocalData(exchangeEpoch)');
    expect(glue).toContain("return 'failed'");
    expect(responder).toContain('const saveIncoming = createIncomingCardSaver()');
    expect(initiator).toContain('const saveIncoming = createIncomingCardSaver()');
    expect(protocol).toContain('export type SaveIncoming = (');
    expect(protocol).toContain(') => IncomingSaveStatus;');
  });
});
