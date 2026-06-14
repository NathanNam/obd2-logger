import Foundation
import JavaScriptCore

/// Evaluates the JS-style formula strings stored in profile JSONs (e.g.
/// `((D*256+E)-32768)/8`). Uses JavaScriptCore so we don't have to
/// re-implement an expression parser, and so the formulas stay byte-for-byte
/// identical between the web app and this iOS app.
///
/// Variables A, B, C, … Z are bound to response bytes 0-25 (0-based). For
/// bytes beyond Z, use `byte(n)` — e.g. `byte(55)*256 + byte(56)`. If the
/// formula references a byte that's out of range for the response,
/// evaluation returns nil.
final class FormulaEvaluator {

    private let context: JSContext

    /// Cache evaluated functions keyed by formula text. Saves us re-parsing
    /// the same formula at every sample tick.
    private var cache: [String: JSValue] = [:]

    init() {
        guard let context = JSContext() else {
            fatalError("Could not create JSContext (this should never fail).")
        }
        // Surface JS exceptions to stderr so misformatted formulas are visible.
        context.exceptionHandler = { _, exception in
            if let exception {
                NSLog("FormulaEvaluator JS exception: \(exception.toString() ?? "(unknown)")")
            }
        }
        self.context = context
    }

    /// Evaluate `formula` against `bytes`. Returns nil on parse error or if
    /// the result is non-numeric.
    func evaluate(formula: String, bytes: [UInt8]) -> Double? {
        guard let fn = compiledFunction(for: formula) else { return nil }
        // Pass `undefined` (not 0) for bytes the response didn't supply.
        // JS arithmetic with undefined yields NaN, which we map to nil
        // below. Defaulting to 0 produced wildly wrong values — e.g. the
        // Lexus mg-torque formula `((D*256+E)-32768)/8` with D=E=0 returns
        // -4096 Nm, far outside any drivetrain's physical range.
        let undefined = JSValue(undefinedIn: context) ?? JSValue()
        // A-Z = bytes 0-25; missing bytes are undefined.
        let alpha: [Any] = (0..<26).map { i -> Any in
            bytes.indices.contains(i) ? Int(bytes[i]) : undefined as Any
        }
        // `byte(n)` for indices >= 26 (or any index — useful for high offsets
        // and dynamic indexing). Returns undefined for out-of-range, which
        // propagates through arithmetic as NaN and surfaces as nil here.
        let byteFn: @convention(block) (Int) -> Any = { idx in
            bytes.indices.contains(idx) ? Int(bytes[idx]) : undefined as Any
        }
        var args: [Any] = alpha
        args.append(unsafeBitCast(byteFn as @convention(block) (Int) -> Any, to: AnyObject.self))
        guard let result = fn.call(withArguments: args) else { return nil }
        if result.isNumber {
            let d = result.toDouble()
            return d.isFinite ? d : nil
        }
        return nil
    }

    // MARK: - Internals

    private func compiledFunction(for formula: String) -> JSValue? {
        if let cached = cache[formula] { return cached }
        // Wrap the formula in a function so we can call it with byte values.
        // A-Z map to bytes 0-25; `byte(n)` is supplied as a callback for
        // higher-index access. Helper functions match the web evaluator:
        //   signed(n)       — 8-bit two's complement
        //   signed16(n)     — 16-bit two's complement
        //   nullIfGte(v, t) — NaN when v >= t (sensor-sentinel)
        // NaN propagates through JS arithmetic and surfaces here as nil
        // (the `d.isFinite` check in evaluate()).
        // The order here MUST match the args order in evaluate().
        let source = """
        (function(A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,byte){
            var min = Math.min, max = Math.max, abs = Math.abs;
            var signed   = function(n){ return n > 0x7F   ? n - 0x100   : n; };
            var signed16 = function(n){ return n > 0x7FFF ? n - 0x10000 : n; };
            var nullIfGte = function(v, t){ return v >= t ? NaN : v; };
            return (\(formula));
        })
        """
        guard let value = context.evaluateScript(source), value.isObject else {
            return nil
        }
        cache[formula] = value
        return value
    }
}
