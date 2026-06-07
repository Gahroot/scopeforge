import { useState } from "react";
import { Building2, Plus, Store } from "lucide-react";
import {
  BrandImportDialog,
  type BrandImportProjectUpdate,
  type BrandRole,
} from "./BrandImportDialog.js";
import type { ProposalBrand } from "../../proposal/types.js";

export interface BrandBarProps {
  readonly vendorBrand: ProposalBrand | null;
  readonly clientBrand: ProposalBrand | null;
  readonly projectId: string | null;
  readonly baseVersionId: string | null;
  readonly displayName: string | null;
  readonly onImported: (
    role: BrandRole,
    brand: ProposalBrand,
    projectUpdate?: BrandImportProjectUpdate,
  ) => void;
}

interface SlotProps {
  readonly label: string;
  readonly brand: ProposalBrand | null;
  readonly icon: JSX.Element;
  readonly onOpen: () => void;
}

function BrandSlot({ label, brand, icon, onOpen }: SlotProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {icon}
      <span className="text-muted-foreground">{label}:</span>
      {brand === null ? (
        <span className="flex items-center gap-0.5 font-medium">
          <Plus className="h-3 w-3" />
          Add
        </span>
      ) : (
        <span className="max-w-[10rem] truncate font-medium">{brand.name}</span>
      )}
    </button>
  );
}

export function BrandBar({
  vendorBrand,
  clientBrand,
  projectId,
  baseVersionId,
  displayName,
  onImported,
}: BrandBarProps): JSX.Element {
  const [openRole, setOpenRole] = useState<BrandRole | null>(null);

  return (
    <div className="flex items-center gap-2">
      <BrandSlot
        label="My brand"
        brand={vendorBrand}
        icon={<Store className="h-3.5 w-3.5" />}
        onOpen={() => setOpenRole("vendor")}
      />
      <BrandSlot
        label="Client"
        brand={clientBrand}
        icon={<Building2 className="h-3.5 w-3.5" />}
        onOpen={() => setOpenRole("client")}
      />
      <span className="hidden text-[11px] text-muted-foreground sm:inline">
        Imported so the AI won't re-ask.
      </span>
      {openRole !== null && (
        <BrandImportDialog
          role={openRole}
          projectId={projectId}
          baseVersionId={baseVersionId}
          displayName={displayName}
          onImported={onImported}
          onClose={() => setOpenRole(null)}
        />
      )}
    </div>
  );
}
