import { render, waitFor } from '@testing-library/react';

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    dismiss: jest.fn(),
  },
}));

jest.mock('../../contexts/GameSessionContext', () => ({
  useGameSession: () => ({
    activeCampaignId: 'campaign-1',
    activeCampaign: {
      id: 'campaign-1',
      dmUserId: 'user-1',
    },
    playerVisibilityRadius: null,
    viewerRole: null,
    updateVisibilityMetadata: jest.fn(),
  }),
}));

jest.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: {
      id: 'user-1',
      roles: ['dm'],
    },
  }),
}));

jest.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connected: false,
    messages: [],
    clearMessages: jest.fn(),
    getMessagesByType: jest.fn(() => []),
  }),
}));

jest.mock('../../utils/api-client', () => ({
  apiFetch: jest.fn(async () => ({ ok: true })),
  fetchJson: jest.fn(async (path: string) => {
    if (path.includes('/players/visible')) {
      return { features: [], metadata: {} };
    }
    return [];
  }),
  readJsonBody: jest.fn(async () => ({})),
  readErrorMessage: jest.fn(() => 'error'),
}));

jest.mock('../map-data-loader', () => ({
  mapDataLoader: {
    loadWorldMaps: jest.fn(async () => ([
      {
        id: 'world-1',
        name: 'Test World',
        bounds: [0, 0, 256, 256],
      },
    ])),
    loadTileSets: jest.fn(async () => ([
      {
        id: 'tiles-1',
        base_url: 'http://example.com/{z}/{x}/{y}.png',
        min_zoom: 0,
        max_zoom: 5,
      },
    ])),
    getBoundsFromExtent: jest.fn(() => [0, 0, 256, 256]),
    getDataTypesForZoom: jest.fn(() => []),
    loadBurgs: jest.fn(async () => []),
    loadRoutes: jest.fn(async () => []),
    loadRivers: jest.fn(async () => []),
    loadCells: jest.fn(async () => []),
    loadMarkers: jest.fn(async () => []),
    loadCampaignMarkers: jest.fn(async () => []),
  },
}));

jest.mock('../map-projection', () => ({
  DEFAULT_PIXEL_EXTENT: [0, 0, 256, 256],
  questablesProjection: 'EPSG:3857',
  updateProjectionExtent: jest.fn(() => [0, 0, 256, 256]),
  PIXEL_PROJECTION_CODE: 'EPSG:3857',
}));

jest.mock('ol/ol.css', () => ({}), { virtual: true });

jest.mock('ol/control', () => ({
  defaults: () => ({}),
}));

type MapViewMock = {
  on: jest.Mock;
  un: jest.Mock;
  setMinZoom: jest.Mock;
  setMaxZoom: jest.Mock;
  getZoom: jest.Mock;
  setZoom: jest.Mock;
  getZoomForResolution: jest.Mock;
  setCenter: jest.Mock;
  calculateExtent: jest.Mock;
  getResolution: jest.Mock;
  getMaxZoom: jest.Mock;
  setProperties: jest.Mock;
  animate: jest.Mock;
};

const createViewMock = (): MapViewMock => ({
  on: jest.fn(),
  un: jest.fn(),
  setMinZoom: jest.fn(),
  setMaxZoom: jest.fn(),
  getZoom: jest.fn(() => 2),
  setZoom: jest.fn(),
  getZoomForResolution: jest.fn(() => 2),
  setCenter: jest.fn(),
  calculateExtent: jest.fn(() => [0, 0, 256, 256]),
  getResolution: jest.fn(() => 1),
  getMaxZoom: jest.fn(() => 20),
  setProperties: jest.fn(),
  animate: jest.fn(),
});

type MapOptionsMock = {
  view?: MapViewMock;
};

jest.mock('ol/Map', () => {
  const MapMock = jest.fn((options: MapOptionsMock = {}) => {
    const view = options.view ?? createViewMock();

    const instance = {
      on: jest.fn(),
      un: jest.fn(),
      dispose: jest.fn(),
      getView: jest.fn(() => view),
      getSize: jest.fn(() => [1024, 768]),
      renderSync: jest.fn(),
      getLayers: jest.fn(() => ({ getArray: jest.fn(() => []) })),
      getTargetElement: jest.fn(() => ({ style: {} })),
      forEachFeatureAtPixel: jest.fn(() => null),
    };

    return instance;
  });

  return {
    __esModule: true,
    default: MapMock,
  };
});

