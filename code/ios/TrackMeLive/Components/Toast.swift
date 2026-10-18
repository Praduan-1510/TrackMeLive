import SwiftUI
import TMLCore

/// A short message the app says while it's open ("Link copied. Paste it wherever you like."):
/// a Liquid Glass capsule under the screen's top bar, read out politely, never taking focus
/// (prototype `.toast`). It fades in and out, or just appears with Reduce Motion.
struct Toast: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(TMLColor.ink)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, TMLSpacing.space5)
            .padding(.vertical, TMLSpacing.space3)
            .glassEffect(.regular, in: .rect(cornerRadius: TMLRadius.lg, style: .continuous))
            .frame(maxWidth: 340)
            // Announced instead; VoiceOver focus stays where it was.
            .accessibilityHidden(true)
            .allowsHitTesting(false)
    }
}

extension View {
    /// Shows `text` as a toast at the top, `offset` below the safe area, and announces it politely.
    func toast(_ text: String?, offset: CGFloat = TMLSpacing.space2) -> some View {
        modifier(ToastModifier(text: text, offset: offset))
    }
}

private struct ToastModifier: ViewModifier {
    let text: String?
    let offset: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let text {
                    Toast(text: text)
                        .padding(.top, offset)
                        .padding(.horizontal, TMLSpacing.space4)
                        .transition(reduceMotion ? .identity : .opacity.combined(with: .move(edge: .top)))
                }
            }
            .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: text)
            .politeAnnouncement(of: text)
    }
}

extension View {
    /// Reads `text` out politely, once, each time it appears or changes (never when it goes away),
    /// without moving VoiceOver's focus: toasts, the 1-hour warning.
    func politeAnnouncement(of text: String?) -> some View {
        onChange(of: text) { _, text in
            guard let text else { return }
            var announcement = AttributedString(text)
            announcement.accessibilitySpeechAnnouncementPriority = .low
            AccessibilityNotification.Announcement(announcement).post()
        }
    }
}

#Preview("Toast") {
    TMLColor.mapLand.ignoresSafeArea().toast("Link copied. Paste it wherever you like.")
}

#Preview("Toast, dark") {
    TMLColor.mapLand.ignoresSafeArea().toast("Link copied. Paste it wherever you like.").preferredColorScheme(.dark)
}

#Preview("Toast, AX5") {
    TMLColor.mapLand.ignoresSafeArea().toast("Link copied. Paste it wherever you like.").dynamicTypeSize(.accessibility5)
}
