import Foundation
import Observation

/// How sign-up ended.
public enum SignUpOutcome: Hashable, Sendable {
    /// A new account: its profile was created with the name typed here. The mascot picker comes next.
    case created
    /// A returning account on this phone: its profile was restored (FSD §4: name, mascot, color,
    /// accessory and settings, never a session). The typed name is not sent.
    case restored
}

/// Sign-up (FSD §4 Sign up; prototype `viewSignup`): a name and a mobile number, then the 6-digit
/// code sent by text. A new code can be sent after 30 seconds. Every failure says what happened
/// under the field it belongs to, keeps what was typed where that helps, and keeps a way forward.
///
/// The view binds its fields through the `update…` functions and its focus to `focus`; everything
/// else here is read-only state for it to show.
@Observable
@MainActor
public final class SignUpModel {
    public enum Step: Hashable, Sendable {
        /// Name and mobile number ("Create your account").
        case details
        /// The 6-digit code ("Enter the code").
        case code
    }

    public enum Field: Hashable, Sendable { case name, phone, code }

    /// What is running, if anything. Buttons show progress and ignore taps meanwhile.
    public enum Activity: Hashable, Sendable {
        case sendingCode, checkingCode, resendingCode, finishingAccount
    }

    // MARK: State for the view

    public private(set) var step: Step = .details
    public private(set) var name = ""
    public private(set) var phoneInput = ""
    public private(set) var region: PhoneRegion
    public private(set) var code = ""
    /// Where the keyboard is. The view mirrors it with `@FocusState`, both ways.
    public var focus: Field?
    public private(set) var activity: Activity?

    /// Shown under the name field.
    public private(set) var nameProblem: PersonName.Problem?
    /// Shown under the number field.
    public private(set) var phoneProblem: PhoneNumberInput.Problem?
    /// Sending the first code failed (`sendFailed` or `tooManyRequests`).
    public private(set) var sendFailure: AuthError?
    /// Checking the code failed, or sending a new one did.
    public private(set) var codeFailure: AuthError?
    /// Signed in, but the profile couldn't be read or created.
    public private(set) var accountFailure: ProfileError?
    /// "New code sent." after Send a new code.
    public private(set) var showsNewCodeSent = false
    /// The code in flight: where it went, and its verification.
    public private(set) var verification: PhoneVerification?
    /// When Send a new code turns on.
    public private(set) var countdown: ResendCountdown?

    /// Already signed in from an interrupted sign-up: only the name is left to ask.
    public let signedInUser: AuthUser?
    /// Why sign-up is showing again ("Your sign-in has ended. Sign in again."), at the top of the
    /// details until Send code is pressed.
    public private(set) var notice: String?

    /// The running send, check or finish, so tests can wait for it.
    @ObservationIgnored public private(set) var work: Task<Void, Never>?

    // MARK: Dependencies

    public typealias CompleteAccount = @MainActor (AuthUser, String) async throws(ProfileError) -> SignUpOutcome

    @ObservationIgnored private let auth: any AuthService
    @ObservationIgnored private let completeAccount: CompleteAccount
    @ObservationIgnored private let onFinished: @MainActor (SignUpOutcome) -> Void
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var nameEdited = false
    @ObservationIgnored private var phoneEdited = false

    /// - Parameters:
    ///   - completeAccount: after the code checks out, reads the profile and restores it, or creates it
    ///     with the name (the account model's job).
    ///   - onFinished: runs once, when sign-up is done.
    public init(
        auth: any AuthService,
        region: PhoneRegion = .defaultRegion(),
        signedInUser: AuthUser? = nil,
        notice: String? = nil,
        now: @escaping () -> Date = Date.init,
        completeAccount: @escaping CompleteAccount,
        onFinished: @escaping @MainActor (SignUpOutcome) -> Void
    ) {
        self.auth = auth
        self.region = region
        self.signedInUser = signedInUser
        self.notice = notice
        self.now = now
        self.completeAccount = completeAccount
        self.onFinished = onFinished
    }

    /// Only the name is asked: the number is already confirmed.
    public var asksNameOnly: Bool { signedInUser != nil }

    public var isBusy: Bool { activity != nil }

    // MARK: Details

    public func updateName(_ text: String) {
        name = PersonName.limitTyping(text)
        nameEdited = true
        // Once an error shows, it clears as soon as the name works; it never appears while typing.
        if nameProblem != nil, case .success = PersonName.validate(name) { nameProblem = nil }
    }

    /// Leaving the name field: tidy it (one space between words, none at the ends) and check it.
    public func nameFieldDidEndEditing() {
        guard nameEdited else { return }
        name = PersonName.tidy(name)
        if case let .failure(problem) = PersonName.validate(name) { nameProblem = problem }
    }

    public func updatePhone(_ text: String) {
        phoneInput = PhoneNumberInput.limitTyping(text)
        phoneEdited = true
        sendFailure = nil
        // A pasted or autofilled "+44 …" moves the country picker to match.
        if let match = PhoneNumberInput.region(of: phoneInput, preferred: region) { region = match }
        if phoneProblem != nil, case .success = PhoneNumberInput.parse(phoneInput, region: region) { phoneProblem = nil }
    }

    /// Leaving the number field: an incomplete number says so now; an empty one waits for Send code.
    public func phoneFieldDidEndEditing() {
        guard phoneEdited, case let .failure(problem) = PhoneNumberInput.parse(phoneInput, region: region),
              problem == .invalid else { return }
        phoneProblem = problem
    }

    public func selectRegion(_ region: PhoneRegion) {
        self.region = region
        sendFailure = nil
        if phoneProblem != nil, case .success = PhoneNumberInput.parse(phoneInput, region: region) { phoneProblem = nil }
    }

