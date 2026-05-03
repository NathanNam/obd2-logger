export type Settings = {
  owner: string;
  autoDecodeVin: boolean;
  nhtsaDisclosureSeen: boolean;
  sampleRateHz: 0.5 | 1 | 2 | 5;
  rootDirHandleSet: boolean;
  activeVehicleSlug: string | null;
  rawCapture: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  owner: "",
  autoDecodeVin: true,
  nhtsaDisclosureSeen: false,
  sampleRateHz: 1,
  rootDirHandleSet: false,
  activeVehicleSlug: null,
  rawCapture: false,
};

export type Vehicle = {
  slug: string;
  owner: string;
  displayName: string;
  year: number | null;
  make: string;
  model: string;
  trim: string;
  vin: string | null;
  notes: string;
  profileId: string;
  profileVersion: string;
  createdAtUtc: string;
  lastUsedUtc: string | null;
  supportedStandardPids: string[];
  supportedProfilePids: string[];
  disabledPids: string[];
};
