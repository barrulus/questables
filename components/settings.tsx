import { FeatureUnavailable } from "./feature-unavailable";

export function Settings() {
  return (
    <FeatureUnavailable
      feature="Settings"
      reason="This panel previously surfaced hardcoded user records. Until the user-management APIs are available, we refuse to show fabricated data."
      remediation="Expose real admin/user settings endpoints and gate the panel on authenticated responses before re-enabling controls here."
    />
  );
}
