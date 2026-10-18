import Foundation
import Testing
@testable import TMLCore

/// The generated Swift tokens (code/shared/tokens/generated/swift, symlinked into TMLCore) must
/// match design-system/tokens.json, the source of every token.
@Suite("Tokens match tokens.json")
struct TokensTests {
    private func tokensJSON() throws -> [String: Any] {
        try #require(try Repo.json("design-system/tokens.json") as? [String: Any])
    }

    private func rgba(_ hex: String) throws -> (Double, Double, Double, Double) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        #expect(s.hasPrefix("#"))
        s.removeFirst()
        if s.count == 6 { s += "ff" }
        let v = try #require(UInt32(s, radix: 16))
        return (Double((v >> 24) & 0xFF) / 255, Double((v >> 16) & 0xFF) / 255,
                Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
    }

    @Test func everyColorTokenMatchesBothThemes() throws {
        let color = try #require(try tokensJSON()["color"] as? [String: Any])
        let list = try #require(color["tokens"] as? [[String: Any]])
        #expect(list.count == TMLColorToken.allCases.count)
        for entry in list {
            let name = try #require(entry["name"] as? String)
            let token = try #require(TMLColorToken(rawValue: name), "no TMLColorToken for \(name)")
            let value = try #require(entry["value"] as? [String: String])
            for (theme, generated) in [("light", token.light), ("dark", token.dark)] {
                let (r, g, b, a) = try rgba(try #require(value[theme]))
                #expect(generated.red.close(to: r) && generated.green.close(to: g)
                        && generated.blue.close(to: b) && generated.alpha.close(to: a),
                        "\(name) \(theme) differs from tokens.json")
            }
        }
    }

    @Test func spacingAndRadiusMatch() throws {
        let json = try tokensJSON()
        func px(_ v: Any?) -> Double? { (v as? String).flatMap { Double($0.replacingOccurrences(of: "px", with: "")) } }
        let spacing = try #require((json["spacing"] as? [String: Any])?["tokens"] as? [[String: Any]])
        let spaceValues: [String: CGFloat] = [
            "space-1": TMLSpacing.space1, "space-2": TMLSpacing.space2, "space-3": TMLSpacing.space3,
            "space-4": TMLSpacing.space4, "space-5": TMLSpacing.space5, "space-6": TMLSpacing.space6,
            "space-8": TMLSpacing.space8, "tap-target": TMLSpacing.tapTarget, "tap-target-lg": TMLSpacing.tapTargetLg,
        ]
        for entry in spacing {
            let name = try #require(entry["name"] as? String)
            #expect(Double(try #require(spaceValues[name])) == px(entry["value"]), "\(name)")
        }
        let radius = try #require((json["radius"] as? [String: Any])?["tokens"] as? [[String: Any]])
        let radiusValues: [String: CGFloat] = [
            "radius-xs": TMLRadius.xs, "radius-md": TMLRadius.md, "radius-lg": TMLRadius.lg,
            "radius-sheet": TMLRadius.sheet, "radius-pill": TMLRadius.pill,
        ]
        for entry in radius {
            let name = try #require(entry["name"] as? String)
            #expect(Double(try #require(radiusValues[name])) == px(entry["value"]), "\(name)")
        }
    }

    @Test func displayStylesComeFromTheGabaritoTokens() throws {
        let type = try #require(try tokensJSON()["type"] as? [String: Any])
        let groups = try #require(type["groups"] as? [[String: Any]])
        let display = groups.filter { ($0["family"] as? String) == "display" }
            .flatMap { ($0["styles"] as? [[String: Any]]) ?? [] }
        #expect(display.map { $0["name"] as? String } == DisplayStyle.all.map(\.name))
        for (entry, style) in zip(display, DisplayStyle.all) {
            #expect(entry["fontSize"] as? String == "\(Int(style.size))px")
            #expect(entry["lineHeight"] as? String == "\(Int(style.lineHeight))px")
            #expect(entry["fontWeight"] as? Int == Int(style.weight))
        }
        #expect(DisplayStyle.badge.uppercase)
        #expect(DisplayStyle.all.filter(\.uppercase).map(\.name) == ["badge"])
    }
}
