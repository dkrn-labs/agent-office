/**
 * Creates a simple event bus with on/off/emit.
 * @returns {{ on: Function, off: Function, emit: Function }}
 */
export function createEventBus() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} unsubscribe function
   */
  function on(event, handler) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(handler);
    return () => off(event, handler);
  }

  /**
   * Unsubscribe a handler from an event.
   * @param {string} event
   * @param {Function} handler
   */
  function off(event, handler) {
    const handlers = listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event, calling all registered handlers.
   * @param {string} event
   * @param {*} [data]
   */
  function emit(event, data) {
    const handlers = listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(data);
    }
  }

  return { on, off, emit };
}
