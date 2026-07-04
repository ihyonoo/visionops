import { afterEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPost } from "../src/api/client";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps default headers while posting JSON", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiPost<{ ok: boolean }>("/api/projects", { name: "demo" });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/projects",
      expect.objectContaining({
        body: JSON.stringify({ name: "demo" }),
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
        method: "POST",
      }),
    );
  });

  it("formats object detail errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            detail: {
              errors: ["data.yaml 파일이 필요합니다."],
              status: "invalid",
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 422,
          },
        );
      }),
    );

    await expect(apiGet("/api/projects/p1/datasets")).rejects.toThrow(
      "data.yaml 파일이 필요합니다.",
    );
  });
});
