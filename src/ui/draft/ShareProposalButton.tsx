import { useCallback, useState } from "react";
import { Check, Link, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { shareProposal } from "../lib/api.js";

export interface ShareProposalButtonProps {
  readonly projectId: string | undefined;
  readonly disabled?: boolean | undefined;
}

export function ShareProposalButton({
  projectId,
  disabled = false,
}: ShareProposalButtonProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async (): Promise<void> => {
    if (projectId === undefined) return;
    setBusy(true);
    setCopied(false);
    try {
      const result = await shareProposal(projectId);
      if (!result.ok) return;
      await navigator.clipboard.writeText(result.value.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  return (
    <Button
      variant="outline"
      disabled={disabled || busy || projectId === undefined}
      onClick={() => void handleShare()}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : copied ? (
        <Check className="h-4 w-4" />
      ) : (
        <Link className="h-4 w-4" />
      )}
      {copied ? "Link copied!" : "Share"}
    </Button>
  );
}
