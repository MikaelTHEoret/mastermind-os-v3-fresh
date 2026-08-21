import { LOCAL_AGENT_DRAIN_TIMEOUT_MS } from './local-control-drain.mjs';

export const LOCAL_NODE_LINK_STOP_TIMEOUT_MS = 12_000;
export const LOCAL_CONTROL_TAKEOVER_TIMEOUT_MS = LOCAL_NODE_LINK_STOP_TIMEOUT_MS
  + LOCAL_AGENT_DRAIN_TIMEOUT_MS
  + 10_000;

export class LocalControlShutdownPreparationError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'LocalControlShutdownPreparationError';
    this.code = code;
  }
}

export async function prepareLocalControlShutdown(options = {}) {
  if (typeof options.stopNodeLink !== 'function' || typeof options.drainMinecraft !== 'function'
    || typeof options.minecraftAgentManaged !== 'boolean' || typeof options.alreadyDrained !== 'boolean') {
    throw new TypeError('Invalid local-control shutdown preparation');
  }

  try {
    await options.stopNodeLink();
  } catch (cause) {
    throw new LocalControlShutdownPreparationError(
      'NODE_LINK_STOP_FAILED',
      'The Mastermind node link did not confirm its exact exit before Minecraft drain.',
      { cause },
    );
  }

  if (options.minecraftAgentManaged && !options.alreadyDrained) {
    try {
      await options.drainMinecraft();
    } catch (cause) {
      throw new LocalControlShutdownPreparationError(
        'MINECRAFT_DRAIN_FAILED',
        'Minecraft did not confirm a safe authenticated drain.',
        { cause },
      );
    }
  }

  return Object.freeze({
    nodeLinkStopped: true,
    minecraftDrained: options.alreadyDrained || options.minecraftAgentManaged,
  });
}
