import Foundation
import Testing
@testable import TMLCore

/// Names count grapheme clusters, the shared rule (schema `PersonName`): Swift `String.count`,
/// Android `BreakIterator`, the server's `Intl.Segmenter`.
@Suite("Person names")
struct PersonNameTests {
    @Test("A character is what a person sees as one", arguments: [
        ("👩🏽\u{200D}💻", 1), // woman technologist, medium skin tone: 4 scalars joined by ZWJ
        ("e\u{301}", 1), // e + combining acute
        ("🇮🇳", 1), // a flag: two regional indicators
        ("Zoë", 3),
        ("नमस्ते", 3), // Devanagari: three clusters
        ("ab", 2),
    ])
    func countsGraphemes(text: String, count: Int) {
        #expect(text.count == count)
        #expect(PersonName.validate(text) == .success(text))
    }

    @Test func typingStopsAt24Characters() {
        let emoji = String(repeating: "👩🏽\u{200D}💻", count: 30)
        let limited = PersonName.limitTyping(emoji)
        #expect(limited.count == 24)
        #expect(limited.unicodeScalars.count == 24 * 4) // whole clusters, never half an emoji
        #expect(PersonName.limitTyping("Alex") == "Alex")
    }

    @Test func twentyFourIsFineAndTwentyFiveIsNot() {
        #expect(PersonName.validate(String(repeating: "é", count: 24)) == .success(String(repeating: "é", count: 24)))
        #expect(PersonName.validate(String(repeating: "a", count: 25)) == .failure(.tooLong))
        // 24 graphemes typed as 48 scalars still count 24.
        let decomposed = String(repeating: "e\u{301}", count: 24)
        #expect(decomposed.unicodeScalars.count == 48)
        #expect(PersonName.validate(decomposed) == .success(decomposed))
    }

    @Test func lineBreaksBecomeSpacesWhileTyping() {
        #expect(PersonName.limitTyping("Alex\nKim") == "Alex Kim")
        #expect(PersonName.limitTyping("A\r\nB\u{2028}C") == "A B C")
    }

    /// The schema's pattern (Q-NAME-CHARACTERS): no control characters or bidi controls, and at
    /// least one letter, number, symbol or emoji.
    @Test func typingDropsInvisibleControlCharacters() {
        #expect(PersonName.limitTyping("Al\u{0}ex\u{7}") == "Alex")
        #expect(PersonName.limitTyping("\u{202E}Alex\u{202C}") == "Alex")
        #expect(PersonName.limitTyping("\u{2067}Nour\u{2069}") == "Nour")
        #expect(PersonName.limitTyping("Alex\tKim") == "Alex Kim")
    }

    @Test func refusesWhatTheServerRefuses() {
        #expect(PersonName.validate("\u{202E}Alex") == .failure(.needsLetterOrNumber))
        #expect(PersonName.validate("Al\u{1B}ex") == .failure(.needsLetterOrNumber))
        #expect(PersonName.validate("\u{200B}\u{200D}") == .failure(.needsLetterOrNumber)) // only zero-width characters
        #expect(PersonName.validate("#\u{FE0F}\u{20E3}") == .failure(.needsLetterOrNumber)) // a keycap # is punctuation
        #expect(PersonName.validate("...") == .failure(.needsLetterOrNumber))
        #expect(PersonName.validate("★") == .success("★"))
        #expect(PersonName.validate("1️⃣") == .success("1️⃣"))
        #expect(PersonName.validate("نور") == .success("نور"))
    }

    @Test func namesAreShownDirectionIsolated() {
        #expect(PersonName.isolated("نور") == "\u{2068}نور\u{2069}")
    }

    @Test func tidyCollapsesWhitespaceAndTrims() {
        #expect(PersonName.tidy("  Alex   Kim \t") == "Alex Kim")
        #expect(PersonName.tidy("\u{A0}Alex\u{2003}Kim\u{FEFF}") == "Alex Kim")
        #expect(PersonName.tidy("\n\n") == "")
    }

    @Test func emptyAfterTidyingIsRefused() {
        #expect(PersonName.validate("") == .failure(.empty))
        #expect(PersonName.validate("   \t ") == .failure(.empty))
        #expect(PersonName.validate("\u{FEFF}") == .failure(.empty))
        #expect(PersonName.validate("  Mom ") == .success("Mom"))
    }
}

