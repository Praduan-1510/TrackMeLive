import Foundation
import Testing
@testable import TMLCore

/// Sign-up's state machine (FSD §4; prototype `viewSignup`), on `FakeAuthService`: the happy path and
/// every failure, with the words and the focus each one leaves.
@MainActor
@Suite("Sign-up")
struct SignUpModelTests {
    @MainActor
    final class Harness {
        /// What the model's closures report back.
        final class Record {
            var clock = Date(timeIntervalSince1970: 10_000)
            var outcome: SignUpOutcome?
            var completions: [(AuthUser, String)] = []
            var nextOutcome: SignUpOutcome = .created
            var nextAccountError: ProfileError?
        }

        let auth = FakeAuthService()
        let record: Record
        let model: SignUpModel

        init(signedIn: AuthUser? = nil) {
            let record = Record()
            self.record = record
            model = SignUpModel(
                auth: auth,
                region: .us,
                signedInUser: signedIn,
                now: { record.clock },
                completeAccount: { user, name throws(ProfileError) in
                    record.completions.append((user, name))
                    if let error = record.nextAccountError {
                        record.nextAccountError = nil
                        throw error
                    }
                    return record.nextOutcome
                },
                onFinished: { record.outcome = $0 }
            )
        }

        var clock: Date {
            get { record.clock }
            set { record.clock = newValue }
        }
        var outcome: SignUpOutcome? { record.outcome }
        var completions: [(AuthUser, String)] { record.completions }
        var nextOutcome: SignUpOutcome {
            get { record.nextOutcome }
            set { record.nextOutcome = newValue }
        }
        var nextAccountError: ProfileError? {
            get { record.nextAccountError }
            set { record.nextAccountError = newValue }
        }

        /// Fills in the details and sends the code.
        func send(name: String = "Alex", number: String = "(415) 555-0142") async {
            model.updateName(name)
            model.updatePhone(number)
            model.submitDetails()
            await model.work?.value
        }

        func enter(_ code: String) async {
            model.updateCode(code)
            await model.work?.value
        }
    }

    // MARK: The happy path

    @Test func aNewAccountSignsUpAndIsCreatedWithTheTidiedName() async {
        let h = Harness()
        #expect(h.model.step == .details)
        #expect(h.model.primaryButtonTitle == "Send code")

        await h.send(name: "  Alex   Kim ")
        #expect(h.model.step == .code)
        #expect(h.model.focus == .code)
        #expect(h.auth.sentCodes == [.alex])
        #expect(h.model.codeSentTo == "Sent by text to \u{2068}+1 (415) 555-0142\u{2069}.")
        #expect(h.model.secondsUntilResend(at: h.clock) == 30)
        #expect(!h.model.canSendNewCode(at: h.clock))

        h.model.updateCode("4829")
        #expect(h.model.activity == nil)
        h.model.updateCode("482913")
        // Six digits check at once, and the line under the field says so.
        #expect(h.model.activity == .checkingCode)
        #expect(h.model.codeMessage == .init(text: "Checking the code\u{2026}", isError: false))
        await h.model.work?.value

        #expect(h.outcome == .created)
        #expect(h.completions.map(\.1) == ["Alex Kim"])
        #expect(h.completions.first?.0.uid == FakeAuthService.uid(for: "+14155550142"))
        #expect(h.auth.currentUser?.phoneNumber == "+14155550142")
        #expect(h.model.activity == nil)
    }

    @Test func aReturningAccountIsRestored() async {
        let h = Harness()
        h.nextOutcome = .restored
        await h.send()
        await h.enter("482913")
        #expect(h.outcome == .restored)
    }

    @Test func autofillOrPasteOfTheWholeCodeWorks() async {
        let h = Harness()
        await h.send()
        await h.enter("Your Track Me Live code is 482 913")
        #expect(h.outcome == .created)
    }

    // MARK: The details step

