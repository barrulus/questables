import { useState } from "react";
import { MapList } from "./map-list";
import { MapUploadWizard } from "./map-upload-wizard";

interface MapsTabProps {
  userId: string;
}

export function MapsTab({ userId }: MapsTabProps) {
  const [showWizard, setShowWizard] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  if (showWizard) {
    return (
      <MapUploadWizard
        userId={userId}
        onClose={() => {
          setShowWizard(false);
          setRefreshKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <MapList
      key={refreshKey}
      onUploadNew={() => setShowWizard(true)}
    />
  );
}
