import Foundation

// Sign-up's words: the prototype's, the design-system README's (Errors, loading and empty states),
// and Android's, so both apps say the same thing. Sentence case, calm, no exclamation marks.

extension SignUpModel {
    /// A line under a field or button. Errors get the warning icon; notes don't.
    public struct Message: Hashable, Sendable {
        public let text: String
        public let isError: Bool
    }

    nonisolated public static var nameHelper: String {
        String(localized: "Up to 24 characters.", bundle: .module)
    }

    nonisolated public static var privacyNote: String {
        String(localized: "People you share with see your name and mascot, never your number.", bundle: .module)
    }

    nonisolated public static var finePrint: String {
        String(localized: "We\u{2019}ll text you a 6-digit code. Message and data rates may apply.", bundle: .module)
    }

    public var title: String {
        String(localized: "Create your account", bundle: .module)
    }

    public var lede: String {
        asksNameOnly
            ? String(localized: "Your number is confirmed. Add the name that goes on your live map.", bundle: .module)
            : String(localized: "Your name goes on your live map. Your number keeps the account yours.", bundle: .module)
    }

    /// Under the name field.
    public var nameError: String? {
        switch nameProblem {
        case .empty: String(localized: "Enter your name. It\u{2019}s what people see when you share.", bundle: .module)
        case .tooLong: String(localized: "Your name can be up to 24 characters.", bundle: .module)
        case .needsLetterOrNumber: String(localized: "Use at least one letter or number in your name.", bundle: .module)
        case nil: nil
        }
    }

    /// Under the number field: libphonenumber's example for the country, as Android shows it.
    public var phoneError: String? {
        guard phoneProblem != nil else { return nil }
        if let example = region.exampleNational {
            return String(localized: "Enter your full mobile number, like \(example).", bundle: .module)
        }
        return String(localized: "Enter your full mobile number, with the area code.", bundle: .module)
    }

    /// Above the Send code button when the text couldn't be sent.
    public var sendError: String? {
        sendFailure.map(Self.sendText)
    }

    /// Send code, Try again after a failed send, or Continue when only the name is asked.
    public var primaryButtonTitle: String {
        if asksNameOnly { return String(localized: "Continue", bundle: .module) }
        return sendFailure == nil
            ? String(localized: "Send code", bundle: .module)
            : String(localized: "Try again", bundle: .module)
    }

    /// Under the number field on the code screen.
    public var codeSentTo: String {
        // Isolated, so the number keeps its order in a right-to-left sentence.
        let number = PersonName.isolated(verification?.phoneNumber.displayString ?? "")
        return String(localized: "Sent by text to \(number).", bundle: .module)
    }

    /// The one line under the code field: what's happening, or what went wrong.
    public var codeMessage: Message? {
        if activity == .checkingCode || activity == .finishingAccount {
            return Message(text: String(localized: "Checking the code\u{2026}", bundle: .module), isError: false)
        }
        if let accountFailure {
            return Message(text: Self.accountText(accountFailure), isError: true)
        }
        switch codeFailure {
        case .wrongCode:
            return Message(text: String(localized: "That code didn\u{2019}t work. Check the text and try again.", bundle: .module), isError: true)
        case .codeExpired:
            return Message(text: String(localized: "That code has expired. Send a new one.", bundle: .module), isError: true)
        case .verifyFailed:
            return Message(text: String(localized: "We couldn\u{2019}t check the code. Check your connection, then try again.", bundle: .module), isError: true)
        case .tooManyRequests:
            return Message(text: String(localized: "Too many tries for now. Wait a few minutes, then send a new code.", bundle: .module), isError: true)
        case .sendFailed, .invalidPhoneNumber:
            return Message(text: Self.sendText(.sendFailed), isError: true)
        case .signOutFailed, nil:
            break
        }
        if showsNewCodeSent {
            return Message(text: String(localized: "New code sent.", bundle: .module), isError: false)
        }
        return nil
    }

    /// The countdown line, "You can send a new code in 0:30." Set it in tabular figures.
    nonisolated public static func resendCountdownText(seconds: Int) -> String {
        let clock = ResendCountdown.clock(seconds)
        return String(localized: "You can send a new code in \(clock).", bundle: .module)
    }

    nonisolated public static var sendNewCodeTitle: String {
        String(localized: "Send a new code", bundle: .module)
    }

    /// Try again after the code couldn't be checked for a connection problem.
    public var offersRetryCheck: Bool {
        codeFailure == .verifyFailed && OneTimeCode.isComplete(code) && !isBusy
    }

    nonisolated private static func sendText(_ error: AuthError) -> String {
        error == .tooManyRequests
            ? String(localized: "We couldn\u{2019}t send a code just now. Wait a few minutes, then try again.", bundle: .module)
            : String(localized: "We couldn\u{2019}t send the code. Check your connection, then try again.", bundle: .module)
    }

    nonisolated private static func accountText(_ error: ProfileError) -> String {
        switch error {
        case .offline, .failed, .notSignedIn, .signInEnded:
            String(localized: "We couldn\u{2019}t finish setting up your account. Check your connection, then try again.", bundle: .module)
        case .rejected:
            String(localized: "We couldn\u{2019}t use that name. Check it, then try again.", bundle: .module)
        }
    }
}
