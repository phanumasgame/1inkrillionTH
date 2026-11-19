export const PIXELS_PER_METER = 2;
export const METERS_PER_POINT = 10;

const clamp = value => Math.max(0, Math.min(1, value));
const ease = progress => progress ** 3 * (progress * (progress * 6 - 15) + 10);

export function descentDuration(points) {
  return points > 0 ? Math.round(1580 + Math.min(points, 100) * 13) : 800;
}

export function descentFrame({ fromDepth, toDepth, startedAt, endsAt, now, height, reducedMotion = false }) {
  const duration = Math.max(1, endsAt - startedAt);
  const elapsed = now - startedAt;
  const intro = Math.min(100, duration * .08);
  const settle = Math.min(360, duration * .22);
  const travel = duration - intro - settle;
  const progress = reducedMotion ? 1 : clamp((elapsed - intro) / travel);
  const eased = ease(progress);
  const depth = fromDepth + (toDepth - fromDepth) * eased;
  const surfaceAtStart = height * .21;
  const anchor = height * .40;
  const worldFrom = fromDepth * PIXELS_PER_METER;
  const worldTo = toDepth * PIXELS_PER_METER;
  const scrollFrom = Math.max(0, worldFrom - (anchor - surfaceAtStart));
  const scrollTo = Math.max(0, worldTo - (anchor - surfaceAtStart));
  const maxLag = Math.min(62, height * .07, (scrollTo - scrollFrom) * .18);
  const cameraLag = maxLag * 4 * eased * (1 - eased);
  const scroll = scrollFrom + (scrollTo - scrollFrom) * eased - cameraLag;
  const surface = surfaceAtStart - scroll;
  const objectFrom = Math.max(height * .37, surfaceAtStart + worldFrom - scrollFrom);
  const objectTo = Math.max(height * .37, surfaceAtStart + worldTo - scrollTo);
  const objectY = objectFrom + (objectTo - objectFrom) * eased + cameraLag;
  const visibility = reducedMotion ? 1 : ease(clamp(elapsed / intro));
  const handoff = reducedMotion ? 1 : ease(clamp((elapsed - (duration - settle)) / settle));
  return { depth, surface, scroll, objectY, progress, visibility, handoff,
    landed: progress >= 1, finished: elapsed >= duration };
}

export function visibleDepthRange(surface, height) {
  const from = Math.max(0, Math.floor(-surface / PIXELS_PER_METER / 25) * 25);
  const to = Math.ceil((height - surface) / PIXELS_PER_METER / 25) * 25;
  return { from, to };
}
