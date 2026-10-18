import SwiftUI
import TMLCore

/// After a share ends (FSD §4 Auto-expiry, Stop sharing; prototype `viewEnded`): the mascot in a
/// dashed ring, why it ended, a short summary and when its points are deleted. Done goes back to
/// Home. At the 1-hour limit, Share again leads: a new session with a new link, straight to the
/// share sheet. The heading is announced once, as the screen appears.
struct EndedScreen: View {
    let flow: ShareFlowModel
    let ended: EndedShare
    let look: MascotLook

    @AccessibilityFocusState private var headingFocused: Bool
    @ScaledMetric(relativeTo: .largeTitle) private var artSize: CGFloat = 168

    var body: some View {
        let p = EndedPresentation(ended: ended)
        ScrollView {
            VStack(spacing: TMLSpacing.space4) {
                ZStack {
                    Circle()
                        .strokeBorder(TMLColor.inkTertiary, style: StrokeStyle(lineWidth: 3, dash: [6, 5]))
                        .opacity(0.6)
                    MascotImage(look: look, size: min(artSize, 168) * 128 / 168)
                        .opacity(0.85)
                }
                .frame(width: min(artSize, 168), height: min(artSize, 168))
                .accessibilityHidden(true)

                VStack(spacing: TMLSpacing.space2) {
                    Text(verbatim: p.title)
                        .displayFont(.largeTitle)
                        .foregroundStyle(TMLColor.ink)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused($headingFocused)
                    Text(verbatim: p.message)
                        .font(.callout)
                        .foregroundStyle(TMLColor.inkSecondary)
                }
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

                RowGroup {
                    ForEach(p.summary) { row in
                        SummaryLine(label: row.label, value: row.value)
                    }
                }

                Text(verbatim: p.deletion)
                    .font(.caption)
                    .foregroundStyle(TMLColor.inkSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, TMLSpacing.space6)
            .padding(.bottom, TMLSpacing.space4)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: TMLSpacing.space2) {
                if p.offersShareAgain {
                    PrimaryButton("Share again", systemImage: "location.fill") {
                        Task { await flow.shareAgain() }
                    }
                    PlainInkButton("Done") { flow.done() }
                } else {
                    PrimaryButton("Done") { flow.done() }
                }
            }
            .padding(.bottom, TMLSpacing.space4)
            .background(TMLColor.ground)
        }
        .screenMargins()
        .background(TMLColor.ground)
        .toolbarVisibility(.hidden, for: .navigationBar)
        .toolbarVisibility(.hidden, for: .tabBar)
        .navigationBarBackButtonHidden()
        .task {
            // Announce the heading once, by moving VoiceOver to it.
            headingFocused = true
        }
    }
}

// MARK: - Previews

private struct EndedPreview: View {
    let flow: ShareFlowModel
    let ended: EndedShare

    init(_ reason: ShareEndReason, viewerName: String? = "Mom", opened: Bool = true) {
        let start = Date().addingTimeInterval(reason == .limit ? -3_600 : -14 * 60)
        ended = EndedShare(sessionId: "preview", reason: reason, startedAt: start, endedAt: Date(), viewerName: viewerName,
                           firstViewedAt: opened ? start.addingTimeInterval(120) : nil, confirmed: true)
        flow = ShareFlowModel(sharing: FixedSharingService(state: .ended(ended)), access: FakeLocationAccess(),
                              permissions: FixedPermissionsService(), profile: { nil })
    }

    var body: some View {
        NavigationStack {
            EndedScreen(flow: flow, ended: ended, look: MascotLook(mascot: .fox))
        }
    }
}

#Preview("Ended, stopped") { EndedPreview(.stopped) }
#Preview("Ended, timer, dark") { EndedPreview(.timer, viewerName: nil, opened: false).preferredColorScheme(.dark) }
#Preview("Ended, limit") { EndedPreview(.limit) }
#Preview("Ended, limit, AX5") { EndedPreview(.limit).dynamicTypeSize(.accessibility5) }
#Preview("Ended, call") { EndedPreview(.call) }
