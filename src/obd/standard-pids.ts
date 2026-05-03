import type { PidDef } from "../profiles/types";

// Subset of the standard mode-01 PID dictionary covering the most useful signals.
// Anything probed-supported but not in this dictionary is logged as raw hex
// (the CSV column is named pid_<hex> and the cell is the raw payload).
//
// Source: SAE J1979 / Wikipedia OBD-II PIDs.

export const STANDARD_MODE_01: PidDef[] = [
  { id: "pids_supported_01_20", display_name: "Supported PIDs 01-20", ecu: "engine", mode: "01", pid: "00", unit: "", formula: "0", category: "diagnostics" },
  { id: "monitor_status",       display_name: "Monitor status",        ecu: "engine", mode: "01", pid: "01", unit: "",   formula: "0", category: "diagnostics" },
  { id: "fuel_system_status",   display_name: "Fuel system status",    ecu: "engine", mode: "01", pid: "03", unit: "",   formula: "0", category: "engine" },
  { id: "engine_load",          display_name: "Engine load",           ecu: "engine", mode: "01", pid: "04", unit: "%",  formula: "A*100/255",       category: "engine", min: 0, max: 100 },
  { id: "coolant_temp",         display_name: "Coolant temp",          ecu: "engine", mode: "01", pid: "05", unit: "°C", formula: "A-40",            category: "engine", min: -40, max: 215 },
  { id: "stft_b1",              display_name: "Short fuel trim B1",    ecu: "engine", mode: "01", pid: "06", unit: "%",  formula: "A*100/128-100",   category: "emissions" },
  { id: "ltft_b1",              display_name: "Long fuel trim B1",     ecu: "engine", mode: "01", pid: "07", unit: "%",  formula: "A*100/128-100",   category: "emissions" },
  { id: "fuel_pressure",        display_name: "Fuel pressure",         ecu: "engine", mode: "01", pid: "0A", unit: "kPa",formula: "A*3",             category: "engine" },
  { id: "intake_map",           display_name: "Intake MAP",            ecu: "engine", mode: "01", pid: "0B", unit: "kPa",formula: "A",               category: "engine" },
  { id: "rpm",                  display_name: "Engine RPM",            ecu: "engine", mode: "01", pid: "0C", unit: "rpm",formula: "(A*256+B)/4",     category: "engine", min: 0, max: 8000 },
  { id: "speed",                display_name: "Vehicle speed",         ecu: "engine", mode: "01", pid: "0D", unit: "km/h",formula: "A",              category: "engine", min: 0, max: 255 },
  { id: "timing_advance",       display_name: "Timing advance",        ecu: "engine", mode: "01", pid: "0E", unit: "°",  formula: "A/2-64",          category: "engine" },
  { id: "iat",                  display_name: "Intake air temp",       ecu: "engine", mode: "01", pid: "0F", unit: "°C", formula: "A-40",            category: "engine" },
  { id: "maf",                  display_name: "MAF",                   ecu: "engine", mode: "01", pid: "10", unit: "g/s",formula: "(A*256+B)/100",   category: "engine" },
  { id: "throttle_pos",         display_name: "Throttle position",     ecu: "engine", mode: "01", pid: "11", unit: "%",  formula: "A*100/255",       category: "engine" },
  { id: "o2_b1s1",              display_name: "O2 B1S1 voltage",       ecu: "engine", mode: "01", pid: "14", unit: "V",  formula: "A/200",           category: "emissions" },
  { id: "o2_b1s2",              display_name: "O2 B1S2 voltage",       ecu: "engine", mode: "01", pid: "15", unit: "V",  formula: "A/200",           category: "emissions" },
  { id: "run_time",             display_name: "Run time since start",  ecu: "engine", mode: "01", pid: "1F", unit: "s",  formula: "A*256+B",         category: "engine" },
  { id: "obd_standard",         display_name: "OBD standard",          ecu: "engine", mode: "01", pid: "1C", unit: "",   formula: "A",               category: "diagnostics" },
  { id: "distance_with_mil",    display_name: "Distance with MIL on",  ecu: "engine", mode: "01", pid: "21", unit: "km", formula: "A*256+B",         category: "diagnostics" },
  { id: "fuel_rail_pressure",   display_name: "Fuel rail pressure",    ecu: "engine", mode: "01", pid: "23", unit: "kPa",formula: "(A*256+B)*10",    category: "engine" },
  { id: "egr_command",          display_name: "Commanded EGR",         ecu: "engine", mode: "01", pid: "2C", unit: "%",  formula: "A*100/255",       category: "emissions" },
  { id: "egr_error",            display_name: "EGR error",             ecu: "engine", mode: "01", pid: "2D", unit: "%",  formula: "A*100/128-100",   category: "emissions" },
  { id: "evap_purge_cmd",       display_name: "Commanded evap purge",  ecu: "engine", mode: "01", pid: "2E", unit: "%",  formula: "A*100/255",       category: "emissions" },
  { id: "fuel_level",           display_name: "Fuel level",            ecu: "engine", mode: "01", pid: "2F", unit: "%",  formula: "A*100/255",       category: "engine" },
  { id: "warmups_since_clear",  display_name: "Warmups since DTC clear",ecu: "engine",mode: "01", pid: "30", unit: "",   formula: "A",               category: "diagnostics" },
  { id: "distance_since_clear", display_name: "Distance since DTC clear",ecu:"engine",mode: "01", pid: "31", unit: "km", formula: "A*256+B",         category: "diagnostics" },
  { id: "evap_pressure",        display_name: "Evap system pressure",  ecu: "engine", mode: "01", pid: "32", unit: "Pa", formula: "(A*256+B)/4",     category: "emissions" },
  { id: "barometric",           display_name: "Barometric pressure",   ecu: "engine", mode: "01", pid: "33", unit: "kPa",formula: "A",               category: "engine" },
  { id: "cat_temp_b1s1",        display_name: "Catalyst temp B1S1",    ecu: "engine", mode: "01", pid: "3C", unit: "°C", formula: "(A*256+B)/10-40", category: "emissions" },
  { id: "cat_temp_b2s1",        display_name: "Catalyst temp B2S1",    ecu: "engine", mode: "01", pid: "3D", unit: "°C", formula: "(A*256+B)/10-40", category: "emissions" },
  { id: "cat_temp_b1s2",        display_name: "Catalyst temp B1S2",    ecu: "engine", mode: "01", pid: "3E", unit: "°C", formula: "(A*256+B)/10-40", category: "emissions" },
  { id: "cat_temp_b2s2",        display_name: "Catalyst temp B2S2",    ecu: "engine", mode: "01", pid: "3F", unit: "°C", formula: "(A*256+B)/10-40", category: "emissions" },
  { id: "control_module_v",     display_name: "Control module voltage",ecu: "engine", mode: "01", pid: "42", unit: "V",  formula: "(A*256+B)/1000",  category: "diagnostics" },
  { id: "abs_load",             display_name: "Absolute load",         ecu: "engine", mode: "01", pid: "43", unit: "%",  formula: "(A*256+B)*100/255",category: "engine" },
  { id: "afr_command",          display_name: "Commanded AFR",         ecu: "engine", mode: "01", pid: "44", unit: "",   formula: "(A*256+B)/32768", category: "emissions" },
  { id: "rel_throttle",         display_name: "Relative throttle pos", ecu: "engine", mode: "01", pid: "45", unit: "%",  formula: "A*100/255",       category: "engine" },
  { id: "ambient_temp",         display_name: "Ambient air temp",      ecu: "engine", mode: "01", pid: "46", unit: "°C", formula: "A-40",            category: "engine" },
  { id: "abs_throttle_b",       display_name: "Absolute throttle B",   ecu: "engine", mode: "01", pid: "47", unit: "%",  formula: "A*100/255",       category: "engine" },
  { id: "accel_pedal_d",        display_name: "Accelerator pedal D",   ecu: "engine", mode: "01", pid: "49", unit: "%",  formula: "A*100/255",       category: "engine" },
  { id: "accel_pedal_e",        display_name: "Accelerator pedal E",   ecu: "engine", mode: "01", pid: "4A", unit: "%",  formula: "A*100/255",       category: "engine" },
  { id: "throttle_actuator_cmd",display_name: "Commanded throttle act.",ecu: "engine",mode: "01", pid: "4C", unit: "%",  formula: "A*100/255",       category: "engine" },
  { id: "time_mil_on",          display_name: "Time run with MIL on",  ecu: "engine", mode: "01", pid: "4D", unit: "min",formula: "A*256+B",         category: "diagnostics" },
  { id: "time_since_clear",     display_name: "Time since DTC clear",  ecu: "engine", mode: "01", pid: "4E", unit: "min",formula: "A*256+B",         category: "diagnostics" },
  { id: "fuel_type",            display_name: "Fuel type",             ecu: "engine", mode: "01", pid: "51", unit: "",   formula: "A",               category: "engine" },
  { id: "ethanol_pct",          display_name: "Ethanol %",             ecu: "engine", mode: "01", pid: "52", unit: "%",  formula: "A*100/255",       category: "engine" },
  { id: "abs_evap_pressure",    display_name: "Abs evap vapor pressure",ecu: "engine",mode: "01", pid: "53", unit: "kPa",formula: "(A*256+B)/200",   category: "emissions" },
  { id: "evap_vapor_pressure",  display_name: "Evap vapor pressure",   ecu: "engine", mode: "01", pid: "54", unit: "Pa", formula: "(A*256+B)-32767", category: "emissions" },
  { id: "stft_b1b3_o2",         display_name: "STFT 2nd O2 B1+B3",     ecu: "engine", mode: "01", pid: "55", unit: "%",  formula: "A*100/128-100",   category: "emissions" },
  { id: "ltft_b1b3_o2",         display_name: "LTFT 2nd O2 B1+B3",     ecu: "engine", mode: "01", pid: "56", unit: "%",  formula: "A*100/128-100",   category: "emissions" },
  { id: "stft_b2b4_o2",         display_name: "STFT 2nd O2 B2+B4",     ecu: "engine", mode: "01", pid: "57", unit: "%",  formula: "A*100/128-100",   category: "emissions" },
  { id: "ltft_b2b4_o2",         display_name: "LTFT 2nd O2 B2+B4",     ecu: "engine", mode: "01", pid: "58", unit: "%",  formula: "A*100/128-100",   category: "emissions" },
  { id: "fuel_pressure_meas",   display_name: "Fuel pressure (measured, PID 6D bytes D-E)", ecu: "engine", mode: "01", pid: "6D", unit: "kPa", formula: "(D*256+E)*10",  category: "engine" },
  { id: "hv_system_voltage",    display_name: "HV system voltage (PID 9A bytes B-C, untested formula)", ecu: "engine", mode: "01", pid: "9A", unit: "V",   formula: "(B*256+C)/10",   category: "hybrid" },
  { id: "fuel_rail_abs",        display_name: "Fuel rail absolute pressure",ecu:"engine",mode:"01",pid: "59",unit: "kPa",formula: "(A*256+B)*10",    category: "engine" },
  { id: "rel_accel_pedal",      display_name: "Relative accel pedal",  ecu: "engine", mode: "01", pid: "5A", unit: "%",  formula: "A*100/255",       category: "engine" },
  { id: "hv_battery_life",      display_name: "Hybrid battery remaining life",ecu:"engine",mode:"01",pid:"5B",unit:"%",  formula: "A*100/255",       category: "hybrid" },
  { id: "oil_temp",             display_name: "Oil temp",              ecu: "engine", mode: "01", pid: "5C", unit: "°C", formula: "A-40",            category: "engine" },
  { id: "injection_timing",     display_name: "Fuel injection timing", ecu: "engine", mode: "01", pid: "5D", unit: "°",  formula: "(A*256+B)/128-210", category: "engine" },
  { id: "fuel_rate",            display_name: "Fuel rate",             ecu: "engine", mode: "01", pid: "5E", unit: "L/h",formula: "(A*256+B)/20",    category: "engine" },
  { id: "odometer",             display_name: "Odometer",              ecu: "engine", mode: "01", pid: "A6", unit: "km", formula: "(A*16777216+B*65536+C*256+D)/10", category: "engine" },
];

const BY_PID = new Map(STANDARD_MODE_01.map((p) => [p.pid.toUpperCase(), p]));

export function getStandardPid(pid: string): PidDef | undefined {
  return BY_PID.get(pid.toUpperCase());
}
