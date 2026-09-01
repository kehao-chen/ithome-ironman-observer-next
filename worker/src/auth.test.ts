import { describe, expect, test } from "bun:test";
import { authorizeDispatch, bearerToken, timingSafeEqual } from "./auth";

describe("bearerToken", () => {
  test("extracts the token from a well-formed header", () => {
    expect(bearerToken("Bearer s3cret")).toBe("s3cret");
  });

  test("tolerates surrounding and inner whitespace", () => {
    expect(bearerToken("  Bearer   s3cret  ")).toBe("s3cret");
    expect(bearerToken("Bearer\ts3cret")).toBe("s3cret");
  });

  test("rejects a missing, empty or non-bearer header", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Basic s3cret")).toBeNull();
    expect(bearerToken("s3cret")).toBeNull();
  });
});

describe("timingSafeEqual", () => {
  test("matches identical strings", async () => {
    expect(await timingSafeEqual("s3cret", "s3cret")).toBe(true);
    expect(await timingSafeEqual("", "")).toBe(true);
  });

  test("rejects differing strings regardless of length", async () => {
    expect(await timingSafeEqual("s3cret", "s3crea")).toBe(false);
    expect(await timingSafeEqual("s3cret", "s3cret-longer")).toBe(false);
    expect(await timingSafeEqual("", "s3cret")).toBe(false);
  });

  test("handles non-ASCII without throwing", async () => {
    expect(await timingSafeEqual("鐵人賽", "鐵人賽")).toBe(true);
    expect(await timingSafeEqual("鐵人賽", "鐵人")).toBe(false);
  });
});

describe("authorizeDispatch", () => {
  test("accepts the configured secret", async () => {
    expect(await authorizeDispatch("Bearer s3cret", "s3cret")).toEqual({ ok: true });
  });

  test("fails closed with 500 when the secret is unset or empty", async () => {
    expect(await authorizeDispatch("Bearer s3cret", undefined)).toEqual({
      ok: false,
      status: 500,
      message: "DISPATCH_SECRET not configured",
    });
    expect(await authorizeDispatch("Bearer s3cret", "")).toEqual({
      ok: false,
      status: 500,
      message: "DISPATCH_SECRET not configured",
    });
  });

  test("401s a request with no usable bearer token", async () => {
    expect(await authorizeDispatch(null, "s3cret")).toEqual({
      ok: false,
      status: 401,
      message: "missing bearer token",
    });
    expect(await authorizeDispatch("Basic s3cret", "s3cret")).toEqual({
      ok: false,
      status: 401,
      message: "missing bearer token",
    });
  });

  test("403s a wrong token", async () => {
    expect(await authorizeDispatch("Bearer wrong", "s3cret")).toEqual({
      ok: false,
      status: 403,
      message: "forbidden",
    });
  });
});
