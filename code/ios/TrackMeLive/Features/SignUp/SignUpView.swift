import SwiftUI
import TMLCore

/// Sign-up (FSD §4; prototype `viewSignup`): "Create your account", then "Enter the code" pushed on
/// the same stack, so the system back button and swipe return to the number. The logic, the words and
/// every error state are `SignUpModel`'s; this view binds fields and focus and announces errors.
struct SignUpView: View {
    @Bindable var model: SignUpModel
    /// Back from the first screen: to onboarding, or a sign-out when only the name was left.
    let onLeave: () -> Void
    @FocusState private var focus: SignUpModel.Field?

    var body: some View {
        NavigationStack(path: stepPath) {
            SignUpDetailsView(model: model, focus: $focus, onLeave: onLeave)
                .navigationDestination(for: SignUpModel.Step.self) { _ in
                    SignUpCodeView(model: model, focus: $focus)
                }
        }
        .tint(TMLColor.ink)
        // Focus moves both ways: the model moves it on purpose (to the first problem, to the code),
        // and leaving a field is when its value is checked.
        .onChange(of: model.focus) { _, field in
            if focus != field { focus = field }
        }
        .onChange(of: focus) { old, new in
            if model.focus != new { model.focus = new }
            if old == .name, new != .name { model.nameFieldDidEndEditing() }
            if old == .phone, new != .phone { model.phoneFieldDidEndEditing() }
        }
    }

    /// The code screen is pushed while the model is on its code step. Back (the button or the swipe)
    /// returns the model to the details.
    private var stepPath: Binding<[SignUpModel.Step]> {
        Binding(
            get: { model.step == .code ? [.code] : [] },
            set: { path in
                if path.isEmpty, model.step == .code { model.goBack() }
            }
        )
    }
}

/// The prominent button with a spinner while its work runs. Its title is the model's, already in
/// the reader's language.
struct SignUpPrimaryButton: View {
    let title: String
    let isBusy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TMLSpacing.space2) {
                if isBusy {
                    ProgressView().tint(TMLColor.onLamplight)
                }
                Text(verbatim: title)
            }
        }
        .buttonStyle(.tmlProminent)
        .disabled(isBusy)
        .accessibilityValue(isBusy ? Text("In progress") : Text(verbatim: ""))
    }
}

/// A line under a field: an error with its icon in `ink` (never `flare`), or a quiet note.
struct SignUpMessageLine: View {
    let message: SignUpModel.Message
    var centered = false

    var body: some View {
        Group {
            if message.isError {
                ErrorLine(message: message.text)
            } else {
                Text(verbatim: message.text)
                    .font(.footnote)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .multilineTextAlignment(centered ? .center : .leading)
        .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
    }
}

extension View {
    /// VoiceOver hears a new error at once, even while focus stays in the field.
    func announcesErrors(_ text: String?) -> some View {
        onChange(of: text) { _, new in
            if let new { AccessibilityNotification.Announcement(new).post() }
        }
    }
}

#Preview("Sign-up") {
    SignUpView(model: SignUpModel(auth: FakeAuthService(), completeAccount: { _, _ in .created }, onFinished: { _ in }),
               onLeave: {})
}
