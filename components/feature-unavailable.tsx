import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AlertCircle } from "lucide-react";
import { cn } from "./ui/utils";

interface FeatureUnavailableProps {
  feature: string;
  reason: string;
  remediation?: string;
  className?: string;
}

export function FeatureUnavailable({ feature, reason, remediation, className }: FeatureUnavailableProps) {
  return (
    <Alert className={cn(className)}>
      <AlertCircle className="w-5 h-5" />
      <AlertTitle>{feature} is currently unavailable</AlertTitle>
      <AlertDescription>
        <p>{reason}</p>
        {remediation && <p className="mt-2">{remediation}</p>}
      </AlertDescription>
    </Alert>
  );
}
