import { describe, expect, it } from 'vitest';
import { measureBridge, routeBridge } from '../../src/bridge-renderer/geometry.js';

describe('bridge geometry', () => {
  it('anchors to concrete range edges after container movement', () => {
    const geometry = measureBridge(
      { left: 100, right: 900, top: 50, bottom: 700, width: 800, height: 650 },
      { left: 140, right: 210, top: 100, bottom: 120, width: 70, height: 20 },
      { left: 540, right: 640, top: 250, bottom: 270, width: 100, height: 20 },
    );
    expect(geometry.start).toEqual({ x: 110, y: 60 });
    expect(geometry.end).toEqual({ x: 440, y: 210 });
    expect(geometry.path).toContain('C');
  });

  it('routes deterministic backlinks for recursion', () => {
    expect(routeBridge({ x: 500, y: 200 }, { x: 100, y: 80 }).path).toBe(routeBridge({ x: 500, y: 200 }, { x: 100, y: 80 }).path);
  });
});
