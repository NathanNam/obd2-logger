# Examples

Real artifacts captured from a 2020 Lexus RX 450hL Premium so newcomers can see what the app produces before installing anything.

| File | What it is |
|---|---|
| [`obd2-logger-webapp.png`](obd2-logger-webapp.png) | Web app live readout, 44 enabled PIDs across Engine / Hybrid / Battery / Emissions / Diagnostics. |
| [`obd2-logger-ios.png`](obd2-logger-ios.png) | iOS app live readout, same vehicle, 46 PIDs. |
| [`2026-05-03T07-55-45Z__2z6wg3dj.csv`](2026-05-03T07-55-45Z__2z6wg3dj.csv) | A 10-row 1 Hz session, parked-in-READY state, ICE just shut off. 50+ columns. |

## CSV column reference

The CSV is a wide table: 5 metadata columns followed by one column per active PID, sorted by category → ECU → id at session start. Blank cells mean "no data captured for this PID in this tick" (no forward-fill). All values are decoded with the formula listed below; unit is what's in the cell.

### Session metadata

| Column | Meaning |
|---|---|
| `timestamp_utc` | ISO-8601 UTC of when this row was captured (millisecond precision). |
| `session_elapsed_ms` | Milliseconds since the session started. Row 0 is `~0`. |
| `profile_id` | Active profile when the session was logged, e.g. `lexus-rx450hl-2020`. |
| `session_id` | 8-char random ID matching the filename suffix. |
| `vehicle_slug` | Per-owner vehicle folder slug, e.g. `2020-lexus-rx`. |

### Engine (standard SAE J1979 Mode 01)

ECU: `engine` (request `7E0` / response `7E8`). Each formula uses `A`, `B`, `C`, `D`, `E` to mean the 1st through 5th payload byte after the `41 <pid>` response prefix.

| Column | Display name | Unit | PID | Formula |
|---|---|---|---|---|
| `engine_load` | Engine load | % | `04` | `A*100/255` |
| `coolant_temp` | Coolant temp | °C | `05` | `A-40` |
| `intake_map` | Intake MAP | kPa | `0B` | `A` |
| `rpm` | Engine RPM | rpm | `0C` | `(A*256+B)/4` |
| `speed` | Vehicle speed | km/h | `0D` | `A` |
| `timing_advance` | Timing advance | ° | `0E` | `A/2-64` |
| `iat` | Intake air temp | °C | `0F` | `A-40` |
| `maf` | Mass air flow | g/s | `10` | `(A*256+B)/100` |
| `throttle_pos` | Throttle position | % | `11` | `A*100/255` |
| `run_time` | Run time since start | s | `1F` | `A*256+B` |
| `fuel_rail_pressure` | Fuel rail pressure | kPa | `23` | `(A*256+B)*10` |
| `barometric` | Barometric pressure | kPa | `33` | `A` |
| `abs_load` | Absolute load | % | `43` | `(A*256+B)*100/255` |
| `rel_throttle` | Relative throttle pos | % | `45` | `A*100/255` |
| `ambient_temp` | Ambient air temp | °C | `46` | `A-40` |
| `abs_throttle_b` | Absolute throttle B | % | `47` | `A*100/255` |
| `throttle_actuator_cmd` | Commanded throttle actuator | % | `4C` | `A*100/255` |
| `fuel_type` | Fuel type | enum | `51` | `A` (1=gasoline, see SAE) |
| `fuel_system_status` | Fuel system status | bitfield | `03` | raw byte |
| `fuel_pressure_meas` | Fuel pressure (measured, bytes D-E) | kPa | `6D` | `(D*256+E)*10` |
| `odometer` | Odometer | km | `A6` | `(A*16777216+B*65536+C*256+D)/10` |

### Emissions (standard Mode 01)

ECU: `engine`.

