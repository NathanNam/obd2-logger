import Foundation

/// Canned ELM327 responses used when the app is in demo mode (no real
/// adapter required — pair step is bypassed via the "Use demo mode" link
/// in onboarding). The reviewer / curious user can navigate the entire
/// app, run a live session, and write a CSV without any hardware.
///
/// Strategy:
///   • AT* commands (init handshake, ATSH addressing) → `OK\r>`.
///   • Mode 01 supported-PID bitmaps → real-world values copied from a
///     2020 Lexus RX 450hL session, so discovery yields a realistic ~40
///     PIDs.
///   • Per-PID Mode 01 + Mode 21 responses → values that drift slightly
///     each tick so the Live readout looks alive rather than frozen.
///   • Mode 09 PID 02 (VIN) → a real test VIN that NHTSA's vPIC will
///     decode to the matching 2020 RX 450hL — so the Add Vehicle flow
///     pre-fills correctly.
///   • Anything we don't recognise → `NO DATA\r>` (Sampler demotes after
///     3 strikes, normal handling).
enum DemoELMResponses {

    /// Bumped each call so PID values can drift between ticks.
    @MainActor
    private static var tickCounter: UInt = 0

    @MainActor
    static func response(for command: String) -> String {
        let cmd = command.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)

        // AT commands — adapter setup, headers, etc.
        if cmd.hasPrefix("AT") {
            // ATZ replies with the firmware banner; everything else "OK".
            if cmd == "ATZ" { return "ATZ\rELM327 v2.2 (demo)\r>" }
            return "OK\r>"
        }

        // Mode 09 PID 02 — VIN. Demo mode deliberately returns NO DATA
        // so we never ship a real VIN in source. The Add Vehicle form
        // opens blank and the reviewer/user types year/make/model
        // manually (which matches the "VIN read failed" fallback the
        // form already handles for non-OBD-VIN-supporting cars).
        if cmd == "0902" { return "NO DATA\r>" }

        // Mode 01 supported-PID bitmaps (real values from a Lexus capture).
        switch cmd {
        case "0100": return "4100 BF BF A8 93\r>"
        case "0120": return "4120 90 0B A0 11\r>"
        case "0140": return "4140 FE D0 04 00\r>"
        case "0160": return "4160 00 00 00 00\r>"
        case "0180": return "4180 00 00 00 00\r>"
        case "01A0": return "41A0 00 00 00 00\r>"
        case "01C0": return "41C0 00 00 00 00\r>"
        default: break
        }

        // Mode 01 per-PID. tickCounter drives small variation.
        if cmd.hasPrefix("01"), cmd.count == 4, let pid = UInt8(cmd.dropFirst(2), radix: 16) {
            tickCounter &+= 1
            if let body = mode01Body(pid: pid, tick: tickCounter) {
                return "41 \(hex(pid)) \(body)\r>"
            }
            return "NO DATA\r>"
        }

        // Mode 21 (Toyota/Lexus proprietary).
        if cmd.hasPrefix("21"), cmd.count == 4, let pid = UInt8(cmd.dropFirst(2), radix: 16) {
            tickCounter &+= 1
            if let lines = mode21MultiFrame(pid: pid, tick: tickCounter) {
                return lines.joined(separator: "\r") + "\r>"
            }
            return "NO DATA\r>"
        }

