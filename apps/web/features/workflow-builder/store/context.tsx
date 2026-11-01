'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { PhysicsWorld } from '../physics/world';
import type { BuilderState, BuilderStore } from './builder-store';

export interface BuilderEnv {
  /** Editing allowed (prop not readOnly, has workflows.edit, wide screen). */
  canEdit: boolean;
  /** Has workflows.publish. */
  canPublish: boolean;
  /** Rope + drag physics on (not flat mode, no reduced motion). */
  physics: boolean;
  reducedMotion: boolean;
  aiEnabled: boolean;
  workspaceName: string;
  userName: string | null;
}

interface Ctx {
  store: BuilderStore;
  world: PhysicsWorld;
  env: BuilderEnv;
}

const BuilderContext = createContext<Ctx | null>(null);

export function BuilderProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>;
}

function useCtx(): Ctx {
  const ctx = useContext(BuilderContext);
  if (!ctx) throw new Error('Workflow builder context missing');
  return ctx;
}

export function useBuilder<T>(selector: (s: BuilderState) => T): T {
  return useStore(useCtx().store, selector);
}

export function useBuilderApi(): BuilderStore {
  return useCtx().store;
}

export function useWorld(): PhysicsWorld {
  return useCtx().world;
}

export function useEnv(): BuilderEnv {
  return useCtx().env;
}
