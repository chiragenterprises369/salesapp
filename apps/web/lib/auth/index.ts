/** Web auth helpers (frontend-app). Wave 1 = mock backend; Wave 3 keeps these signatures over HTTP. */
export * from './demo-accounts';
export * from './mock-auth';
export * from './redirect';
export { useReadOnly, useRedirectWhenSignedIn } from './use-auth';
