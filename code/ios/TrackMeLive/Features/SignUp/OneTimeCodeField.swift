import SwiftUI
import TMLCore

/// The 6-digit code as six boxes over one real text field. The field does the typing, pasting and
/// the "From Messages" suggestion (`.oneTimeCode`), and is what VoiceOver reads; the boxes only draw
/// it. The box for the next digit shows a lamplight outline and caret; a wrong or expired code
/// outlines every box, next to the message that says so.
struct OneTimeCodeField: View {
    @Binding var code: String
    let isInvalid: Bool
    var focus: FocusState<SignUpModel.Field?>.Binding
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isFocused: Bool { focus.wrappedValue == .code }

    var body: some View {
        ZStack {
            HStack(spacing: TMLSpacing.space2) {
                ForEach(0..<OneTimeCode.length, id: \.self) { index in
                    DigitBox(
                        digit: digit(at: index),
                        isCurrent: isFocused && index == min(code.count, OneTimeCode.length - 1) && code.count < OneTimeCode.length,
                        isInvalid: isInvalid
                    )
                }
            }
            .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.6), value: code)
            .accessibilityHidden(true)

            TextField("", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused(focus, equals: .code)
                // The boxes show the digits; the field stays invisible on top of them to take taps.
                .foregroundStyle(.clear)
                .tint(.clear)
                .frame(maxWidth: .infinity, minHeight: 56)
                .accessibilityLabel("6-digit code")
                .accessibilityValue(accessibilityValue)
        }
        // Digits stay a readable size in the boxes at the largest text sizes.
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    }

    private func digit(at index: Int) -> Character? {
        index < code.count ? code[code.index(code.startIndex, offsetBy: index)] : nil
    }

    /// "4 8 2, 3 of 6 digits", so VoiceOver reads digits rather than a number.
    private var accessibilityValue: Text {
        if code.isEmpty { return Text("Empty") }
        let spelled = code.map(String.init).joined(separator: " ")
        return Text("\(spelled), \(code.count) of \(OneTimeCode.length) digits")
    }
}

private struct DigitBox: View {
    let digit: Character?
    let isCurrent: Bool
    let isInvalid: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: TMLRadius.xs, style: .continuous)
                .fill(TMLColor.surface)
            RoundedRectangle(cornerRadius: TMLRadius.xs, style: .continuous)
                .strokeBorder(stroke, lineWidth: isCurrent || isInvalid ? 2 : 1)
            if let digit {
                Text(String(digit))
                    .displayFont(.distance)
                    .monospacedDigit()
                    .foregroundStyle(TMLColor.ink)
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
            } else if isCurrent {
                Caret(blinks: !reduceMotion)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 56)
    }

    private var stroke: Color {
        if isCurrent { return TMLColor.lamplight }
        if isInvalid { return TMLColor.inkTertiary }
        return TMLColor.separator
    }
}

/// The text caret in the current box. It blinks once a second, and holds still with Reduce Motion.
private struct Caret: View {
    let blinks: Bool

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { context in
            let visible = !blinks || Int(context.date.timeIntervalSinceReferenceDate * 2) % 2 == 0
            Capsule()
                .fill(TMLColor.lamplightText)
                .frame(width: 2, height: 26)
                .opacity(visible ? 1 : 0)
        }
    }
}
