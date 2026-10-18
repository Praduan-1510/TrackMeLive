import SwiftUI
import TMLCore

/// "Create your account": the name people see, and the mobile number that keeps the account yours.
/// Both fields have visible labels; problems show under the fields with an icon and words, and the
/// field gets an `ink` outline, so nothing rests on color alone. Send code stays above the keyboard.
struct SignUpDetailsView: View {
    @Bindable var model: SignUpModel
    var focus: FocusState<SignUpModel.Field?>.Binding
    let onLeave: () -> Void
    @State private var choosingCountry = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let notice = model.notice {
                    // Why sign-up is back, in the error style, until Send code.
                    ErrorLine(message: notice)
                        .padding(.bottom, TMLSpacing.space4)
                        .onAppear { AccessibilityNotification.Announcement(notice).post() }
                }
                Text(verbatim: model.lede)
                    .font(.callout)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                fields
                    .padding(.top, TMLSpacing.space6)

                VStack(alignment: .leading, spacing: TMLSpacing.space3) {
                    if let error = model.nameError {
                        ErrorLine(message: error)
                    } else {
                        note(SignUpModel.nameHelper)
                    }
                    if let error = model.phoneError {
                        ErrorLine(message: error)
                    }
                    if let error = model.sendError {
                        ErrorLine(message: error)
                    }
                    if !model.asksNameOnly {
                        note(SignUpModel.privacyNote)
                    }
                }
                .padding(.top, TMLSpacing.space3)
                .padding(.horizontal, TMLSpacing.space4)
            }
            .padding(.bottom, TMLSpacing.space6)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        .screenMargins()
        .background(TMLColor.ground)
        // Pinned above the keyboard, with the system's scroll edge under it.
        .safeAreaBar(edge: .bottom) { footer }
        .navigationTitle(Text(verbatim: model.title))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Back", systemImage: "chevron.backward", action: onLeave)
                    .disabled(model.isBusy)
            }
        }
        .sheet(isPresented: $choosingCountry) {
            CountryPickerView(selected: model.region) { model.selectRegion($0) }
        }
        .announcesErrors(model.nameError)
        .announcesErrors(model.phoneError)
        .announcesErrors(model.sendError)
    }

    // MARK: Fields

    private var fields: some View {
        VStack(spacing: 0) {
            FieldCell(label: "Name", isInvalid: model.nameProblem != nil, isFocused: focus.wrappedValue == .name,
                      position: model.asksNameOnly ? .only : .top, onTap: { focus.wrappedValue = .name }) {
                TextField("", text: Binding(get: { model.name }, set: { model.updateName($0) }))
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(model.asksNameOnly ? .done : .next)
                    .focused(focus, equals: .name)
                    .onSubmit {
                        if model.asksNameOnly { model.submitDetails() } else { focus.wrappedValue = .phone }
                    }
                    .accessibilityLabel("Name")
                    .accessibilityHint(Text(verbatim: model.nameError ?? SignUpModel.nameHelper))
            }

            if !model.asksNameOnly {
                Rectangle()
                    .fill(TMLColor.separator)
                    .frame(height: 1)
                    .padding(.leading, TMLSpacing.space4)
                    .accessibilityHidden(true)

                FieldCell(label: "Mobile number", isInvalid: model.phoneProblem != nil,
                          isFocused: focus.wrappedValue == .phone, position: .bottom,
                          onTap: { focus.wrappedValue = .phone }) {
                    HStack(spacing: TMLSpacing.space3) {
                        CountryButton(region: model.region) { choosingCountry = true }
                        TextField("", text: Binding(get: { model.phoneInput }, set: { model.updatePhone($0) }))
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            .monospacedDigit()
                            .focused(focus, equals: .phone)
                            .accessibilityLabel("Mobile number")
                            .accessibilityHint(model.phoneError.map { Text(verbatim: $0) } ?? Text(verbatim: ""))
                    }
                }
            }
        }
        .background(TMLColor.surface, in: .rect(cornerRadius: TMLRadius.lg, style: .continuous))
    }

    private func note(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.footnote)
            .foregroundStyle(TMLColor.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Footer

    private var footer: some View {
        VStack(spacing: TMLSpacing.space2) {
            SignUpPrimaryButton(title: model.primaryButtonTitle, isBusy: model.isBusy) {
                model.submitDetails()
            }
            if !model.asksNameOnly {
                Text(verbatim: SignUpModel.finePrint)
                    .font(.caption)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .screenMargins()
        .padding(.top, TMLSpacing.space3)
        .padding(.bottom, TMLSpacing.space2)
    }
}

/// One row of the form: a footnote label over the input, inside the `surface` group. Focused, it
/// gets a 2pt `focus-ring` outline; with a problem, a 2pt `ink` outline (the prototype's `.field`).
private struct FieldCell<Input: View>: View {
    enum Position { case top, bottom, only }

    let label: LocalizedStringKey
    let isInvalid: Bool
    let isFocused: Bool
    let position: Position
    /// Tapping anywhere in the row, the label included, puts the cursor in its field.
    let onTap: () -> Void
    @ViewBuilder var input: Input

    var body: some View {
        VStack(alignment: .leading, spacing: TMLSpacing.space1) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(TMLColor.inkSecondary)
                // The input carries the same label for VoiceOver.
                .accessibilityHidden(true)
            input
                .font(.body)
                .foregroundStyle(TMLColor.ink)
                .tint(TMLColor.lamplightText)
                .frame(minHeight: 32)
        }
        .padding(.horizontal, TMLSpacing.space4)
        .padding(.vertical, TMLSpacing.space3)
        .frame(maxWidth: .infinity, minHeight: TMLSpacing.tapTarget, alignment: .leading)
        .contentShape(shape)
        .simultaneousGesture(TapGesture().onEnded(onTap))
        .overlay {
            if isInvalid || isFocused {
                shape.strokeBorder(isInvalid ? TMLColor.ink : TMLColor.focusRing, lineWidth: 2)
            }
        }
    }

    /// The outline follows the group's rounded corners on its own side.
    private var shape: UnevenRoundedRectangle {
        let radius = TMLRadius.lg
        return switch position {
        case .top: UnevenRoundedRectangle(topLeadingRadius: radius, topTrailingRadius: radius, style: .continuous)
        case .bottom: UnevenRoundedRectangle(bottomLeadingRadius: radius, bottomTrailingRadius: radius, style: .continuous)
        case .only: UnevenRoundedRectangle(topLeadingRadius: radius, bottomLeadingRadius: radius,
                                           bottomTrailingRadius: radius, topTrailingRadius: radius, style: .continuous)
        }
    }
}

/// "US +1": opens the country list. A `surface-raised` capsule, at least 44pt tall.
private struct CountryButton: View {
    let region: PhoneRegion
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TMLSpacing.space2) {
                Text(verbatim: "\(region.code) +\(region.callingCode)")
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(TMLColor.inkSecondary)
            }
            .foregroundStyle(TMLColor.ink)
            .padding(.horizontal, TMLSpacing.space3)
            .frame(minHeight: TMLSpacing.tapTarget)
            .background(TMLColor.surfaceRaised, in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Country: \(region.name()), plus \(region.callingCode)"))
        .accessibilityHint("Changes the country of your number")
    }
}
