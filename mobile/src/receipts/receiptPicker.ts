import { LIMITS } from '@expense-tracker/shared';
import { decodedSize } from './receiptStore';

/**
 * Getting a photo for a receipt: camera or library, then shrunk to something worth uploading.
 *
 * Behind an interface so screens and tests never touch a native module; the real
 * implementation loads `expo-image-picker` and `expo-image-manipulator` on first use, which
 * also keeps them out of the startup path.
 *
 * Every photo is re-encoded as a JPEG no wider than {@link ENCODE_LADDER}'s first rung. A
 * phone's native photo is 3-8 MB; a receipt is read at arm's length and needs a legible page,
 * not a gallery print. The ladder steps down until the result is under the server's limit, so
 * a very detailed image gets smaller rather than refused.
 */

export type PickOutcome =
  | { readonly status: 'picked'; readonly dataBase64: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'denied' }
  | { readonly status: 'failed' };

export interface ReceiptPicker {
  takePhoto(): Promise<PickOutcome>;
  chooseFromLibrary(): Promise<PickOutcome>;
}

/** Longest edge to try, and JPEG quality, from best to smallest. */
export const ENCODE_LADDER: readonly { readonly width: number; readonly quality: number }[] = [
  { width: 1600, quality: 0.7 },
  { width: 1280, quality: 0.6 },
  { width: 1024, quality: 0.5 },
  { width: 800, quality: 0.4 },
];

/** Encodes `source` at a width and quality, returning base64 JPEG. */
export type Encoder = (width: number, quality: number) => Promise<string>;

/**
 * Walk the ladder until an encoding fits, and return it - or null if even the smallest
 * rung is too large, which for a photo of paper would mean something is badly wrong.
 */
export async function encodeToFit(encode: Encoder): Promise<string | null> {
  for (const rung of ENCODE_LADDER) {
    const dataBase64 = await encode(rung.width, rung.quality);
    if (decodedSize(dataBase64) <= LIMITS.RECEIPT_MAX_BYTES) return dataBase64;
  }
  return null;
}

async function encodeUri(uri: string, sourceWidth: number): Promise<string | null> {
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  return encodeToFit(async (width, quality) => {
    const context = ImageManipulator.manipulate(uri);
    // Never enlarge: a small image is encoded at its own width.
    if (sourceWidth === 0 || sourceWidth > width) context.resize({ width });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: quality,
      base64: true,
    });
    if (saved.base64 === undefined) throw new Error('image encoder returned no data');
    return saved.base64;
  });
}

async function pick(source: 'camera' | 'library'): Promise<PickOutcome> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { status: 'denied' };

    const options = { mediaTypes: ['images' as const], quality: 1, allowsEditing: false };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : (result.assets[0] ?? null);
    if (asset === null) return { status: 'cancelled' };

    const dataBase64 = await encodeUri(asset.uri, asset.width);
    return dataBase64 === null ? { status: 'failed' } : { status: 'picked', dataBase64 };
  } catch {
    return { status: 'failed' };
  }
}

const expoPicker: ReceiptPicker = {
  takePhoto: () => pick('camera'),
  chooseFromLibrary: () => pick('library'),
};

let current: ReceiptPicker = expoPicker;

export function getReceiptPicker(): ReceiptPicker {
  return current;
}

/** Test seam: replace the picker, or pass `null` to restore the real one. */
export function setReceiptPickerForTests(picker: ReceiptPicker | null): void {
  current = picker ?? expoPicker;
}
