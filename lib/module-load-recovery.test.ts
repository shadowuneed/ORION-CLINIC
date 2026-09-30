import { describe, expect, it, vi } from 'vitest';
import { isModuleLoadFailure, listenForModuleLoadFailure } from './module-load-recovery';

describe('module navigation failure recovery', () => {
  it.each([
    'Failed to fetch dynamically imported module: http://127.0.0.1:3200/node_modules/.vite/deps/navigation.js',
    new TypeError('error loading dynamically imported module'),
    { message: 'Importing a module script failed.' },
    new Error('Loading chunk abc123 failed.'),
  ])('recognizes specific module load errors %j', reason => expect(isModuleLoadFailure(reason)).toBe(true));
  it.each([null, undefined, {}, 503, 'Failed to fetch', new Error('Forbidden'), new Error('API unavailable'), { message: 4 }])(
    'does not suppress application, authorization or general network failures %j', reason => expect(isModuleLoadFailure(reason)).toBe(false),
  );
  it('handles hostile error getters without throwing from a global handler', () => {
    expect(isModuleLoadFailure({ get message() { throw new Error('getter'); } })).toBe(false);
  });
  it.each(['unhandledrejection', 'vite:preloadError'])('offers manual recovery on %s and unregisters on cleanup', type => {
    const target = new EventTarget();
    const publish = vi.fn();
    const cleanup = listenForModuleLoadFailure(target, publish);
    const event = () => {
      const value = new Event(type, { cancelable: true });
      Object.defineProperty(value, type === 'unhandledrejection' ? 'reason' : 'payload', { value: new Error('Failed to fetch dynamically imported module: /module.js') });
      return value;
    };
    const first = event();
    target.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    cleanup();
    const after = event();
    target.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it('leaves unrelated promise errors untouched', () => {
    const target = new EventTarget();
    const publish = vi.fn();
    const cleanup = listenForModuleLoadFailure(target, publish);
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'reason', { value: new Error('Permission denied') });
    target.dispatchEvent(event);
    expect(publish).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    cleanup();
  });
});
