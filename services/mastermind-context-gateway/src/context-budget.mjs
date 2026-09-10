import { boundedText, ContextGatewayError } from './validation.mjs';

const REFERENCES = new Set([
  'id', 'address', 'docId', 'coreHash', 'taskId', 'checkpointId', 'memoryKey',
  'sessionId', 'playerId', 'project', 'layer', 'state', 'revision', 'sequence',
  'createdAt', 'updatedAt', 'lastCheckpointAt', 'occurredAt', 'sourceType',
]);
const MINIMAL_FIELDS = new Set([
  ...REFERENCES, 'content', 'summary', 'intent', 'title', 'checkpoint',
  'completedItems', 'openItems', 'blockers',
]);

function compact(value, textLimit, arrayLimit, minimal = false, key = '') {
  if (typeof value === 'string') return REFERENCES.has(key) ? value : boundedText(value, textLimit);
  if (Array.isArray(value)) return value.slice(0, arrayLimit).map((item) => compact(item, textLimit, arrayLimit, minimal));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([name]) => !minimal || MINIMAL_FIELDS.has(name))
      .map(([name, item]) => [name, compact(item, textLimit, arrayLimit, minimal, name)]));
  }
  return value;
}

// Reserve one representative of every available layer before spending on extras.
// Stable references survive compaction so callers can retrieve the full source.
export function fitContext(packet, budget) {
  const result = structuredClone(packet);
  const groups = [];
  const addGroup = (name, rows, write) => {
    if (Array.isArray(rows)) groups.push({ name, source: rows, selected: [], indices: [], write });
  };
  if (Array.isArray(packet.pinned)) {
    const layers = ['identity', 'toolbox', 'project', 'other'];
    for (const layer of layers) {
      addGroup(layer, packet.pinned.filter((row) => (layers.includes(row.layer) ? row.layer : 'other') === layer), () => {});
    }
  }
  addGroup('tasks', packet.projectState?.tasks, (rows) => { result.projectState.tasks = rows; });
  for (const name of ['relevant', 'memories', 'archive', 'minecraftMemories']) {
    addGroup(name, packet[name], (rows) => { result[name] = rows; });
  }
  const refresh = () => {
    if (Array.isArray(packet.pinned)) {
      result.pinned = groups.filter((group) => ['identity', 'toolbox', 'project', 'other'].includes(group.name))
        .flatMap((group) => group.selected);
    }
    for (const group of groups) group.write(group.selected);
    const truncated = groups.some((group) => JSON.stringify(group.selected) !== JSON.stringify(group.source));
    result.contextBudget = {
      maximumCharacters: budget,
      actualCharacters: 0,
      truncated,
      sections: Object.fromEntries(groups.filter((group) => group.source.length > 0)
        .map((group) => [group.name, { available: group.source.length, included: group.selected.length }])),
      taskContinuity: groups.filter((group) => group.name === 'tasks').flatMap((group) =>
        group.selected.map((task) => {
          const source = group.source.find((row) => row.taskId === task.taskId);
          return {
            taskId: task.taskId,
            checkpointId: task.checkpoint?.checkpointId ?? null,
            complete: JSON.stringify(task) === JSON.stringify(source),
            intentComplete: task.intent === source.intent,
            summaryComplete: task.checkpoint?.summary === source.checkpoint?.summary,
            fullStateTool: 'mastermind_project_state',
          };
        })),
    };
    // The count includes its own digits and all truncation metadata.
    let length = JSON.stringify(result).length;
    while (result.contextBudget.actualCharacters !== length) {
      result.contextBudget.actualCharacters = length;
      length = JSON.stringify(result).length;
    }
    return length;
  };

  for (const group of groups) group.selected = structuredClone(group.source);
  if (refresh() <= budget) return result;

  // Build the reserved floor with short excerpts, preserving every available layer.
  for (const [textLimit, arrayLimit, minimal] of [[512, 3, false], [256, 2, false], [128, 1, true], [48, 1, true]]) {
    for (const group of groups) {
      group.selected = group.source.length ? [compact(group.source[0], textLimit, arrayLimit, minimal)] : [];
      group.indices = group.source.length ? [0] : [];
    }
    if (refresh() <= budget) break;
  }
  if (refresh() > budget) {
    throw new ContextGatewayError('CONTEXT_BUDGET_TOO_SMALL',
      'The requested budget cannot hold the available layers and their stable references. Request a larger budget.');
  }

  // The leading task is the current continuation. Reserve its full state before
  // additional generic memories; if it cannot fit, prioritize its exact intent
  // and checkpoint summary. Metadata identifies any remaining partial state.
  const tasks = groups.find((group) => group.name === 'tasks');
  if (tasks?.selected.length) {
    const excerpt = tasks.selected[0];
    tasks.selected[0] = structuredClone(tasks.source[0]);
    if (refresh() > budget) {
      tasks.selected[0] = excerpt;
      for (const field of ['intent', 'summary']) {
        const previous = structuredClone(tasks.selected[0]);
        if (field === 'intent') tasks.selected[0].intent = tasks.source[0].intent;
        else if (tasks.source[0].checkpoint && tasks.selected[0].checkpoint) {
          tasks.selected[0].checkpoint.summary = tasks.source[0].checkpoint.summary;
        }
        if (refresh() > budget) tasks.selected[0] = previous;
      }
    }
  }

  // Round-robin allocation prevents generic pins from consuming all intent evidence.
  const next = new Map(groups.map((group) => [group.name, group.selected.length]));
  let added = true;
  while (added) {
    added = false;
    for (const group of groups) {
      const index = next.get(group.name);
      if (index >= group.source.length) continue;
      next.set(group.name, index + 1);
      group.selected.push(compact(group.source[index], 512, 3));
      if (refresh() <= budget) { added = true; group.indices.push(index); }
      else group.selected.pop();
    }
  }

  // Spend the remainder on richer excerpts, again visiting all layers in order.
  const maximumRows = Math.max(0, ...groups.map((group) => group.selected.length));
  for (let index = 0; index < maximumRows; index += 1) {
    for (const group of groups) {
      if (index >= group.selected.length) continue;
      const previous = group.selected[index];
      group.selected[index] = structuredClone(group.source[group.indices[index]]);
      if (refresh() > budget) group.selected[index] = previous;
    }
  }
  refresh();
  return result;
}
