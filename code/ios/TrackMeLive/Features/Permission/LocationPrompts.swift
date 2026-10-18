import SwiftUI
import TMLCore

// The location step before sharing (FSD §8; prototype `permPrompt`), on Home: the explainer sheet
// before the system prompt, and the alerts for location that's off, off for the whole phone, or
// restricted. The Precise Location alert shows on the share and live screens.

extension View {
    /// The location step's explainer and alerts, driven by `gate`.
    func locationGatePrompts(_ gate: LocationGateModel) -> some View {
        modifier(LocationGatePrompts(gate: gate))
    }

    /// One of the location alerts (`prompt` is never the explainer here), with Open Settings
    /// opening what `openSettings` returns.
    func locationAlert(_ prompt: Binding<LocationPrompt?>, openSettings: @escaping () -> URL?) -> some View {
        modifier(LocationAlert(prompt: prompt, openSettings: openSettings))
    }
}

private struct LocationGatePrompts: ViewModifier {
    @Bindable var gate: LocationGateModel

    func body(content: Content) -> some View {
        content
            .sheet(item: explainer) { prompt in
                PermissionExplainer(
                    systemImage: "location.fill",
                    title: prompt.title,
                    message: prompt.message,
                    confirmTitle: prompt.confirmTitle ?? "Continue",
                    cancelTitle: prompt.cancelTitle
                ) {
                    Task { await gate.continueFromExplainer() }
                } onNotNow: {
                    gate.dismiss()
                }
            }
            .locationAlert(alert) { gate.openSettings() }
    }

    /// The explainer while it's up. Swiping it away is Not now; Continue has already cleared it, so
    /// the sheet closing then changes nothing.
    private var explainer: Binding<LocationPrompt?> {
        Binding(get: { gate.prompt?.isExplainer == true ? gate.prompt : nil },
                set: { if $0 == nil, gate.prompt?.isExplainer == true { gate.dismiss() } })
    }

    private var alert: Binding<LocationPrompt?> {
        Binding(get: { gate.prompt?.isExplainer == false ? gate.prompt : nil },
                set: { if $0 == nil, gate.prompt?.isExplainer == false { gate.dismiss() } })
    }
}

private struct LocationAlert: ViewModifier {
    @Binding var prompt: LocationPrompt?
    let openSettings: () -> URL?
    @Environment(\.openURL) private var openURL

    func body(content: Content) -> some View {
        content.alert(prompt?.title ?? "", isPresented: isPresented, presenting: prompt) { prompt in
            if let confirm = prompt.confirmTitle {
                Button(confirm) {
                    if let url = openSettings() { openURL(url) }
                }
            }
            Button(prompt.cancelTitle, role: .cancel) { self.prompt = nil }
        } message: { prompt in
            Text(verbatim: prompt.message)
        }
    }

    /// Alerts close only through their buttons, which say what happens next; the binding just follows.
    private var isPresented: Binding<Bool> {
        Binding(get: { prompt != nil && prompt?.isExplainer == false }, set: { _ in })
    }
}

/// Home with each of the location step's prompts, for the previews.
private struct LocationPromptsPreview: View {
    let gate: LocationGateModel

    init(_ authorization: LocationAuthorization) {
        gate = LocationGateModel(access: FakeLocationAccess(authorization: authorization))
    }

    var body: some View {
        TMLColor.ground
            .ignoresSafeArea()
            .locationGatePrompts(gate)
            .task { await gate.begin(wanting: .precise) { _, _ in } }
    }
}

#Preview("Explainer") { LocationPromptsPreview(.notAsked) }
#Preview("Explainer, dark") { LocationPromptsPreview(.notAsked).preferredColorScheme(.dark) }
#Preview("Explainer, AX5") { LocationPromptsPreview(.notAsked).dynamicTypeSize(.accessibility5) }
#Preview("Location off") { LocationPromptsPreview(LocationAuthorization(status: .denied, hasAsked: true)) }
#Preview("Location Services off") { LocationPromptsPreview(LocationAuthorization(status: .whenInUse, servicesEnabled: false)) }
#Preview("Restricted, dark") {
    LocationPromptsPreview(LocationAuthorization(status: .restricted)).preferredColorScheme(.dark)
}
