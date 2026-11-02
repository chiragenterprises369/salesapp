/**
 * Board event celebrations (SPEC 28.1): the canvas layer over the Leads Board and the mock live
 * feed that makes the Leads tab feel live in mock mode. BoardView mounts both.
 */
export { CelebrationLayer, type CelebrationLayerProps } from './celebration-layer';
export { useCelebrationSetting, type CelebrationSetting } from './settings';
export { CELEBRATION_KINDS, type CelebrationKind } from './events';
export { useMockLiveLeads } from '@/lib/leads/mock-realtime';
