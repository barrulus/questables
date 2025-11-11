import { jest } from "@jest/globals";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

declare global {
  // eslint-disable-next-line no-var
  var __mockMapInstance: MockMap | null | undefined;
  // eslint-disable-next-line no-var
  var __mockViewInstance: MockView | null | undefined;
}

interface MockView {
  getZoom(): number;
  setZoom(value: number): void;
  getCenter(): [number, number];
  setCenter(center: [number, number]): void;
  fit(extent: [number, number, number, number]): void;
  calculateExtent(size: [number, number]): [number, number, number, number];
}

interface MockMap {
  trigger(event: string): void;
  getView(): MockView;
  getSize(): [number, number];
  updateSize(): void;
}

await jest.unstable_mockModule("ol/View", () => {
  class ViewMock implements MockView {
  private center: [number, number];
  private zoom: number;
  private extent: [number, number, number, number];
  private fitCount: number;
  private minZoom: number;
  private maxZoom: number;

  constructor(options: { center?: [number, number]; zoom?: number; extent?: [number, number, number, number] }) {
    this.center = options.center ?? [0, 0];
    this.zoom = options.zoom ?? 0;
    this.extent = options.extent ?? [0, 0, 100, 100];
    this.fitCount = 0;
    this.minZoom = 0;
    this.maxZoom = 20;
    globalThis.__mockViewInstance = this;
  }

    getZoom(): number {
      return this.zoom;
    }

    setZoom(value: number) {
      this.zoom = value;
    }

    getZoomForResolution(): number {
      return this.zoom;
    }

    setProperties() {}

    getCenter(): [number, number] {
      return [...this.center] as [number, number];
    }

    setCenter(center: [number, number]) {
      this.center = [center[0], center[1]];
    }

    fit(extent: [number, number, number, number]) {
      this.extent = [...extent];
      this.center = [
        (extent[0] + extent[2]) / 2,
        (extent[1] + extent[3]) / 2,
      ];
      this.zoom = 10 + this.fitCount;
      this.fitCount += 1;
    }

    getResolution(): number {
      return 1;
    }

    setResolution() {}

  calculateExtent(): [number, number, number, number] {
    return [...this.extent];
  }

  animate() {}

  setMinZoom(value: number) {
    this.minZoom = value;
  }

  setMaxZoom(value: number) {
    this.maxZoom = value;
  }
}

  return {
    __esModule: true,
    default: ViewMock,
  };
});

await jest.unstable_mockModule("ol/Map", () => {
  class MapMock implements MockMap {
    private handlers: Record<string, Set<() => void>>;
    private size: [number, number];
    private view: MockView;
    private targetElement: HTMLElement;

    constructor(options: { view?: MockView } = {}) {
      const fallbackView: MockView = options.view ?? ({
        getZoom: () => 0,
        setZoom: () => {},
        getCenter: () => [0, 0] as [number, number],
        setCenter: () => {},
        fit: () => {},
        calculateExtent: () => [0, 0, 0, 0] as [number, number, number, number],
        getZoomForResolution: () => 0,
        setProperties: () => {},
        getResolution: () => 1,
        setResolution: () => {},
        animate: () => {},
        setMinZoom: () => {},
        setMaxZoom: () => {},
      } as MockView);
      this.view = fallbackView;
      this.handlers = {};
      this.size = [1024, 768];
      this.targetElement = document.createElement("div");
      globalThis.__mockMapInstance = this;
    }

    setTarget() {}

    dispose() {}

    getView(): MockView {
      return this.view;
    }

    updateSize() {}

    getSize(): [number, number] {
      return [...this.size];
    }

    addOverlay() {}

    on(event: string, handler: () => void) {
      if (!this.handlers[event]) {
        this.handlers[event] = new Set();
      }
      this.handlers[event].add(handler);
    }

    un(event: string, handler: () => void) {
      this.handlers[event]?.delete(handler);
    }

    trigger(event: string) {
      this.handlers[event]?.forEach((handler) => handler());
    }

    getPixelFromCoordinate(): [number, number] {
      return [0, 0];
    }

    getTargetElement(): HTMLElement {
      return this.targetElement;
    }

    addInteraction() {}

    removeInteraction() {}
  }

  return {
    __esModule: true,
    default: MapMock,
  };
});

