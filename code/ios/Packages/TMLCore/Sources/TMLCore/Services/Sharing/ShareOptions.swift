import Foundation

/// When a share stops (FSD §4 Stop rule): the share screen's Stops row and the timer sheet.
public enum StopChoice: Hashable, Sendable {
    /// When the call ends: only during a call, for that call.
    case call
    /// In 15 min, In 30 min, In 1 hour: now plus the minutes, capped at the 1-hour limit.
    case minutes(TMLStopMinutes)
    /// At the 1-hour limit (`stop_at` = `expires_at`), offered on the timer sheet once In 1 hour
    /// would pass it.
    case limit

    /// The wire's stop_rule.
    public var stopRule: TMLStopRule {
        switch self {
        case .call: .call
        case .minutes: .minutes
        case .limit: .limit
        }
    }

    /// The wire's stop_minutes: set only for a timer.
    public var stopMinutes: TMLStopMinutes? {
        if case .minutes(let minutes) = self { minutes } else { nil }
    }

    /// The timer sheet's words (prototype `stopLabel`). `limitTime` is the formatted `expires_at`
    /// ("10:38 pm"), shown with At the 1-hour limit.
    public func label(limitTime: String) -> String {
        switch self {
        case .call: "When the call ends"
        case .minutes(.minutes60): "In 1 hour"
        case .minutes(let minutes): "In \(minutes.rawValue) min"
        case .limit: "At the 1-hour limit \u{00B7} \(limitTime)"
        }
    }
}

/// What the share screen sends to start a session (FSD §4: Who it's for, Stops, Let them share
/// back, Location detail).
public struct ShareOptions: Hashable, Sendable {
    /// Who it's for: optional, used only on the sharer's screens. Tidied and checked like a name.
    public var viewerName: String?
    public var stop: StopChoice
    /// The connected call's per-device id (the CallKit UUID), or nil for a manual share.
    public var callId: String?
    /// Let them share back. The server forces it off without a call.
    public var shareBack: Bool
    public var precision: TMLPrecision

    public init(viewerName: String? = nil, stop: StopChoice, callId: String? = nil, shareBack: Bool, precision: TMLPrecision) {
        self.viewerName = viewerName
        self.stop = stop
        self.callId = callId
        self.shareBack = shareBack
        self.precision = precision
    }

    /// The `createSession` payload. Without a call, When the call ends falls back to the 30-minute
    /// timer (FSD §4 Stop rule) and share back is off; At the 1-hour limit starts as In 1 hour,
    /// which the server caps to the same `stop_at`. An empty name is no name.
    public var request: TMLCreateSessionRequest {
        var stop = stop
        if callId == nil, stop == .call {
            stop = .minutes(TMLStopMinutes(rawValue: TMLSchemaConstants.defaultStopMinutes) ?? .minutes30)
        }
        if stop == .limit { stop = .minutes(.minutes60) }
        let name: String?
        if let viewerName, case .success(let tidy) = PersonName.validate(viewerName) { name = tidy } else { name = nil }
        return TMLCreateSessionRequest(
            stopRule: stop.stopRule,
            stopMinutes: stop.stopMinutes,
            callId: callId,
            shareBackAllowed: callId != nil && shareBack,
            precision: precision,
            viewerName: name
        )
    }
}

/// The link to hand to the system share sheet (FSD §4 Live map link). Send link again reuses it.
public struct ShareLink: Hashable, Sendable {
    public var sessionId: String
    /// `<viewer origin>/s/<token>`, built by the server.
    public var url: URL

    public init(sessionId: String, url: URL) {
        self.sessionId = sessionId
        self.url = url
    }
}

extension TMLCreateSessionRequest {
    /// The callable's payload: snake_case keys, nulls written (JSONSerialization, Foundation types only).
    public func callablePayload() throws -> [String: Any] {
        try SharingWire.payload(self)
    }
}

/// Codable to the Foundation objects the callables take, and back.
enum SharingWire {
    static func payload(_ value: some Encodable) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw EncodingError.invalidValue(data, .init(codingPath: [], debugDescription: "Not an object"))
        }
        return object
    }

    static func decode<T: Decodable>(_ type: T.Type, from json: Data) throws -> T {
        try JSONDecoder().decode(type, from: json)
    }

    /// Epoch milliseconds, as the callables return times.
    static func date(ms: Int64) -> Date { Date(timeIntervalSince1970: TimeInterval(ms) / 1000) }
}
