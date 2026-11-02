/** Theme and interface-style system (frontend-app). Mounted once in app/layout.tsx inside <AppProviders>. */
export { readInterfaceCookie, readThemeCookie, writeInterfaceCookie, writeThemeCookie } from './cookie';
export { useDeviceCapabilities } from './device';
export { getInterfaceBootScript, INTERFACE_COOKIE, INTERFACE_STYLE_ATTRIBUTE, MOTION_ATTRIBUTE, type InterfaceCookie } from './interface-boot';
export { InterfaceProvider, useInterface, useInterfaceStore } from './interface-provider';
export { useInterfaceSettings, type InterfaceSettings } from './interface-settings';
export {
  describeOverride,
  INTERFACE_STYLE_LABEL,
  INTERFACE_STYLES,
  MOTION_INTENSITIES,
  MOTION_INTENSITY_LABEL,
  resolveInterface,
  stylesForPanel,
  type DeviceCapabilities,
  type InterfacePanel,
  type InterfaceStyle,
  type MotionIntensity,
  type ResolvedInterface,
} from './interface-style';
export { ThemeProvider, useReducedMotionSetting, useTheme } from './theme-provider';
export { DEFAULT_TIME_ZONE, useThemeStore, type ReducedMotionSetting } from './theme-store';
