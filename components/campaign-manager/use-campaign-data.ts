import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  apiFetch,
  readErrorMessage,
  readJsonBody,
} from "../../utils/api-client";
import type { Campaign } from "../campaign-shared";

export interface UseCampaignDataReturn {
  dmCampaigns: Campaign[];
  selectedCampaign: Campaign | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  selectCampaign: (campaign: Campaign | null) => void;
  refreshCampaigns: () => Promise<void>;
  loadCampaignData: (options?: { signal?: AbortSignal; mode?: "initial" | "refresh" }) => Promise<void>;
  lastSelectedCampaignIdRef: React.RefObject<string | null>;
}

export function useCampaignData(userId: string | undefined): UseCampaignDataReturn {
  const [dmCampaigns, setDmCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const lastSelectedCampaignIdRef = useRef<string | null>(null);

  const selectCampaign = useCallback((campaign: Campaign | null) => {
    if (campaign) {
      lastSelectedCampaignIdRef.current = campaign.id;
      setSelectedCampaign(campaign);
    } else {
      lastSelectedCampaignIdRef.current = null;
      setSelectedCampaign(null);
    }
  }, []);

  const loadCampaignData = useCallback(
    async ({
      signal,
      mode = "initial",
    }: { signal?: AbortSignal; mode?: "initial" | "refresh" } = {}) => {
      if (!userId) {
        selectCampaign(null);
        setDmCampaigns([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const setSpinner = (value: boolean) => {
        if (mode === "initial") {
          setLoading(value);
        } else {
          setRefreshing(value);
        }
      };

      try {
        setSpinner(true);
        setError(null);

        const response = await apiFetch(`/api/users/${userId}/campaigns`, { signal });
        if (!response.ok) {
          throw new Error(
            await readErrorMessage(response, "Failed to load user campaigns"),
          );
        }
        const data = await readJsonBody<{ dmCampaigns?: Campaign[] }>(response);
        const dmCampaignList = data.dmCampaigns ?? [];

        setDmCampaigns(dmCampaignList);

        const lastSelectedId = lastSelectedCampaignIdRef.current;
        if (lastSelectedId) {
          const matched = dmCampaignList.find((c) => c.id === lastSelectedId);
          if (matched) {
            selectCampaign(matched);
            return;
          }
        }

        if (dmCampaignList.length > 0) {
          selectCampaign(dmCampaignList[0]);
        } else {
          selectCampaign(null);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : "Failed to load campaigns";
        setError(message);
        if (mode === "refresh") toast.error(message);
      } finally {
        setSpinner(false);
      }
    },
    [userId, selectCampaign],
  );

  const refreshCampaigns = useCallback(
    () => loadCampaignData({ mode: "refresh" }),
    [loadCampaignData],
  );

  // Initial load
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    loadCampaignData({ signal: controller.signal, mode: "initial" });
    return () => controller.abort();
  }, [userId, loadCampaignData]);

  return {
    dmCampaigns,
    selectedCampaign,
    loading,
    error,
    refreshing,
    selectCampaign,
    refreshCampaigns,
    loadCampaignData,
    lastSelectedCampaignIdRef,
  };
}