jest.mock('ol/View', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    on: jest.fn(),
    un: jest.fn(),
    setMinZoom: jest.fn(),
    setMaxZoom: jest.fn(),
    getZoom: jest.fn(() => 2),
    setZoom: jest.fn(),
    getMaxZoom: jest.fn(() => 20),
    getZoomForResolution: jest.fn(() => 2),
    setCenter: jest.fn(),
    calculateExtent: jest.fn(() => [0, 0, 256, 256]),
    setProperties: jest.fn(),
    animate: jest.fn(),
  })),
}));

type TileLayerOptionsMock = {
  source?: unknown;
};

jest.mock('ol/layer/Tile', () => ({
  __esModule: true,
  default: jest.fn((options: TileLayerOptionsMock = {}) => ({
    setSource: jest.fn(),
    getSource: () => options?.source ?? null,
    setVisible: jest.fn(),
    changed: jest.fn(),
  })),
}));

type VectorLayerOptionsMock = {
  source?: {
    clear: jest.Mock;
    addFeatures: jest.Mock;
    getFeatures: jest.Mock;
    getFeatureById: jest.Mock;
  };
  visible?: boolean;
};

const createVectorSourceMock = () => ({
  clear: jest.fn(),
  addFeatures: jest.fn(),
  getFeatures: jest.fn(() => []),
  getFeatureById: jest.fn(),
});

jest.mock('ol/layer/Vector', () => ({
  __esModule: true,
  default: jest.fn((options: VectorLayerOptionsMock = {}) => {
    let visible = Boolean(options?.visible);
    const source = options?.source ?? createVectorSourceMock();

    return {
      getSource: () => source,
      setSource: jest.fn(),
      setVisible: jest.fn((next: boolean) => {
        visible = next;
      }),
      getVisible: jest.fn(() => visible),
      changed: jest.fn(),
    };
  }),
}));

jest.mock('ol/source/Vector', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    clear: jest.fn(),
    addFeatures: jest.fn(),
    getFeatures: jest.fn(() => []),
    getFeatureById: jest.fn(),
  })),
}));

jest.mock('ol/source/XYZ', () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));

jest.mock('ol/tilegrid/TileGrid', () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));

jest.mock('ol', () => ({
  __esModule: true,
  Overlay: jest.fn(() => ({
    setPosition: jest.fn(),
    getPosition: jest.fn(),
  })),
}));

jest.mock('ol/style', () => ({
  __esModule: true,
  Style: jest.fn(function Style() {}),
  Fill: jest.fn(function Fill() {}),
  Stroke: jest.fn(function Stroke() {}),
  Circle: jest.fn(function Circle() {}),
  CircleStyle: jest.fn(function CircleStyle() {}),
  Text: jest.fn(function Text() {}),
}));

jest.mock('ol/Feature', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    set: jest.fn(),
    get: jest.fn(),
    getProperties: jest.fn(() => ({})),
  })),
}));

jest.mock('ol/geom/Point', () => ({
  __esModule: true,
  default: jest.fn(function Point() {}),
}));

jest.mock('ol/geom/LineString', () => ({
  __esModule: true,
  default: jest.fn(function LineString() {}),
}));

jest.mock('ol/format/GeoJSON', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    readFeature: jest.fn(() => ({
      getGeometry: jest.fn(),
      getProperties: jest.fn(() => ({})),
    })),
  })),
}));

import { OpenLayersMap } from '../openlayers-map';

describe('OpenLayersMap health-check regression', () => {
  test('does not recreate map on re-render', async () => {
    (globalThis as Record<string, unknown>).__questablesMapInitCount = 0;

    const { rerender } = render(<OpenLayersMap />);

    await waitFor(() => {
      const count = (globalThis as Record<string, unknown>).__questablesMapInitCount as number | undefined;
      expect((count ?? 0) > 0).toBe(true);
    });

    const callCountAfterMount = Number((globalThis as Record<string, unknown>).__questablesMapInitCount ?? 0);

    rerender(<OpenLayersMap />);

    await waitFor(() => {
      const count = Number((globalThis as Record<string, unknown>).__questablesMapInitCount ?? 0);
      expect(count).toBe(callCountAfterMount);
    });
  });
});
