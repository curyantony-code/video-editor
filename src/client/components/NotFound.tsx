import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";

export function NotFound({ home = true }: { home?: boolean }) {
  return (
    <div data-testid="not-found">
      <EmptyState
        kind="filtered"
        title="Not found"
        description="This page doesn't exist or isn't shared with you."
        action={home ? <Button render={<Link to="/" />}>Your projects</Button> : undefined}
      />
    </div>
  );
}
