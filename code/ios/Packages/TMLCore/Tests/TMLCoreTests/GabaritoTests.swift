import CoreText
import Foundation
import Testing
@testable import TMLCore

@Suite("Bundled Gabarito")
struct GabaritoTests {
    @Test func fontFileShipsWithItsLicense() throws {
        let url = try #require(Gabarito.fontURL)
        #expect(FileManager.default.fileExists(atPath: url.path))
        let license = try #require(Bundle.module.url(forResource: "OFL-Gabarito", withExtension: "txt"))
        let text = try String(contentsOf: license, encoding: .utf8)
        #expect(text.contains("SIL OPEN FONT LICENSE"))
    }

    @Test func registersOnceAndAgain() {
        #expect(Gabarito.register())
        #expect(Gabarito.register())
    }

    @Test(arguments: DisplayStyle.all)
    func everyDisplayStyleResolvesToGabaritoAtItsWeight(style: DisplayStyle) throws {
        let resolved = style.resolve()
        let family = CTFontCopyFamilyName(resolved.ctFont) as String
        #expect(family == Gabarito.familyName)
        let variation = try #require(CTFontCopyVariation(resolved.ctFont) as? [Int: Double])
        #expect(variation[Gabarito.weightAxis] == style.weight)
        #expect(CTFontGetSize(resolved.ctFont) == style.size)
        #expect(resolved.lineSpacing >= 0)
    }

    @Test func boldTextGoesOneStepHeavierWithinTheAxis() {
        #expect(DisplayStyle.largeTitle.weight(boldText: true) == 800)
        #expect(DisplayStyle.badge.weight(boldText: true) == 900)
        let black = DisplayStyle(name: "x", size: 10, lineHeight: 12, weight: 900, tracking: 0, relativeTo: .body)
        #expect(black.weight(boldText: true) == 900)
    }

    @Test func weightIsClampedToTheAxis() throws {
        let font = Gabarito.ctFont(size: 20, weight: 1200)
        let variation = try #require(CTFontCopyVariation(font) as? [Int: Double])
        #expect(variation[Gabarito.weightAxis] == 900)
    }
}
