import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { FeatureUnavailable } from "./feature-unavailable";

export function Compendium() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compendium</CardTitle>
      </CardHeader>
      <CardContent>
        <FeatureUnavailable
          feature="Rules & lore compendium"
          reason="The compendium previously shipped with fabricated entries for spells, monsters, and locations. The backend does not provide a content library yet, so the dummy dataset has been removed."
          remediation="Sync this view with the official content service or import tooling once the data contracts are agreed with the backend team."
        />
      </CardContent>
    </Card>
  );
}
