/**
 * Fraunhofer, paraxial model for two identical, uniformly illuminated slits.
 * Parameters: wavelength in nm, separation/slitWidth in mm, distance in m,
 * phase in degrees. Screen positions and the exported distances are in mm.
 * Each mode is normalized independently; this does not compare total power.
 */
export const DEFAULT_PARAMS = Object.freeze({
  wavelength: 520,
  separation: 0.25,
  slitWidth: 0.05,
  distance: 1.5,
  phase: 0,
  mode: 'double',
});

const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

function geometry(params = DEFAULT_PARAMS) {
  return {
    wavelength: positive(params.wavelength, DEFAULT_PARAMS.wavelength) * 1e-6,
    separation: positive(params.separation, DEFAULT_PARAMS.separation),
    slitWidth: positive(params.slitWidth, DEFAULT_PARAMS.slitWidth),
    distance: positive(params.distance, DEFAULT_PARAMS.distance) * 1000,
    phase: Number.isFinite(params.phase) ? params.phase * Math.PI / 180 : 0,
    mode: params.mode ?? 'double',
  };
}

/** sinc(x) = sin(x)/x, with its removable singularity filled at zero. */
export function sinc(x) {
  if (Math.abs(x) < 1e-5) return 1 - x * x / 6;
  return Math.sin(x) / x;
}

/**
 * Propagation-direction view of the fixed far-field, small-angle model.
 * depthFraction is z/L, clamped to [0.04, 1]; yEff = yMm/(z/L).
 * This is not an exact near-slit field or a simulated propagation delay.
 * amplitude is a signed far-field envelope, excluding a common carrier.
 * Distinguishable paths have no combined coherent amplitude (null).
 */
export function fieldAt(yMm, depthFraction, params = DEFAULT_PARAMS) {
  const g = geometry(params);
  const z = clamp(Number.isNaN(depthFraction) || depthFraction === undefined ? 1 : depthFraction, 0.04, 1);
  const yEff = yMm / z;
  if (!Number.isFinite(yEff)) return { amplitude: g.mode === 'observed' ? null : 0, intensity: 0, envelope: 0 };
  const beta = Math.PI * g.slitWidth * yEff / (g.wavelength * g.distance);
  const slitAmplitude = sinc(beta);
  const envelope = clamp(slitAmplitude ** 2, 0, 1);
  if (g.mode === 'observed') return { amplitude: null, intensity: envelope, envelope };
  const alpha = Math.PI * g.separation * yEff / (g.wavelength * g.distance) + g.phase / 2;
  const amplitude = g.mode === 'single' ? slitAmplitude : slitAmplitude * Math.cos(alpha);
  return { amplitude, intensity: clamp(amplitude ** 2, 0, 1), envelope };
}

/** Relative screen intensity: exactly the field at depthFraction = 1. */
export function intensityAt(yMm, params = DEFAULT_PARAMS) {
  return fieldAt(yMm, 1, params).intensity;
}

/** Spacing of adjacent interference maxima (without envelope correction). */
export function deltaMm(params = DEFAULT_PARAMS) {
  const g = geometry(params);
  return g.wavelength * g.distance / g.separation;
}

/** Distance from the optical axis to the first single-slit minimum. */
export function envelopeZeroMm(params = DEFAULT_PARAMS) {
  const g = geometry(params);
  return g.wavelength * g.distance / g.slitWidth;
}

/** Signed geometrical path difference, using the same paraxial model. */
export function pathDifferenceMm(yMm, params = DEFAULT_PARAMS) {
  const g = geometry(params);
  return g.separation * yMm / g.distance;
}

/**
 * Sample a detection coordinate by rejection sampling. The result is
 * conditional on arriving inside [-extentMm, extentMm]. random must return
 * independent values in [0,1), as Math.random does.
 */
export function sampleHit(params = DEFAULT_PARAMS, random = Math.random, extentMm = 15) {
  const extent = positive(extentMm, 15);
  for (;;) {
    const yMm = (random() * 2 - 1) * extent;
    if (random() < intensityAt(yMm, params)) return yMm;
  }
}

/** Approximate visible-spectrum display color, not a calibrated color model. */
export function wavelengthRGB(nm) {
  const w = clamp(Number.isFinite(nm) ? nm : 520, 380, 780);
  let r = 0, g = 0, b = 0;
  if (w < 440) { r = (440 - w) / 60; b = 1; }
  else if (w < 490) { g = (w - 440) / 50; b = 1; }
  else if (w < 510) { g = 1; b = (510 - w) / 20; }
  else if (w < 580) { r = (w - 510) / 70; g = 1; }
  else if (w < 645) { r = 1; g = (645 - w) / 65; }
  else { r = 1; }
  const sensitivity = w < 420 ? 0.3 + 0.7 * (w - 380) / 40
    : w > 700 ? 0.3 + 0.7 * (780 - w) / 80 : 1;
  return [r, g, b].map(c => Math.round(255 * (c * sensitivity) ** 0.8)).join(',');
}
