import Foundation
import Testing
@testable import TMLCore

@Suite("Mascots")
struct MascotTests {
    @Test func twelveInThreeSetsOfFourWithFoxFirst() {
        #expect(Mascot.allCases.count == 12)
        #expect(Mascot.default == .fox)
        #expect(MascotSet.allCases.map { $0.mascots.count } == [4, 4, 4])
        #expect(MascotSet.classics.mascots.first == .fox)
    }

    /// The accessory list must equal ACCESSORY_SUPPORT in mascots/model/accessories.mjs, the source
    /// of truth (the prototype has the same check in tests/accessories.mjs).
    @Test func accessorySupportMatchesTheModels() throws {
        let source = try Repo.text("mascots/model/accessories.mjs")
        let block = try #require(source.range(of: "export const ACCESSORY_SUPPORT = {"))
        let end = try #require(source.range(of: "};", range: block.upperBound..<source.endIndex))
        let body = source[block.upperBound..<end.lowerBound]
        var parsed: [String: [String]] = [:]
        for line in body.split(separator: "\n") {
            let parts = line.split(separator: ":", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let key = parts[0].trimmingCharacters(in: .whitespaces)
            let values = parts[1].split(separator: "'").enumerated().filter { $0.offset % 2 == 1 }.map { String($0.element) }
            parsed[key] = values
        }
        #expect(parsed.count == 12)
        for mascot in Mascot.allCases {
            #expect(parsed[mascot.rawValue] == mascot.accessories.map(\.rawValue), "\(mascot)")
        }
    }

    /// scripts/export-assets.sh must have put every render into the app's and the widget's asset
    /// catalogs, and every flat SVG into both.
    @Test(arguments: Mascot.allCases)
    func assetsAreExported(mascot: Mascot) {
        let fm = FileManager.default
        func asset(_ target: String, _ name: String, _ ext: String) -> URL {
            Repo.url("code/ios/\(target)/\(target == "TrackMeLive" ? "Resources/" : "")Assets.xcassets/\(name).imageset/\(name).\(ext)")
        }
        let app = asset("TrackMeLive", mascot.renderAssetName, "png")
        let appFlat = asset("TrackMeLive", mascot.flatAssetName, "svg")
        let widgetRender = asset("TrackMeLiveWidgets", mascot.renderAssetName, "png")
        let widgetFlat = asset("TrackMeLiveWidgets", mascot.flatAssetName, "svg")
        #expect(fm.fileExists(atPath: app.path))
        #expect(fm.fileExists(atPath: appFlat.path))
        #expect(fm.fileExists(atPath: widgetRender.path))
        #expect(fm.fileExists(atPath: widgetFlat.path))
        // The Original renders are byte-for-byte the design system's masters.
        #expect(fm.contentsEqual(atPath: app.path, andPath: Repo.url("design-system/assets/Mascots/\(mascot.rawValue).png").path))
    }

    @Test func colorsHaveNamesInPickerOrder() {
        #expect(TMLMascotColor.allCases.map(\.name) == ["Original", "Moss", "Lagoon", "Dusk", "Rose"])
    }

    @Test func onlyTheAstronautExplainsAnEmptyAccessoryRow() {
        for mascot in Mascot.allCases {
            #expect((mascot.noAccessoriesNote != nil) == (mascot == .astronaut), "\(mascot)")
        }
        #expect(Mascot.astronaut.noAccessoriesNote == "The astronaut\u{2019}s helmet doesn\u{2019}t take accessories.")
    }
}

@Suite("Mascot look")
struct MascotLookTests {
    @Test func everyAccountStartsAsTheOriginalFox() {
        #expect(MascotLook.default == MascotLook(mascot: .fox, color: .original, accessory: nil))
    }

    /// The server rejects an accessory the character doesn't take, so a look never holds one.
    @Test func changingTheCharacterDropsAnAccessoryItCantWear() {
        var look = MascotLook(mascot: .fox, color: .dusk, accessory: .glasses)
        look.mascot = .ghost
        #expect(look.accessory == .glasses) // the ghost takes glasses
        look.mascot = .robot
        #expect(look.accessory == nil) // the robot takes only the headlamp
        look.accessory = .headlamp
        #expect(look.accessory == .headlamp)
        look.mascot = .astronaut
        #expect(look.accessory == nil)
        #expect(look.color == .dusk) // color is never touched
    }

    @Test func anUnsupportedAccessoryBecomesNone() {
        var look = MascotLook(mascot: .astronaut, accessory: .headphones)
        #expect(look.accessory == nil)
        look = MascotLook(mascot: .ninja)
        look.accessory = .glasses
        #expect(look.accessory == nil)
    }

    @Test func readsTheProfileAndTheSessionSnapshot() {
        let sharer = TMLSharerSnapshot(name: "Alex", mascotId: .neko, mascotColor: .rose, mascotAccessory: .headlamp)
        #expect(MascotLook(sharer: sharer) == MascotLook(mascot: .neko, color: .rose, accessory: .headlamp))
    }

