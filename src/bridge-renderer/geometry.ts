export interface RectLike {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BridgeGeometry {
  readonly start: Point;
  readonly end: Point;
  readonly path: string;
}

export const anchorPoint = (
  worldRect: RectLike,
  anchorRect: RectLike,
  side: 'left' | 'right',
): Point => ({
  x: (side === 'right' ? anchorRect.right : anchorRect.left) - worldRect.left,
  y: anchorRect.top - worldRect.top + anchorRect.height / 2,
});

export const routeBridge = (start: Point, end: Point): BridgeGeometry => {
  const horizontalDistance = Math.abs(end.x - start.x);
  const bend = Math.max(48, Math.min(180, horizontalDistance * 0.45));
  const direction = end.x >= start.x ? 1 : -1;
  const controlOne = start.x + bend * direction;
  const controlTwo = end.x - bend * direction;
  return {
    start,
    end,
    path: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${controlOne.toFixed(1)} ${start.y.toFixed(1)}, ${controlTwo.toFixed(1)} ${end.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
  };
};

export const measureBridge = (
  worldRect: RectLike,
  sourceRect: RectLike,
  targetRect: RectLike,
): BridgeGeometry => routeBridge(anchorPoint(worldRect, sourceRect, 'right'), anchorPoint(worldRect, targetRect, 'left'));
