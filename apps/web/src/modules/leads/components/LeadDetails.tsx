import type { Lead } from "../api/leadsTypes";

type Props = {
  lead: Lead;
  onChange: (lead: Lead) => void;
  onConflict: () => void;
};

export function LeadDetails(_props: Props) {
  return null;
}
