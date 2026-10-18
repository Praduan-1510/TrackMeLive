import SwiftUI
import TMLCore

/// When sharing stops (FSD §4 Stop rule; prototype `timer` modal): the choices on offer with a
/// check on the current one, and the 1-hour rule under them. Choosing closes the sheet. Used by the
/// share screen's Stops row and the live screen's Change timer.
struct TimerSheet: View {
    let sheet: TimerSheetPresentation
    let onChoose: (StopChoice) -> Void
    let onClose: () -> Void

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TMLSpacing.space4) {
                HStack(alignment: .top, spacing: TMLSpacing.space3) {
                    Text(verbatim: sheet.title)
                        .displayFont(.title2)
                        .foregroundStyle(TMLColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityAddTraits(.isHeader)
                    // Opaque, since the sheet itself is glass.
                    GlassBarButton("Close", systemImage: "xmark", action: onClose)
                }

                VStack(spacing: 0) {
                    ForEach(Array(sheet.choices.enumerated()), id: \.element.id) { index, choice in
                        if index > 0 {
                            Rectangle()
                                .fill(TMLColor.separator)
                                .frame(height: 1 / displayScale)
                                .padding(.leading, TMLSpacing.space4)
                                .accessibilityHidden(true)
                        }
                        ChoiceRow(choice: choice) { onChoose(choice.choice) }
                    }
                }
                .background(TMLColor.surfaceRaised, in: .rect(cornerRadius: TMLRadius.md, style: .continuous))

                Text(verbatim: sheet.footer)
                    .font(.caption)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
            }
            .padding(TMLSpacing.space5)
        }
        .scrollBounceBehavior(.basedOnSize)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

private struct ChoiceRow: View {
    let choice: TimerSheetPresentation.Choice
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TMLSpacing.space3) {
                Text(verbatim: choice.label)
                    .font(.body)
                    .monospacedDigit()
                    .foregroundStyle(TMLColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(TMLColor.lamplightText)
                    .opacity(choice.isSelected ? 1 : 0)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, TMLSpacing.space4)
            .padding(.vertical, TMLSpacing.space3)
            .frame(minHeight: TMLSpacing.tapTarget)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(choice.isSelected ? .isSelected : [])
    }
}

/// The sheet before sharing and while sharing near the limit, for the previews.
private struct TimerSheetGallery: View {
    var sheet: TimerSheetPresentation

    var body: some View {
        TMLColor.ground
            .ignoresSafeArea()
            .sheet(isPresented: .constant(true)) {
                TimerSheet(sheet: sheet, onChoose: { _ in }, onClose: {})
            }
    }
}

private let beforeSharing = TimerSheetPresentation(choices: StopChoice.beforeSharing(onCall: false),
                                                   selected: .minutes(.minutes30), expiresAt: nil, callOffered: false)
private let nearTheLimit = TimerSheetPresentation(choices: [.minutes(.minutes15), .limit], selected: .limit,
                                                  expiresAt: Date().addingTimeInterval(20 * 60), callOffered: false)

#Preview("Timer sheet") { TimerSheetGallery(sheet: beforeSharing) }
#Preview("Timer sheet, dark") { TimerSheetGallery(sheet: nearTheLimit).preferredColorScheme(.dark) }
#Preview("Timer sheet, AX5") { TimerSheetGallery(sheet: nearTheLimit).dynamicTypeSize(.accessibility5) }
