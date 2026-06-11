// Seed the registry with the command center's existing faculties/panels as MODULES.
// Idempotent: only registers what is not already present, so user toggles persist
// across re-seeds / HMR. New floors (assimilation loop, ported faculties) register here too.
import { registry, ModuleSeed } from './registry';

let seeded = false;

export function seedModules(): void {
  if (seeded) return;
  seeded = true;

  const reg = (m: ModuleSeed) => { if (!registry.has(m.id)) registry.register(m); };

  reg({ id: 'module-explorer', name: 'Module Explorer', kind: 'tool', status: 'live', faculty: 'shell',
        description: 'The modular shell itself: see, toggle, and (next floor) assimilate modules.',
        version: '1.0', dependencies: [], capabilities: ['list', 'toggle', 'status'],
        source: 'command-center', accent: 'violet', enabled: true });

  reg({ id: 'nexus-core', name: 'Nexus Core', kind: 'faculty', status: 'live', faculty: 'cortex',
        description: 'Self-sustaining core: perceive -> decide -> persist, with the operator gate.',
        version: '3.0', dependencies: [], capabilities: ['perceive', 'decide', 'persist', 'proposals'],
        source: 'command-center', accent: 'cyan', enabled: true });

  reg({ id: 'nexus-core-hero', name: 'Nexus Core (visual)', kind: 'panel', status: 'live', faculty: 'cortex',
        description: 'The spinning core centerpiece — the brain/AI face, recovered from os-v3.',
        version: '1.0', dependencies: [], capabilities: ['hero', 'identity'],
        source: 'recovered', accent: 'cyan', enabled: true });

  reg({ id: 'data-explorer', name: 'Data Explorer', kind: 'panel', status: 'live', faculty: 'perception',
        description: 'One source, many forms: table / log / conversation / live-feed view primitives.',
        version: '1.0', dependencies: [], capabilities: ['table', 'log', 'conversation', 'feed'],
        source: 'command-center', accent: 'cyan', enabled: true });

  reg({ id: 'operations-map', name: 'Operations Map', kind: 'panel', status: 'live', faculty: 'body',
        description: 'Radial node/edge map of the whole organism (painting): faculty=angle, phase=radius, status=colour.',
        version: '1.0', dependencies: [], capabilities: ['graph', 'painting', 'dependencies', 'status'],
        source: 'command-center', accent: 'cyan', enabled: true });

  reg({ id: 'forge-console', name: 'Forge', kind: 'panel', status: 'live', faculty: 'hands',
        description: 'Design-from-intent console: invoke the live generative faculties (pattern_forge, cycle_resonator) on the kernel.',
        version: '1.0', dependencies: [], capabilities: ['synthesize', 'propose', 'catalog', 'call'],
        source: 'command-center', accent: 'green', enabled: true });

  reg({ id: 'travel-telemetry', name: 'Travel (5m)', kind: 'data', status: 'live', faculty: 'perception',
        description: 'Chunk-load + anticheat telemetry over the last 5 minutes.',
        version: '1.0', dependencies: [], capabilities: ['chunk-rate', 'ac-hits'],
        source: 'command-center', accent: 'gold', enabled: true });

  reg({ id: 'tps-history', name: 'TPS History', kind: 'data', status: 'live', faculty: 'perception',
        description: 'Server tick-rate rollups (current / min / avg / samples).',
        version: '1.0', dependencies: [], capabilities: ['tps-stats'],
        source: 'command-center', accent: 'cyan', enabled: true });

  reg({ id: 'tps-timeline', name: 'TPS Timeline', kind: 'panel', status: 'live', faculty: 'perception',
        description: 'Backend tick-rate signature graph.',
        version: '1.0', dependencies: ['tps-history'], capabilities: ['tps-signature'],
        source: 'command-center', accent: 'cyan', enabled: true });

  reg({ id: 'chunk-radar', name: 'Chunk Radar', kind: 'panel', status: 'live', faculty: 'perception',
        description: 'Spatial movement trace from chunk-load events.',
        version: '1.0', dependencies: [], capabilities: ['movement-trace'],
        source: 'command-center', accent: 'gold', enabled: true });

  reg({ id: 'chat-intelligence', name: 'Chat Intelligence', kind: 'panel', status: 'live', faculty: 'perception',
        description: 'Live chat stream with bot / auto-reply / human classification.',
        version: '1.0', dependencies: [], capabilities: ['chat-stream', 'actor-class'],
        source: 'command-center', accent: 'green', enabled: true });
}