| Column | Display name | Unit | PID | Formula |
|---|---|---|---|---|
| `stft_b1` | Short fuel trim B1 | % | `06` | `A*100/128-100` |
| `ltft_b1` | Long fuel trim B1 | % | `07` | `A*100/128-100` |
| `o2_b1s2` | O2 B1S2 voltage | V | `15` | `A/200` |
| `egr_command` | Commanded EGR | % | `2C` | `A*100/255` |
| `evap_purge_cmd` | Commanded evap purge | % | `2E` | `A*100/255` |
| `cat_temp_b1s1` | Catalyst temp B1S1 | °C | `3C` | `(A*256+B)/10-40` |
| `cat_temp_b2s1` | Catalyst temp B2S1 | °C | `3D` | `(A*256+B)/10-40` |
| `cat_temp_b1s2` | Catalyst temp B1S2 | °C | `3E` | `(A*256+B)/10-40` |
| `cat_temp_b2s2` | Catalyst temp B2S2 | °C | `3F` | `(A*256+B)/10-40` |
| `afr_command` | Commanded AFR | ratio | `44` | `(A*256+B)/32768` |
| `abs_evap_pressure` | Abs evap vapor pressure | kPa | `53` | `(A*256+B)/200` |
| `evap_vapor_pressure` | Evap vapor pressure | Pa | `54` | `(A*256+B)-32767` |
| `stft_b1b3_o2` | STFT 2nd O2 B1+B3 | % | `55` | `A*100/128-100` |
| `ltft_b1b3_o2` | LTFT 2nd O2 B1+B3 | % | `56` | `A*100/128-100` |
| `stft_b2b4_o2` | STFT 2nd O2 B2+B4 | % | `57` | `A*100/128-100` |
| `ltft_b2b4_o2` | LTFT 2nd O2 B2+B4 | % | `58` | `A*100/128-100` |

### Diagnostics (standard Mode 01)

ECU: `engine`.

| Column | Display name | Unit | PID | Formula |
|---|---|---|---|---|
| `monitor_status` | Monitor status | bitfield | `01` | raw byte |
| `obd_standard` | OBD standard | enum | `1C` | `A` (1=OBD-II as defined by CARB, see SAE) |
| `distance_with_mil` | Distance with MIL on | km | `21` | `A*256+B` |
| `warmups_since_clear` | Warmups since DTC clear | count | `30` | `A` |
| `distance_since_clear` | Distance since DTC clear | km | `31` | `A*256+B` |
| `control_module_v` | Control module voltage | V | `42` | `(A*256+B)/1000` |
| `time_mil_on` | Time run with MIL on | min | `4D` | `A*256+B` |
| `time_since_clear` | Time since DTC clear | min | `4E` | `A*256+B` |

### Hybrid (Lexus RX 450hL profile, Mode 21)

ECU: `hybrid_controller` (request `7E2` / response `7EA`). These are Toyota/Lexus proprietary Mode 21 PIDs validated against this exact vehicle. `D`, `E` here mean the 4th and 5th payload bytes — see [`profiles/builtin/lexus-rx450hl-2020.json`](../profiles/builtin/lexus-rx450hl-2020.json) for the validation notes.

| Column | Display name | Unit | PID | Formula |
|---|---|---|---|---|
| `mg1_torque` | MG1 torque | Nm | `61` | `((D*256+E)-32768)/8` |
| `mg2_torque` | MG2 torque | Nm | `62` | `((D*256+E)-32768)/8` |
| `mgr_torque` | MGR torque (rear motor) | Nm | `63` | `((D*256+E)-32768)/8` |

### Battery (Lexus RX 450hL profile, Mode 21)

ECU: `hybrid_controller`. On this vehicle, HV battery telemetry is exposed via the hybrid_controller, *not* a separate battery_controller. Two PIDs supply five values — PID `95` is one query whose 4 bytes A/B/C/D each report a different cell-block temperature.

| Column | Display name | Unit | PID | Formula |
|---|---|---|---|---|
| `battery_temp_1` | Battery cell-block 1 temp | °C | `95` | `A` |
| `battery_temp_2` | Battery cell-block 2 temp | °C | `95` | `B` |
| `battery_temp_3` | Battery cell-block 3 temp | °C | `95` | `C` |
| `battery_temp_4` | Battery cell-block 4 temp | °C | `95` | `D` |
| `hv_voltage` | HV pack voltage | V | `98` | `(A*256+B)/100` |

## Reading the example CSV

Row 1 of the example was captured ~38 ms after the session started; the ICE had run very recently (cat temps still 382 °C / 110 °C) but had just shut off, putting the car in EV-READY at idle. That's why `rpm` reads 0, `mg*_torque` all read 0, and the BMS hasn't woken up yet so `hv_voltage` and `battery_temp_*` are blank — they only respond reliably under load (acceleration or regen).

For a richer dataset, capture a session while driving — short ~30s loop with one moderate acceleration and one regen-into-stop is enough to populate every column.
