import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../../src/core/event-bus.js';

describe('createEventBus', () => {
  it('calls handler when matching event is emitted', () => {
    const bus = createEventBus();
    let received;
    bus.on('test:event', (data) => { received = data; });
    bus.emit('test:event', { value: 42 });
    assert.deepEqual(received, { value: 42 });
  });

  it('calls multiple handlers registered for the same event', () => {
    const bus = createEventBus();
    const calls = [];
    bus.on('multi', () => calls.push('a'));
    bus.on('multi', () => calls.push('b'));
    bus.emit('multi');
    assert.deepEqual(calls, ['a', 'b']);
  });

  it('unsubscribes via the function returned by on()', () => {
    const bus = createEventBus();
    let count = 0;
    const unsub = bus.on('tick', () => { count++; });
    bus.emit('tick');
    unsub();
    bus.emit('tick');
    assert.equal(count, 1);
  });

  it('off() removes a specific handler', () => {
    const bus = createEventBus();
    let count = 0;
    const handler = () => { count++; };
    bus.on('ping', handler);
    bus.emit('ping');
    bus.off('ping', handler);
    bus.emit('ping');
    assert.equal(count, 1);
  });

  it('does not throw when emitting an event with no handlers', () => {
    const bus = createEventBus();
    assert.doesNotThrow(() => bus.emit('no:listeners', { x: 1 }));
  });
});
