import { describe, expect, it } from "vitest";
import { silenceBounds } from "./audioTrim";

describe("silenceBounds", () => {
  it("cuts leading and trailing samples below the threshold", () => {
    expect(silenceBounds(new Float32Array([0, 0.001, -0.002, 0.5, -0.4, 0.002, 0]))).toEqual([3, 5]);
  });

  it("treats negative peaks like positive ones and keeps quiet samples inside the speech", () => {
    expect(silenceBounds(new Float32Array([0, -0.2, 0, 0, 0.3, 0]))).toEqual([1, 5]);
  });

  it("returns [0, 0] for silence and for an empty buffer", () => {
    expect(silenceBounds(new Float32Array([0, 0.001, -0.001]))).toEqual([0, 0]);
    expect(silenceBounds(new Float32Array(0))).toEqual([0, 0]);
  });

  it("keeps a clip without silence whole and honours a custom threshold", () => {
    expect(silenceBounds(new Float32Array([0.5, 0.5]))).toEqual([0, 2]);
    expect(silenceBounds(new Float32Array([0.05, 0.2, 0.05]), 0.1)).toEqual([1, 2]);
  });
});
