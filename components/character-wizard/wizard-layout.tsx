import type { ReactNode } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { WizardSidebar } from './wizard-sidebar';

interface WizardLayoutProps {
  mainContent: ReactNode;
  previewContent: ReactNode;
}

export function WizardLayout({ mainContent, previewContent }: WizardLayoutProps) {
  return (
    <div className="flex h-full">
      <WizardSidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ScrollArea className="flex-1 h-full">
          <div className="p-8">{mainContent}</div>
        </ScrollArea>
      </div>

      <div className="w-80 bg-card border-l flex flex-col min-h-0">
        <div className="px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Character Preview</h3>
        </div>
        <ScrollArea className="flex-1 h-full">
          <div className="p-4">{previewContent}</div>
        </ScrollArea>
      </div>
    </div>
  );
}
