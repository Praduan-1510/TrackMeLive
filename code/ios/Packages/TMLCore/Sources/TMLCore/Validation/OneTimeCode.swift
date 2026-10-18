import Foundation

/// The 6-digit code sent by text at sign-up (FSD §4).
public enum OneTimeCode {
    public static let length = TMLSchemaConstants.otpLength

    /// What the code field keeps: digits only (any script's, as ASCII), at most 6. Autofill from
    /// Messages and a pasted "Your code is 482 913" both come out as "482913".
    public static func limitTyping(_ text: String) -> String {
        var digits = ""
        for character in text {
            guard character.isNumber, let value = character.wholeNumberValue, (0...9).contains(value) else { continue }
            digits.append(Character(String(value)))
            if digits.count == length { break }
        }
        return digits
    }

    public static func isComplete(_ code: String) -> Bool {
        code.count == length && code.allSatisfy(\.isASCII) && code.allSatisfy(\.isNumber)
    }
}

/// When a new code can be sent: 30 seconds after the last one (FSD §4 Sign up). The screen shows
/// "You can send a new code in 0:30." counting down, then a Send a new code button.
public struct ResendCountdown: Hashable, Sendable {
    public static let delay: TimeInterval = TimeInterval(TMLSchemaConstants.otpResendSeconds)

    /// When Send a new code becomes available.
    public let availableAt: Date

    public init(sentAt: Date, delay: TimeInterval = ResendCountdown.delay) {
        availableAt = sentAt.addingTimeInterval(delay)
    }

    /// Whole seconds left, rounded up, so the line reads 0:30 right after sending and 0:01 in its
    /// last second. Zero once a new code can be sent.
    public func secondsLeft(at now: Date) -> Int {
        max(0, Int((availableAt.timeIntervalSince(now)).rounded(.up)))
    }

    public func canResend(at now: Date) -> Bool { secondsLeft(at: now) == 0 }

    /// "0:30", "0:05", "1:00".
    public static func clock(_ seconds: Int) -> String {
        let seconds = max(0, seconds)
        let rest = seconds % 60
        return "\(seconds / 60):\(rest < 10 ? "0" : "")\(rest)"
    }
}