await jest.unstable_mockModule("../components/layers", () => {
  const createSource = () => ({
    clear: jest.fn(),
    addFeatures: jest.fn(),
    addFeature: jest.fn(),
  });

  const createVectorLayer = () => {
    const source = createSource();
    return {
      getSource: () => source,
      setSource: jest.fn(),
      setVisible: jest.fn(),
    };
  };

  const createPointLayer = () => {
    const source = createSource();
    return {
      getSource: () => source,
      setVisible: jest.fn(),
    };
  };

  const createTileLayer = () => ({
    setSource: jest.fn(),
    setVisible: jest.fn(),
    setOpacity: jest.fn(),
    changed: jest.fn(),
  });

  return {
    __esModule: true,
    createBaseTileLayer: createTileLayer,
    createBurgsLayer: createVectorLayer,
    createRoutesLayer: createVectorLayer,
    createRiversLayer: createVectorLayer,
    createMarkersLayer: createVectorLayer,
    createCellsLayer: createVectorLayer,
    createRegionLayer: createVectorLayer,
    createDrawLayer: () => ({
      layer: createVectorLayer(),
      source: {
        clear: jest.fn(),
      },
    }),
    createSpawnLayer: createPointLayer,
    createHighlightLayer: () => ({
      getSource: () => ({
        clear: jest.fn(),
        addFeature: jest.fn(),
      }),
      setVisible: jest.fn(),
    }),
  };
});

await jest.unstable_mockModule("../components/campaign-prep-layer-visibility", () => ({
  __esModule: true,
  useLayerVisibility: () => ({
    visibility: {
      burgs: true,
      routes: true,
      rivers: false,
      markers: true,
      cells: false,
    },
    toggle: jest.fn(),
    setVisibility: jest.fn(),
  }),
}));

await jest.unstable_mockModule("../components/map-data-loader", () => ({
  __esModule: true,
  mapDataLoader: {
    loadTileSets: jest.fn(async () => [
      {
        id: "tiles-1",
        name: "Primary",
        base_url: "https://tiles.example.com",
      },
    ]),
    getBoundsFromExtent: jest.fn(() => ({
      west: 0,
      south: 0,
      east: 100,
      north: 100,
    })),
    getDataTypesForZoom: jest.fn(() => []),
    loadBurgs: jest.fn(async () => []),
    loadRoutes: jest.fn(async () => []),
    loadRivers: jest.fn(async () => []),
    loadMarkers: jest.fn(async () => []),
    loadCells: jest.fn(async () => []),
  },
}));

await jest.unstable_mockModule("../components/maps/questables-tile-source", () => ({
  __esModule: true,
  createQuestablesTileSource: jest.fn(() => ({})),
}));

await jest.unstable_mockModule("../components/maps/questables-style-factory", () => ({
  __esModule: true,
  createBurgStyleFactory: () => () => null,
  createMarkerStyleFactory: () => () => null,
  createRouteStyleFactory: () => () => null,
  getCellStyle: () => null,
  getRiverStyle: () => null,
}));

await jest.unstable_mockModule("ol/style", () => ({
  __esModule: true,
  Circle: class {},
  Fill: class {},
  Stroke: class {},
  Style: class {},
  Text: class {},
}));

