import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AlertCircle, MessageSquare } from "lucide-react";

export function DiceRoller() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dice Roller</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="w-5 h-5" />
          <AlertTitle>Use chat for verifiable dice rolls</AlertTitle>
          <AlertDescription>
            Dice rolls must be executed through the campaign chat so every result is
            persisted via the `/api/campaigns/:id/messages` endpoint with
            `message_type = "dice_roll"`. The standalone roller is disabled until the
            backend exposes a dedicated dice service.
          </AlertDescription>
        </Alert>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <MessageSquare className="w-4 h-4" />
          <span>
            Open the chat panel and use `/roll` commands (for example `/roll d20+5`) to
            broadcast authenticated dice results to the whole party.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