    @Test func anEmptyNameSaysSoAndTakesFocus() async {
        let h = Harness()
        await h.send(name: "   ")
        #expect(h.model.step == .details)
        #expect(h.model.nameProblem == .empty)
        #expect(h.model.nameError == "Enter your name. It\u{2019}s what people see when you share.")
        #expect(h.model.focus == .name)
        #expect(h.auth.sentCodes.isEmpty)

        // The message goes as soon as the name works, without waiting for another tap.
        h.model.updateName("A")
        #expect(h.model.nameProblem == nil)
    }

    @Test func theNameIsCheckedOnBlurNotWhileTyping() {
        let h = Harness()
        h.model.updateName(" ")
        #expect(h.model.nameProblem == nil)
        h.model.nameFieldDidEndEditing()
        #expect(h.model.nameProblem == .empty)

        h.model.updateName("  Mom   G ")
        h.model.nameFieldDidEndEditing()
        #expect(h.model.name == "Mom G")
        #expect(h.model.nameProblem == nil)
    }

    @Test func leavingAnUntouchedNameFieldSaysNothing() {
        let h = Harness()
        h.model.nameFieldDidEndEditing()
        h.model.phoneFieldDidEndEditing()
        #expect(h.model.nameProblem == nil)
        #expect(h.model.phoneProblem == nil)
    }

    @Test func typingStopsAt24Characters() {
        let h = Harness()
        h.model.updateName(String(repeating: "👩🏽\u{200D}💻", count: 30))
        #expect(h.model.name.count == 24)
    }

    @Test func anIncompleteNumberSaysSoWithAnExampleAndTakesFocus() async {
        let h = Harness()
        await h.send(number: "(415) 555-01")
        #expect(h.model.step == .details)
        #expect(h.model.phoneProblem == .invalid)
        #expect(h.model.phoneError == "Enter your full mobile number, like (201) 555-0123.")
        #expect(h.model.focus == .phone)
        #expect(h.auth.sentCodes.isEmpty)

        h.model.updatePhone("(415) 555-0142")
        #expect(h.model.phoneProblem == nil)
    }

    @Test func anEmptyNumberWaitsForSendCode() async {
        let h = Harness()
        h.model.updateName("Alex")
        h.model.phoneFieldDidEndEditing()
        #expect(h.model.phoneProblem == nil)
        h.model.submitDetails()
        #expect(h.model.phoneProblem == .empty)
        #expect(h.model.focus == .phone)
    }

    @Test func anIncompleteNumberShowsOnBlur() {
        let h = Harness()
        h.model.updatePhone("415")
        h.model.phoneFieldDidEndEditing()
        #expect(h.model.phoneProblem == .invalid)
    }

    @Test func theNameIsCheckedBeforeTheNumber() async {
        let h = Harness()
        await h.send(name: "", number: "12")
        #expect(h.model.nameProblem == .empty)
        #expect(h.model.focus == .name)
    }

    @Test func aNumberAuthRefusesSaysTheSameAsAnInvalidOne() async {
        let h = Harness()
        h.auth.nextSendError = .invalidPhoneNumber
        await h.send()
        #expect(h.model.step == .details)
        #expect(h.model.phoneProblem == .invalid)
        #expect(h.model.focus == .phone)
        #expect(h.model.sendError == nil)
    }

    @Test func aFailedTextOffersTryAgainWhichWorks() async {
        let h = Harness()
        h.auth.nextSendError = .sendFailed
        await h.send()
        #expect(h.model.step == .details)
        #expect(h.model.sendError == "We couldn\u{2019}t send the code. Check your connection, then try again.")
        #expect(h.model.primaryButtonTitle == "Try again")

        h.model.submitDetails()
        await h.model.work?.value
        #expect(h.model.step == .code)
        #expect(h.model.sendError == nil)
    }

    @Test func tooManyCodesAsksToWait() async {
        let h = Harness()
        h.auth.nextSendError = .tooManyRequests
        await h.send()
        #expect(h.model.sendError == "We couldn\u{2019}t send a code just now. Wait a few minutes, then try again.")
    }

