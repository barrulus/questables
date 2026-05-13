// Password-based login + register were removed in favour of passkey-only auth.
// See utils/api/passkey.ts for the actual implementation.

export {
  loginWithPasskey as login,
  enrolWithPasskey,
  addPasskey,
  listPasskeys,
  removePasskey,
  getEnrolment,
} from './passkey';
export type {
  PasskeyAuthResponse as AuthResponse,
  EnrolmentPreview,
  PasskeyRecord,
} from './passkey';
