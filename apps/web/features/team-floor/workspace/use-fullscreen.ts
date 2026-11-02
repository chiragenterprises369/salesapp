'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Full-screen mode of the floor workspace.
 *
 * The whole document goes full screen (Fullscreen API on <html>), and the workspace covers the panel
 * shell (sidebar, top bar) as a fixed layer. Making <html> the full-screen element keeps every dialog,
 * sheet, menu and toast visible: they portal to <body>, which a full-screen child element would hide.
 * Where the API is missing or refused (iOS Safari, iframes), the fixed layer alone is the full-screen
 * mode ("immersive") and Esc leaves it. In real full screen the browser owns Esc (it exits full screen).
 */
export interface FullscreenControl {
  /** The workspace covers the screen (real full screen or the immersive fallback). */
  active: boolean;
  /** The browser is in real full screen (Esc belongs to the browser). */
  native: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}

const fullscreenElement = () => (typeof document === 'undefined' ? null : document.fullscreenElement);

export function useFullscreen(): FullscreenControl {
  const [active, setActive] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const on = fullscreenElement() !== null;
      setNative(on);
      // Leaving real full screen (Esc, F11, browser UI) leaves the workspace's full-screen layer too.
      if (!on) setActive(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Leaving the page while in full screen: give the browser window back.
  useEffect(
    () => () => {
      if (fullscreenElement()) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  const enter = useCallback(() => {
    setActive(true);
    const root = document.documentElement;
    if (!document.fullscreenEnabled || typeof root.requestFullscreen !== 'function' || fullscreenElement()) return;
    // Must run inside the click or key press (user activation); refused -> the immersive layer stays.
    root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  }, []);

  const exit = useCallback(() => {
    setActive(false);
    if (fullscreenElement()) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    if (active) exit();
    else enter();
  }, [active, enter, exit]);

  return { active, native, enter, exit, toggle };
}

/** Text fields, menus, lists and grids keep their own keys; workspace shortcuts skip them. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!target.closest('[role="textbox"],[role="combobox"],[role="listbox"],[role="menu"],[role="menuitem"],[role="grid"],[role="slider"],[role="spinbutton"],[cmdk-root]');
}

/** A dialog or sheet is open (Radix content carries role=dialog and data-state=open): its own keys win. */
export function modalOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"],[role="dialog"][aria-modal="true"]');
}
