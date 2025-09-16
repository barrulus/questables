import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "./button";

interface ErrorDisplayProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorDisplay({ 
  title = "Something went wrong", 
  message, 
  onRetry,
  className 
}: ErrorDisplayProps) {
  const containerClasses = `text-center py-8 ${className || ''}`;
  
  return (
    <div className={containerClasses}>
      <AlertCircle className="w-8 h-8 mx-auto mb-4 text-red-500" />
      <h3 className="text-red-800 font-medium mb-2">{title}</h3>
      <p className="text-red-600 text-sm mb-4">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Try Again
        </Button>
      )}
    </div>
  );
}

export function ErrorCard({ title, message, onRetry }: ErrorDisplayProps) {
  return (
    <div className="p-4 border border-red-200 bg-red-50 rounded">
      <ErrorDisplay title={title} message={message} onRetry={onRetry} className="py-4" />
    </div>
  );
}