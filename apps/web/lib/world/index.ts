/**
 * Mock world (Wave 1): linked dummy data for every screen of the main workspace, with data scope.
 * Readers: ./read. Hooks: ./hooks. Super Admin rows: ./platform.
 */
export * from './read';
export * from './scope';
export { world, worldContext, worldLeadsSeed, worldNow } from './world';