@Suite("Phone numbers in E.164")
struct PhoneNumberTests {
    let us = PhoneRegion.us
    func region(_ code: String) throws -> PhoneRegion { try #require(PhoneRegion.region(code: code)) }

    @Test("US numbers however they're typed", arguments: [
        "(415) 555-0142", "415-555-0142", "415.555.0142", "4155550142", "1 415 555 0142", "+1 415 555 0142", " +14155550142",
    ])
    func usFormats(input: String) throws {
        let number = try PhoneNumberInput.parse(input, region: us).get()
        #expect(number.e164 == "+14155550142")
        #expect(number.regionCode == "US")
        #expect(number.displayString == "+1 (415) 555-0142")
    }

    @Test("Incomplete or impossible North American numbers", arguments: [
        "(415) 555-01", "555-0142", "(015) 555-0142", "(415) 155-0142", "415 555 01420", "2 415 555 0142",
    ])
    func usInvalid(input: String) {
        #expect(PhoneNumberInput.parse(input, region: us) == .failure(.invalid))
    }

    @Test func noDigitsIsEmpty() {
        #expect(PhoneNumberInput.parse("", region: us) == .failure(.empty))
        #expect(PhoneNumberInput.parse(" ( ) - ", region: us) == .failure(.empty))
    }

    @Test func theTrunkPrefixIsDropped() throws {
        let gb = try region("GB")
        #expect(try PhoneNumberInput.parse("07400 123456", region: gb).get().e164 == "+447400123456")
        #expect(try PhoneNumberInput.parse("7400 123456", region: gb).get().e164 == "+447400123456")
        let india = try region("IN")
        #expect(try PhoneNumberInput.parse("081234 56789", region: india).get().e164 == "+918123456789")
        let russia = try region("RU")
        #expect(try PhoneNumberInput.parse("8 912 345-67-89", region: russia).get().e164 == "+79123456789")
    }

    @Test func mobileRulesWhereKnown() throws {
        let gb = try region("GB")
        #expect(PhoneNumberInput.parse("020 7946 0958", region: gb) == .failure(.invalid)) // a London landline
        let india = try region("IN")
        #expect(PhoneNumberInput.parse("51234 56789", region: india) == .failure(.invalid))
        let italy = try region("IT")
        #expect(try PhoneNumberInput.parse("312 345 6789", region: italy).get().e164 == "+393123456789")
    }

    @Test func aPlusNumberCarriesItsOwnCountry() throws {
        let number = try PhoneNumberInput.parse("+44 7400 123456", region: us).get()
        #expect(number.regionCode == "GB")
        #expect(number.e164 == "+447400123456")
        #expect(PhoneNumberInput.region(of: "+44 7400", preferred: us)?.code == "GB")
        #expect(PhoneNumberInput.region(of: "+91 81234", preferred: us)?.code == "IN")
        #expect(PhoneNumberInput.region(of: "07400", preferred: us) == nil)
        // A shared code keeps the region already chosen.
        let canada = try region("CA")
        #expect(PhoneNumberInput.region(of: "+1 506 234 5678", preferred: canada)?.code == "CA")
        #expect(PhoneNumberInput.region(of: "+1 506 234 5678", preferred: try region("GB"))?.code == "US")
    }

    @Test func otherRegionsGetTheE164Check() throws {
        let portugal = try region("PT")
        #expect(try PhoneNumberInput.parse("912 345 678", region: portugal).get().e164 == "+351912345678")
        #expect(PhoneNumberInput.parse("91", region: portugal) == .failure(.invalid))
        #expect(PhoneNumberInput.parse("9123456789012345", region: portugal) == .failure(.invalid))
        #expect(PhoneNumberInput.parse("+999 1234 5678", region: portugal) == .failure(.invalid))
    }

    @Test func digitsInOtherScriptsCount() throws {
        // Arabic-Indic digits from an Arabic keypad.
        #expect(try PhoneNumberInput.parse("٤١٥٥٥٥٠١٤٢", region: us).get().e164 == "+14155550142")
    }

    @Test func typingKeepsOnlyNumberCharacters() {
        #expect(PhoneNumberInput.limitTyping("tel: +1 (415) 555-0142 ext") == " +1 (415) 555-0142 ")
        #expect(PhoneNumberInput.limitTyping(String(repeating: "1", count: 40)).count == PhoneNumberInput.maxTypedLength)
    }

    @Test func everyRegionHasACallingCodeAndAName() {
        #expect(PhoneRegion.all.count > 200)
        #expect(Set(PhoneRegion.all.map(\.code)).count == PhoneRegion.all.count)
        for region in PhoneRegion.all {
            #expect(!region.callingCode.isEmpty && region.callingCode.allSatisfy(\.isNumber), "\(region.code)")
            #expect(region.name(locale: Locale(identifier: "en_US")) != region.code || region.code == "XK", "\(region.code)")
        }
    }

    /// The "like …" examples are libphonenumber's, so they must pass the rules they illustrate.
    @Test func everyExampleIsValidForItsRegion() throws {
        for region in PhoneRegion.all {
            guard let example = region.exampleNational else { continue }
            #expect(throws: Never.self, "\(region.code) \(example)") { try PhoneNumberInput.parse(example, region: region).get() }
        }
    }

    @Test func theDefaultRegionFollowsTheLocale() {
        #expect(PhoneRegion.defaultRegion(locale: Locale(identifier: "en_GB")).code == "GB")
        #expect(PhoneRegion.defaultRegion(locale: Locale(identifier: "hi_IN")).code == "IN")
        #expect(PhoneRegion.defaultRegion(locale: Locale(identifier: "en")).code == "US")
    }
}

@Suite("The text code and its resend timer")
struct OneTimeCodeTests {
    @Test func keepsSixDigitsFromWhateverArrives() {
        #expect(OneTimeCode.limitTyping("482913") == "482913")
        #expect(OneTimeCode.limitTyping("Your code is 482 913.") == "482913")
        #expect(OneTimeCode.limitTyping("4829131111") == "482913")
        #expect(OneTimeCode.limitTyping("abc") == "")
        #expect(OneTimeCode.limitTyping("٤٨٢٩١٣") == "482913")
    }

