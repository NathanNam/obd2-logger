export type NhtsaDecoded = {
  Make: string | null;
  Model: string | null;
  ModelYear: string | null;
  Trim: string | null;
  EngineConfiguration: string | null;
  EngineCylinders: string | null;
  FuelTypePrimary: string | null;
  FuelTypeSecondary: string | null;
  BodyClass: string | null;
};

export type NhtsaResult =
  | { ok: true; raw: NhtsaDecoded; year: number | null; make: string; model: string; trim: string }
  | { ok: false; error: string };

const ENDPOINT = "https://vpic.nhtsa.dot.gov/api/vehicles/decodevin";

export async function decodeVin(vin: string, signal?: AbortSignal): Promise<NhtsaResult> {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) {
    return { ok: false, error: "Invalid VIN format." };
  }
  let json: { Results?: { Variable: string; Value: string | null }[] };
  try {
    const url = `${ENDPOINT}/${encodeURIComponent(vin)}?format=json`;
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      return { ok: false, error: `NHTSA returned HTTP ${resp.status}.` };
    }
    json = await resp.json();
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") {
      return { ok: false, error: "aborted" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const map: Record<string, string | null> = {};
  for (const row of json.Results ?? []) {
    map[row.Variable] = row.Value;
  }

  const raw: NhtsaDecoded = {
    Make: map["Make"] ?? null,
    Model: map["Model"] ?? null,
    ModelYear: map["Model Year"] ?? null,
    Trim: map["Trim"] ?? null,
    EngineConfiguration: map["Engine Configuration"] ?? null,
    EngineCylinders: map["Engine Number of Cylinders"] ?? null,
    FuelTypePrimary: map["Fuel Type - Primary"] ?? null,
    FuelTypeSecondary: map["Fuel Type - Secondary"] ?? null,
    BodyClass: map["Body Class"] ?? null,
  };

  const yearNum = raw.ModelYear ? parseInt(raw.ModelYear, 10) : NaN;
  return {
    ok: true,
    raw,
    year: Number.isFinite(yearNum) ? yearNum : null,
    make: titleCase(raw.Make),
    model: raw.Model ?? "",
    trim: raw.Trim ?? "",
  };
}

function titleCase(value: string | null): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