await jest.unstable_mockModule("ol/extent", () => ({
  __esModule: true,
  getCenter: (extent: [number, number, number, number]) => [
    (extent[0] + extent[2]) / 2,
    (extent[1] + extent[3]) / 2,
  ],
  getWidth: (extent: [number, number, number, number]) => Math.abs(extent[2] - extent[0]),
  getHeight: (extent: [number, number, number, number]) => Math.abs(extent[3] - extent[1]),
  applyTransform: (extent: [number, number, number, number]) => extent,
  createEmpty: () => [0, 0, 0, 0] as [number, number, number, number],
  createOrUpdateFromFlatCoordinates: (
    _extent: [number, number, number, number],
    flatCoordinates: number[],
  ) => {
    if (flatCoordinates.length >= 4) {
      return [
        flatCoordinates[0],
        flatCoordinates[1],
        flatCoordinates[2],
        flatCoordinates[3],
      ] as [number, number, number, number];
    }
    return [0, 0, 0, 0] as [number, number, number, number];
  },
  forEachCorner: (
    extent: [number, number, number, number],
    callback: (corner: [number, number]) => void,
  ) => {
    const corners: [number, number][] = [
      [extent[0], extent[1]],
      [extent[0], extent[3]],
      [extent[2], extent[1]],
      [extent[2], extent[3]],
    ];
    corners.forEach(callback);
  },
  createOrUpdateEmpty: () => [0, 0, 0, 0] as [number, number, number, number],
  returnOrUpdate: (
    extent: [number, number, number, number],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ) => {
    extent[0] = minX;
    extent[1] = minY;
    extent[2] = maxX;
    extent[3] = maxY;
    return extent;
  },
  createOrUpdate: (
    extent: [number, number, number, number],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ) => {
    extent[0] = minX;
    extent[1] = minY;
    extent[2] = maxX;
    extent[3] = maxY;
    return extent;
  },
  intersects: () => true,
  closestSquaredDistanceXY: () => 0,
  extend: (
    extent: [number, number, number, number],
    other: [number, number, number, number],
  ) => {
    extent[0] = Math.min(extent[0], other[0]);
    extent[1] = Math.min(extent[1], other[1]);
    extent[2] = Math.max(extent[2], other[2]);
    extent[3] = Math.max(extent[3], other[3]);
    return extent;
  },
  extendFlatCoordinates: (
    extent: [number, number, number, number],
    flatCoordinates: number[],
    offset: number,
    end: number,
    stride: number,
  ) => {
    for (let i = offset; i < end; i += stride) {
      const x = flatCoordinates[i];
      const y = flatCoordinates[i + 1];
      if (x < extent[0]) extent[0] = x;
      if (y < extent[1]) extent[1] = y;
      if (x > extent[2]) extent[2] = x;
      if (y > extent[3]) extent[3] = y;
    }
    return extent;
  },
  intersectsSegment: () => true,
  containsXY: () => true,
  createOrUpdateFromCoordinate: (
    extent: [number, number, number, number],
    coordinate: [number, number],
    skipNaN?: boolean,
  ) => {
    const [x, y] = coordinate;
    if (!skipNaN || (Number.isFinite(x) && Number.isFinite(y))) {
      if (x < extent[0]) extent[0] = x;
      if (y < extent[1]) extent[1] = y;
      if (x > extent[2]) extent[2] = x;
      if (y > extent[3]) extent[3] = y;
    }
    return extent;
  },
  equals: () => true,
  containsExtent: () => true,
  wrapAndSliceX: (
    _extent: [number, number, number, number],
    _minX: number,
    _maxX: number,
  ) => {},
}));

await jest.unstable_mockModule("ol/control", () => ({
  __esModule: true,
  defaults: jest.fn(() => []),
}));

await jest.unstable_mockModule("ol/Feature", () => ({
  __esModule: true,
  default: class {
    setStyle() {}
    getGeometry() {
      return {
        getExtent: () => [0, 0, 1, 1],
      };
    }
  },
}));

await jest.unstable_mockModule("ol/geom/Point", () => ({
  __esModule: true,
  default: class {
    constructor(public coordinates: [number, number]) {
      this.coordinates = coordinates;
    }
  },
}));

await jest.unstable_mockModule("ol/geom/Polygon", () => ({
  __esModule: true,
  default: class {
    constructor(public coordinates: number[][][]) {
      this.coordinates = coordinates;
    }
    getCoordinates() {
      return this.coordinates;
    }
  },
}));

await jest.unstable_mockModule("ol/geom/MultiPolygon", () => ({
  __esModule: true,
  default: class {},
}));

await jest.unstable_mockModule("ol/format/GeoJSON", () => ({
  __esModule: true,
  default: class {
    readFeature() {
      return null;
    }
    writeGeometryObject() {
      return {};
    }
  },
}));

await jest.unstable_mockModule("ol/interaction/Draw", () => ({
  __esModule: true,
  default: class {
    on() {}
  },
}));

await jest.unstable_mockModule("ol", () => ({
  __esModule: true,
  Overlay: class {},
}));

await jest.unstable_mockModule("sonner", () => ({
  __esModule: true,
  toast: {
    error: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
  },
}));

await jest.unstable_mockModule("../components/ui/utils", () => ({
  __esModule: true,
  cn: (...values: string[]) => values.filter(Boolean).join(" "),
}));