    @Test func aPastedInternationalNumberMovesTheCountry() async {
        let h = Harness()
        h.model.updatePhone("+44 7400 123456")
        #expect(h.model.region.code == "GB")
        await h.send(number: "+44 7400 123456")
        #expect(h.auth.sentCodes.first?.e164 == "+447400123456")
    }

    @Test func choosingACountryRechecksTheNumber() async {
        let h = Harness()
        await h.send(number: "07400 123456")
        #expect(h.model.phoneProblem == .invalid)
        h.model.selectRegion(PhoneRegion.region(code: "GB") ?? .us)
        #expect(h.model.phoneProblem == nil)
        #expect(h.model.phoneError == nil)
    }

    @Test func tapsWhileSendingAreIgnored() async {
        let h = Harness()
        h.model.updateName("Alex")
        h.model.updatePhone("(415) 555-0142")
        h.model.submitDetails()
        #expect(h.model.activity == .sendingCode)
        h.model.submitDetails()
        await h.model.work?.value
        #expect(h.auth.sentCodes.count == 1)
    }

    // MARK: The code step

    @Test func aWrongCodeSaysSoClearsTheFieldAndKeepsFocus() async {
        let h = Harness()
        await h.send()
        await h.enter("111111")
        #expect(h.model.codeFailure == .wrongCode)
        #expect(h.model.codeMessage == .init(text: "That code didn\u{2019}t work. Check the text and try again.", isError: true))
        #expect(h.model.code == "")
        #expect(h.model.focus == .code)
        #expect(h.outcome == nil)

        // Typing again clears the message; the right code then works.
        h.model.updateCode("4")
        #expect(h.model.codeMessage == nil)
        await h.enter("482913")
        #expect(h.outcome == .created)
    }

    @Test func anExpiredCodeOffersANewOneAtOnce() async {
        let h = Harness()
        await h.send()
        await h.enter(FakeAuthService.expiredCode)
        #expect(h.model.codeFailure == .codeExpired)
        #expect(h.model.codeMessage == .init(text: "That code has expired. Send a new one.", isError: true))
        #expect(h.model.code == "")
        // No need to wait out the 30 seconds.
        #expect(h.model.canSendNewCode(at: h.clock))
        // Typing doesn't hide that the code is gone.
        h.model.updateCode("4")
        #expect(h.model.codeFailure == .codeExpired)

        h.model.sendNewCode()
        await h.model.work?.value
        #expect(h.auth.sentCodes.count == 2)
        #expect(h.model.codeFailure == nil)
        #expect(h.model.codeMessage == .init(text: "New code sent.", isError: false))
        #expect(h.model.code == "")
    }

    @Test func aNewCodeWaitsThirtySeconds() async {
        let h = Harness()
        await h.send()
        h.clock.addTimeInterval(12)
        #expect(h.model.secondsUntilResend(at: h.clock) == 18)
        h.model.sendNewCode()
        #expect(h.model.activity == nil)
        #expect(h.auth.sentCodes.count == 1)

        h.clock.addTimeInterval(18)
        #expect(h.model.canSendNewCode(at: h.clock))
        h.model.sendNewCode()
        await h.model.work?.value
        #expect(h.auth.sentCodes.count == 2)
        #expect(h.model.showsNewCodeSent)
        // The countdown starts over from the new code.
        #expect(h.model.secondsUntilResend(at: h.clock) == 30)
        // The note goes once typing starts.
        h.model.updateCode("1")
        #expect(h.model.codeMessage == nil)
    }

    @Test func aFailedNewCodeSaysSo() async {
        let h = Harness()
        await h.send()
        h.clock.addTimeInterval(30)
        h.auth.nextSendError = .sendFailed
        h.model.sendNewCode()
        await h.model.work?.value
        #expect(h.model.codeMessage == .init(text: "We couldn\u{2019}t send the code. Check your connection, then try again.", isError: true))
        #expect(h.model.canSendNewCode(at: h.clock))
    }

