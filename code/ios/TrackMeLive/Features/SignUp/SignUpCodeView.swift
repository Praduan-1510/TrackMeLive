import SwiftUI
import TMLCore

/// "Enter the code": six digits, filled in from Messages where the phone allows. Six digits check at
/// once. One line under the field says what's happening or what went wrong, and the resend line
/// counts down from 0:30 in tabular figures until Send a new code replaces it.
struct SignUpCodeView: View {
    @Bindable var model: SignUpModel
    var focus: FocusState<SignUpModel.Field?>.Binding

    /// Checking or finishing: back would leave a sign-in half done.
    private var holdsBack: Bool {
        model.activity == .checkingCode || model.activity == .finishingAccount
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: model.codeSentTo)
                    .font(.callout)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                OneTimeCodeField(
                    code: Binding(get: { model.code }, set: { model.updateCode($0) }),
                    isInvalid: model.codeFailure == .wrongCode || model.codeFailure == .codeExpired,
                    focus: focus
                )
                .padding(.top, TMLSpacing.space6)

                VStack(spacing: TMLSpacing.space3) {
                    if let message = model.codeMessage {
                        SignUpMessageLine(message: message, centered: true)
                    }
                    if model.offersRetryCheck {
                        PlainInkButton("Try again") { model.verifyCode() }
                    } else if model.accountFailure != nil, !model.isBusy {
                        PlainInkButton("Try again") { model.retryFinishing() }
                    }
                    ResendLine(model: model)
                }
                .padding(.top, TMLSpacing.space4)
                .frame(maxWidth: .infinity)
            }
            .padding(.bottom, TMLSpacing.space6)
        }
        .scrollBounceBehavior(.basedOnSize)
        .screenMargins()
        .background(TMLColor.ground)
        .navigationTitle("Enter the code")
        .navigationBarTitleDisplayMode(.large)
        .navigationBarBackButtonHidden(holdsBack)
        .onAppear {
            // Pushed screens take focus once they're on screen.
            focus.wrappedValue = .code
            AccessibilityNotification.ScreenChanged().post()
        }
        .announcesErrors(model.codeMessage.flatMap { $0.isError ? $0.text : nil })
    }
}

/// "You can send a new code in 0:30." ticking each second, then a Send a new code button. After an
/// expired code, the button shows at once.
private struct ResendLine: View {
    let model: SignUpModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            if model.canSendNewCode(at: context.date) {
                Button {
                    model.sendNewCode()
                } label: {
                    HStack(spacing: TMLSpacing.space2) {
                        if model.activity == .resendingCode {
                            ProgressView().tint(TMLColor.ink)
                        }
                        Text(verbatim: SignUpModel.sendNewCodeTitle)
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(TMLColor.ink)
                    .frame(minWidth: TMLSpacing.tapTarget, minHeight: TMLSpacing.tapTarget)
                    .contentShape(.rect)
                }
                .buttonStyle(.borderless)
                .disabled(model.isBusy)
            } else {
                Text(verbatim: SignUpModel.resendCountdownText(seconds: model.secondsUntilResend(at: context.date)))
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(TMLColor.inkSecondary)
                    .multilineTextAlignment(.center)
                    .frame(minHeight: TMLSpacing.tapTarget)
                    // The countdown isn't announced each second; VoiceOver reads it when it reaches it.
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
    }
}
