import { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";

import {
  useLayerVisibility,
  type LayerVisibilityState,
} from "../components/campaign-prep-layer-visibility";

type VisibilityController = ReturnType<typeof useLayerVisibility>;

interface HarnessProps {
  initial: LayerVisibilityState;
  onUpdate: (_controller: VisibilityController) => void;
}

function LayerVisibilityHarness({ initial, onUpdate }: HarnessProps) {
  const controller = useLayerVisibility(initial);

  useEffect(() => {
    onUpdate(controller);
  }, [controller, onUpdate]);

  return null;
}

describe("useLayerVisibility", () => {
  const baseState: LayerVisibilityState = {
    burgs: true,
    routes: true,
    rivers: false,
    markers: true,
    cells: false,
  };

  it("toggles individual layers when no explicit state is provided", async () => {
    let controller: VisibilityController | null = null;

    const { unmount } = render(
      <LayerVisibilityHarness
        initial={baseState}
        onUpdate={(next) => {
          controller = next;
        }}
      />,
    );

    await waitFor(() => {
      expect(controller).not.toBeNull();
    });

    expect(controller?.visibility).toEqual(baseState);

    await act(async () => {
      controller?.toggle("rivers");
    });

    await waitFor(() => {
      expect(controller?.visibility.rivers).toBe(true);
    });

    await act(async () => {
      controller?.toggle("rivers");
    });

    await waitFor(() => {
      expect(controller?.visibility.rivers).toBe(false);
    });

    unmount();
  });

  it("respects explicit visibility values when provided", async () => {
    let controller: VisibilityController | null = null;

    const { unmount } = render(
      <LayerVisibilityHarness
        initial={baseState}
        onUpdate={(next) => {
          controller = next;
        }}
      />,
    );

    await waitFor(() => {
      expect(controller).not.toBeNull();
    });

    await act(async () => {
      controller?.toggle("cells", true);
    });

    await waitFor(() => {
      expect(controller?.visibility.cells).toBe(true);
    });

    await act(async () => {
      controller?.toggle("cells", false);
    });

    await waitFor(() => {
      expect(controller?.visibility.cells).toBe(false);
    });

    unmount();
  });
});
