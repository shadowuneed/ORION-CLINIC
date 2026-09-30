import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPathwayTransitionController, pathwayMotionDuration } from './pathway-transition';

function setup() {
  const navigate = vi.fn();
  const publish = vi.fn();
  const settled = vi.fn();
  const controller = createPathwayTransitionController({ navigate, publish, settled });
  return { controller, navigate, publish, settled };
}
const open = { from: '/patients', target: '/pathway?patientId=patient-a', label: 'Маршрут' };
const close = { from: '/pathway', target: '/patients', label: 'Пациенты' };

describe('patient workspace transition lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([open, close])('covers before navigating and waits for the mounted destination: $from', (request) => {
    const { controller, navigate, publish, settled } = setup();
    const duration = pathwayMotionDuration[request === open ? 'open' : 'close'];
    controller.start(request);
    vi.advanceTimersByTime(duration.cover - 1);
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(request.target);
    vi.advanceTimersByTime(2000);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'waiting' }));
    expect(settled).not.toHaveBeenCalled();
    controller.ready(request.from);
    expect(settled).not.toHaveBeenCalled();
    controller.ready(new URL(request.target, 'https://orion.test').pathname);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'reveal' }));
    vi.advanceTimersByTime(duration.reveal - 1);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenLastCalledWith(null);
    expect(settled).toHaveBeenCalledWith('ready', expect.objectContaining(request));
  });

  it('never pushes a stale target after navigation was cancelled or superseded', () => {
    const { controller, navigate } = setup();
    controller.start(open);
    controller.ready('/scheduling');
    vi.runAllTimers();
    expect(navigate).not.toHaveBeenCalled();
    controller.start(close);
    controller.cancel();
    vi.runAllTimers();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('releases the curtain after failed navigation and accepts another request', () => {
    const { controller, publish, settled, navigate } = setup();
    controller.start(open);
    vi.runAllTimers();
    expect(publish).toHaveBeenLastCalledWith(null);
    expect(settled).toHaveBeenCalledWith('failed', expect.objectContaining(open));
    controller.start(open);
    vi.advanceTimersByTime(pathwayMotionDuration.open.cover);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('cannot be restarted by repeat clicks and clears every timer when disposed', () => {
    const { controller, navigate } = setup();
    controller.start(open);
    controller.start(close);
    vi.advanceTimersByTime(pathwayMotionDuration.open.cover);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(open.target);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honours the destination immediately if reduced motion is enabled during cover', () => {
    const { controller, navigate, publish } = setup();
    controller.start(open);
    controller.reduceMotion();
    expect(publish).toHaveBeenLastCalledWith(null);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(open.target);
    vi.runAllTimers();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('clears navigation failures and allows redirected destinations to reveal', () => {
    const { controller, navigate, settled } = setup();
    navigate.mockImplementationOnce(() => { throw new Error('Router unavailable'); });
    controller.start(open);
    vi.advanceTimersByTime(pathwayMotionDuration.open.cover);
    expect(settled).toHaveBeenCalledWith('failed', expect.objectContaining(open));
    expect(vi.getTimerCount()).toBe(0);
    controller.start(open);
    vi.advanceTimersByTime(pathwayMotionDuration.open.cover);
    controller.ready('/sign-in');
    vi.advanceTimersByTime(pathwayMotionDuration.open.reveal);
    expect(settled).toHaveBeenLastCalledWith('ready', expect.objectContaining(open));
  });
});