    @Test func isCompleteAtSixAsciiDigits() {
        #expect(OneTimeCode.isComplete("482913"))
        #expect(!OneTimeCode.isComplete("48291"))
        #expect(!OneTimeCode.isComplete("٤٨٢٩١٣"))
    }

    @Test func countsDownFromThirtyRoundingUp() {
        let sent = Date(timeIntervalSince1970: 1_000)
        let countdown = ResendCountdown(sentAt: sent)
        #expect(countdown.secondsLeft(at: sent) == 30)
        #expect(countdown.secondsLeft(at: sent.addingTimeInterval(0.2)) == 30)
        #expect(countdown.secondsLeft(at: sent.addingTimeInterval(29.5)) == 1)
        #expect(!countdown.canResend(at: sent.addingTimeInterval(29.99)))
        #expect(countdown.secondsLeft(at: sent.addingTimeInterval(30)) == 0)
        #expect(countdown.canResend(at: sent.addingTimeInterval(30)))
        #expect(countdown.secondsLeft(at: sent.addingTimeInterval(90)) == 0)
    }

    @Test func readsAsAClock() {
        #expect(ResendCountdown.clock(30) == "0:30")
        #expect(ResendCountdown.clock(5) == "0:05")
        #expect(ResendCountdown.clock(60) == "1:00")
        #expect(ResendCountdown.clock(-3) == "0:00")
        #expect(SignUpModel.resendCountdownText(seconds: 30) == "You can send a new code in 0:30.")
    }
}

@Suite("Service error mapping")
struct ServiceErrorTests {
    @Test func firebaseAuthErrorsWhileSending() {
        #expect(AuthError.sending(firebaseCode: 17042) == .invalidPhoneNumber)
        #expect(AuthError.sending(firebaseCode: 17041) == .invalidPhoneNumber)
        #expect(AuthError.sending(firebaseCode: 17010) == .tooManyRequests)
        #expect(AuthError.sending(firebaseCode: 17052) == .tooManyRequests)
        #expect(AuthError.sending(firebaseCode: 17020) == .sendFailed)
        #expect(AuthError.sending(firebaseCode: 17999) == .sendFailed)
    }

    @Test func firebaseAuthErrorsWhileChecking() {
        #expect(AuthError.verifying(firebaseCode: 17044) == .wrongCode)
        #expect(AuthError.verifying(firebaseCode: 17051) == .codeExpired)
        #expect(AuthError.verifying(firebaseCode: 17046) == .codeExpired)
        #expect(AuthError.verifying(firebaseCode: 17010) == .tooManyRequests)
        #expect(AuthError.verifying(firebaseCode: 17020) == .verifyFailed)
    }

    @Test func callableErrors() {
        let details: [String: Any] = ["errors": [["field": "mascot_accessory", "message": "astronaut takes none"]]]
        #expect(ProfileError.callable(code: 3, details: details) == .rejected(field: "mascot_accessory"))
        #expect(ProfileError.callable(code: 3, details: nil) == .rejected(field: nil))
        #expect(ProfileError.callable(code: 16, details: nil) == .signInEnded)
        #expect(ProfileError.signInEnded.message == "Your sign-in has ended. Sign in again.")
        #expect(ProfileError.callable(code: 7, details: nil) == .notSignedIn)
        #expect(ProfileError.callable(code: 14, details: nil) == .offline)
        #expect(ProfileError.callable(code: 4, details: nil) == .offline)
        #expect(ProfileError.callable(code: 13, details: nil) == .failed)
        #expect(ProfileError.offline.message == "We couldn\u{2019}t save that. Check your connection, then try again.")
    }
}
