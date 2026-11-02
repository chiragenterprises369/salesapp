/** Web auth helpers. API mode calls the real routes; mock mode (tests) keeps the Wave 1 mock backend. */
export * from './demo-accounts';
export * from './redirect';
export { acceptInvite, authFailureFrom, login, lookupInvite, secretFromOtpauth, signup, superLogin, superVerify, type AuthFailure, type AuthFailureCode, type InviteDetails, type SuperLoginStep } from './actions';
export { qrMatrix, qrSvgPath } from './qr';
export { isAuthTransition, useReadOnly, useRedirectWhenSignedIn, useSignOut, useSwitchPersona } from './use-auth';
