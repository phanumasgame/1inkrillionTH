export const PIXELS_PER_METER = 2;
export const METERS_PER_POINT = 10;

const clamp = value => Math.max(0, Math.min(1, value));

// A deeper answer has farther to travel, while every answer gets a brief
// introduction and a visible moment on its destination before the reveal.
export function descentDuration(points) {
  return points > 0 ? Math.round(3400 + Math.min(points, 100) * 16) : 800;
}

export function descentFrame({ fromDepth, toDepth, startedAt, endsAt, now, height, reducedMotion = false }) {
  const duration = Math.max(1, endsAt - startedAt);
  const intro = Math.min(220, duration * .12);
  const settle = Math.min(400, duration * .15);
  const travel = Math.max(1, duration - intro - settle);
  const progress = reducedMotion ? 1 : clamp((now - startedAt - intro) / travel);
  const eased = progress * progress * (3 - 2 * progress);
  const depth = fromDepth + (toDepth - fromDepth) * eased;
  const surfaceAtStart = height * .21;
  const anchor = height * .40;
  const distance = Math.max(0, toDepth - fromDepth) * PIXELS_PER_METER;
  const cameraLag = reducedMotion ? 0 : Math.sin(Math.PI * progress) * Math.min(145, distance * .10);
  const scroll = Math.max(0, depth * PIXELS_PER_METER - (anchor - surfaceAtStart) - cameraLag);
  const surface = surfaceAtStart - scroll;
  const objectY = Math.max(height * .37, surface + depth * PIXELS_PER_METER);
  return { depth, surface, scroll, objectY, progress, landed: progress >= 1 };
}

export function visibleDepthRange(surface, height) {
  const from = Math.max(0, Math.floor(-surface / PIXELS_PER_METER / 25) * 25);
  const to = Math.ceil((height - surface) / PIXELS_PER_METER / 25) * 25;
  return { from, to };
}