await jest.unstable_mockModule("../components/ui/button", () => ({
  __esModule: true,
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

await jest.unstable_mockModule("../components/ui/select", () => ({
  __esModule: true,
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));

await jest.unstable_mockModule("../components/ui/checkbox", () => ({
  __esModule: true,
  Checkbox: () => <input type="checkbox" />,
}));

await jest.unstable_mockModule("../components/ui/badge", () => ({
  __esModule: true,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

await jest.unstable_mockModule("../components/ui/skeleton", () => ({
  __esModule: true,
  Skeleton: () => <div>Loading…</div>,
}));

await jest.unstable_mockModule("../components/ui/loading-spinner", () => ({
  __esModule: true,
  LoadingSpinner: () => <div>Loading…</div>,
}));

const { CampaignPrepMap } = await import("../components/campaign-prep-map");
const mockedMapDataLoader = (await import("../components/map-data-loader")).mapDataLoader as {
  loadTileSets: jest.Mock;
  getBoundsFromExtent: jest.Mock;
  getDataTypesForZoom: jest.Mock;
  loadBurgs: jest.Mock;
  loadRoutes: jest.Mock;
  loadRivers: jest.Mock;
  loadMarkers: jest.Mock;
  loadCells: jest.Mock;
};

const worldMap = {
  id: "world-1",
  name: "Test Map",
  bounds: {
    west: 0,
    south: 0,
    east: 2048,
    north: 2048,
  },
};

const baseProps = {
  spawn: null,
  editingSpawn: false,
  canEditSpawn: false,
  worldMap,
  onRegionDrawComplete: jest.fn(),
};

const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 1024;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 768;
    },
  });

  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });

  if (typeof requestAnimationFrame === "undefined") {
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      writable: true,
      value: (cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      },
    });
  }
});

afterAll(() => {
  if (clientWidthDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
  }
  if (clientHeightDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
  }
});

describe("CampaignPrepMap viewport cache", () => {
  it("preserves manual zoom across rerenders", async () => {
    const { rerender } = render(<CampaignPrepMap {...baseProps} />);

    await waitFor(() => {
      expect(globalThis.__mockMapInstance).toBeTruthy();
      expect(globalThis.__mockViewInstance).toBeTruthy();
    });

    const mapInstance = globalThis.__mockMapInstance as MockMap;
    const viewInstance = globalThis.__mockViewInstance as MockView;

    act(() => {
      viewInstance.setZoom(7);
      viewInstance.setCenter([512, 512]);
      mapInstance.trigger("moveend");
    });

    rerender(<CampaignPrepMap {...baseProps} worldMap={{ ...worldMap }} />);

    await waitFor(() => {
      expect(viewInstance.getZoom()).toBe(7);
      expect(viewInstance.getCenter()).toEqual([512, 512]);
    });
  });

  it("debounces world layer loads on rapid moveend events", async () => {
    jest.useFakeTimers();
    const loadBurgsMock = mockedMapDataLoader.loadBurgs;
    const dataTypesMock = mockedMapDataLoader.getDataTypesForZoom;

    loadBurgsMock.mockResolvedValue([]);
    dataTypesMock.mockReturnValue(["burgs"]);

    const renderResult = render(<CampaignPrepMap {...baseProps} />);

    try {
      await waitFor(() => {
        expect(globalThis.__mockMapInstance).toBeTruthy();
      });

      // Allow the initial immediate load to complete, then reset call counters.
      await waitFor(() => {
        expect(loadBurgsMock).toHaveBeenCalled();
      });
      loadBurgsMock.mockClear();

      const mapInstance = globalThis.__mockMapInstance as MockMap;

      act(() => {
        mapInstance.trigger("moveend");
        mapInstance.trigger("moveend");
        mapInstance.trigger("moveend");
      });

      expect(loadBurgsMock).toHaveBeenCalledTimes(0);

      act(() => {
        jest.advanceTimersByTime(250);
      });

      await waitFor(() => {
        expect(loadBurgsMock).toHaveBeenCalledTimes(1);
      });
    } finally {
      jest.useRealTimers();
      dataTypesMock.mockReturnValue([]);
      loadBurgsMock.mockClear();
      renderResult.unmount();
    }
  });
});
