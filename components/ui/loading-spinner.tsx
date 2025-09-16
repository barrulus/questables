import { Loader2 } from "lucide-react";

interface LoadingSpinnerProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  text?: string;
}

const sizeClasses = {
  sm: "w-4 h-4",
  md: "w-8 h-8", 
  lg: "w-12 h-12"
};

export function LoadingSpinner({ className, size = "md", text }: LoadingSpinnerProps) {
  const containerClasses = `flex flex-col items-center justify-center ${className || ''}`;
  const spinnerClasses = `animate-spin ${sizeClasses[size]} ${text ? 'mb-2' : ''}`;
  
  return (
    <div className={containerClasses}>
      <Loader2 className={spinnerClasses} />
      {text && <p className="text-muted-foreground text-sm">{text}</p>}
    </div>
  );
}

export function LoadingCard({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="p-8 text-center">
      <LoadingSpinner size="lg" text={text} />
    </div>
  );
}