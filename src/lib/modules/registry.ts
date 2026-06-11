// Mastermind modular spine — ports bolt's ModuleRegistry (codex/_bolt19/core/module)
// into the command center. The command center is the HOST; every faculty / panel /
// data feed / tool / assimilated-foreign thing is a MODULE registered here.
// This is the cure for the rebuild-from-scratch loop: capability slots in one
// reviewed module at a time, never another whole-organism rebuild.

export type ModuleKind = 'faculty' | 'panel' | 'data' | 'tool' | 'external';
export type ModuleStatus = 'live' | 'recovered' | 'spec' | 'thin' | 'planned';
export type Accent = 'cyan' | 'gold' | 'green' | 'magenta' | 'violet' | 'red';

export interface ModuleInfo {
  id: string;                 // stable unique id
  name: string;               // display name
  kind: ModuleKind;
  status: ModuleStatus;       // honest maturity
  description: string;
  version: string;
  faculty?: string;           // organism faculty served (cortex, perception, memory, orchestration, body, shell...)
  dependencies: string[];     // ids of modules this depends on
  capabilities: string[];     // what it provides
  source?: string;            // origin: 'command-center' | 'bolt' | 'assimilated:<origin>' ...
  accent?: Accent;            // visual-standard accent
  enabled: boolean;           // host renders / activates it when true
  created: string;            // ISO
  lastModified: string;       // ISO
}

export type RegistryEvent =
  | { type: 'registered'; module: ModuleInfo }
  | { type: 'unregistered'; id: string }
  | { type: 'updated'; module: ModuleInfo }
  | { type: 'toggled'; module: ModuleInfo };

type Listener = (e: RegistryEvent) => void;
export type ModuleSeed =
  Omit<ModuleInfo, 'created' | 'lastModified'> &
  Partial<Pick<ModuleInfo, 'created' | 'lastModified'>>;

export class ModuleRegistry {
  private modules = new Map<string, ModuleInfo>();
  private listeners = new Set<Listener>();

  register(info: ModuleSeed): ModuleInfo {
    const now = new Date().toISOString();
    const existing = this.modules.get(info.id);
    const mod: ModuleInfo = {
      ...info,
      created: existing?.created ?? info.created ?? now,
      lastModified: now,
    };
    this.modules.set(mod.id, mod);
    this.emit(existing ? { type: 'updated', module: mod } : { type: 'registered', module: mod });
    return mod;
  }

  unregister(id: string): void {
    if (this.modules.delete(id)) this.emit({ type: 'unregistered', id });
  }

  get(id: string): ModuleInfo | undefined { return this.modules.get(id); }
  list(): ModuleInfo[] { return Array.from(this.modules.values()); }
  has(id: string): boolean { return this.modules.has(id); }
  isEnabled(id: string): boolean { return !!this.modules.get(id)?.enabled; }

  update(id: string, updates: Partial<ModuleInfo>): ModuleInfo {
    const cur = this.modules.get(id);
    if (!cur) throw new Error(`Module ${id} not found`);
    const next: ModuleInfo = { ...cur, ...updates, id: cur.id, lastModified: new Date().toISOString() };
    this.modules.set(id, next);
    this.emit({ type: 'updated', module: next });
    return next;
  }

  setEnabled(id: string, enabled: boolean): void {
    const cur = this.modules.get(id);
    if (!cur || cur.enabled === enabled) return;
    const next: ModuleInfo = { ...cur, enabled, lastModified: new Date().toISOString() };
    this.modules.set(id, next);
    this.emit({ type: 'toggled', module: next });
  }

  toggle(id: string): void {
    const cur = this.modules.get(id);
    if (cur) this.setEnabled(id, !cur.enabled);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(e: RegistryEvent): void { this.listeners.forEach((l) => l(e)); }
}

// Module-scoped singleton (survives HMR in dev via globalThis).
const g = globalThis as unknown as { __mmRegistry?: ModuleRegistry };
export const registry: ModuleRegistry = g.__mmRegistry ?? (g.__mmRegistry = new ModuleRegistry());