        return "NO DATA\r>"
    }

    // MARK: - Mode 01 bodies

    /// Each entry returns the data bytes (hex, space-separated) AFTER the
    /// `41 <pid>` response prefix. Length must match what the formula
    /// expects (`A` = 1 byte, `(A*256+B)` = 2 bytes, etc.).
    private static func mode01Body(pid: UInt8, tick: UInt) -> String? {
        let drift = Double((tick % 64))
        switch pid {
        case 0x01: return "00 00 00 00"                                           // monitor_status (no DTCs)
        case 0x03: return "02 00"                                                  // fuel_system_status
        case 0x04: return hex(UInt8((40.0 + drift * 0.5).clamped(0, 255)))         // engine_load %
        case 0x05: return hex(UInt8((85 + Int(drift) % 5)))                        // coolant_temp + 40
        case 0x06: return hex(UInt8(128))                                           // stft_b1 → 0%
        case 0x07: return hex(UInt8(132))                                           // ltft_b1 → +3%
        case 0x0A: return hex(UInt8(110))                                           // fuel_pressure → 330 kPa
        case 0x0B: return hex(UInt8(50 + Int(drift) % 20))                          // intake_map kPa
        case 0x0C:
            // RPM: (A*256+B)/4 → idle around 800 rpm with drift up to ~2500.
            let rpm = 800 + Int(drift) * 27
            return uint16(rpm * 4)
        case 0x0D: return hex(UInt8(Int(drift) % 60))                               // speed km/h
        case 0x0E: return hex(UInt8(128 + Int(drift) % 16))                         // timing_advance
        case 0x0F: return hex(UInt8(35 + 40))                                       // iat (raw - 40)
        case 0x10: return uint16(Int(2.5 * 100) + Int(drift) * 10)                  // maf g/s
        case 0x11: return hex(UInt8((20.0 + drift * 0.3).clamped(0, 255)))          // throttle_pos %
        case 0x14: return hex(UInt8(160))                                           // o2_b1s1
        case 0x15: return hex(UInt8(120))                                           // o2_b1s2
        case 0x1C: return hex(UInt8(1))                                             // obd_standard
        case 0x1F: return uint16(120 + Int(drift))                                  // run_time s
        case 0x21: return uint16(0)                                                 // distance_with_mil
        case 0x2C: return hex(UInt8(0))                                             // egr_command %
        case 0x2D: return hex(UInt8(128))                                           // egr_error
        case 0x2E: return hex(UInt8(0))                                             // evap_purge_cmd
        case 0x2F: return hex(UInt8(180))                                           // fuel_level %
        case 0x30: return hex(UInt8(8))                                             // warmups_since_clear
        case 0x31: return uint16(245)                                               // distance_since_clear
        case 0x33: return hex(UInt8(101))                                           // barometric kPa
        case 0x3C: return uint16(4900 + Int(drift) * 8)                             // cat_temp_b1s1
        case 0x3D: return uint16(4880 + Int(drift) * 8)
        case 0x3E: return uint16(1200 + Int(drift) * 4)
        case 0x3F: return uint16(1180 + Int(drift) * 4)
        case 0x42: return uint16(14000 + Int(drift) * 5)                            // control_module_v mV*1000
        case 0x43: return uint16(50 + Int(drift))                                   // abs_load
        case 0x44: return uint16(32750)                                             // afr_command ≈ 1.0
        case 0x45: return hex(UInt8((10.0 + drift * 0.4).clamped(0, 255)))          // rel_throttle %
        case 0x46: return hex(UInt8(20 + 40))                                       // ambient_temp
        case 0x47: return hex(UInt8(110 + Int(drift) % 16))                         // abs_throttle_b
        case 0x49: return hex(UInt8(60))                                            // accel_pedal_d
        case 0x4A: return hex(UInt8(58))                                            // accel_pedal_e
        case 0x4C: return hex(UInt8(50))                                            // throttle_actuator_cmd
        case 0x4D: return uint16(0)                                                 // time_mil_on
        case 0x4E: return uint16(180)                                               // time_since_clear
        case 0x51: return hex(UInt8(1))                                             // fuel_type (gasoline)
        case 0x53: return uint16(20100)                                             // abs_evap_pressure
        case 0x54: return uint16(32850)                                             // evap_vapor_pressure
        case 0x55: return hex(UInt8(128))                                           // stft_b1b3_o2
        case 0x56: return hex(UInt8(128))                                           // ltft_b1b3_o2
        case 0x57: return hex(UInt8(128))                                           // stft_b2b4_o2
        case 0x58: return hex(UInt8(128))                                           // ltft_b2b4_o2
        case 0x5B: return hex(UInt8(217))                                           // hv_battery_life ≈ 85%
        case 0x6D: return "00 00 00 30 00 00"                                       // fuel_pressure_meas (D-E)
        case 0x9A: return "00 00 80 00 00"                                          // hv_system_voltage (B-C)
        case 0xA6: return "00 21 39 7C 00"                                          // odometer (~136890 km)
        default: return nil
        }
    }

    // MARK: - Mode 21 multi-frame bodies (Toyota/Lexus hybrid PIDs)

    /// Returns the framed-response lines for a Mode 21 PID, mirroring how
    /// real ELM327 emits multi-frame ISO-TP responses with `<digit>:`
    /// frame indices and a leading length token.
    private static func mode21MultiFrame(pid: UInt8, tick: UInt) -> [String]? {
        let drift = Double((tick % 32))
        switch pid {
        case 0x61, 0x62, 0x63:
            // mg torques: ((D*256+E)-32768)/8 → drift around 0 Nm at idle.
            let value = 32768 + Int((sin(Double(tick) * 0.1) * 200) * 8)
            let de = clampedUInt16(value)
            return [
                "010",
                "0:6\(hex(0x60 | (pid & 0x0F))) 71 70 \(hex(UInt8((de >> 8) & 0xFF))) \(hex(UInt8(de & 0xFF)))",
                "1:00 00 00 00 00 00 00 00",
                "2:00 00"
            ]
        case 0x95:
            // Battery temps: 4 bytes, °C raw. Drift slightly across cells.
            let base = 26 + Int(drift) % 3
            return [
                "012",
                "0:6195 \(hex(UInt8(base))) \(hex(UInt8(base))) \(hex(UInt8(base+1))) \(hex(UInt8(base)))",
                "1:00 00 00 00 00 00 00",
                "2:00 00 00"
            ]
        case 0x98:
            // HV pack voltage: (A*256+B)/100 → drift between ~280 and ~440 V.
            let voltage = 32000 + Int(sin(Double(tick) * 0.05) * 6000)
            let ab = clampedUInt16(voltage)
            return [
                "014",
                "0:6198 \(hex(UInt8((ab >> 8) & 0xFF))) \(hex(UInt8(ab & 0xFF))) 4D BC",
                "1:00 7D 8C 4E 7F E7 7F",
                "2:E7 7F E7 90 00 00 00"
            ]
        default:
            return nil
        }
    }

    // MARK: - Helpers

    private static func hex(_ b: UInt8) -> String {
        String(format: "%02X", b)
    }

    private static func uint16(_ v: Int) -> String {
        let clamped = max(0, min(0xFFFF, v))
        let hi = UInt8((clamped >> 8) & 0xFF)
        let lo = UInt8(clamped & 0xFF)
        return "\(hex(hi)) \(hex(lo))"
    }

    private static func clampedUInt16(_ v: Int) -> Int {
        max(0, min(0xFFFF, v))
    }
}

private extension Double {
    func clamped(_ lo: Double, _ hi: Double) -> Double {
        Swift.min(Swift.max(self, lo), hi)
    }
}
