import * as LocalAuthentication from 'expo-local-authentication';

/**
 * The only file that talks to `expo-local-authentication`, so the rest of the app deals in
 * two plain questions: can this device lock the app at all, and did the person pass.
 *
 * "Can lock" means *any* enrolled way to prove it is them - Face ID, a fingerprint, or the
 * device passcode. A phone with no passcode and no biometrics has nothing to ask for, and a
 * lock that cannot be passed would lock the person out of their own data.
 */

export async function canAuthenticate(): Promise<boolean> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) return false;
    // `SECRET` is "a passcode but no biometrics", which is still enough to ask for.
    return (
      (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE
    );
  } catch {
    return false;
  }
}

export type AuthResult =
  | { readonly ok: true }
  /** `cancelled` is the person saying no, which is not an error worth a message. */
  | { readonly ok: false; readonly cancelled: boolean; readonly code: string };

const CANCEL_CODES = new Set(['user_cancel', 'system_cancel', 'app_cancel']);

/** Ask the system to verify the person. Falls back to the passcode, as the system allows. */
export async function authenticate(reason: string): Promise<AuthResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason });
    if (result.success) return { ok: true };
    return { ok: false, cancelled: CANCEL_CODES.has(result.error), code: result.error };
  } catch (error) {
    return { ok: false, cancelled: false, code: error instanceof Error ? error.message : 'error' };
  }
}
