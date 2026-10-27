import { LIMITS } from '@expense-tracker/shared';
import { ENCODE_LADDER, encodeToFit } from '@/receipts/receiptPicker';

const b64 = (bytes: number): string => Buffer.alloc(bytes, 1).toString('base64');

describe('encodeToFit', () => {
  it('takes the first rung when it already fits', async () => {
    const seen: number[] = [];
    const result = await encodeToFit(async (width) => {
      seen.push(width);
      return b64(1000);
    });
    expect(result).not.toBeNull();
    expect(seen).toEqual([ENCODE_LADDER[0]!.width]);
  });

  it('steps down until the image is under the server limit', async () => {
    const seen: number[] = [];
    const result = await encodeToFit(async (width) => {
      seen.push(width);
      return b64(width > 1100 ? LIMITS.RECEIPT_MAX_BYTES + 10 : 1000);
    });
    expect(result).not.toBeNull();
    expect(seen).toEqual([1600, 1280, 1024]);
  });

  it('gives up with null when even the smallest rung is too big', async () => {
    const result = await encodeToFit(async () => b64(LIMITS.RECEIPT_MAX_BYTES + 10));
    expect(result).toBeNull();
  });

  it('accepts an image exactly at the limit', async () => {
    expect(await encodeToFit(async () => b64(LIMITS.RECEIPT_MAX_BYTES))).not.toBeNull();
  });
});
