import Foundation
import JavaScriptCore

/// Evaluates the JS-style formula strings stored in profile JSONs (e.g.
/// `((D*256+E)-32768)/8`). Uses JavaScriptCore so we don't have to
/// re-implement an expression parser, and so the formulas stay byte-for-byte
/// identical between the web app and this iOS app.
///
/// Variables A, B, C, D, E, F, G, H, I, J are bound to the corresponding
/// raw response bytes (0-based). If the formula references a variable
/// that's out of range for the response, evaluation returns nil.
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
        let args: [Any] = (0..<10).map { i -> Int in
            bytes.indices.contains(i) ? Int(bytes[i]) : 0
        }
        guard let result = fn.call(withArguments: args) else { return nil }
        if result.isNumber {
            return result.toDouble()
        }
        return nil
    }

    // MARK: - Internals

    private func compiledFunction(for formula: String) -> JSValue? {
        if let cached = cache[formula] { return cached }
        // Wrap the formula in a function so we can call it with byte values.
        let source = "(function(A,B,C,D,E,F,G,H,I,J){ return (\(formula)); })"
        guard let value = context.evaluateScript(source), value.isObject else {
            return nil
        }
        cache[formula] = value
        return value
    }
}
