import { describe, it, expect } from "vitest";
import { InvalidServerPortError, resolveServerPort } from "../resolveServerPort";

describe("resolveServerPort", () => {
  it("defaults to 3000 when unset", () => {
    expect(resolveServerPort(undefined)).toBe(3000);
    expect(resolveServerPort("")).toBe(3000);
  });

  it('accepts "3001"', () => {
    expect(resolveServerPort("3001")).toBe(3001);
  });

  it('accepts "8080"', () => {
    expect(resolveServerPort("8080")).toBe(8080);
  });

  it('rejects "0"', () => {
    expect(() => resolveServerPort("0")).toThrow(InvalidServerPortError);
  });

  it('rejects "-1"', () => {
    expect(() => resolveServerPort("-1")).toThrow(InvalidServerPortError);
  });

  it('rejects "65536"', () => {
    expect(() => resolveServerPort("65536")).toThrow(InvalidServerPortError);
  });

  it('rejects "3000.5"', () => {
    expect(() => resolveServerPort("3000.5")).toThrow(InvalidServerPortError);
  });

  it('rejects "abc"', () => {
    expect(() => resolveServerPort("abc")).toThrow(InvalidServerPortError);
  });
});