    /// Send code (Try again after a failure), or Continue when only the name is asked.
    public func submitDetails() {
        guard !isBusy else { return }
        notice = nil
        name = PersonName.tidy(name)
        let checkedName: String
        switch PersonName.validate(name) {
        case let .failure(problem):
            nameProblem = problem
            focus = .name
            return
        case let .success(valid):
            nameProblem = nil
            checkedName = valid
        }

        if let signedInUser {
            run(.finishingAccount) { model in await model.finish(signedInUser, name: checkedName) }
            return
        }

        let number: PhoneNumber
        switch PhoneNumberInput.parse(phoneInput, region: region) {
        case let .failure(problem):
            phoneProblem = problem
            focus = .phone
            return
        case let .success(valid):
            phoneProblem = nil
            number = valid
        }

        sendFailure = nil
        run(.sendingCode) { model in await model.send(to: number) }
    }

    private func send(to number: PhoneNumber) async {
        do {
            let sent = try await auth.sendCode(to: number)
            verification = sent
            countdown = ResendCountdown(sentAt: now())
            code = ""
            codeFailure = nil
            accountFailure = nil
            showsNewCodeSent = false
            step = .code
            focus = .code
        } catch .invalidPhoneNumber {
            phoneProblem = .invalid
            focus = .phone
        } catch {
            sendFailure = error
        }
    }

    // MARK: Code

    /// The code field. Six digits check the code at once.
    public func updateCode(_ text: String) {
        guard activity != .checkingCode, activity != .finishingAccount else { return }
        let digits = OneTimeCode.limitTyping(text)
        guard digits != code else { return }
        code = digits
        if !digits.isEmpty {
            showsNewCodeSent = false
            // A new attempt clears the last one's message, except an expired code's: it needs a new code.
            if codeFailure != .codeExpired { codeFailure = nil }
        }
        if OneTimeCode.isComplete(digits) { verifyCode() }
    }

    /// Checks the 6 digits (automatic at six; also Try again after a connection failure).
    public func verifyCode() {
        guard !isBusy, let verification, OneTimeCode.isComplete(code) else { return }
        codeFailure = nil
        accountFailure = nil
        let typed = code
        run(.checkingCode) { model in await model.check(typed, verification: verification) }
    }

    private func check(_ typed: String, verification: PhoneVerification) async {
        let user: AuthUser
        do {
            user = try await auth.verify(code: typed, for: verification)
        } catch {
            codeFailure = error
            // A wrong or expired code is cleared for the next try; the field keeps focus. After a
            // connection failure the digits stay, so Try again checks them.
            if error == .wrongCode || error == .codeExpired || error == .tooManyRequests { code = "" }
            focus = .code
            return
        }
        activity = .finishingAccount
        await finish(user, name: name)
    }

    /// Signed in: restore the profile, or create it with the name.
    private func finish(_ user: AuthUser, name: String) async {
        do {
            let outcome = try await completeAccount(user, name)
            onFinished(outcome)
        } catch {
            accountFailure = error
        }
    }

    /// Try again after the account couldn't be finished. The code already worked, so it isn't re-checked.
    public func retryFinishing() {
        guard !isBusy, accountFailure != nil else { return }
        let user = signedInUser ?? auth.currentUser
        guard let user, case let .success(checkedName) = PersonName.validate(name) else { return }
        accountFailure = nil
        run(.finishingAccount) { model in await model.finish(user, name: checkedName) }
    }

    /// Seconds until Send a new code; zero once it's on offer.
    public func secondsUntilResend(at date: Date) -> Int {
        countdown?.secondsLeft(at: date) ?? 0
    }

    /// Send a new code shows when the countdown is over, or at once when the code has expired.
    public func canSendNewCode(at date: Date) -> Bool {
        codeFailure == .codeExpired || secondsUntilResend(at: date) == 0
    }

    public func sendNewCode() {
        guard !isBusy, let verification, canSendNewCode(at: now()) else { return }
        run(.resendingCode) { model in await model.resend(to: verification.phoneNumber) }
    }

    private func resend(to number: PhoneNumber) async {
        do {
            let sent = try await auth.sendCode(to: number)
            // Back was tapped meanwhile: the details screen sends a fresh code anyway.
            guard !Task.isCancelled else { return }
            verification = sent
            countdown = ResendCountdown(sentAt: now())
            code = ""
            codeFailure = nil
            showsNewCodeSent = true
        } catch {
            // Send failures read the same on the code screen: sendFailed, tooManyRequests, or invalid.
            codeFailure = error == .invalidPhoneNumber ? .sendFailed : error
        }
        focus = .code
    }

    // MARK: Navigation

    /// Back: from the code to the details (the number can be fixed). Returns false on the details,
    /// where the screen's own Back leaves sign-up.
    ///
    /// If the code was accepted but the account couldn't be finished, the phone is signed in to that
    /// number: Back signs it out, so a different number can't leave the first account orphaned.
    @discardableResult
    public func goBack() -> Bool {
        guard step == .code, !isBusy || activity == .resendingCode else { return false }
        if auth.currentUser != nil {
            try? auth.signOut()
        }
        accountFailure = nil
        work?.cancel()
        activity = nil
        step = .details
        code = ""
        codeFailure = nil
        showsNewCodeSent = false
        focus = .phone
        return true
    }

    private func run(_ kind: Activity, _ body: @escaping @MainActor (SignUpModel) async -> Void) {
        activity = kind
        work = Task { [weak self] in
            guard let self else { return }
            await body(self)
            if !Task.isCancelled { self.activity = nil }
        }
    }
}
