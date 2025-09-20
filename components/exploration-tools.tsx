import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { FeatureUnavailable } from "./feature-unavailable";

export function ExplorationTools() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exploration Tools</CardTitle>
      </CardHeader>
      <CardContent>
        <FeatureUnavailable
          feature="Exploration planning"
          reason="These controls depended on Middle-earth fixtures and random generators. No real travel, survival, or weather endpoints exist on the backend yet."
          remediation="Once the campaign travel API is defined, wire those endpoints here to surface live party status instead of scripted examples."
        />
      </CardContent>
    </Card>
  );
}
