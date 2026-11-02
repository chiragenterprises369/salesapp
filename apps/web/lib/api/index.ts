/**
 * Web API layer (web-api stream). `api` / `superApi` are the typed clients over API_ROUTES;
 * `getDataSource()` decides between the API (default) and the test-only mock layer.
 */
export { api, superApi, configureApiClient, refreshAccessToken, createApiClient, type ApiClient, type CallOptions, type SessionEndReason } from './client';
export { API_ORIGIN, API_URL, WS_URL } from './config';
export { DATA_SOURCE_KEY, getDataSource, isApiData, isMockData, MOCK_DATA_ALLOWED, noteMockUse, type DataSource } from './data-source';
export { clearAccessToken, decodeTokenClaims, getAccessTokenFor, onTokenChange, setAccessToken, type Audience } from './tokens';