    /// Every field is written, and none is null (FSD §6).
    @Test func encodesWithTheProfileFieldNames() throws {
        let data = try JSONEncoder().encode(MascotLook(mascot: .ace))
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["mascot_id"] as? String == "ace")
        #expect(json["mascot_color"] as? String == "original")
        #expect(json.keys.contains("mascot_accessory") && json["mascot_accessory"] is NSNull)
        let robot = #"{"mascot_id":"robot","mascot_color":"moss","mascot_accessory":"glasses"}"#
        let decoded = try JSONDecoder().decode(MascotLook.self, from: Data(robot.utf8))
        #expect(decoded == MascotLook(mascot: .robot, color: .moss, accessory: nil))
    }

    @Test func spokenNameNamesTheColorAndAccessory() {
        #expect(MascotLook(mascot: .fox).spokenName == "Fox")
        #expect(MascotLook(mascot: .fox, color: .lagoon, accessory: .glasses).spokenName == "Fox, Lagoon, with glasses")
        #expect(MascotLook(mascot: .agent, accessory: .headphones).spokenName == "Agent, with headphones")
    }
}

@Suite("Mascot assets")
struct MascotAssetTests {
    let look = MascotLook(mascot: .fox, color: .lagoon, accessory: .glasses)

    @Test func namesFollowTheExportScript() {
        #expect(MascotAssets.render(.fox, .original, size: .stage) == Mascot.fox.renderAssetName)
        #expect(MascotAssets.render(.fox, .lagoon, size: .stage) == "mascot-fox-lagoon")
        #expect(MascotAssets.render(.fox, .lagoon, size: .avatar) == "avatar-fox-lagoon")
        #expect(MascotAssets.render(.fox, .original, size: .avatar) == "avatar-fox")
        #expect(MascotAssets.accessoryLayer(.fox, .glasses, size: .stage) == "accessory-fox-glasses")
        #expect(MascotAssets.accessoryLayer(.fox, .glasses, size: .avatar) == "avatar-accessory-fox-glasses")
        #expect(MascotAssets.flat(.fox) == "mascot-fox-flat")
    }

    @Test func picksTheSizeForWhereItsDrawn() {
        #expect(MascotAssets.Size(drawnAt: 32) == .avatar)
        #expect(MascotAssets.Size(drawnAt: 40) == .avatar)
        #expect(MascotAssets.Size(drawnAt: 62) == .stage)
        #expect(MascotAssets.Size(drawnAt: 152) == .stage)
    }

