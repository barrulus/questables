import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { FeatureUnavailable } from "./feature-unavailable";

export function RuleBooks() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rule Books</CardTitle>
      </CardHeader>
      <CardContent>
        <FeatureUnavailable
          feature="Rule book library"
          reason="Static excerpts from the Player's Handbook and other sources were embedded directly in the UI. Those samples have been removed to keep the app honest about which publications are actually integrated."
          remediation="Integrate with a licensed rules reference or upload tooling that stores rule excerpts in the database before re-enabling this view."
        />
      </CardContent>
    </Card>
  );
}
