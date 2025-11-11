import { useCallback, useState } from "react";

export interface LayerVisibilityState {
  burgs: boolean;
  routes: boolean;
  rivers: boolean;
  markers: boolean;
  cells: boolean;
}

export const useLayerVisibility = (initial: LayerVisibilityState) => {
  const [visibility, setVisibility] = useState(initial);

  const toggle = useCallback(
    (key: keyof LayerVisibilityState, explicit?: boolean) => {
      setVisibility((prev) => ({
        ...prev,
        [key]: typeof explicit === "boolean" ? explicit : !prev[key],
      }));
    },
    [],
  );

  return { visibility, toggle };
};
