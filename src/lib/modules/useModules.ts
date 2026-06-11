// React binding for the module registry. useSyncExternalStore so any component
// re-renders when modules are registered / toggled / updated.
import { useSyncExternalStore } from 'react';
import { registry, ModuleInfo } from './registry';

let cache: ModuleInfo[] = [];
let cacheKey = '';

function snapshot(): ModuleInfo[] {
  const list = registry.list();
  const key = list.map((m) => `${m.id}:${m.enabled}:${m.lastModified}`).join('|');
  if (key !== cacheKey) { cacheKey = key; cache = list; }
  return cache;
}

export function useModules(): ModuleInfo[] {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    snapshot,
    snapshot,
  );
}

export function useModuleEnabled(id: string): boolean {
  useModules();
  return registry.isEnabled(id);
}
