import { describe, expect, it } from 'vitest';
import {
  createDailyBudget,
  modelStrategy,
  pacificDay,
  ReaderQuotaError,
  StrategySkipped,
  textStrategy,
  type ReceiptReader,
} from '../src/services/receiptStrategies.ts';
import { ModelAnswerError } from '../src/services/modelReading.ts';

/**
 * The two ways to read a receipt - a vision model, or OCR text through the parser - behind one
 * `scan`, plus the daily budget that keeps the free tier's quota from being spent on a failing
 * call (`docs/design/14-ai-receipt-reading.md`).
 */

const noon = (day: string) => new Date(`${day}T20:00:00Z`);
const today = new Date('2026-10-29T20:00:00Z');
const image = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
const context = { currency: 'USD', today };

const answer = {
  isReceipt: true,
  total: 4.5,
  printedCurrency: null,
  date: '2026-10-28',
  dateAmbiguous: false,
  merchant: 'Cafe Nero',
  category: 'eating_out',
};

function model(result: () => unknown): ReceiptReader & { calls: number } {
  const reader = {
    calls: 0,
    async readReceipt() {
      reader.calls += 1;
      return result();
    },
  };
  return reader;
}

describe('pacificDay', () => {
  it('is the calendar day in Pacific time, which is when Google resets the quota', () => {
    // 2026-10-29 06:59 UTC is 23:59 PDT the day before; 07:00 UTC is midnight.
    expect(pacificDay(new Date('2026-10-29T06:59:00Z'))).toBe('2026-10-28');
    expect(pacificDay(new Date('2026-10-29T07:00:00Z'))).toBe('2026-10-29');
  });

  it('follows the switch to winter time', () => {
    // PST (UTC-8) from 2026-11-01: 07:59 UTC is still the day before.
    expect(pacificDay(new Date('2026-11-02T07:59:00Z'))).toBe('2026-11-01');
    expect(pacificDay(new Date('2026-11-02T08:00:00Z'))).toBe('2026-11-02');
  });
});

describe('createDailyBudget', () => {
  it('allows exactly its limit in a day', () => {
    const budget = createDailyBudget(2);
    expect([budget.tryTake(today), budget.tryTake(today), budget.tryTake(today)]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('starts again on the next Pacific day', () => {
    const budget = createDailyBudget(1);
    expect(budget.tryTake(noon('2026-10-29'))).toBe(true);
    expect(budget.tryTake(noon('2026-10-29'))).toBe(false);
    expect(budget.tryTake(noon('2026-10-30'))).toBe(true);
  });

  it('is spent for the rest of the day once exhausted, whatever was left', () => {
    const budget = createDailyBudget(100);
    budget.exhaust(noon('2026-10-29'));
    expect(budget.tryTake(noon('2026-10-29'))).toBe(false);
    expect(budget.tryTake(noon('2026-10-30'))).toBe(true);
  });

  it('with a limit of zero never allows a call', () => {
    expect(createDailyBudget(0).tryTake(today)).toBe(false);
  });
});

describe('modelStrategy', () => {
  it('hands the reader the photo and the account context, and returns normalized fields', async () => {
    let seen: unknown[] = [];
    const reader: ReceiptReader = {
      async readReceipt(...args) {
        seen = args;
        return answer;
      },
    };

    const result = await modelStrategy(reader, createDailyBudget(5)).scan(image, context);

    expect(seen).toEqual([image, context]);
    expect(result).toEqual({
      amountMinor: 450,
      date: '2026-10-28',
      merchant: 'Cafe Nero',
      category: 'eating_out',
    });
  });

  it('is skipped, without calling the reader, when the day budget is spent', async () => {
    const reader = model(() => answer);
    const strategy = modelStrategy(reader, createDailyBudget(0));

    await expect(strategy.scan(image, context)).rejects.toBeInstanceOf(StrategySkipped);
    expect(reader.calls).toBe(0);
  });

  it('spends one unit per attempt, including a failed one', async () => {
    const reader = model(() => {
      throw new Error('boom');
    });
    const budget = createDailyBudget(2);
    const strategy = modelStrategy(reader, budget);

    await expect(strategy.scan(image, context)).rejects.toThrow('boom');
    await expect(strategy.scan(image, context)).rejects.toThrow('boom');
    await expect(strategy.scan(image, context)).rejects.toBeInstanceOf(StrategySkipped);
    expect(reader.calls).toBe(2);
  });

  it('stops calling for the rest of the day after the provider says it is out of quota', async () => {
    const reader = model(() => {
      throw new ReaderQuotaError();
    });
    const strategy = modelStrategy(reader, createDailyBudget(100));

    await expect(strategy.scan(image, context)).rejects.toBeInstanceOf(ReaderQuotaError);
    await expect(strategy.scan(image, context)).rejects.toBeInstanceOf(StrategySkipped);
    expect(reader.calls).toBe(1);
  });

  it('fails, rather than half-answer, when the model answers off-schema', async () => {
    const strategy = modelStrategy(
      model(() => ({ total: '4.50' })),
      createDailyBudget(5),
    );
    await expect(strategy.scan(image, context)).rejects.toBeInstanceOf(ModelAnswerError);
  });

  it('is named, so a log line can say which strategy failed', () => {
    expect(
      modelStrategy(
        model(() => answer),
        createDailyBudget(1),
      ).name,
    ).toBe('model');
  });
});

describe('textStrategy', () => {
  it('reads the text with OCR and parses it', async () => {
    const strategy = textStrategy({
      async readText() {
        return ['FRESH MARKET', 'Date: 2026-10-28', 'TOTAL 6.50'].join('\n');
      },
    });

    expect(await strategy.scan(image, context)).toMatchObject({
      amountMinor: 650,
      date: '2026-10-28',
      merchant: 'FRESH MARKET',
    });
    expect(strategy.name).toBe('ocr');
  });

  it('lets a provider failure through, for the caller to count', async () => {
    const strategy = textStrategy({
      async readText() {
        throw new Error('down');
      },
    });
    await expect(strategy.scan(image, context)).rejects.toThrow('down');
  });
});
