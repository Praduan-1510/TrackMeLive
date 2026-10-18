import Foundation

/// Paths in the repo, for tests that check TMLCore against the design system's sources of truth.
enum Repo {
    /// The repository root (…/TrackMeLive), from this file's place in code/ios/Packages/TMLCore/Tests/TMLCoreTests.
    static let root: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { url.deleteLastPathComponent() }
        return url
    }()

    static func url(_ path: String) -> URL { root.appending(path: path) }

    static func json(_ path: String) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(contentsOf: url(path)))
    }

    static func text(_ path: String) throws -> String {
        try String(contentsOf: url(path), encoding: .utf8)
    }
}

extension Double {
    func close(to other: Double, within tolerance: Double = 0.5 / 255) -> Bool { abs(self - other) <= tolerance }
}
