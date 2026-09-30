/**
 * [start, end) sample range left after cutting leading and trailing near-silence (|sample| < threshold;
 * 0.003 ≈ −50 dBFS). All-silent or empty input → [0, 0].
 * MP3 encoder padding and TTS edge silence would otherwise leave audible gaps between concatenated clips.
 */
export function silenceBounds(samples: Float32Array, threshold = 0.003): [number, number] {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start += 1;
  if (start === samples.length) return [0, 0];
  let end = samples.length;
  while (end > start && Math.abs(samples[end - 1]) < threshold) end -= 1;
  return [start, end];
}
