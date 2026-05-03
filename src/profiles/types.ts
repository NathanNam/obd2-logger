export type PidCategory =
  | "engine"
  | "hybrid"
  | "battery"
  | "transmission"
  | "emissions"
  | "diagnostics"
  | "other";

export type PidDef = {
  id: string;
  display_name: string;
  ecu: string;
  mode: string;
  pid: string;
  unit: string;
  formula: string;
  category: PidCategory;
  min?: number;
  max?: number;
};

export type EcuDef = {
  request_header: string;
  response_header: string;
};

export type VehicleMatch = {
  make?: string;
  models?: string[];
  year_min?: number;
  year_max?: number;
};

export type Profile = {
  profile_id: string;
  profile_version: string;
  display_name: string;
  description: string;
  vehicle_match?: VehicleMatch;
  ecus: Record<string, EcuDef>;
  pids: PidDef[];
  sources?: string[];
  validated_against?: { vehicle: string; date: string; notes?: string }[];
};