    /// Color, then the Original, then the flat SVG; at avatar size the right color comes before the right size.
    @Test func fallsBackFromColorToBaseToFlat() {
        #expect(MascotAssets.renderCandidates(for: look, size: .stage) == ["mascot-fox-lagoon", "mascot-fox", "mascot-fox-flat"])
        #expect(MascotAssets.renderCandidates(for: look, size: .avatar)
            == ["avatar-fox-lagoon", "mascot-fox-lagoon", "avatar-fox", "mascot-fox", "mascot-fox-flat"])
        #expect(MascotAssets.renderCandidates(for: MascotLook(mascot: .ghost), size: .stage) == ["mascot-ghost", "mascot-ghost-flat"])
    }

    @Test func resolvesWithEverythingPresent() {
        let r = MascotAssets.resolve(look, size: .stage) { _ in true }
        #expect(r == .init(render: "mascot-fox-lagoon", isFlat: false, accessoryLayer: "accessory-fox-glasses"))
    }

    @Test func aMissingColorFallsBackToTheOriginalWithItsAccessory() {
        let r = MascotAssets.resolve(look, size: .stage) { $0 != "mascot-fox-lagoon" }
        #expect(r == .init(render: "mascot-fox", isFlat: false, accessoryLayer: "accessory-fox-glasses"))
    }

    /// Accessory layers fit the render's camera, not the flat art.
    @Test func theFlatFallbackGoesWithoutTheAccessory() {
        let r = MascotAssets.resolve(look, size: .stage) { $0.hasSuffix("-flat") || $0.hasPrefix("accessory-") }
        #expect(r == .init(render: "mascot-fox-flat", isFlat: true, accessoryLayer: nil))
    }

    @Test func aMissingLayerIsSimplyNotDrawn() {
        let r = MascotAssets.resolve(look, size: .avatar) { !$0.contains("accessory") }
        #expect(r == .init(render: "avatar-fox-lagoon", isFlat: false, accessoryLayer: nil))
        let stageLayer = MascotAssets.resolve(look, size: .avatar) { $0 != "avatar-accessory-fox-glasses" }
        #expect(stageLayer.accessoryLayer == "accessory-fox-glasses")
    }

    @Test func nothingAtAllMeansThePlainDisc() {
        let r = MascotAssets.resolve(look, size: .avatar) { _ in false }
        #expect(r == .init(render: nil, isFlat: false, accessoryLayer: nil))
    }

    /// scripts/export-assets.sh produced every asset MascotAssets names, at the right pixel sizes,
    /// and no accessory layer for a character that can't wear it.
    @Test func theAppCatalogHoldsEveryExport() throws {
        let catalog = Repo.url("code/ios/TrackMeLive/Resources/Assets.xcassets")
        let sets = try imageSets(in: catalog)
        for name in MascotAssets.expectedAppAssets() {
            #expect(sets[name] != nil, "missing \(name)")
        }
        for mascot in Mascot.allCases {
            for accessory in TMLMascotAccessory.allCases where !mascot.accessories.contains(accessory) {
                #expect(sets[MascotAssets.accessoryLayer(mascot, accessory, size: .stage)] == nil)
                #expect(sets[MascotAssets.accessoryLayer(mascot, accessory, size: .avatar)] == nil)
            }
        }
        // Every scaled export is its point size times the scale, from the 512px masters.
        let scaled = sets.filter { entry in
            entry.key.hasPrefix("avatar-") || entry.key.hasPrefix("accessory-")
                || TMLMascotColor.allCases.contains { $0 != .original && entry.key.hasSuffix("-\($0.rawValue)") }
        }
        #expect(scaled.count == 12 * 4 + 21 + (12 * 5 + 21))
        for (name, dir) in scaled {
            let points = name.hasPrefix("avatar-") ? MascotAssets.Size.avatar.points : MascotAssets.Size.stage.points
            for scale in MascotAssets.scales {
                let png = dir.appending(path: "\(name)@\(scale)x.png")
                #expect(try pngWidth(png) == Int(points) * scale, "\(name)@\(scale)x")
            }
        }
    }

    /// Every `<name>.imageset` folder under the catalog, at any depth.
    private func imageSets(in catalog: URL) throws -> [String: URL] {
        var found: [String: URL] = [:]
        let walker = try #require(FileManager.default.enumerator(at: catalog, includingPropertiesForKeys: nil))
        for case let url as URL in walker where url.pathExtension == "imageset" {
            found[url.deletingPathExtension().lastPathComponent] = url
        }
        return found
    }

    /// The width from a PNG's IHDR chunk.
    private func pngWidth(_ url: URL) throws -> Int {
        let bytes = [UInt8](try Data(contentsOf: url).prefix(24))
        try #require(bytes.count == 24 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47)
        return bytes[16..<20].reduce(0) { $0 << 8 | Int($1) }
    }
}

@Suite("Mascot swatches")
struct MascotSwatchTests {
    /// The swatches match the prototype's COLORS and KEY (prototype/js/app.js), which the Android
    /// app and the browser page share.
    @Test func matchThePrototype() throws {
        let source = try Repo.text("prototype/js/app.js")
        func hex(_ pattern: String) throws -> UInt32 {
            let regex = try Regex(pattern)
            let match = try #require(source.firstMatch(of: regex))
            let value = try #require(match.output[1].substring)
            return try #require(UInt32(value, radix: 16)) << 8 | 0xFF
        }
        for color in TMLMascotColor.allCases where color != .original {
            let expected = try hex("id: '\(color.rawValue)', name: '[^']+', swatch: '#([0-9A-Fa-f]{6})'")
            #expect(MascotSwatch.rgba(color, for: .fox).rgba == expected, "\(color)")
        }
        for mascot in Mascot.allCases {
            let expected = try hex("\\b\(mascot.rawValue): '#([0-9A-Fa-f]{6})'")
            #expect(MascotSwatch.rgba(.original, for: mascot).rgba == expected, "\(mascot)")
        }
    }

    /// The check on the chosen swatch holds 4.5:1 on every swatch (the prototype's on-lamplight
    /// check drops to about 2:1 on Ninja's, Ace's and Agent's Originals).
    @Test func theCheckMarkReadsOnEverySwatch() {
        for mascot in Mascot.allCases {
            for color in TMLMascotColor.allCases {
                let swatch = MascotSwatch.rgba(color, for: mascot)
                let ratio = Contrast.ratio(MascotSwatch.checkGlyph(on: swatch), swatch)
                #expect(ratio >= 4.5, "\(mascot) \(color): \(ratio)")
            }
        }
    }

    @Test func contrastMatchesWCAG() {
        let black = TMLRGBA(rgba: 0x000000FF), white = TMLRGBA(rgba: 0xFFFFFFFF)
        #expect(Contrast.ratio(black, white).close(to: 21, within: 0.001))
        #expect(Contrast.ratio(white, white).close(to: 1, within: 0.001))
        // lamplight-text on surface (light), which the design system quotes as 5.72:1.
        #expect(Contrast.ratio(TMLColorToken.lamplightText.light, TMLColorToken.surface.light).close(to: 5.72, within: 0.01))
    }
}
