import { ScrollArea } from "./ui/scroll-area";
import { FeatureUnavailable } from "./feature-unavailable";

export function SidebarTools() {
  return (
    <div className="w-80 border-r bg-card">
      <div className="p-4 border-b">
        <h2 className="font-semibold">Character Tools</h2>
        <p className="text-sm text-muted-foreground">Live data required</p>
      </div>
      <ScrollArea className="h-[calc(100vh-120px)] p-4">
        <FeatureUnavailable
          feature="Sidebar utilities"
          reason="The previous implementation relied on hard-coded character snapshots and random dice rolls. Those placeholders have been removed per the zero-dummy policy."
          remediation="Wire this panel to real character, combat, and inventory APIs once the backend exposes lightweight summary endpoints."
        />
      </ScrollArea>
    </div>
  );
}
