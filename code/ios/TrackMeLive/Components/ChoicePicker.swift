import SwiftUI
import TMLCore

/// A choice between a few short options: the native segmented `Picker` at standard text sizes,
/// and a native menu `Picker` at the accessibility sizes, where segments would truncate their
/// labels. Either way VoiceOver reads it as one picker with its selected value.
///
/// In a `Form` row it shows its label over the segments (Location detail, Appearance), or the
/// label with the value beside it as a menu.
struct ChoicePicker<Value: Hashable & Identifiable>: View {
    let title: LocalizedStringKey
    let options: [Value]
    @Binding var selection: Value
    let label: (Value) -> String
    /// Show the title above the segments (false when a section header already names it).
    var showsTitle = true

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(_ title: LocalizedStringKey, selection: Binding<Value>, options: [Value], showsTitle: Bool = true,
         label: @escaping (Value) -> String) {
        self.title = title
        _selection = selection
        self.options = options
        self.showsTitle = showsTitle
        self.label = label
    }

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            Picker(title, selection: $selection) { optionTags }
                .pickerStyle(.menu)
        } else {
            VStack(alignment: .leading, spacing: TMLSpacing.space2) {
                if showsTitle {
                    Text(title)
                        .foregroundStyle(TMLColor.ink)
                        .accessibilityHidden(true) // the picker carries the same label
                }
                Picker(title, selection: $selection) { optionTags }
                    .pickerStyle(.segmented)
                    .labelsHidden()
            }
            .padding(.vertical, TMLSpacing.space1)
        }
    }

    private var optionTags: some View {
        ForEach(options) { option in
            Text(label(option)).tag(option)
        }
    }
}

/// The in-app explainer before a system permission prompt (prototype `ask`): a picture, what the
/// permission is for, the prominent action and Not now. Shown as a sheet sized to its content.
struct PermissionExplainer: View {
    let systemImage: String
    let title: String
    let message: String
    let confirmTitle: String
    let cancelTitle: String
    let onContinue: () -> Void
    let onNotNow: () -> Void

    @ScaledMetric(relativeTo: .title) private var artSize: CGFloat = 72

    init(systemImage: String, title: String, message: String, confirmTitle: String, cancelTitle: String,
         onContinue: @escaping () -> Void, onNotNow: @escaping () -> Void) {
        self.systemImage = systemImage
        self.title = title
        self.message = message
        self.confirmTitle = confirmTitle
        self.cancelTitle = cancelTitle
        self.onContinue = onContinue
        self.onNotNow = onNotNow
    }

    /// Settings' explainers.
    init(prompt: PermissionPrompt, onContinue: @escaping () -> Void, onNotNow: @escaping () -> Void) {
        self.init(systemImage: prompt.systemImage, title: prompt.title, message: prompt.message,
                  confirmTitle: prompt.confirmTitle, cancelTitle: prompt.cancelTitle,
                  onContinue: onContinue, onNotNow: onNotNow)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: TMLSpacing.space4) {
                Image(systemName: systemImage)
                    .font(.title.weight(.semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(TMLColor.lamplightText)
                    .frame(width: artSize, height: artSize)
                    .background(TMLColor.lamplightWash, in: .circle)
                    .accessibilityHidden(true)
                VStack(spacing: TMLSpacing.space2) {
                    Text(verbatim: title)
                        .displayFont(.title2)
                        .foregroundStyle(TMLColor.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(verbatim: message)
                        .font(.callout)
                        .foregroundStyle(TMLColor.inkSecondary)
                }
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: TMLSpacing.space1) {
                    PrimaryButton(LocalizedStringKey(confirmTitle), action: onContinue)
                    PlainInkButton(LocalizedStringKey(cancelTitle), action: onNotNow)
                }
            }
            .padding(TMLSpacing.space5)
            .padding(.top, TMLSpacing.space3)
        }
        .scrollBounceBehavior(.basedOnSize)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

/// Both choice pickers and both explainers, for the previews.
private struct ChoiceGallery: View {
    @State private var precision = TMLPrecision.precise

    var body: some View {
        Form {
            ChoicePicker("Location detail", selection: $precision, options: TMLPrecision.allCases) { $0.label }
        }
        .sheet(isPresented: .constant(true)) {
            PermissionExplainer(prompt: .locationExplainer, onContinue: {}, onNotNow: {})
        }
    }
}

#Preview("Choice and explainer") { ChoiceGallery() }
#Preview("Choice and explainer, dark") { ChoiceGallery().preferredColorScheme(.dark) }
#Preview("Choice and explainer, AX5") { ChoiceGallery().dynamicTypeSize(.accessibility5) }
