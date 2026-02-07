import { jest } from "@jest/globals";
import {
  loadWorldMapSummaries,
  peekWorldMapSummaries,
  __resetWorldMapCacheForTests,
  setWorldMapListFetcher,
} from "../utils/world-map-cache";
type ListWorldMapsFn = typeof import("../utils/api/maps")["listWorldMaps"];
const mockListWorldMaps = jest.fn<ListWorldMapsFn>();

describe("world map cache", () => {
  beforeEach(() => {
    __resetWorldMapCacheForTests();
    mockListWorldMaps.mockReset();
    setWorldMapListFetcher(mockListWorldMaps);
  });

  it("caches world map summaries after first load", async () => {
    mockListWorldMaps.mockResolvedValueOnce([
      { id: "map-1", name: "Azure Expanse", description: "  coastal world  " },
    ]);

    const first = await loadWorldMapSummaries();
    expect(first).toEqual([
      { id: "map-1", name: "Azure Expanse", description: "  coastal world  " },
    ]);
    expect(mockListWorldMaps).toHaveBeenCalledTimes(1);

    mockListWorldMaps.mockClear();

    const second = await loadWorldMapSummaries();
    expect(second).toEqual(first);
    expect(mockListWorldMaps).not.toHaveBeenCalled();
    expect(peekWorldMapSummaries()).toEqual(first);
  });

  it("forces a refresh when requested", async () => {
    mockListWorldMaps
      .mockResolvedValueOnce([{ id: "map-1", name: "Azure Expanse" }])
      .mockResolvedValueOnce([{ id: "map-1", name: "Azure Expanse v2" }]);

    await loadWorldMapSummaries();
    expect(mockListWorldMaps).toHaveBeenCalledTimes(1);

    const refreshed = await loadWorldMapSummaries({ force: true });

    expect(mockListWorldMaps).toHaveBeenCalledTimes(2);
    expect(refreshed).toEqual([{ id: "map-1", name: "Azure Expanse v2", description: null }]);
  });

  it("filters out invalid world map payloads", async () => {
    mockListWorldMaps.mockResolvedValueOnce([
      { id: "valid-id", name: "Valid Map", description: "" },
      { id: "", name: "Missing id" },
      { id: "missing-name" },
      null,
    ] as any);

    const results = await loadWorldMapSummaries();
    expect(results).toEqual([{ id: "valid-id", name: "Valid Map", description: null }]);
  });
});