    @Test func aConnectionFailureKeepsTheDigitsAndOffersTryAgain() async {
        let h = Harness()
        await h.send()
        h.auth.nextVerifyError = .verifyFailed
        await h.enter("482913")
        #expect(h.model.codeMessage == .init(text: "We couldn\u{2019}t check the code. Check your connection, then try again.", isError: true))
        #expect(h.model.code == "482913")
        #expect(h.model.offersRetryCheck)

        h.model.verifyCode()
        await h.model.work?.value
        #expect(h.outcome == .created)
    }

    @Test func tooManyTriesAsksToWaitForANewCode() async {
        let h = Harness()
        await h.send()
        h.auth.nextVerifyError = .tooManyRequests
        await h.enter("482913")
        #expect(h.model.codeMessage == .init(text: "Too many tries for now. Wait a few minutes, then send a new code.", isError: true))
        #expect(h.model.code == "")
    }

    @Test func anAccountThatCantBeFinishedOffersTryAgainWithoutANewCode() async {
        let h = Harness()
        h.nextAccountError = .offline
        await h.send()
        await h.enter("482913")
        #expect(h.outcome == nil)
        #expect(h.model.accountFailure == .offline)
        #expect(h.model.codeMessage == .init(
            text: "We couldn\u{2019}t finish setting up your account. Check your connection, then try again.", isError: true))

        h.model.retryFinishing()
        await h.model.work?.value
        #expect(h.outcome == .created)
        #expect(h.completions.count == 2)
        #expect(h.auth.sentCodes.count == 1)
    }

    @Test func backAfterTheAccountFailedSignsOut() async {
        let h = Harness()
        h.nextAccountError = .offline
        await h.send()
        await h.enter("482913")
        #expect(h.auth.currentUser != nil)
        #expect(h.model.goBack())
        #expect(h.auth.currentUser == nil)
        #expect(h.model.accountFailure == nil)
        #expect(h.model.step == .details)
    }

    @Test func backBeforeTheCodeWorkedHasNoOneToSignOut() async {
        let h = Harness()
        await h.send()
        #expect(h.auth.currentUser == nil)
        #expect(h.model.goBack())
        #expect(h.auth.currentUser == nil)
        #expect(h.model.step == .details)
    }

    @Test func digitsAreIgnoredWhileTheCodeIsBeingChecked() async {
        let h = Harness()
        await h.send()
        h.model.updateCode("482913")
        h.model.updateCode("48291")
        #expect(h.model.code == "482913")
        await h.model.work?.value
        #expect(h.outcome == .created)
    }

    @Test func backFromTheCodeReturnsToTheNumber() async {
        let h = Harness()
        await h.send()
        h.model.updateCode("12")
        #expect(h.model.goBack())
        #expect(h.model.step == .details)
        #expect(h.model.focus == .phone)
        #expect(h.model.code == "")
        #expect(h.model.name == "Alex")
        #expect(h.model.phoneInput == "(415) 555-0142")
        // On the details, Back is the screen's own: it leaves sign-up.
        #expect(!h.model.goBack())
    }

    // MARK: An interrupted sign-up

    @Test func signedInWithoutAProfileAsksOnlyForTheName() async {
        let user = AuthUser(uid: "u1", phoneNumber: "+14155550142")
        let h = Harness(signedIn: user)
        #expect(h.model.asksNameOnly)
        #expect(h.model.primaryButtonTitle == "Continue")
        h.model.updateName(" Alex ")
        h.model.submitDetails()
        #expect(h.model.activity == .finishingAccount)
        await h.model.work?.value
        #expect(h.outcome == .created)
        #expect(h.completions.first?.0 == user)
        #expect(h.completions.first?.1 == "Alex")
        #expect(h.auth.sentCodes.isEmpty)
    }
}
